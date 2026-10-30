-- 0030 — Deliverer onboarding, documents and review (Phase 3).
--
-- Adds exactly what the registration workflow needs on top of 0029:
--   * a configurable document-type catalogue (nothing is marked legally required by this migration;
--     the owner decides which documents to demand);
--   * `delivery_documents`, one row per private file, scoped to an application, vehicle, fleet or
--     driver, with review state;
--   * fleet <-> application linkage and a submitted timestamp;
--   * an assigned-driver column so a fleet vehicle is never matched to an unauthorised driver;
--   * atomic submission (provider application + fleet row), vehicle registration during onboarding,
--     document registration, and owner/staff review functions;
--   * a stricter `list_my_delivery_offers()` (approved providers/drivers only) and acceptance that
--     permits an approved fleet driver without weakening any check.
--
-- Files never live in a public bucket: paths must start with delivery/<caller-id>/ inside the
-- existing private provider-documents bucket.

begin;

-- ---------------------------------------------------------------- document catalogue

create table if not exists public.delivery_document_types (
  code text primary key check (code ~ '^[a-z0-9_]{2,60}$'),
  label text not null check (char_length(trim(label)) between 1 and 120),
  applies_to text not null check (applies_to in ('provider', 'vehicle', 'driver', 'fleet')),
  is_required boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now()
);

-- Generic catalogue. `is_required` defaults to false on purpose: demanding a licence or insurance
-- is a legal/policy decision for the owner, not something this migration should invent.
insert into public.delivery_document_types (code, label, applies_to, is_required, sort_order) values
  ('national_id', 'National ID or passport', 'provider', false, 10),
  ('driving_licence', 'Driving licence', 'driver', false, 20),
  ('vehicle_registration', 'Vehicle registration', 'vehicle', false, 30),
  ('vehicle_insurance', 'Vehicle insurance', 'vehicle', false, 40),
  ('vehicle_inspection', 'Vehicle inspection certificate', 'vehicle', false, 50),
  ('business_registration', 'Business registration', 'fleet', false, 60),
  ('goods_in_transit_insurance', 'Goods-in-transit insurance', 'fleet', false, 70)
on conflict (code) do nothing;

alter table public.delivery_document_types enable row level security;
revoke all on public.delivery_document_types from anon, authenticated;
grant select on public.delivery_document_types to authenticated;
grant insert, update, delete on public.delivery_document_types to authenticated;

drop policy if exists "delivery_document_types_read" on public.delivery_document_types;
create policy "delivery_document_types_read" on public.delivery_document_types
for select to authenticated
using (is_active or (select public.is_shilevi_owner_admin()));

drop policy if exists "delivery_document_types_admin_write" on public.delivery_document_types;
create policy "delivery_document_types_admin_write" on public.delivery_document_types
for all to authenticated
using ((select public.is_shilevi_owner_admin()))
with check ((select public.is_shilevi_owner_admin()));

-- ---------------------------------------------------------------- fleet linkage & driver

alter table public.delivery_fleets
  add column if not exists application_id uuid
    references public.provider_applications(id) on delete set null,
  add column if not exists submitted_at timestamptz;

create unique index if not exists delivery_fleets_application_unique
  on public.delivery_fleets(application_id) where application_id is not null;

alter table public.transport_vehicles
  add column if not exists assigned_driver_id uuid references auth.users(id) on delete set null;

-- ---------------------------------------------------------------- document records

create table if not exists public.delivery_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  application_id uuid references public.provider_applications(id) on delete cascade,
  vehicle_id uuid references public.transport_vehicles(id) on delete cascade,
  fleet_id uuid references public.delivery_fleets(id) on delete cascade,
  driver_user_id uuid references auth.users(id) on delete set null,
  doc_type text not null references public.delivery_document_types(code),
  storage_path text not null unique
    check (storage_path like 'delivery/%' and char_length(storage_path) <= 500),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'expired')),
  expires_at date,
  reviewer_note text check (reviewer_note is null or char_length(reviewer_note) <= 1000),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint delivery_document_scope_present check (
    application_id is not null or vehicle_id is not null
    or fleet_id is not null or driver_user_id is not null
  )
);

