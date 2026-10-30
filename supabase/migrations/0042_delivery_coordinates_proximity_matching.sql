-- Shilevi migration 0042: real delivery coordinates, seller pickup points and proximity matching.
-- Forward-only and additive. No existing delivery, order, quote or ledger row is rewritten.
--
-- The gap this closes:
--   `deliveries` recorded two free-text addresses and (from 0029) county/service-location ids, but no
--   coordinates. So `match_delivery_candidates()` could only rank by declared routes and service
--   areas, `delivery_tracking()` had to return `destination: null`, and no map could show where a
--   package actually had to go.
--
-- What this migration deliberately does NOT do:
--   * It does not invent a coordinate. A point exists only because a customer pinned it at checkout,
--     a seller confirmed their own collection point, or a configured geocoder resolved an address.
--     Historical deliveries keep `*_point_source = 'none'` and remain valid.
--   * It does not turn a county name into a street coordinate.
--   * It does not add a delivery fee, change an accepted quote, alter commission or touch the ledger.
--   * It does not expose a pickup or destination point to a rider before the job is assigned, or to
--     anyone who is not a participant.

begin;

-- ---------------------------------------------------------------- distance helper

/**
 * Great-circle distance in kilometres between two coordinates.
 *
 * This is the only distance Shilevi can compute without a routing provider, and every caller labels
 * it as straight-line distance. It is never presented as a road distance or used to promise an ETA.
 */
create or replace function public.geo_distance_km(
  p_lat1 numeric,
  p_lng1 numeric,
  p_lat2 numeric,
  p_lng2 numeric
) returns double precision
language sql
immutable
set search_path = ''
as $$
  select case
    when p_lat1 is null or p_lng1 is null or p_lat2 is null or p_lng2 is null then null
    else 6371.0088 * 2 * asin(least(1, sqrt(
      power(sin(radians(p_lat2 - p_lat1) / 2), 2)
      + cos(radians(p_lat1)) * cos(radians(p_lat2))
        * power(sin(radians(p_lng2 - p_lng1) / 2), 2)
    )))
  end;
$$;
revoke all on function public.geo_distance_km(numeric, numeric, numeric, numeric) from public, anon;
grant execute on function public.geo_distance_km(numeric, numeric, numeric, numeric) to authenticated;

-- ---------------------------------------------------------------- delivery coordinates

alter table public.deliveries
  add column if not exists pickup_lat numeric(9, 6)
    check (pickup_lat is null or pickup_lat between -90 and 90),
  add column if not exists pickup_lng numeric(9, 6)
    check (pickup_lng is null or pickup_lng between -180 and 180),
  add column if not exists pickup_accuracy_m numeric(8, 1)
    check (pickup_accuracy_m is null or (pickup_accuracy_m >= 0 and pickup_accuracy_m <= 100000)),
  add column if not exists pickup_landmark text
    check (pickup_landmark is null or char_length(pickup_landmark) between 1 and 200),
  add column if not exists pickup_point_source text not null default 'none'
    check (pickup_point_source in ('none', 'seller_pin', 'staff_pin', 'geocoder')),
  add column if not exists pickup_point_confirmed_at timestamptz,
  add column if not exists dropoff_lat numeric(9, 6)
    check (dropoff_lat is null or dropoff_lat between -90 and 90),
  add column if not exists dropoff_lng numeric(9, 6)
    check (dropoff_lng is null or dropoff_lng between -180 and 180),
  add column if not exists dropoff_accuracy_m numeric(8, 1)
    check (dropoff_accuracy_m is null or (dropoff_accuracy_m >= 0 and dropoff_accuracy_m <= 100000)),
  add column if not exists dropoff_landmark text
    check (dropoff_landmark is null or char_length(dropoff_landmark) between 1 and 200),
  add column if not exists dropoff_point_source text not null default 'none'
    check (dropoff_point_source in ('none', 'customer_pin', 'staff_pin', 'geocoder')),
  add column if not exists dropoff_point_confirmed_at timestamptz;

