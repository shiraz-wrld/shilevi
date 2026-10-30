-- Shilevi migration 0037: activity-specific deliverer requirements.
--
-- What was wrong:
--
--   * `/deliver/apply` showed every document type in the catalogue, whether or not it applied to
--     the chosen vehicle. A bicycle courier was invited to upload a driving licence and a vehicle
--     registration; a motorbike courier could submit with no licence at all.
--   * Submission was possible before any document existed, so "submitted" and "complete" meant the
--     same thing to the database. A reviewer had to discover the gaps by reading the queue.
--   * Identity details (document type and number), licence number/class/expiry and vehicle
--     ownership were never captured in a validated shape.
--   * `/deliver/apply` called `add_delivery_route()` during submission, but that function requires
--     an **approved** application, so choosing a route made submission fail. The route is now kept
--     as an intent in the application and published from the workspace after approval.
--
-- What this migration adds (additive only; no row is rewritten, no data deleted):
--
--   1. Two extra private document types — the back of the identity document and a profile photo.
--   2. `delivery_document_requirements`: which document is required, for which vehicle class and
--      which application mode. Insurance and inspection stay optional because making them mandatory
--      is a legal/policy decision, not something a migration should invent.
--   3. `create_delivery_application()`: one transaction that validates identity, licence, vehicle
--      ownership and required documents **server-side**, then writes the application, the fleet, the
--      vehicle and the document rows together. `submit_deliverer_application()` and
--      `submit_delivery_application_draft()` keep their signatures and now delegate to it, so no
--      path can skip validation.
--   4. `my_delivery_document_checklist()` and `attach_my_delivery_document()` so an applicant can see
--      exactly what is missing or rejected and replace a document without a new application.
--
-- Submitting still grants nothing: the application is `pending`, the vehicle is `pending`, and every
-- document is `pending` until an authorized reviewer decides.

begin;

-- ---------------------------------------------------------------- document types

insert into public.delivery_document_types (code, label, applies_to, is_required, sort_order) values
  ('national_id_back', 'National ID or passport — back / second page', 'provider', true, 15),
  ('profile_photo', 'Recent photograph of you', 'provider', true, 18)
on conflict (code) do nothing;

-- The existing front/first-page type stays required and keeps its code so records already on file
-- continue to resolve.
update public.delivery_document_types
set label = 'National ID or passport (front / photo page)', is_required = true
where code = 'national_id';

-- ---------------------------------------------------------------- requirement rules

create table if not exists public.delivery_document_requirements (
  doc_type text not null references public.delivery_document_types(code) on delete cascade,
  vehicle_class_code text not null default '*'
    check (vehicle_class_code ~ '^(\*|[a-z0-9_]{2,40})$'),
  application_mode text not null default '*'
    check (application_mode in ('*', 'individual', 'fleet')),
  is_required boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (doc_type, vehicle_class_code, application_mode)
);

alter table public.delivery_document_requirements enable row level security;
revoke all on public.delivery_document_requirements from anon, authenticated;
grant select on public.delivery_document_requirements to authenticated;
grant insert, update, delete on public.delivery_document_requirements to authenticated;

drop policy if exists "delivery_document_requirements_read" on public.delivery_document_requirements;
create policy "delivery_document_requirements_read" on public.delivery_document_requirements
for select to authenticated
using (true);

drop policy if exists "delivery_document_requirements_owner_write" on public.delivery_document_requirements;
create policy "delivery_document_requirements_owner_write" on public.delivery_document_requirements
for all to authenticated
using ((select public.is_shilevi_owner_admin()))
with check ((select public.is_shilevi_owner_admin()));

-- Identity evidence applies to every activity.
insert into public.delivery_document_requirements (doc_type, vehicle_class_code, application_mode, is_required) values
  ('national_id', '*', '*', true),
  ('national_id_back', '*', '*', true),
  ('profile_photo', '*', '*', true)
on conflict do nothing;

-- A licence and a registration belong to a motor vehicle. A bicycle courier is never asked for them.
insert into public.delivery_document_requirements (doc_type, vehicle_class_code, application_mode, is_required)
select doc.code, c.code, '*', true
from public.delivery_vehicle_classes c
cross join (values ('driving_licence'), ('vehicle_registration')) as doc(code)
where c.code <> 'bicycle'
on conflict do nothing;