create index if not exists delivery_documents_user_idx
  on public.delivery_documents(user_id, created_at desc);
create index if not exists delivery_documents_review_idx
  on public.delivery_documents(status, created_at) where status = 'pending';

alter table public.delivery_documents enable row level security;
revoke all on public.delivery_documents from anon, authenticated;
grant select, insert, delete on public.delivery_documents to authenticated;

drop policy if exists "delivery_documents_select_own_or_staff" on public.delivery_documents;
create policy "delivery_documents_select_own_or_staff" on public.delivery_documents
for select to authenticated
using (
  user_id = (select auth.uid())
  or driver_user_id = (select auth.uid())
  or (select public.is_shilevi_owner_admin())
  or (select public.has_staff_capability('delivery.manage'))
);

-- An applicant may register a record for their own private file, always pending review, and only
-- when the path is inside their own folder. Files themselves are guarded by the storage policy.
drop policy if exists "delivery_documents_insert_own" on public.delivery_documents;
create policy "delivery_documents_insert_own" on public.delivery_documents
for insert to authenticated
with check (
  user_id = (select auth.uid())
  and status = 'pending'
  and storage_path like 'delivery/' || (select auth.uid())::text || '/%'
);

drop policy if exists "delivery_documents_delete_own_pending" on public.delivery_documents;
create policy "delivery_documents_delete_own_pending" on public.delivery_documents
for delete to authenticated
using (
  user_id = (select auth.uid()) and status = 'pending'
);

-- ---------------------------------------------------------------- submission

/**
 * Submit an individual deliverer or fleet application atomically.
 *
 * One live transport_partner application per account: a duplicate while draft/pending/under_review/
 * approved exists is refused rather than silently piling up records. Submitting grants nothing —
 * eligibility still requires a reviewer to approve the application, approve the fleet where present,
 * and approve each vehicle.
 */
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
declare
  v_business text;
  v_application uuid;
  v_fleet uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.';
  end if;
  if p_mode not in ('individual', 'fleet') then
    raise exception 'Unknown application mode.';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Application details are required.';
  end if;
  if nullif(trim(coalesce(p_terms_version, '')), '') is null then
    raise exception 'Accept the deliverer terms before submitting.';
  end if;

  if exists (
    select 1 from public.provider_applications pa
    where pa.user_id = auth.uid()
      and pa.activity_type = 'transport_partner'
      and pa.status in ('draft', 'pending', 'under_review', 'approved')
  ) then
    raise exception 'You already have a delivery application in progress or approved.';
  end if;

  v_business := nullif(trim(coalesce(p_payload ->> 'business_name', '')), '');

  insert into public.provider_applications
    (user_id, activity_type, status, business_name, application_data, submitted_at)
  values (
    auth.uid(), 'transport_partner', 'pending', v_business,
    p_payload || jsonb_build_object(
      'mode', p_mode,
      'terms_version', p_terms_version,
      'terms_accepted_at', now()
    ),
    now()
  )
  returning id into v_application;

  if p_mode = 'fleet' then
    if v_business is null then
      raise exception 'A business name is required for a fleet application.';
    end if;
    insert into public.delivery_fleets
      (owner_user_id, business_name, status, application_id, submitted_at)
    values (auth.uid(), left(v_business, 160), 'pending', v_application, now())
    returning id into v_fleet;
  end if;

  return query select v_application, v_fleet;
end;
$$;
revoke all on function public.submit_deliverer_application(text, jsonb, text) from public, anon;
grant execute on function public.submit_deliverer_application(text, jsonb, text) to authenticated;

-- ---------------------------------------------------------------- resumable drafts
-- A draft is its own row so an applicant can come back later without touching the reviewed
-- application record. It is deleted when the application is submitted.
create table if not exists public.delivery_application_drafts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  mode text not null default 'individual' check (mode in ('individual', 'fleet')),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  updated_at timestamptz not null default now()
);

alter table public.delivery_application_drafts enable row level security;
revoke all on public.delivery_application_drafts from anon, authenticated;
grant select, insert, update, delete on public.delivery_application_drafts to authenticated;

drop policy if exists "delivery_application_drafts_own" on public.delivery_application_drafts;
create policy "delivery_application_drafts_own" on public.delivery_application_drafts
for all to authenticated
using (user_id = (select auth.uid()) and not (select public.is_shilevi_owner_admin()))
with check (user_id = (select auth.uid()));