-- A latitude without a longitude is an unusable point, so the pair is all-or-nothing.
alter table public.deliveries
  drop constraint if exists deliveries_pickup_point_pair;
alter table public.deliveries
  add constraint deliveries_pickup_point_pair check ((pickup_lat is null) = (pickup_lng is null));

alter table public.deliveries
  drop constraint if exists deliveries_dropoff_point_pair;
alter table public.deliveries
  add constraint deliveries_dropoff_point_pair check ((dropoff_lat is null) = (dropoff_lng is null));

create index if not exists deliveries_pickup_point_idx
  on public.deliveries(pickup_lat, pickup_lng)
  where pickup_lat is not null;

comment on column public.deliveries.dropoff_point_source is
  'How the destination coordinate was obtained. none means no real point exists; it is never back-filled from a county or address.';

-- ---------------------------------------------------------------- seller pickup points

create table if not exists public.provider_pickup_points (
  user_id uuid primary key references auth.users(id) on delete cascade,
  label text check (label is null or char_length(label) between 1 and 120),
  latitude numeric(9, 6) not null check (latitude between -90 and 90),
  longitude numeric(9, 6) not null check (longitude between -180 and 180),
  accuracy_m numeric(8, 1) check (accuracy_m is null or (accuracy_m >= 0 and accuracy_m <= 100000)),
  landmark text check (landmark is null or char_length(landmark) between 1 and 200),
  updated_at timestamptz not null default now()
);

drop trigger if exists provider_pickup_points_set_updated_at on public.provider_pickup_points;
create trigger provider_pickup_points_set_updated_at before update on public.provider_pickup_points
for each row execute function public.set_updated_at();

alter table public.provider_pickup_points enable row level security;
revoke all on public.provider_pickup_points from anon, authenticated;
grant select, insert, update, delete on public.provider_pickup_points to authenticated;

drop policy if exists "provider_pickup_points_select_own_or_staff" on public.provider_pickup_points;
create policy "provider_pickup_points_select_own_or_staff" on public.provider_pickup_points
for select to authenticated
using (
  user_id = (select auth.uid())
  or (select public.is_shilevi_owner_admin())
  or (select public.has_staff_capability('delivery.manage'))
);

drop policy if exists "provider_pickup_points_manage_own" on public.provider_pickup_points;
create policy "provider_pickup_points_manage_own" on public.provider_pickup_points
for all to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

comment on table public.provider_pickup_points is
  'A provider''s explicitly confirmed collection point. Set through set_my_pickup_point(); never derived from a business address.';

-- ---------------------------------------------------------------- who may set a pickup point

/**
 * A provider path that can legitimately hand goods over: an approved application, or ownership of a
 * listing (the historic seller path). Nothing here grants delivery eligibility.
 */
