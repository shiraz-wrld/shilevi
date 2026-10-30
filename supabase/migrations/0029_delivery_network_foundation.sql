-- 0029 — Intelligent delivery network: foundation (Phase 2).
--
-- What this migration does
--   * Adds the vehicle-capability catalogue that cargo-aware matching needs.
--   * Adds fleet (transport business) and fleet-driver records.
--   * Adds provider route coverage alongside the existing service-area coverage.
--   * Extends the existing `deliveries` table into a shipment record (cargo, quote, assignment,
--     proof) instead of creating a competing shipments table.
--   * Adds matched offers and delivery incidents.
--   * Adds owner/staff-guarded matching, offering and concurrency-safe acceptance functions.
--
-- What it deliberately does not do
--   * It invents no courier API, no coverage claim, no price and no provider. Vehicle classes below
--     are configuration defaults an administrator can change; they are not a statement that every
--     class is available in every county.
--   * It does not weaken any existing policy: every new table has RLS enabled and no client write
--     grant unless stated. Matching and assignment are functions, not browser decisions.
--   * It does not touch the ledger, commission or payment functions.

begin;

-- ---------------------------------------------------------------- vehicle capability catalogue

create table if not exists public.delivery_vehicle_classes (
  code text primary key check (code ~ '^[a-z0-9_]{2,40}$'),
  label text not null check (char_length(trim(label)) between 1 and 80),
  max_payload_kg integer not null check (max_payload_kg between 1 and 60000),
  max_length_cm integer check (max_length_cm is null or max_length_cm between 1 and 3000),
  max_width_cm integer check (max_width_cm is null or max_width_cm between 1 and 500),
  max_height_cm integer check (max_height_cm is null or max_height_cm between 1 and 500),
  supports_covered boolean not null default false,
  supports_fragile boolean not null default false,
  supports_temperature_controlled boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now()
);

-- Configuration defaults. An administrator can change or deactivate any row.
insert into public.delivery_vehicle_classes
  (code, label, max_payload_kg, max_length_cm, max_width_cm, max_height_cm,
   supports_covered, supports_fragile, supports_temperature_controlled, is_active, sort_order)
values
  ('bicycle',     'Bicycle courier',      15,   60,  50,  40, false, true,  false, true, 10),
  ('motorbike',   'Motorbike courier',    40,   60,  50,  50, false, true,  false, true, 20),
  ('car',         'Car',                 120,  120,  80,  70, true,  true,  false, true, 30),
  ('pickup',      'Pickup',              800,  240, 150, 100, true,  true,  false, true, 40),
  ('van',         'Delivery van',       1500,  300, 170, 170, true,  true,  false, true, 50),
  ('small_truck', 'Small truck',        3500,  420, 200, 200, true,  true,  false, true, 60),
  ('lorry',       'Lorry',             12000,  900, 240, 260, true,  true,  false, true, 70)
on conflict (code) do nothing;

alter table public.delivery_vehicle_classes enable row level security;
revoke all on public.delivery_vehicle_classes from anon, authenticated;
grant select on public.delivery_vehicle_classes to anon, authenticated;
grant insert, update, delete on public.delivery_vehicle_classes to authenticated;

drop policy if exists "delivery_vehicle_classes_read" on public.delivery_vehicle_classes;
create policy "delivery_vehicle_classes_read" on public.delivery_vehicle_classes
for select to anon, authenticated
using (is_active or (select public.is_shilevi_owner_admin()));

drop policy if exists "delivery_vehicle_classes_admin_write" on public.delivery_vehicle_classes;
create policy "delivery_vehicle_classes_admin_write" on public.delivery_vehicle_classes
for all to authenticated
using ((select public.is_shilevi_owner_admin()))
with check ((select public.is_shilevi_owner_admin()));

-- ---------------------------------------------------------------- fleets

create table if not exists public.delivery_fleets (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  business_name text not null check (char_length(trim(business_name)) between 1 and 160),
  status text not null default 'draft' check (status in (
    'draft','pending','under_review','approved','rejected','suspended'
  )),
  reviewer_note text check (reviewer_note is null or char_length(reviewer_note) <= 1000),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_user_id)
);