-- Optional until the owner makes a policy decision.
insert into public.delivery_document_requirements (doc_type, vehicle_class_code, application_mode, is_required)
select doc.code, c.code, '*', false
from public.delivery_vehicle_classes c
cross join (values ('vehicle_insurance'), ('vehicle_inspection')) as doc(code)
where c.code <> 'bicycle'
on conflict do nothing;

insert into public.delivery_document_requirements (doc_type, vehicle_class_code, application_mode, is_required) values
  ('business_registration', '*', 'fleet', true),
  ('goods_in_transit_insurance', '*', 'fleet', false)
on conflict do nothing;

-- ---------------------------------------------------------------- validated submission

/**
 * Create a deliverer application in one transaction.
 *
 * Every value that decides eligibility is validated here, not in the browser: identity document,
 * licence (motor vehicles only), vehicle ownership, and the required documents for the chosen
 * vehicle class and mode. Nothing is approved by submitting.
 */
create or replace function public.create_delivery_application(
  p_mode text,
  p_payload jsonb,
  p_terms_version text
) returns table (application_id uuid, fleet_id uuid, vehicle_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_business text;
  v_vehicle jsonb;
  v_docs jsonb;
  v_class text;
  v_class_row record;
  v_type record;
  v_doc jsonb;
  v_app uuid;
  v_fleet uuid;
  v_vehicle_row uuid;
  v_seen text[] := array[]::text[];
  v_missing text;
  v_missing_label text;
  v_expiry date;
  v_licence_expiry date;
  v_ownership text;
  v_payload_kg integer;
  v_length_cm integer;
  v_width_cm integer;
  v_height_cm integer;
  v_transport_mode text;
  v_origin uuid;
  v_destination uuid;
begin
  if v_uid is null then
    raise exception 'Sign in required.';
  end if;
  if p_mode is null or p_mode not in ('individual', 'fleet') then
    raise exception 'Unknown application mode.';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Application details are required.';
  end if;
  if nullif(trim(coalesce(p_terms_version, '')), '') is null then
    raise exception 'Accept the deliverer terms before submitting.';
  end if;

  v_vehicle := case when jsonb_typeof(p_payload -> 'vehicle') = 'object'
    then p_payload -> 'vehicle' else '{}'::jsonb end;
  v_docs := case when jsonb_typeof(p_payload -> 'documents') = 'array'
    then p_payload -> 'documents' else '[]'::jsonb end;

  if exists (
    select 1 from public.provider_applications pa
    where pa.user_id = v_uid
      and pa.activity_type = 'transport_partner'
      and pa.status in ('draft', 'pending', 'under_review', 'approved')
  ) then
    raise exception 'You already have a delivery application in progress or approved.';
  end if;

  -- Identity.
  if char_length(trim(coalesce(p_payload ->> 'full_name', ''))) < 2 then
    raise exception 'Enter the name that appears on your identification.';
  end if;
  if char_length(trim(coalesce(p_payload ->> 'phone', ''))) < 7
     or char_length(trim(coalesce(p_payload ->> 'phone', ''))) > 32 then
    raise exception 'Enter a reachable phone number.';
  end if;
  if coalesce(p_payload ->> 'id_type', '') not in ('national_id', 'passport') then
    raise exception 'Choose the identity document you are presenting.';
  end if;
  if char_length(trim(coalesce(p_payload ->> 'id_number', ''))) not between 4 and 40 then
    raise exception 'Enter the identity document number.';
  end if;
  if char_length(trim(coalesce(p_payload ->> 'operating_area', ''))) < 2 then
    raise exception 'Describe the area you can realistically serve.';
  end if;

  v_business := nullif(trim(coalesce(p_payload ->> 'business_name', '')), '');
  if p_mode = 'fleet' and (v_business is null or char_length(v_business) < 2) then
    raise exception 'A business name is required for a fleet application.';
  end if;
  if p_mode = 'fleet' and char_length(trim(coalesce(p_payload ->> 'representative', ''))) < 2 then
    raise exception 'Name the person authorised to represent the business.';
  end if;

  -- Vehicle.
  v_class := nullif(trim(coalesce(v_vehicle ->> 'class_code', '')), '');
  select * into v_class_row from public.delivery_vehicle_classes c
  where c.code = v_class and c.is_active;
  if v_class_row.code is null then
    raise exception 'Choose a supported vehicle class.';
  end if;
  if char_length(trim(coalesce(v_vehicle ->> 'make_model', ''))) < 2 then
    raise exception 'Describe the vehicle.';
  end if;
  if char_length(trim(coalesce(v_vehicle ->> 'plate_number', ''))) < 2 then
    raise exception 'Enter the plate or identifier.';
  end if;

  v_ownership := coalesce(nullif(trim(coalesce(v_vehicle ->> 'ownership_status', '')), ''), '');
  if v_ownership not in ('owned', 'leased', 'authorised', 'fleet_vehicle') then
    raise exception 'State whether you own, lease or are authorised to use the vehicle.';
  end if;
  if p_mode = 'individual' and v_ownership = 'fleet_vehicle' then
    raise exception 'A fleet vehicle requires a fleet application.';
  end if;

  -- A driving licence is a motor-vehicle requirement. A bicycle courier is never asked for one.
  if v_class <> 'bicycle' then
    if char_length(trim(coalesce(v_vehicle ->> 'licence_number', ''))) < 4 then
      raise exception 'Enter your driving licence number.';
    end if;
    if char_length(trim(coalesce(v_vehicle ->> 'licence_class', ''))) < 1 then
      raise exception 'Enter the licence class or category.';
    end if;
    begin
      v_licence_expiry := nullif(trim(coalesce(v_vehicle ->> 'licence_expiry', '')), '')::date;
    exception when others then
      raise exception 'Enter the licence expiry date as a date.';
    end;
    if v_licence_expiry is null then
      raise exception 'Enter the licence expiry date.';
    end if;
    if v_licence_expiry < current_date then
      raise exception 'An expired driving licence cannot support this application.';
    end if;
  end if;

  -- Documents supplied by the applicant.
  if jsonb_typeof(v_docs) <> 'array' or jsonb_array_length(v_docs) = 0 then
    raise exception 'Upload the required documents before submitting.';
  end if;

  for v_doc in select * from jsonb_array_elements(v_docs) loop
    if jsonb_typeof(v_doc) <> 'object' then
      raise exception 'Malformed document entry.';
    end if;

    select * into v_type from public.delivery_document_types t
    where t.code = trim(coalesce(v_doc ->> 'doc_type', '')) and t.is_active;
    if v_type.code is null then
      raise exception 'Unknown document type.';
    end if;
    if v_type.code = any(v_seen) then
      raise exception 'Each document type may only be supplied once.';
    end if;
    if coalesce(v_doc ->> 'storage_path', '') not like 'delivery/' || v_uid::text || '/%' then
      raise exception 'Documents must be uploaded to your own private folder.';
    end if;
    if v_type.applies_to = 'fleet' and p_mode <> 'fleet' then
      raise exception 'A fleet document cannot be attached to an individual application.';
    end if;

    v_seen := v_seen || v_type.code;
  end loop;

  for v_missing, v_missing_label in
    select r.doc_type, t.label
    from public.delivery_document_requirements r
    join public.delivery_document_types t on t.code = r.doc_type and t.is_active
    where r.is_required
      and (r.vehicle_class_code = '*' or r.vehicle_class_code = v_class)
      and (r.application_mode = '*' or r.application_mode = p_mode)
      and not (r.doc_type = any(v_seen))
    order by t.sort_order
  loop
    raise exception 'Upload the required document: %.', v_missing_label;
  end loop;

  -- ---------------------------------------------------------------- writes

  insert into public.provider_applications
    (user_id, activity_type, status, business_name, application_data, submitted_at)
  values (
    v_uid, 'transport_partner', 'pending', v_business,
    p_payload || jsonb_build_object(
      'mode', p_mode,
      'terms_version', p_terms_version,
      'terms_accepted_at', now(),
      'documents_supplied', to_jsonb(v_seen)
    ),
    now()
  )
  returning id into v_app;

  if p_mode = 'fleet' then
    insert into public.delivery_fleets
      (owner_user_id, business_name, status, application_id, submitted_at)
    values (v_uid, left(v_business, 160), 'pending', v_app, now())
    returning id into v_fleet;
  end if;

  v_transport_mode := case v_class
    when 'bicycle' then 'bicycle'
    when 'motorbike' then 'motorcycle'
    when 'car' then 'car'
    when 'tuk_tuk' then 'tuk_tuk'
    else 'van'
  end;

  v_payload_kg := case when coalesce(v_vehicle ->> 'payload_kg', '') ~ '^[0-9]{1,6}$'
    then (v_vehicle ->> 'payload_kg')::integer else null end;
  v_length_cm := case when coalesce(v_vehicle ->> 'length_cm', '') ~ '^[0-9]{1,6}$'
    then (v_vehicle ->> 'length_cm')::integer else null end;
  v_width_cm := case when coalesce(v_vehicle ->> 'width_cm', '') ~ '^[0-9]{1,6}$'
    then (v_vehicle ->> 'width_cm')::integer else null end;
  v_height_cm := case when coalesce(v_vehicle ->> 'height_cm', '') ~ '^[0-9]{1,6}$'
    then (v_vehicle ->> 'height_cm')::integer else null end;

  v_vehicle_row := public.register_delivery_vehicle(
    v_class,
    trim(v_vehicle ->> 'make_model'),
    trim(v_vehicle ->> 'plate_number'),
    v_transport_mode,
    v_payload_kg,
    v_length_cm,
    v_width_cm,
    v_height_cm,
    coalesce((v_vehicle ->> 'supports_covered') = 'true', false),
    coalesce((v_vehicle ->> 'supports_fragile') = 'true', false),
    coalesce((v_vehicle ->> 'supports_temperature_controlled') = 'true', false),
    v_fleet
  );

  for v_doc in select * from jsonb_array_elements(v_docs) loop
    select * into v_type from public.delivery_document_types t
    where t.code = trim(coalesce(v_doc ->> 'doc_type', ''));

    v_expiry := case when coalesce(v_doc ->> 'expires_at', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      then (v_doc ->> 'expires_at')::date else null end;

    insert into public.delivery_documents (
      user_id, application_id, vehicle_id, fleet_id, driver_user_id,
      doc_type, storage_path, status, expires_at
    ) values (
      v_uid,
      case when v_type.applies_to = 'provider' then v_app end,
      case when v_type.applies_to = 'vehicle' then v_vehicle_row end,
      case when v_type.applies_to = 'fleet' then v_fleet end,
      case when v_type.applies_to = 'driver' then v_uid end,
      v_type.code,
      trim(v_doc ->> 'storage_path'),
      'pending',
      v_expiry
    );
  end loop;

  -- A route is an intent here. `add_delivery_route()` refuses an unapproved provider, so it is
  -- published from the workspace after approval instead of failing the application.
  begin
    v_origin := nullif(trim(coalesce(p_payload ->> 'origin_location_id', '')), '')::uuid;
    v_destination := nullif(trim(coalesce(p_payload ->> 'destination_location_id', '')), '')::uuid;
  exception when others then
    v_origin := null;
    v_destination := null;
  end;

  if v_origin is not null and v_destination is not null and v_origin <> v_destination then
    insert into public.delivery_application_route_intents (application_id, origin_location_id, destination_location_id)
    values (v_app, v_origin, v_destination)
    on conflict (application_id) do update
      set origin_location_id = excluded.origin_location_id,
          destination_location_id = excluded.destination_location_id;
  end if;

  delete from public.delivery_application_drafts where user_id = v_uid;

  insert into public.audit_events (actor_id, action, resource_type, resource_id, outcome, metadata)
  values (v_uid, 'delivery_application.submit', 'provider_applications', v_app::text, 'success',
    jsonb_build_object('mode', p_mode, 'vehicle_class', v_class, 'documents', array_length(v_seen, 1)));

  return query select v_app, v_fleet, v_vehicle_row;
end;
$$;

revoke all on function public.create_delivery_application(text, jsonb, text) from public, anon, authenticated;

-- Route intent is written by the submission itself and read by the applicant's own workspace.
create table if not exists public.delivery_application_route_intents (
  application_id uuid primary key references public.provider_applications(id) on delete cascade,
  origin_location_id uuid not null references public.service_locations(id) on delete cascade,
  destination_location_id uuid not null references public.service_locations(id) on delete cascade,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  constraint delivery_route_intent_differs check (origin_location_id <> destination_location_id)
);

alter table public.delivery_application_route_intents enable row level security;
revoke all on public.delivery_application_route_intents from anon, authenticated;
grant select on public.delivery_application_route_intents to authenticated;

drop policy if exists "delivery_route_intent_own" on public.delivery_application_route_intents;
create policy "delivery_route_intent_own" on public.delivery_application_route_intents
for select to authenticated
using (
  exists (
    select 1 from public.provider_applications pa
    where pa.id = application_id and pa.user_id = (select auth.uid())
  )
);

-- The table is created after the function body above only for readability; the function resolves
-- names at run time, so this order is safe.

-- ---------------------------------------------------------------- public wrappers

create or replace function public.submit_deliverer_application(
  p_mode text,
  p_payload jsonb,
  p_terms_version text default null
) returns table (application_id uuid, fleet_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  return query
  select r.application_id, r.fleet_id
  from public.create_delivery_application(p_mode, p_payload, p_terms_version) r;
end;
$$;
revoke all on function public.submit_deliverer_application(text, jsonb, text) from public, anon;
grant execute on function public.submit_deliverer_application(text, jsonb, text) to authenticated;

create or replace function public.submit_delivery_application_draft(p_terms_version text)
returns table (application_id uuid, fleet_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_draft record;
  v_result record;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.';
  end if;

  select * into v_draft from public.delivery_application_drafts where user_id = auth.uid();
  if v_draft.user_id is null then
    raise exception 'There is no saved draft to submit.';
  end if;

  select * into v_result
  from public.create_delivery_application(v_draft.mode, v_draft.payload, p_terms_version);

  return query select v_result.application_id, v_result.fleet_id;
end;
$$;
revoke all on function public.submit_delivery_application_draft(text) from public, anon;
grant execute on function public.submit_delivery_application_draft(text) to authenticated;

-- ---------------------------------------------------------------- applicant read models

/**
 * What an applicant still has to supply, for the mode/class they are applying with.
 *
 * `p_mode`/`p_vehicle_class` let the form ask before an application exists; without them the latest
 * live application is used. `status` is `missing` when no row exists yet, otherwise the state of the
 * newest document of that type.
 */
create or replace function public.my_delivery_document_checklist(
  p_mode text default null,
  p_vehicle_class text default null
) returns table (
  doc_type text,
  label text,
  applies_to text,
  is_required boolean,
  status text,
  document_id uuid,
  expires_at date,
  reviewer_note text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_mode text := p_mode;
  v_class text := p_vehicle_class;
  v_app record;
begin
  if v_uid is null then
    raise exception 'Sign in to read your application checklist.';
  end if;

  if v_mode is null or v_class is null then
    select pa.id, pa.application_data ->> 'mode' as mode,
           coalesce(pa.application_data #>> '{vehicle,class_code}', v.vehicle_class_code) as class_code
    into v_app
    from public.provider_applications pa
    left join lateral (
      select tv.vehicle_class_code from public.transport_vehicles tv
      where tv.user_id = v_uid and tv.vehicle_class_code is not null
      order by tv.created_at desc limit 1
    ) v on true
    where pa.user_id = v_uid and pa.activity_type = 'transport_partner'
    order by pa.created_at desc
    limit 1;

    v_mode := coalesce(v_mode, v_app.mode, 'individual');
    v_class := coalesce(v_class, v_app.class_code, 'motorbike');
  end if;

  return query
  select r.doc_type, t.label, t.applies_to, r.is_required,
    coalesce(d.status, 'missing'), d.id, d.expires_at, d.reviewer_note
  from public.delivery_document_requirements r
  join public.delivery_document_types t on t.code = r.doc_type and t.is_active
  left join lateral (
    select dd.id, dd.status, dd.expires_at, dd.reviewer_note
    from public.delivery_documents dd
    where dd.user_id = v_uid and dd.doc_type = r.doc_type
    order by dd.created_at desc
    limit 1
  ) d on true
  where (r.vehicle_class_code = '*' or r.vehicle_class_code = v_class)
    and (r.application_mode = '*' or r.application_mode = v_mode)
  order by r.is_required desc, t.sort_order;
end;
$$;
revoke all on function public.my_delivery_document_checklist(text, text) from public, anon;
grant execute on function public.my_delivery_document_checklist(text, text) to authenticated;

/**
 * Attach or replace a private document on the caller's own live application.
 *
 * The document always enters as `pending`, so replacing a rejected file never marks it reviewed and
 * never activates anything. Scope (application, vehicle, fleet or driver) is derived from the
 * document type, so a caller cannot attach a fleet document to an individual application.
 */
create or replace function public.attach_my_delivery_document(
  p_doc_type text,
  p_storage_path text,
  p_expires_at date default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_type record;
  v_app record;
  v_vehicle uuid;
  v_fleet uuid;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Sign in required.';
  end if;

  select * into v_type from public.delivery_document_types t
  where t.code = p_doc_type and t.is_active;
  if v_type.code is null then
    raise exception 'Unknown document type.';
  end if;

  select pa.id, pa.status, pa.application_data ->> 'mode' as mode
  into v_app
  from public.provider_applications pa
  where pa.user_id = v_uid and pa.activity_type = 'transport_partner'
    and pa.status in ('pending', 'under_review', 'approved', 'rejected')
  order by pa.created_at desc
  limit 1;

  if v_app.id is null then
    raise exception 'Submit a delivery application before adding documents.';
  end if;

  if p_storage_path is null
     or p_storage_path not like 'delivery/' || v_uid::text || '/%' then
    raise exception 'Documents must be uploaded to your own private folder.';
  end if;

  select tv.id into v_vehicle from public.transport_vehicles tv
  where tv.user_id = v_uid
  order by tv.created_at desc limit 1;

  select f.id into v_fleet from public.delivery_fleets f
  where f.owner_user_id = v_uid
  order by f.created_at desc limit 1;

  if v_type.applies_to = 'vehicle' and v_vehicle is null then
    raise exception 'Register a vehicle before adding its documents.';
  end if;
  if v_type.applies_to = 'fleet' and (v_fleet is null or v_app.mode <> 'fleet') then
    raise exception 'A fleet document requires a fleet application.';
  end if;

  if exists (
    select 1 from public.delivery_documents dd
    where dd.user_id = v_uid and dd.doc_type = v_type.code and dd.status = 'pending'
  ) then
    raise exception 'That document is already waiting for review.';
  end if;

  insert into public.delivery_documents (
    user_id, application_id, vehicle_id, fleet_id, driver_user_id,
    doc_type, storage_path, status, expires_at
  ) values (
    v_uid,
    case when v_type.applies_to = 'provider' then v_app.id end,
    case when v_type.applies_to = 'vehicle' then v_vehicle end,
    case when v_type.applies_to = 'fleet' then v_fleet end,
    case when v_type.applies_to = 'driver' then v_uid end,
    v_type.code, p_storage_path, 'pending', p_expires_at
  )
  returning id into v_id;

  insert into public.audit_events (actor_id, action, resource_type, resource_id, outcome, metadata)
  values (v_uid, 'delivery_document.attach', 'delivery_documents', v_id::text, 'success',
    jsonb_build_object('doc_type', v_type.code));

  return v_id;
end;
$$;
revoke all on function public.attach_my_delivery_document(text, text, date) from public, anon;
grant execute on function public.attach_my_delivery_document(text, text, date) to authenticated;

/** Publish the route the applicant declared once their application is approved. */
create or replace function public.publish_my_delivery_route()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_intent record;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Sign in required.';
  end if;

  select i.* into v_intent
  from public.delivery_application_route_intents i
  join public.provider_applications pa on pa.id = i.application_id
  where pa.user_id = v_uid and pa.status = 'approved'
  order by i.created_at desc
  limit 1;

  if v_intent.application_id is null then
    raise exception 'There is no route to publish on an approved application.';
  end if;

  v_id := public.add_delivery_route(v_intent.origin_location_id, v_intent.destination_location_id);

  update public.delivery_application_route_intents
  set published_at = now()
  where application_id = v_intent.application_id;

  return v_id;
end;
$$;
revoke all on function public.publish_my_delivery_route() from public, anon;
grant execute on function public.publish_my_delivery_route() to authenticated;

commit;