create or replace function public.may_publish_pickup_point(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null and (
    exists (
      select 1 from public.provider_applications pa
      where pa.user_id = p_user_id
        and pa.status = 'approved'
        and pa.activity_type in ('product_seller', 'service_provider', 'transport_partner')
    )
    or exists (
      select 1 from public.listings l
      where l.owner_id = p_user_id
    )
  );
$$;
revoke all on function public.may_publish_pickup_point(uuid) from public, anon;
grant execute on function public.may_publish_pickup_point(uuid) to authenticated;

create or replace function public.set_my_pickup_point(
  p_lat numeric,
  p_lng numeric,
  p_accuracy_m numeric default null,
  p_landmark text default null,
  p_label text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row record;
begin
  if v_uid is null then
    raise exception 'Sign in to set a pickup point.' using errcode = '42501';
  end if;

  if not public.may_publish_pickup_point(v_uid) then
    raise exception 'Only a seller or provider with an approved account can save a pickup point.'
      using errcode = '42501';
  end if;

  if p_lat is null or p_lng is null then
    raise exception 'A latitude and longitude are required.' using errcode = '22023';
  end if;

  insert into public.provider_pickup_points as p (
    user_id, label, latitude, longitude, accuracy_m, landmark, updated_at
  ) values (
    v_uid,
    nullif(trim(coalesce(p_label, '')), ''),
    p_lat,
    p_lng,
    p_accuracy_m,
    nullif(trim(coalesce(p_landmark, '')), ''),
    now()
  )
  on conflict (user_id) do update
    set label = excluded.label,
        latitude = excluded.latitude,
        longitude = excluded.longitude,
        accuracy_m = excluded.accuracy_m,
        landmark = excluded.landmark,
        updated_at = excluded.updated_at
  returning * into v_row;

  return jsonb_build_object(
    'latitude', v_row.latitude,
    'longitude', v_row.longitude,
    'label', v_row.label,
    'landmark', v_row.landmark,
    'updated_at', v_row.updated_at
  );
end;
$$;
revoke all on function public.set_my_pickup_point(numeric, numeric, numeric, text, text) from public, anon;
grant execute on function public.set_my_pickup_point(numeric, numeric, numeric, text, text) to authenticated;

-- A saved pickup point pre-fills a new shipment for the same seller. It is one explicit point the
-- seller chose, not an address guessed from the listing.
create or replace function public.deliveries_prefill_pickup_point()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seller uuid;
  v_point record;
begin
  if new.pickup_lat is not null then
    return new;
  end if;

  select oi.owner_id into v_seller
  from public.order_items oi
  where oi.order_id = new.order_id
  order by oi.owner_id
  limit 1;

  if v_seller is null then
    return new;
  end if;

  select p.latitude, p.longitude, p.accuracy_m, p.landmark
    into v_point
  from public.provider_pickup_points p
  where p.user_id = v_seller;

  if v_point.latitude is null then
    return new;
  end if;

  new.pickup_lat := v_point.latitude;
  new.pickup_lng := v_point.longitude;
  new.pickup_accuracy_m := v_point.accuracy_m;
  new.pickup_landmark := v_point.landmark;
  new.pickup_point_source := 'seller_pin';
  new.pickup_point_confirmed_at := now();
  return new;
end;
$$;

drop trigger if exists deliveries_prefill_pickup_point on public.deliveries;
create trigger deliveries_prefill_pickup_point before insert on public.deliveries
for each row execute function public.deliveries_prefill_pickup_point();

-- ---------------------------------------------------------------- set the two points

/**
 * The customer confirms where the parcel must go.
 *
 * Only the order's own customer (or the owner) may do this, and only until the rider has collected
 * it — after that the destination is part of a job in progress. No price, fee or ledger value moves.
 */
create or replace function public.set_delivery_destination(
  p_order_id uuid,
  p_lat numeric,
  p_lng numeric,
  p_accuracy_m numeric default null,
  p_landmark text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row record;
  v_is_customer boolean;
  v_is_staff boolean;
begin
  if v_uid is null then
    raise exception 'Not authenticated.' using errcode = '42501';
  end if;

  if p_lat is null or p_lng is null then
    raise exception 'A latitude and longitude are required.' using errcode = '22023';
  end if;

  select d.id, d.status, o.customer_id
    into v_row
  from public.deliveries d
  join public.orders o on o.id = d.order_id
  where d.order_id = p_order_id;

  if v_row.id is null then
    raise exception 'This order has no platform delivery to place a point on.' using errcode = 'P0002';
  end if;

  v_is_customer := v_row.customer_id = v_uid;
  v_is_staff := (select public.is_shilevi_owner_admin());

  if not (v_is_customer or v_is_staff) then
    raise exception 'Not authorized to set this destination.' using errcode = '42501';
  end if;

  if v_row.status not in ('requested', 'assigned', 'to_pickup') then
    raise exception 'The rider has already collected this parcel, so the destination can no longer change.'
      using errcode = '22023';
  end if;

  update public.deliveries d
     set dropoff_lat = p_lat,
         dropoff_lng = p_lng,
         dropoff_accuracy_m = p_accuracy_m,
         dropoff_landmark = nullif(trim(coalesce(p_landmark, '')), ''),
         dropoff_point_source = case when v_is_customer then 'customer_pin' else 'staff_pin' end,
         dropoff_point_confirmed_at = now(),
         updated_at = now()
   where d.id = v_row.id;

  return jsonb_build_object(
    'delivery_id', v_row.id,
    'latitude', p_lat,
    'longitude', p_lng,
    'source', case when v_is_customer then 'customer_pin' else 'staff_pin' end,
    'confirmed_at', now()
  );
end;
$$;
revoke all on function public.set_delivery_destination(uuid, numeric, numeric, numeric, text) from public, anon;
grant execute on function public.set_delivery_destination(uuid, numeric, numeric, numeric, text) to authenticated;

/**
 * The seller confirms the collection point for one shipment.
 *
 * Viewing or changing another seller's shipment is refused. Allowed until the rider is at the
 * counter; a collected parcel has already been picked up from a real place.
 */
create or replace function public.set_delivery_pickup_point(
  p_delivery_id uuid,
  p_lat numeric,
  p_lng numeric,
  p_accuracy_m numeric default null,
  p_landmark text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row record;
  v_is_seller boolean;
  v_is_staff boolean;
begin
  if v_uid is null then
    raise exception 'Not authenticated.' using errcode = '42501';
  end if;

  if p_lat is null or p_lng is null then
    raise exception 'A latitude and longitude are required.' using errcode = '22023';
  end if;

  select d.id, d.status, d.order_id
    into v_row
  from public.deliveries d
  where d.id = p_delivery_id;

  if v_row.id is null then
    raise exception 'Shipment not found.' using errcode = 'P0002';
  end if;

  v_is_seller := exists (
    select 1 from public.order_items oi
    where oi.order_id = v_row.order_id and oi.owner_id = v_uid
  );
  v_is_staff := (select public.is_shilevi_owner_admin())
    or (select public.has_staff_capability('delivery.manage'));

  if not (v_is_seller or v_is_staff) then
    raise exception 'Not authorized to set this pickup point.' using errcode = '42501';
  end if;

  if v_row.status not in ('requested', 'assigned', 'to_pickup') then
    raise exception 'This shipment has already been collected, so its pickup point cannot change.'
      using errcode = '22023';
  end if;

  update public.deliveries d
     set pickup_lat = p_lat,
         pickup_lng = p_lng,
         pickup_accuracy_m = p_accuracy_m,
         pickup_landmark = nullif(trim(coalesce(p_landmark, '')), ''),
         pickup_point_source = case when v_is_seller then 'seller_pin' else 'staff_pin' end,
         pickup_point_confirmed_at = now(),
         updated_at = now()
   where d.id = v_row.id;

  return jsonb_build_object(
    'delivery_id', v_row.id,
    'latitude', p_lat,
    'longitude', p_lng,
    'source', case when v_is_seller then 'seller_pin' else 'staff_pin' end,
    'confirmed_at', now()
  );
end;
$$;
revoke all on function public.set_delivery_pickup_point(uuid, numeric, numeric, numeric, text) from public, anon;
grant execute on function public.set_delivery_pickup_point(uuid, numeric, numeric, numeric, text) to authenticated;

-- ---------------------------------------------------------------- proximity ranking

/**
 * Rank eligible delivery candidates, now with real distance.
 *
 * The eligibility gates from 0029 are unchanged — approved application, approved and active vehicle,
 * current documents, an approved fleet, vehicle class, weight and dimension fit, and a declared route
 * or service area. Distance is a ranking signal only; it can never make an ineligible rider eligible
 * and it is never compared across accounts by anything a client sends.
 *
 * Availability is the fresh location: a rider who is sharing a position reported within the last ten
 * minutes is ranked ahead of riders with no fresh fix. A stale position is never treated as current —
 * it yields no distance at all, and the row sorts after every fresh candidate.
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
      ) as failed_deliveries,
      pos.latitude as rider_lat,
      pos.longitude as rider_lng,
      pos.updated_at as rider_position_at
    from public.provider_applications pa
    join public.transport_vehicles v on v.user_id = pa.user_id
    join public.delivery_vehicle_classes c on c.code = v.vehicle_class_code
    left join public.provider_positions pos on pos.user_id = pa.user_id
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
  ), scored as (
    select
      e.*,
      (e.rider_position_at is not null and e.rider_position_at > now() - interval '10 minutes')
        as position_fresh,
      case
        when e.rider_position_at is null then null
        when e.rider_position_at <= now() - interval '10 minutes' then null
        when v_delivery.pickup_lat is null or e.rider_lat is null then null
        else round(
          public.geo_distance_km(e.rider_lat, e.rider_lng, v_delivery.pickup_lat, v_delivery.pickup_lng)::numeric,
          2
        )
      end as rider_distance_km,
      case
        when e.rider_position_at is null then null
        else round(extract(epoch from (now() - e.rider_position_at)))::int
      end as rider_position_age_seconds
    from eligible e
  )
  select
    s.provider_user_id,
    s.vehicle_row_id,
    s.class_code,
    round(greatest(0, least(100,
      50
      + case when s.exact_route then 20 else 8 end
      + case
          when v_delivery.weight_kg is null or s.capacity_kg <= 0 then 10
          else least(12, round(12 * (1 - (v_delivery.weight_kg / s.capacity_kg::numeric)), 2))
        end
      + least(10, s.completed_deliveries::numeric)
      - least(15, (s.failed_deliveries * 3)::numeric)
    )), 2),
    jsonb_build_object(
      'exact_route', s.exact_route,
      'service_area_route', s.area_route,
      'capacity_kg', s.capacity_kg,
      'completed_deliveries', s.completed_deliveries,
      'failed_deliveries', s.failed_deliveries,
      'vehicle_class', s.class_code,
      'position_fresh', s.position_fresh,
      'rider_position_age_seconds', s.rider_position_age_seconds,
      'rider_distance_km', s.rider_distance_km,
      'distance_basis', 'straight_line',
      'pickup_point_confirmed', v_delivery.pickup_lat is not null,
      'note', 'Eligibility is unchanged; distance and location freshness only order eligible candidates.'
    )
  from scored s
  order by s.position_fresh desc nulls last, s.rider_distance_km asc nulls last, 4 desc, 1;
end;
$$;
revoke all on function public.match_delivery_candidates(uuid) from public, anon;
grant execute on function public.match_delivery_candidates(uuid) to authenticated;

-- ---------------------------------------------------------------- tracking with a real destination

/**
 * 0041's tracking read-model, extended with the real points and an honest distance.
 *
 * `straight_line_km` is great-circle distance between the rider and the destination and is labelled
 * as such in `distance_basis`. Without a routing provider there is no road distance and no ETA, so
 * neither field exists — the app shows markers and the straight-line figure only.
 */
create or replace function public.delivery_tracking(p_delivery_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row record;
  v_is_customer boolean;
  v_is_rider boolean;
  v_is_staff boolean;
  v_live boolean;
  v_pos record;
  v_age_seconds numeric;
  v_stale boolean;
  v_straight_km numeric;
begin
  if v_uid is null then
    raise exception 'Not authenticated.' using errcode = '42501';
  end if;

  select d.id,
         d.status,
         d.rider_id,
         d.pickup_address,
         d.dropoff_address,
         d.assigned_vehicle_id,
         d.pickup_lat,
         d.pickup_lng,
         d.pickup_landmark,
         d.pickup_point_source,
         d.dropoff_lat,
         d.dropoff_lng,
         d.dropoff_landmark,
         d.dropoff_point_source,
         o.customer_id
    into v_row
  from public.deliveries d
  join public.orders o on o.id = d.order_id
  where d.id = p_delivery_id;

  if v_row.id is null then
    raise exception 'Delivery not found.' using errcode = 'P0002';
  end if;

  v_is_customer := v_row.customer_id = v_uid;
  v_is_rider := v_row.rider_id is not null and v_row.rider_id = v_uid;
  v_is_staff := (select public.is_shilevi_owner_admin())
    or (select public.has_staff_capability('delivery.manage'));

  if not (v_is_customer or v_is_rider or v_is_staff) then
    raise exception 'Not authorized to track this delivery.' using errcode = '42501';
  end if;

  v_live := v_row.rider_id is not null
    and v_row.status in ('assigned', 'to_pickup', 'collected', 'in_transit');

  if v_live then
    select p.latitude, p.longitude, p.accuracy_m, p.heading_deg, p.updated_at
      into v_pos
    from public.provider_positions p where p.user_id = v_row.rider_id;
    v_age_seconds := case
      when v_pos.updated_at is null then null
      else round(extract(epoch from (now() - v_pos.updated_at)))
    end;
    v_stale := v_age_seconds is null or v_age_seconds > 120;
  end if;

  if v_pos.latitude is not null and v_row.dropoff_lat is not null and not v_stale then
    v_straight_km := round(
      public.geo_distance_km(v_pos.latitude, v_pos.longitude, v_row.dropoff_lat, v_row.dropoff_lng)::numeric,
      2
    );
  end if;

  return jsonb_build_object(
    'delivery_id', v_row.id,
    'status', v_row.status,
    'live', v_live,
    'pickup_label', v_row.pickup_address,
    'dropoff_label', v_row.dropoff_address,
    'pickup_landmark', v_row.pickup_landmark,
    'dropoff_landmark', v_row.dropoff_landmark,
    'pickup_source', v_row.pickup_point_source,
    'dropoff_source', v_row.dropoff_point_source,
    'pickup_point', case
      when v_row.pickup_lat is null then null
      else jsonb_build_object('latitude', v_row.pickup_lat, 'longitude', v_row.pickup_lng)
    end,
    'dropoff_point', case
      when v_row.dropoff_lat is null then null
      else jsonb_build_object('latitude', v_row.dropoff_lat, 'longitude', v_row.dropoff_lng)
    end,
    'rider', case
      when v_live then jsonb_build_object(
        'display_name', coalesce(
          (select pr.display_name from public.profiles pr where pr.id = v_row.rider_id),
          'Your delivery partner'
        ),
        'vehicle', (
          select nullif(concat_ws(' · ', nullif(v.make_model, ''), nullif(v.plate_number, '')), '')
          from public.transport_vehicles v
          where v.id = v_row.assigned_vehicle_id
        )
      )
      else null
    end,
    'position', case
      when v_live and v_pos.latitude is not null then jsonb_build_object(
        'latitude', v_pos.latitude,
        'longitude', v_pos.longitude,
        'accuracy_m', v_pos.accuracy_m,
        'heading_deg', v_pos.heading_deg,
        'updated_at', v_pos.updated_at,
        'age_seconds', v_age_seconds,
        'stale', v_stale
      )
      else null
    end,
    'straight_line_km', v_straight_km,
    'distance_basis', case when v_straight_km is null then null else 'straight_line' end,
    'notice', case
      when not v_live then 'Live tracking starts when a rider is assigned and stops when the delivery ends.'
      when v_pos.latitude is null then 'Your rider is assigned but has not started sharing their location.'
      when v_stale then 'The last known position is out of date; tracking may have been interrupted.'
      when v_row.dropoff_lat is null then 'Your rider is on the way. No exact destination pin was saved for this order, so no distance is shown.'
      else 'Live position reported by your rider''s device. Distance is straight-line, not a road distance.'
    end
  );
end;
$$;
revoke all on function public.delivery_tracking(uuid) from public, anon;
grant execute on function public.delivery_tracking(uuid) to authenticated;

comment on function public.delivery_tracking(uuid) is
  'Participant-scoped live delivery read-model. Returns real pickup/destination points when they exist, a straight-line distance and no invented route or ETA.';

commit;