alter table public.delivery_fleets enable row level security;
revoke all on public.delivery_fleets from anon, authenticated;
grant select, insert on public.delivery_fleets to authenticated;
grant update (business_name) on public.delivery_fleets to authenticated;

drop policy if exists "delivery_fleets_select_own_or_staff" on public.delivery_fleets;
create policy "delivery_fleets_select_own_or_staff" on public.delivery_fleets
for select to authenticated
using (
  owner_user_id = (select auth.uid())
  or (select public.is_shilevi_owner_admin())
  or (select public.has_staff_capability('delivery.manage'))
);

-- A provider may open a draft application for their own account. Approval is staff-only.
drop policy if exists "delivery_fleets_insert_own_draft" on public.delivery_fleets;
create policy "delivery_fleets_insert_own_draft" on public.delivery_fleets
for insert to authenticated
with check (owner_user_id = (select auth.uid()) and status = 'draft');

drop policy if exists "delivery_fleets_update_own_draft" on public.delivery_fleets;
create policy "delivery_fleets_update_own_draft" on public.delivery_fleets
for update to authenticated
using (owner_user_id = (select auth.uid()) and status in ('draft', 'pending'))
with check (owner_user_id = (select auth.uid()) and status in ('draft', 'pending'));

create table if not exists public.delivery_fleet_drivers (
  id uuid primary key default gen_random_uuid(),
  fleet_id uuid not null references public.delivery_fleets(id) on delete cascade,
  driver_user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','approved','rejected','suspended')),
  note text check (note is null or char_length(note) <= 1000),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (fleet_id, driver_user_id)
);

alter table public.delivery_fleet_drivers enable row level security;
revoke all on public.delivery_fleet_drivers from anon, authenticated;
grant select, insert on public.delivery_fleet_drivers to authenticated;

drop policy if exists "delivery_fleet_drivers_select_related" on public.delivery_fleet_drivers;
create policy "delivery_fleet_drivers_select_related" on public.delivery_fleet_drivers
for select to authenticated
using (
  driver_user_id = (select auth.uid())
  or exists (
    select 1 from public.delivery_fleets f
    where f.id = delivery_fleet_drivers.fleet_id and f.owner_user_id = (select auth.uid())
  )
  or (select public.is_shilevi_owner_admin())
  or (select public.has_staff_capability('delivery.manage'))
);

-- Approved drivers may see the fleet they drive for. Defined after the driver table exists.
drop policy if exists "delivery_fleets_select_approved_driver" on public.delivery_fleets;
create policy "delivery_fleets_select_approved_driver" on public.delivery_fleets
for select to authenticated
using (
  exists (
    select 1 from public.delivery_fleet_drivers d
    where d.fleet_id = delivery_fleets.id
      and d.driver_user_id = (select auth.uid())
      and d.status = 'approved'
  )
);

drop policy if exists "delivery_fleet_drivers_insert_by_owner" on public.delivery_fleet_drivers;
create policy "delivery_fleet_drivers_insert_by_owner" on public.delivery_fleet_drivers
for insert to authenticated
with check (
  status = 'pending'
  and exists (
    select 1 from public.delivery_fleets f
    where f.id = delivery_fleet_drivers.fleet_id
      and f.owner_user_id = (select auth.uid())
      and f.status in ('draft', 'pending', 'approved')
  )
);

-- ---------------------------------------------------------------- provider routes

create table if not exists public.delivery_provider_routes (
  id uuid primary key default gen_random_uuid(),
  provider_user_id uuid not null references auth.users(id) on delete cascade,
  origin_location_id uuid not null references public.service_locations(id) on delete cascade,
  destination_location_id uuid not null references public.service_locations(id) on delete cascade,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (provider_user_id, origin_location_id, destination_location_id),
  constraint delivery_route_differs check (origin_location_id <> destination_location_id)
);