create or replace function public.save_delivery_application_draft(p_mode text, p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in required.';
  end if;
  if p_mode not in ('individual', 'fleet') then
    raise exception 'Unknown application mode.';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Application details are required.';
  end if;
  if exists (
    select 1 from public.provider_applications pa
    where pa.user_id = auth.uid() and pa.activity_type = 'transport_partner'
      and pa.status in ('pending', 'under_review', 'approved')
  ) then
    raise exception 'You already have a delivery application under review or approved.';
  end if;

  insert into public.delivery_application_drafts (user_id, mode, payload)
  values (auth.uid(), p_mode, p_payload)
  on conflict (user_id) do update
    set mode = excluded.mode, payload = excluded.payload, updated_at = now();
end;
$$;
revoke all on function public.save_delivery_application_draft(text, jsonb) from public, anon;
grant execute on function public.save_delivery_application_draft(text, jsonb) to authenticated;

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

  select * into v_result from public.submit_deliverer_application(v_draft.mode, v_draft.payload, p_terms_version);

  delete from public.delivery_application_drafts where user_id = auth.uid();

  return query select v_result.application_id, v_result.fleet_id;
end;
$$;
revoke all on function public.submit_delivery_application_draft(text) from public, anon;
grant execute on function public.submit_delivery_application_draft(text) to authenticated;

/**
 * Register a vehicle during onboarding. Unlike add_transport_vehicle() this does not require an
 * already-approved application — the vehicle is created in `pending` and can never be used until a
 * reviewer approves it.
 */
create or replace function public.register_delivery_vehicle(
  p_class_code text,
  p_make_model text,
  p_plate_number text,
  p_mode text,
  p_payload_kg integer default null,
  p_length_cm integer default null,
  p_width_cm integer default null,
  p_height_cm integer default null,
  p_supports_covered boolean default false,
  p_supports_fragile boolean default false,
  p_supports_temperature_controlled boolean default false,
  p_fleet_id uuid default null,
  p_assigned_driver_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_class record;
  v_application record;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.';
  end if;

  select * into v_class from public.delivery_vehicle_classes
  where code = p_class_code and is_active;
  if v_class.code is null then
    raise exception 'Unknown vehicle class.';
  end if;

  select * into v_application from public.provider_applications
  where user_id = auth.uid() and activity_type = 'transport_partner'
    and status in ('draft', 'pending', 'under_review', 'approved')
  order by created_at desc
  limit 1;
  if v_application.id is null then
    raise exception 'Submit a delivery application before adding a vehicle.';
  end if;

  if p_fleet_id is not null then
    if not exists (
      select 1 from public.delivery_fleets f
      where f.id = p_fleet_id and f.owner_user_id = auth.uid()
    ) then
      raise exception 'Fleet not found.';
    end if;
  end if;

  if p_assigned_driver_id is not null then
    if p_fleet_id is null then
      raise exception 'An assigned driver requires a fleet application.';
    end if;
    if not exists (
      select 1 from public.delivery_fleet_drivers d
      where d.fleet_id = p_fleet_id and d.driver_user_id = p_assigned_driver_id
    ) then
      raise exception 'Add the driver to the fleet before assigning a vehicle.';
    end if;
  end if;

  if p_mode not in ('car','motorcycle','bicycle','tuk_tuk','van') then
    raise exception 'Unsupported transport mode.';
  end if;
  if nullif(trim(coalesce(p_make_model, '')), '') is null
     or char_length(trim(coalesce(p_plate_number, ''))) < 2 then
    raise exception 'A vehicle description and plate or identifier are required.';
  end if;

  if p_payload_kg is not null and (p_payload_kg < 1 or p_payload_kg > v_class.max_payload_kg) then
    raise exception 'Payload must be between 1 and % kg for this class.', v_class.max_payload_kg;
  end if;
  if p_length_cm is not null and v_class.max_length_cm is not null and p_length_cm > v_class.max_length_cm then
    raise exception 'Length exceeds the class limit.';
  end if;
  if p_width_cm is not null and v_class.max_width_cm is not null and p_width_cm > v_class.max_width_cm then
    raise exception 'Width exceeds the class limit.';
  end if;
  if p_height_cm is not null and v_class.max_height_cm is not null and p_height_cm > v_class.max_height_cm then
    raise exception 'Height exceeds the class limit.';
  end if;

  insert into public.transport_vehicles (
    user_id, mode, make_model, plate_number, seat_capacity, verification_status,
    vehicle_class_code, fleet_id, assigned_driver_id, payload_kg, length_cm, width_cm, height_cm,
    supports_covered, supports_fragile, supports_temperature_controlled
  ) values (
    auth.uid(), p_mode, left(trim(p_make_model), 120), upper(left(trim(p_plate_number), 24)),
    1, 'pending', p_class_code, p_fleet_id, p_assigned_driver_id, p_payload_kg,
    p_length_cm, p_width_cm, p_height_cm,
    coalesce(p_supports_covered, false), coalesce(p_supports_fragile, false),
    coalesce(p_supports_temperature_controlled, false)
  )
  returning id into v_id;

  insert into public.audit_events (actor_id, action, resource_type, resource_id, outcome, metadata)
  values (auth.uid(), 'delivery_vehicle.register', 'transport_vehicles', v_id::text, 'success',
    jsonb_build_object('class_code', p_class_code, 'fleet', p_fleet_id is not null));

  return v_id;
end;
$$;
revoke all on function public.register_delivery_vehicle(text, text, text, text, integer, integer, integer, integer, boolean, boolean, boolean, uuid, uuid) from public, anon;
grant execute on function public.register_delivery_vehicle(text, text, text, text, integer, integer, integer, integer, boolean, boolean, boolean, uuid, uuid) to authenticated;

/**
 * Register a private document row. The file itself must already be inside the caller's own folder in
 * the private bucket; this row is what a reviewer sees and decides on.
 */
create or replace function public.register_delivery_document(
  p_doc_type text,
  p_storage_path text,
  p_application_id uuid default null,
  p_vehicle_id uuid default null,
  p_fleet_id uuid default null,
  p_driver_user_id uuid default null,
  p_expires_at date default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type record;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.';
  end if;

  select * into v_type from public.delivery_document_types
  where code = p_doc_type and is_active;
  if v_type.code is null then
    raise exception 'Unknown document type.';
  end if;

  if p_storage_path is null
     or p_storage_path not like 'delivery/' || auth.uid()::text || '/%' then
    raise exception 'Documents must be uploaded to your own private folder.';
  end if;

  if p_application_id is not null and not exists (
    select 1 from public.provider_applications pa
    where pa.id = p_application_id and pa.user_id = auth.uid()
  ) then
    raise exception 'Application not found.';
  end if;

  if p_vehicle_id is not null and not exists (
    select 1 from public.transport_vehicles v
    where v.id = p_vehicle_id
      and (v.user_id = auth.uid() or v.assigned_driver_id = auth.uid())
  ) then
    raise exception 'Vehicle not found.';
  end if;

  if p_fleet_id is not null and not exists (
    select 1 from public.delivery_fleets f
    where f.id = p_fleet_id and f.owner_user_id = auth.uid()
  ) then
    raise exception 'Fleet not found.';
  end if;

  if p_driver_user_id is not null and p_driver_user_id <> auth.uid() then
    if p_fleet_id is null or not exists (
      select 1 from public.delivery_fleets f
      where f.id = p_fleet_id and f.owner_user_id = auth.uid()
    ) then
      raise exception 'You may only register documents for yourself.';
    end if;
  end if;

  if v_type.applies_to = 'provider' and p_application_id is null then
    raise exception 'This document type belongs to the application.';
  elsif v_type.applies_to = 'vehicle' and p_vehicle_id is null then
    raise exception 'This document type belongs to a vehicle.';
  elsif v_type.applies_to = 'fleet' and p_fleet_id is null then
    raise exception 'This document type belongs to a fleet.';
  elsif v_type.applies_to = 'driver' and p_driver_user_id is null then
    raise exception 'This document type belongs to a driver.';
  end if;

  insert into public.delivery_documents (
    user_id, application_id, vehicle_id, fleet_id, driver_user_id,
    doc_type, storage_path, status, expires_at
  ) values (
    auth.uid(), p_application_id, p_vehicle_id, p_fleet_id,
    coalesce(p_driver_user_id, auth.uid()), p_doc_type, p_storage_path, 'pending', p_expires_at
  )
  returning id into v_id;

  return v_id;
end;
$$;
revoke all on function public.register_delivery_document(text, text, uuid, uuid, uuid, uuid, date) from public, anon;
grant execute on function public.register_delivery_document(text, text, uuid, uuid, uuid, uuid, date) to authenticated;

-- ---------------------------------------------------------------- staff review

create or replace function public.admin_review_delivery_document(
  p_document_id uuid,
  p_approve boolean,
  p_note text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_document record;
begin
  if not public.has_staff_capability('delivery.manage') then
    raise exception 'Not authorized.';
  end if;

  select * into v_document from public.delivery_documents where id = p_document_id for update;
  if v_document.id is null then
    raise exception 'Document not found.';
  end if;
  if v_document.status <> 'pending' then
    raise exception 'This document has already been reviewed.';
  end if;
  if not p_approve and nullif(trim(coalesce(p_note, '')), '') is null then
    raise exception 'A rejection note is required.';
  end if;

  update public.delivery_documents
  set status = case when p_approve then 'approved' else 'rejected' end,
      reviewer_note = left(nullif(trim(coalesce(p_note, '')), ''), 1000),
      reviewed_at = now(),
      reviewed_by = auth.uid()
  where id = p_document_id;

  insert into public.audit_events (actor_id, action, resource_type, resource_id, outcome, metadata)
  values (auth.uid(), 'delivery_document.review', 'delivery_documents', p_document_id::text,
    'success', jsonb_build_object('approved', p_approve, 'doc_type', v_document.doc_type));
end;
$$;
revoke all on function public.admin_review_delivery_document(uuid, boolean, text) from public, anon;
grant execute on function public.admin_review_delivery_document(uuid, boolean, text) to authenticated;

create or replace function public.admin_review_delivery_fleet(
  p_fleet_id uuid,
  p_approve boolean,
  p_note text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fleet record;
begin
  if not public.has_staff_capability('delivery.manage') then
    raise exception 'Not authorized.';
  end if;

  select * into v_fleet from public.delivery_fleets where id = p_fleet_id for update;
  if v_fleet.id is null then
    raise exception 'Fleet not found.';
  end if;
  if v_fleet.status not in ('pending', 'under_review') then
    raise exception 'This fleet is not awaiting review.';
  end if;
  if not p_approve and nullif(trim(coalesce(p_note, '')), '') is null then
    raise exception 'A rejection note is required.';
  end if;

  update public.delivery_fleets
  set status = case when p_approve then 'approved' else 'rejected' end,
      reviewer_note = left(nullif(trim(coalesce(p_note, '')), ''), 1000),
      reviewed_at = now(),
      reviewed_by = auth.uid()
  where id = p_fleet_id;

  insert into public.audit_events (actor_id, action, resource_type, resource_id, outcome, metadata)
  values (auth.uid(), 'delivery_fleet.review', 'delivery_fleets', p_fleet_id::text,
    'success', jsonb_build_object('approved', p_approve));
end;
$$;
revoke all on function public.admin_review_delivery_fleet(uuid, boolean, text) from public, anon;
grant execute on function public.admin_review_delivery_fleet(uuid, boolean, text) to authenticated;

-- Drivers are approved separately from the fleet: approving a business must never silently approve
-- every person driving for it.
create or replace function public.admin_review_delivery_fleet_driver(
  p_driver_id uuid,
  p_approve boolean,
  p_note text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_driver record;
begin
  if not public.has_staff_capability('delivery.manage') then
    raise exception 'Not authorized.';
  end if;

  select * into v_driver from public.delivery_fleet_drivers where id = p_driver_id for update;
  if v_driver.id is null then
    raise exception 'Driver record not found.';
  end if;
  if v_driver.status <> 'pending' then
    raise exception 'This driver has already been reviewed.';
  end if;
  if not p_approve and nullif(trim(coalesce(p_note, '')), '') is null then
    raise exception 'A rejection note is required.';
  end if;

  update public.delivery_fleet_drivers
  set status = case when p_approve then 'approved' else 'rejected' end,
      note = left(nullif(trim(coalesce(p_note, '')), ''), 1000),
      reviewed_at = now(),
      reviewed_by = auth.uid()
  where id = p_driver_id;

  insert into public.audit_events (actor_id, action, resource_type, resource_id, outcome, metadata)
  values (auth.uid(), 'delivery_fleet_driver.review', 'delivery_fleet_drivers', p_driver_id::text,
    'success', jsonb_build_object('approved', p_approve));
end;
$$;
revoke all on function public.admin_review_delivery_fleet_driver(uuid, boolean, text) from public, anon;
grant execute on function public.admin_review_delivery_fleet_driver(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------- matching updates

-- Recreated from 0029 with one addition: a vehicle assigned to a fleet driver is only eligible while
-- that driver's fleet membership is approved. The owner's own vehicles (no assigned driver) are
-- unaffected. Every other rule is unchanged.
create or replace function public.match_delivery_candidates(p_delivery_id uuid)
returns table (
  provider_user_id uuid,
  vehicle_id uuid,
  vehicle_class_code text,
  rank_score numeric,
  reasons jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_delivery record;
begin
  if not public.has_staff_capability('delivery.manage') then
    raise exception 'Not authorized.';
  end if;

  select * into v_delivery from public.deliveries where id = p_delivery_id;
  if v_delivery.id is null then
    raise exception 'Shipment not found.';
  end if;

  if v_delivery.pickup_location_id is null or v_delivery.dropoff_location_id is null then
    return;
  end if;

  return query
  with candidates as (
    select
      pa.user_id as provider_user_id,
      v.id as vehicle_row_id,
      v.vehicle_class_code as class_code,
      coalesce(v.payload_kg, c.max_payload_kg) as capacity_kg,
      exists (
        select 1 from public.delivery_provider_routes r
        where r.provider_user_id = pa.user_id
          and r.is_active
          and r.origin_location_id = v_delivery.pickup_location_id
          and r.destination_location_id = v_delivery.dropoff_location_id
      ) as exact_route,
      (
        exists (
          select 1 from public.provider_service_areas s
          join public.provider_activities a on a.id = s.provider_activity_id
          where a.user_id = pa.user_id and a.status = 'approved'
            and s.is_active and s.location_id = v_delivery.pickup_location_id
        )
        and exists (
          select 1 from public.provider_service_areas s
          join public.provider_activities a on a.id = s.provider_activity_id
          where a.user_id = pa.user_id and a.status = 'approved'
            and s.is_active and s.location_id = v_delivery.dropoff_location_id
        )
      ) as area_route,
      (
        select count(*) from public.deliveries dh
        where dh.rider_id = pa.user_id and dh.status = 'delivered'
      ) as completed_deliveries,
      (
        select count(*) from public.deliveries dh
        where dh.rider_id = pa.user_id and dh.status = 'failed'
      ) as failed_deliveries
    from public.provider_applications pa
    join public.transport_vehicles v on v.user_id = pa.user_id
    join public.delivery_vehicle_classes c on c.code = v.vehicle_class_code
    where pa.activity_type = 'transport_partner'
      and pa.status = 'approved'
      and v.verification_status = 'approved'
      and v.is_active
      and c.is_active
      and (v.documents_expire_at is null or v.documents_expire_at >= current_date)
      and (
        v.fleet_id is null
        or exists (
          select 1 from public.delivery_fleets f
          where f.id = v.fleet_id and f.status = 'approved'
        )
      )
      and (
        v.assigned_driver_id is null
        or (
          v.fleet_id is not null
          and exists (
            select 1 from public.delivery_fleet_drivers d
            where d.fleet_id = v.fleet_id
              and d.driver_user_id = v.assigned_driver_id
              and d.status = 'approved'
          )
        )
      )
      and (
        v_delivery.required_vehicle_class_code is null
        or v.vehicle_class_code = v_delivery.required_vehicle_class_code
      )
      and coalesce(v_delivery.weight_kg, 0) <= coalesce(v.payload_kg, c.max_payload_kg)
      and (v_delivery.length_cm is null or coalesce(v.length_cm, c.max_length_cm) is null
        or coalesce(v.length_cm, c.max_length_cm) >= v_delivery.length_cm)
      and (v_delivery.width_cm is null or coalesce(v.width_cm, c.max_width_cm) is null
        or coalesce(v.width_cm, c.max_width_cm) >= v_delivery.width_cm)
      and (v_delivery.height_cm is null or coalesce(v.height_cm, c.max_height_cm) is null
        or coalesce(v.height_cm, c.max_height_cm) >= v_delivery.height_cm)
      and (not v_delivery.requires_covered or v.supports_covered or c.supports_covered)
      and (not v_delivery.fragile or v.supports_fragile or c.supports_fragile)
      and (not v_delivery.temperature_controlled
        or v.supports_temperature_controlled or c.supports_temperature_controlled)
  ), eligible as (
    select * from candidates c
    where c.exact_route or c.area_route
  )
  select
    e.provider_user_id,
    e.vehicle_row_id,
    e.class_code,
    round(greatest(0, least(100,
      50
      + case when e.exact_route then 20 else 8 end
      + case
          when v_delivery.weight_kg is null or e.capacity_kg <= 0 then 10
          else least(12, round(12 * (1 - (v_delivery.weight_kg / e.capacity_kg::numeric)), 2))
        end
      + least(10, e.completed_deliveries::numeric)
      - least(15, (e.failed_deliveries * 3)::numeric)
    )), 2),
    jsonb_build_object(
      'exact_route', e.exact_route,
      'service_area_route', e.area_route,
      'capacity_kg', e.capacity_kg,
      'completed_deliveries', e.completed_deliveries,
      'failed_deliveries', e.failed_deliveries,
      'vehicle_class', e.class_code,
      'note', 'Score ranks eligible candidates only. It never overrides an eligibility rule.'
    )
  from eligible e
  order by 4 desc, 1;
end;
$$;
revoke all on function public.match_delivery_candidates(uuid) from public, anon;
grant execute on function public.match_delivery_candidates(uuid) to authenticated;

-- Matched-only offer list, now closed to suspended/rejected providers. A suspended provider sees an
-- empty dashboard instead of live job offers they cannot accept.
create or replace function public.list_my_delivery_offers()
returns table (
  offer_id uuid,
  delivery_id uuid,
  shipment_number text,
  order_number text,
  pickup_county text,
  dropoff_county text,
  package_count integer,
  weight_kg numeric,
  required_vehicle_class_code text,
  expires_at timestamptz,
  fee_minor bigint
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if auth.uid() is null then
    raise exception 'Sign in required.';
  end if;

  update public.delivery_offers
  set status = 'expired', responded_at = now()
  where provider_user_id = auth.uid() and status = 'offered' and expires_at <= now();

  if not exists (
    select 1 from public.provider_applications pa
    where pa.user_id = auth.uid()
      and pa.activity_type = 'transport_partner'
      and pa.status = 'approved'
  ) and not exists (
    select 1 from public.delivery_fleet_drivers d
    where d.driver_user_id = auth.uid() and d.status = 'approved'
  ) then
    return;
  end if;

  return query
    select o.id, d.id, d.shipment_number, ord.order_number, d.pickup_county, d.dropoff_county,
      d.package_count, d.weight_kg, d.required_vehicle_class_code, o.expires_at, d.rider_fee_minor
    from public.delivery_offers o
    join public.deliveries d on d.id = o.delivery_id
    join public.orders ord on ord.id = d.order_id
    where o.provider_user_id = auth.uid()
      and o.status = 'offered'
      and o.expires_at > now()
      and d.status = 'requested'
      and d.rider_id is null
    order by o.expires_at asc;
end;
$$;
revoke all on function public.list_my_delivery_offers() from public, anon;
grant execute on function public.list_my_delivery_offers() to authenticated;

-- Acceptance, extended for fleet drivers: the caller must either own the vehicle with an approved
-- application, or be the assigned driver with an approved fleet membership. Everything else is
-- re-validated exactly as in 0029.
create or replace function public.accept_delivery_offer(p_offer_id uuid)
returns table (delivery_id uuid, order_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_offer record;
  v_delivery record;
  v_vehicle record;
  v_capacity integer;
  v_caller_is_provider boolean;
  v_caller_is_fleet_driver boolean;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.';
  end if;

  select * into v_offer from public.delivery_offers where id = p_offer_id for update;
  if v_offer.id is null or v_offer.provider_user_id <> auth.uid() then
    raise exception 'Offer not found.';
  end if;
  if v_offer.status <> 'offered' then
    raise exception 'This offer is no longer open.';
  end if;
  if v_offer.expires_at <= now() then
    update public.delivery_offers set status = 'expired', responded_at = now() where id = v_offer.id;
    raise exception 'This offer has expired.';
  end if;

  select * into v_vehicle from public.transport_vehicles where id = v_offer.vehicle_id;
  if v_vehicle.id is null then
    raise exception 'This vehicle is not available.';
  end if;
  if v_vehicle.verification_status <> 'approved' or not v_vehicle.is_active then
    raise exception 'This vehicle is not approved for delivery.';
  end if;
  if v_vehicle.documents_expire_at is not null and v_vehicle.documents_expire_at < current_date then
    raise exception 'This vehicle has expired documents.';
  end if;

  v_caller_is_provider := exists (
    select 1 from public.provider_applications pa
    where pa.user_id = auth.uid()
      and pa.activity_type = 'transport_partner'
      and pa.status = 'approved'
  );

  v_caller_is_fleet_driver := v_vehicle.assigned_driver_id = auth.uid()
    and v_vehicle.fleet_id is not null
    and exists (
      select 1 from public.delivery_fleet_drivers d
      where d.fleet_id = v_vehicle.fleet_id
        and d.driver_user_id = auth.uid()
        and d.status = 'approved'
    )
    and exists (
      select 1 from public.delivery_fleets f
      where f.id = v_vehicle.fleet_id and f.status = 'approved'
    );

  if not v_caller_is_provider and not v_caller_is_fleet_driver then
    raise exception 'Only an approved delivery partner or fleet driver can accept a shipment.';
  end if;
  if v_vehicle.user_id <> auth.uid() and v_vehicle.assigned_driver_id <> auth.uid() then
    raise exception 'This vehicle is not yours to operate.';
  end if;

  select * into v_delivery from public.deliveries where id = v_offer.delivery_id for update;
  if v_delivery.id is null then
    raise exception 'Shipment not found.';
  end if;
  if v_delivery.rider_id is not null or v_delivery.status <> 'requested' then
    raise exception 'This shipment has already been assigned.';
  end if;

  select coalesce(v_vehicle.payload_kg, c.max_payload_kg) into v_capacity
  from public.delivery_vehicle_classes c
  where c.code = v_vehicle.vehicle_class_code;
  if v_capacity is null or coalesce(v_delivery.weight_kg, 0) > v_capacity then
    raise exception 'This vehicle cannot carry the shipment.';
  end if;
  if v_delivery.requires_covered and not v_vehicle.supports_covered then
    raise exception 'This shipment requires a covered vehicle.';
  end if;
  if v_delivery.fragile and not v_vehicle.supports_fragile then
    raise exception 'This vehicle is not cleared for fragile cargo.';
  end if;
  if v_delivery.temperature_controlled and not v_vehicle.supports_temperature_controlled then
    raise exception 'This shipment requires a temperature-controlled vehicle.';
  end if;

  update public.deliveries
  set rider_id = auth.uid(),
      assigned_vehicle_id = v_vehicle.id,
      status = 'assigned',
      assignment_status = 'assigned',
      assigned_at = now()
  where id = v_delivery.id;

  update public.delivery_offers set status = 'accepted', responded_at = now() where id = v_offer.id;
  update public.delivery_offers
  set status = 'expired', responded_at = now()
  where delivery_id = v_delivery.id and id <> v_offer.id and status = 'offered';

  insert into public.delivery_events (delivery_id, status, actor_id, actor_role, note)
  values (v_delivery.id, 'assigned', auth.uid(), 'rider',
    'Assigned through a matched delivery offer.');

  return query select v_delivery.id, v_delivery.order_id;
end;
$$;
revoke all on function public.accept_delivery_offer(uuid) from public, anon;
grant execute on function public.accept_delivery_offer(uuid) to authenticated;

commit;