create index if not exists delivery_provider_routes_lookup_idx
  on public.delivery_provider_routes(origin_location_id, destination_location_id, is_active);

alter table public.delivery_provider_routes enable row level security;
revoke all on public.delivery_provider_routes from anon, authenticated;
grant select, insert, update, delete on public.delivery_provider_routes to authenticated;

drop policy if exists "delivery_provider_routes_select_own_or_staff" on public.delivery_provider_routes;
create policy "delivery_provider_routes_select_own_or_staff" on public.delivery_provider_routes
for select to authenticated
using (
  provider_user_id = (select auth.uid())
  or (select public.is_shilevi_owner_admin())
  or (select public.has_staff_capability('delivery.manage'))
);

drop policy if exists "delivery_provider_routes_manage_own" on public.delivery_provider_routes;
create policy "delivery_provider_routes_manage_own" on public.delivery_provider_routes
for all to authenticated
using (provider_user_id = (select auth.uid()))
with check (provider_user_id = (select auth.uid()));

-- ---------------------------------------------------------------- vehicle capability columns

alter table public.transport_vehicles
  add column if not exists vehicle_class_code text references public.delivery_vehicle_classes(code),
  add column if not exists fleet_id uuid references public.delivery_fleets(id) on delete set null,
  add column if not exists payload_kg integer check (payload_kg is null or payload_kg between 1 and 60000),
  add column if not exists length_cm integer check (length_cm is null or length_cm between 1 and 3000),
  add column if not exists width_cm integer check (width_cm is null or width_cm between 1 and 500),
  add column if not exists height_cm integer check (height_cm is null or height_cm between 1 and 500),
  add column if not exists supports_covered boolean not null default false,
  add column if not exists supports_fragile boolean not null default false,
  add column if not exists supports_temperature_controlled boolean not null default false,
  add column if not exists documents_expire_at date;

create index if not exists transport_vehicles_class_idx
  on public.transport_vehicles(vehicle_class_code, verification_status, is_active);

-- ---------------------------------------------------------------- shipments (existing deliveries)

alter table public.deliveries
  add column if not exists shipment_number text not null
    default ('SHP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))),
  add column if not exists pickup_county text check (pickup_county is null or char_length(pickup_county) <= 100),
  add column if not exists pickup_location_id uuid references public.service_locations(id),
  add column if not exists dropoff_location_id uuid references public.service_locations(id),
  add column if not exists package_count integer not null default 1
    check (package_count between 1 and 200),
  add column if not exists weight_kg numeric(8, 2) check (weight_kg is null or weight_kg >= 0),
  add column if not exists length_cm integer check (length_cm is null or length_cm between 1 and 3000),
  add column if not exists width_cm integer check (width_cm is null or width_cm between 1 and 500),
  add column if not exists height_cm integer check (height_cm is null or height_cm between 1 and 500),
  add column if not exists fragile boolean not null default false,
  add column if not exists requires_covered boolean not null default false,
  add column if not exists temperature_controlled boolean not null default false,
  add column if not exists required_vehicle_class_code text
    references public.delivery_vehicle_classes(code),
  add column if not exists assigned_vehicle_id uuid
    references public.transport_vehicles(id) on delete set null,
  add column if not exists assignment_status text not null default 'open'
    check (assignment_status in ('open', 'offered', 'assigned', 'cancelled')),
  add column if not exists quote_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists proof_type text
    check (proof_type is null or proof_type in ('code', 'signature', 'photo', 'provider_event')),
  add column if not exists proof_image_path text,
  add column if not exists return_status text
    check (return_status is null or return_status in ('none', 'requested', 'in_transit', 'returned'));

create unique index if not exists deliveries_shipment_number_unique
  on public.deliveries(shipment_number);
create index if not exists deliveries_assignment_queue_idx
  on public.deliveries(assignment_status, status, created_at);

-- ---------------------------------------------------------------- matched offers

create table if not exists public.delivery_offers (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.deliveries(id) on delete cascade,
  provider_user_id uuid not null references auth.users(id) on delete cascade,
  vehicle_id uuid not null references public.transport_vehicles(id) on delete cascade,
  rank_score numeric(6, 2) not null default 0 check (rank_score >= 0),
  reasons jsonb not null default '{}'::jsonb,
  status text not null default 'offered'
    check (status in ('offered', 'accepted', 'declined', 'expired', 'withdrawn')),
  response_note text check (response_note is null or char_length(response_note) <= 500),
  expires_at timestamptz not null,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (delivery_id, provider_user_id)
);

create index if not exists delivery_offers_provider_idx
  on public.delivery_offers(provider_user_id, status, expires_at);

alter table public.delivery_offers enable row level security;
revoke all on public.delivery_offers from anon, authenticated;
grant select on public.delivery_offers to authenticated;

drop policy if exists "delivery_offers_select_own_or_staff" on public.delivery_offers;
create policy "delivery_offers_select_own_or_staff" on public.delivery_offers
for select to authenticated
using (
  provider_user_id = (select auth.uid())
  or (select public.is_shilevi_owner_admin())
  or (select public.has_staff_capability('delivery.manage'))
);

-- A deliverer reads the offered shipment only through list_my_delivery_offers(), which omits the
-- street address. Direct row access stays participant-scoped.

-- ---------------------------------------------------------------- incidents

create table if not exists public.delivery_incidents (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique
    default ('INC-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))),
  delivery_id uuid not null references public.deliveries(id) on delete cascade,
  category text not null check (category in (
    'not_home','wrong_address','failed_pickup','vehicle_issue','late_delivery','damaged','missing',
    'wrong_item','rejected','return_to_sender','provider_cancelled','fee_dispute',
    'suspected_fraud','other'
  )),
  description text not null check (char_length(trim(description)) between 10 and 2000),
  status text not null default 'open' check (status in ('open','investigating','resolved','rejected')),
  opened_by uuid not null references auth.users(id) on delete restrict,
  resolution_note text check (resolution_note is null or char_length(resolution_note) <= 2000),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists delivery_incidents_delivery_idx
  on public.delivery_incidents(delivery_id, created_at desc);
create index if not exists delivery_incidents_open_idx
  on public.delivery_incidents(status, created_at) where status in ('open','investigating');

alter table public.delivery_incidents enable row level security;
revoke all on public.delivery_incidents from anon, authenticated;
grant select, insert on public.delivery_incidents to authenticated;
grant update (status, resolution_note, resolved_at, resolved_by)
  on public.delivery_incidents to authenticated;

drop policy if exists "delivery_incidents_select_participant" on public.delivery_incidents;
create policy "delivery_incidents_select_participant" on public.delivery_incidents
for select to authenticated
using (
  (select public.is_delivery_participant(delivery_id))
  or (select public.is_shilevi_owner_admin())
  or (select public.has_staff_capability('delivery.manage'))
);

drop policy if exists "delivery_incidents_insert_participant" on public.delivery_incidents;
create policy "delivery_incidents_insert_participant" on public.delivery_incidents
for insert to authenticated
with check (
  opened_by = (select auth.uid())
  and status = 'open'
  and (
    (select public.is_delivery_participant(delivery_id))
    or (select public.has_staff_capability('delivery.manage'))
  )
);

drop policy if exists "delivery_incidents_resolve_staff" on public.delivery_incidents;
create policy "delivery_incidents_resolve_staff" on public.delivery_incidents
for update to authenticated
using ((select public.has_staff_capability('delivery.manage')))
with check ((select public.has_staff_capability('delivery.manage')));

-- ---------------------------------------------------------------- private delivery documents

-- Deliverer licences, vehicle papers and insurance reuse the existing PRIVATE bucket; nothing here
-- creates a public bucket or a public read path. Path convention: delivery/<user-id>/<file>.
do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'storage.objects is not present; skipping delivery document policies';
    return;
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'shilevi_delivery_documents_read'
  ) then
    create policy "shilevi_delivery_documents_read" on storage.objects
      for select to authenticated
      using (
        bucket_id = 'provider-documents'
        and (storage.foldername(name))[1] = 'delivery'
        and (
          (storage.foldername(name))[2] = (select auth.uid())::text
          or (select public.is_shilevi_owner_admin())
          or (select public.has_staff_capability('delivery.manage'))
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'shilevi_delivery_documents_insert'
  ) then
    create policy "shilevi_delivery_documents_insert" on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'provider-documents'
        and (storage.foldername(name))[1] = 'delivery'
        and (storage.foldername(name))[2] = (select auth.uid())::text
      );
  end if;
end $$;

-- ---------------------------------------------------------------- matching

/**
 * Hard eligibility first, then an explainable score.
 *
 * A candidate is returned only when every mandatory rule passes:
 *   - the provider has an approved transport_partner application;
 *   - the vehicle is approved, active, inside its document validity window and belongs to an
 *     approved fleet when it is attached to one;
 *   - the vehicle class is active and the class/vehicle payload covers the shipment weight;
 *   - covered / fragile / temperature requirements are supported;
 *   - every specified cargo dimension is met by the vehicle or its class default;
 *   - the shipment has resolvable pickup and dropoff service locations AND the provider covers that
 *     exact route or both locations through active service areas.
 *
 * Score (0–100) is deliberately simple and auditable: a neutral baseline, route quality, capacity
 * headroom, and verified completed/failed delivery counts. A provider with no history scores the
 * neutral baseline; it is never treated as proven poor.
 */
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

  -- Without resolved service locations the route cannot be verified, so nothing is offered. The
  -- case goes to manual review instead of a guessed match.
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
      coalesce(v.length_cm, c.max_length_cm) as capacity_length,
      coalesce(v.width_cm, c.max_width_cm) as capacity_width,
      coalesce(v.height_cm, c.max_height_cm) as capacity_height,
      (v.supports_covered or c.supports_covered) as covered_ok,
      (v.supports_fragile or c.supports_fragile) as fragile_ok,
      (v.supports_temperature_controlled or c.supports_temperature_controlled) as cold_ok,
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

/**
 * Offer an available shipment to the best eligible candidates. Staff/owner only: automatic
 * assignment is a server operation, not something a browser can trigger for someone else's order.
 */
create or replace function public.offer_delivery_to_candidates(
  p_delivery_id uuid,
  p_limit integer default 3,
  p_expires_minutes integer default 30
) returns table (provider_user_id uuid, vehicle_id uuid, rank_score numeric)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_delivery record;
  v_limit integer;
  v_minutes integer;
begin
  if not public.has_staff_capability('delivery.manage') then
    raise exception 'Not authorized.';
  end if;

  select * into v_delivery from public.deliveries where id = p_delivery_id for update;
  if v_delivery.id is null then
    raise exception 'Shipment not found.';
  end if;
  if v_delivery.status <> 'requested' or v_delivery.rider_id is not null
     or v_delivery.assignment_status in ('assigned', 'cancelled') then
    raise exception 'This shipment is no longer available for assignment.';
  end if;

  v_limit := greatest(1, least(coalesce(p_limit, 3), 10));
  v_minutes := greatest(5, least(coalesce(p_expires_minutes, 30), 1440));

  return query
  with best as (
    select m.* from public.match_delivery_candidates(p_delivery_id) m
    order by m.rank_score desc
    limit v_limit
  ), upserted as (
    insert into public.delivery_offers
      (delivery_id, provider_user_id, vehicle_id, rank_score, reasons, status, expires_at)
    select p_delivery_id, b.provider_user_id, b.vehicle_id, b.rank_score, b.reasons, 'offered',
      now() + make_interval(mins => v_minutes)
    from best b
    on conflict (delivery_id, provider_user_id) do update
      set vehicle_id = excluded.vehicle_id,
          rank_score = excluded.rank_score,
          reasons = excluded.reasons,
          status = 'offered',
          response_note = null,
          responded_at = null,
          expires_at = excluded.expires_at
      where public.delivery_offers.status in ('offered', 'declined', 'expired')
    returning provider_user_id, vehicle_id, rank_score
  )
  select u.provider_user_id, u.vehicle_id, u.rank_score from upserted u;

  update public.deliveries
  set assignment_status = 'offered'
  where id = p_delivery_id
    and rider_id is null
    and status = 'requested'
    and exists (
      select 1 from public.delivery_offers o
      where o.delivery_id = p_delivery_id
        and o.status = 'offered'
        and o.expires_at > now()
    );
end;
$$;
revoke all on function public.offer_delivery_to_candidates(uuid, integer, integer) from public, anon;
grant execute on function public.offer_delivery_to_candidates(uuid, integer, integer) to authenticated;

/**
 * Matched-only job view for the signed-in deliverer. The street address, phone number and customer
 * identity are deliberately absent: those are released only after assignment through row access.
 */
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

/**
 * Concurrency-safe acceptance. The delivery row is locked, the assignment is re-validated and a
 * second acceptance loses the race instead of double-booking the shipment.
 */
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
    update public.delivery_offers
    set status = 'expired', responded_at = now()
    where id = v_offer.id;
    raise exception 'This offer has expired.';
  end if;

  if not exists (
    select 1 from public.provider_applications pa
    where pa.user_id = auth.uid()
      and pa.activity_type = 'transport_partner'
      and pa.status = 'approved'
  ) then
    raise exception 'Only an approved delivery partner can accept a shipment.';
  end if;

  select * into v_vehicle from public.transport_vehicles where id = v_offer.vehicle_id;
  if v_vehicle.id is null or v_vehicle.user_id <> auth.uid()
     or v_vehicle.verification_status <> 'approved' or not v_vehicle.is_active then
    raise exception 'This vehicle is not approved for delivery.';
  end if;
  if v_vehicle.documents_expire_at is not null and v_vehicle.documents_expire_at < current_date then
    raise exception 'This vehicle has expired documents.';
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
  if v_capacity is null
     or coalesce(v_delivery.weight_kg, 0) > v_capacity then
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

  update public.delivery_offers
  set status = 'accepted', responded_at = now()
  where id = v_offer.id;

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

create or replace function public.decline_delivery_offer(p_offer_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_offer record;
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

  update public.delivery_offers
  set status = 'declined',
      response_note = left(nullif(trim(coalesce(p_reason, '')), ''), 500),
      responded_at = now()
  where id = v_offer.id;
end;
$$;
revoke all on function public.decline_delivery_offer(uuid, text) from public, anon;
grant execute on function public.decline_delivery_offer(uuid, text) to authenticated;

-- ---------------------------------------------------------------- vehicle profile & routes

/**
 * A deliverer describes their own vehicle's capability. Any material change returns the vehicle to
 * pending review, because approval was given for the previous capability.
 */
create or replace function public.set_delivery_vehicle_profile(
  p_vehicle_id uuid,
  p_class_code text,
  p_payload_kg integer default null,
  p_length_cm integer default null,
  p_width_cm integer default null,
  p_height_cm integer default null,
  p_supports_covered boolean default false,
  p_supports_fragile boolean default false,
  p_supports_temperature_controlled boolean default false,
  p_documents_expire_at date default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vehicle record;
  v_class record;
  v_previous text;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.';
  end if;

  select * into v_vehicle from public.transport_vehicles where id = p_vehicle_id for update;
  if v_vehicle.id is null or v_vehicle.user_id <> auth.uid() then
    raise exception 'Vehicle not found.';
  end if;

  select * into v_class from public.delivery_vehicle_classes
  where code = p_class_code and is_active;
  if v_class.code is null then
    raise exception 'Unknown vehicle class.';
  end if;

  if p_payload_kg is not null and (p_payload_kg < 1 or p_payload_kg > v_class.max_payload_kg) then
    raise exception 'Payload must be between 1 and % kg for this class.', v_class.max_payload_kg;
  end if;
  if p_length_cm is not null and v_class.max_length_cm is not null
     and p_length_cm > v_class.max_length_cm then
    raise exception 'Length exceeds the class limit.';
  end if;
  if p_width_cm is not null and v_class.max_width_cm is not null
     and p_width_cm > v_class.max_width_cm then
    raise exception 'Width exceeds the class limit.';
  end if;
  if p_height_cm is not null and v_class.max_height_cm is not null
     and p_height_cm > v_class.max_height_cm then
    raise exception 'Height exceeds the class limit.';
  end if;

  v_previous := v_vehicle.vehicle_class_code;

  update public.transport_vehicles
  set vehicle_class_code = p_class_code,
      payload_kg = p_payload_kg,
      length_cm = p_length_cm,
      width_cm = p_width_cm,
      height_cm = p_height_cm,
      supports_covered = coalesce(p_supports_covered, false),
      supports_fragile = coalesce(p_supports_fragile, false),
      supports_temperature_controlled = coalesce(p_supports_temperature_controlled, false),
      documents_expire_at = p_documents_expire_at,
      verification_status = case
        when v_previous is distinct from p_class_code then 'pending'
        when v_vehicle.payload_kg is distinct from p_payload_kg then 'pending'
        when v_vehicle.length_cm is distinct from p_length_cm then 'pending'
        when v_vehicle.width_cm is distinct from p_width_cm then 'pending'
        when v_vehicle.height_cm is distinct from p_height_cm then 'pending'
        when v_vehicle.supports_covered is distinct from coalesce(p_supports_covered, false) then 'pending'
        when v_vehicle.supports_fragile is distinct from coalesce(p_supports_fragile, false) then 'pending'
        when v_vehicle.supports_temperature_controlled
          is distinct from coalesce(p_supports_temperature_controlled, false) then 'pending'
        else verification_status
      end,
      reviewer_note = case
        when v_previous is distinct from p_class_code then 'Capability changed; re-verification required.'
        else reviewer_note
      end
  where id = p_vehicle_id;

  insert into public.audit_events (actor_id, action, resource_type, resource_id, outcome, metadata)
  values (auth.uid(), 'delivery_vehicle.profile_update', 'transport_vehicles', p_vehicle_id::text,
    'success', jsonb_build_object('class_code', p_class_code, 'payload_kg', p_payload_kg));
end;
$$;
revoke all on function public.set_delivery_vehicle_profile(uuid, text, integer, integer, integer, integer, boolean, boolean, boolean, date) from public, anon;
grant execute on function public.set_delivery_vehicle_profile(uuid, text, integer, integer, integer, integer, boolean, boolean, boolean, date) to authenticated;

create or replace function public.add_delivery_route(p_origin_location_id uuid, p_destination_location_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.';
  end if;
  if not exists (
    select 1 from public.provider_applications pa
    where pa.user_id = auth.uid()
      and pa.activity_type = 'transport_partner'
      and pa.status = 'approved'
  ) then
    raise exception 'Only an approved delivery partner can publish routes.';
  end if;

  insert into public.delivery_provider_routes (provider_user_id, origin_location_id, destination_location_id)
  values (auth.uid(), p_origin_location_id, p_destination_location_id)
  on conflict (provider_user_id, origin_location_id, destination_location_id)
    do update set is_active = true
  returning id into v_id;

  return v_id;
end;
$$;
revoke all on function public.add_delivery_route(uuid, uuid) from public, anon;
grant execute on function public.add_delivery_route(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------- provider suspension
--
-- Integration requirement: the delivery network must be able to suspend an approved provider
-- (safety, fraud, expired documents) and reactivate them after review. Migration 0006 allowed only
-- pending → approved/rejected, so an approved application could never be suspended by anyone. This
-- recreates the guard verbatim and adds one owner-only branch; every other transition and every
-- column restriction is unchanged.
create or replace function public.guard_provider_application_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  owner_admin boolean := (select public.is_shilevi_owner_admin());
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  -- Applicants may submit only their own draft. All business/application fields and
  -- reviewer metadata must remain unchanged during this transition.
  if old.user_id = actor_id and old.status = 'draft' and new.status = 'pending' then
    if old.submitted_at is not null
      or new.submitted_at is null
      or new.reviewed_at is distinct from old.reviewed_at
      or new.reviewed_by is distinct from old.reviewed_by
      or new.reviewer_note is distinct from old.reviewer_note
      or new.rejection_reason is distinct from old.rejection_reason
      or new.user_id is distinct from old.user_id
      or new.activity_type is distinct from old.activity_type
      or new.business_name is distinct from old.business_name
      or new.application_data is distinct from old.application_data
      or new.country_code is distinct from old.country_code
      or new.public_reference is distinct from old.public_reference
      or new.created_at is distinct from old.created_at
    then
      raise exception 'Only a draft submission timestamp and status may change during submission.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- Owners may review only another user's pending application, and only with the
  -- verified-email allowlist and aal2 enforced by is_shilevi_owner_admin().
  if owner_admin and old.status = 'pending' and new.status in ('approved', 'rejected') then
    if old.user_id = actor_id then
      raise exception 'Owners cannot review their own provider application.'
        using errcode = '42501';
    end if;
    if new.reviewed_by is distinct from actor_id
      or new.reviewed_at is null
      or new.submitted_at is distinct from old.submitted_at
      or new.user_id is distinct from old.user_id
      or new.activity_type is distinct from old.activity_type
      or new.business_name is distinct from old.business_name
      or new.application_data is distinct from old.application_data
      or new.country_code is distinct from old.country_code
      or new.public_reference is distinct from old.public_reference
      or new.created_at is distinct from old.created_at
    then
      raise exception 'Review may change only status and review metadata.'
        using errcode = '42501';
    end if;
    if new.status = 'rejected' and nullif(trim(coalesce(new.rejection_reason, new.reviewer_note, '')), '') is null then
      raise exception 'A rejection reason is required.'
        using errcode = '23514';
    end if;
    if new.status = 'approved' and new.rejection_reason is not null then
      raise exception 'Approved applications cannot have a rejection reason.'
        using errcode = '23514';
    end if;
    return new;
  end if;

  -- Owner-only suspension and reactivation of an already-approved provider. Only status and review
  -- metadata may change, the owner may not act on their own application, and a suspension needs a
  -- recorded reason so the provider can act on it.
  if owner_admin and old.status in ('approved', 'suspended')
     and new.status in ('approved', 'suspended') and old.status <> new.status then
    if old.user_id = actor_id then
      raise exception 'Owners cannot change the status of their own provider application.'
        using errcode = '42501';
    end if;
    if new.reviewed_by is distinct from actor_id
      or new.reviewed_at is null
      or new.submitted_at is distinct from old.submitted_at
      or new.user_id is distinct from old.user_id
      or new.activity_type is distinct from old.activity_type
      or new.business_name is distinct from old.business_name
      or new.application_data is distinct from old.application_data
      or new.country_code is distinct from old.country_code
      or new.public_reference is distinct from old.public_reference
      or new.created_at is distinct from old.created_at
    then
      raise exception 'Suspension may change only status and review metadata.'
        using errcode = '42501';
    end if;
    if new.status = 'suspended'
       and nullif(trim(coalesce(new.reviewer_note, '')), '') is null then
      raise exception 'A suspension reason is required.'
        using errcode = '23514';
    end if;
    return new;
  end if;

  raise exception 'Provider application status transition is not permitted.'
    using errcode = '42501';
end;
$$;
revoke all on function public.guard_provider_application_transition() from public, anon, authenticated;

create or replace function public.delete_delivery_route(p_route_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in required.';
  end if;

  delete from public.delivery_provider_routes
  where id = p_route_id and provider_user_id = auth.uid();

  if not found then
    raise exception 'Route not found.';
  end if;
end;
$$;
revoke all on function public.delete_delivery_route(uuid) from public, anon;
grant execute on function public.delete_delivery_route(uuid) to authenticated;

commit;
