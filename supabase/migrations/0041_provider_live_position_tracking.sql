-- Shilevi migration 0041: real provider live positions and authorized tracking reads.
-- Forward-only and additive. No existing row, status or financial record is rewritten.
--
-- The gap this closes:
--   `rides` stores pickup/dropoff coordinates (0020) and `deliveries` stores a rider (0029), but
--   nothing anywhere records where an on-duty provider actually is. Every screen that could show a
--   map therefore had no live data to show, and the only honest choice was to show nothing.
--
-- What this migration deliberately does NOT do:
--   * It does not invent positions. A row only exists after a signed-in approved provider's own
--     device publishes coordinates through `publish_provider_position()`.
--   * It does not invent a destination. `deliveries` has no street coordinates column, so delivery
--     tracking returns a real rider position and no fabricated route, distance or ETA.
--   * It does not expose one provider's position to another provider, or any position to a customer
--     who is not on the assignment that provider is currently performing.
--
-- Access model:
--   * `provider_positions` is readable only by its owner (RLS). There is no direct insert/update
--     grant at all; writes go through one SECURITY DEFINER function.
--   * Cross-account reads exist only inside `delivery_tracking()` and `ride_tracking()`, which check
--     participation and the live window themselves and return a narrow JSON document.

begin;

-- ---------------------------------------------------------------- live provider positions

create table if not exists public.provider_positions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  latitude numeric(9, 6) not null check (latitude between -90 and 90),
  longitude numeric(9, 6) not null check (longitude between -180 and 180),
  accuracy_m numeric(8, 1) check (accuracy_m is null or (accuracy_m >= 0 and accuracy_m <= 100000)),
  heading_deg numeric(5, 1) check (heading_deg is null or (heading_deg >= 0 and heading_deg <= 360)),
  speed_mps numeric(6, 2) check (speed_mps is null or (speed_mps >= 0 and speed_mps <= 120)),
  -- Server time of the accepted ping. A device clock is never trusted for freshness.
  recorded_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists provider_positions_set_updated_at on public.provider_positions;
create trigger provider_positions_set_updated_at before update on public.provider_positions
for each row execute function public.set_updated_at();

create index if not exists provider_positions_updated_idx
  on public.provider_positions(updated_at desc);

-- Writes are function-only. A browser session can read its own row and nothing else.
alter table public.provider_positions enable row level security;
revoke all on public.provider_positions from anon, authenticated;
grant select on public.provider_positions to authenticated;
grant select on public.provider_positions to service_role;

drop policy if exists "provider_positions_select_own" on public.provider_positions;
create policy "provider_positions_select_own" on public.provider_positions
for select to authenticated
using (user_id = (select auth.uid()));

comment on table public.provider_positions is
  'Latest device-reported position of one on-duty provider. Written only through publish_provider_position(). Owner-readable only; other accounts read a position exclusively through delivery_tracking()/ride_tracking() inside an authorized live window.';

-- ---------------------------------------------------------------- who may publish

/**
 * True when the account holds an approved provider path that can legitimately perform work: an
 * approved transport-partner application (the table 0029 matches riders from), the transport
 * partner role, or an activated provider activity that covers delivery/ride transactions.
 *
 * This is a permission-to-publish check, not a job allocation decision. It grants no access to any
 * job, and an unapproved applicant cannot obtain a position row at all.
 */
create or replace function public.may_publish_provider_position(p_user_id uuid)
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
        and pa.activity_type = 'transport_partner'
        and pa.status = 'approved'
    )
    or exists (
      select 1 from public.user_roles ur
      where ur.user_id = p_user_id and ur.role = 'transport_partner'
    )
    or exists (
      select 1 from public.provider_activities a
      where a.user_id = p_user_id
        and a.status = 'approved'
        and (a.expires_at is null or a.expires_at > now())
        and a.transaction_types && array['delivery', 'ride']::text[]
    )
  );
$$;
revoke all on function public.may_publish_provider_position(uuid) from public, anon;
grant execute on function public.may_publish_provider_position(uuid) to authenticated;

-- ---------------------------------------------------------------- publish / stop

/**
 * Record the caller's own current position.
 *
 * `p_lat`/`p_lng` are required; everything else is optional device metadata. Updates arriving less
 * than two seconds after the previous accepted ping are acknowledged without a write, so a
 * misconfigured watcher cannot turn into a write storm. Returns the stored row so the caller can
 * confirm what the server actually holds.
 */
create or replace function public.publish_provider_position(
  p_lat numeric,
  p_lng numeric,
  p_accuracy_m numeric default null,
  p_heading_deg numeric default null,
  p_speed_mps numeric default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_existing record;
  v_row record;
begin
  if v_uid is null then
    raise exception 'Sign in to share your location.' using errcode = '42501';
  end if;

  if not public.may_publish_provider_position(v_uid) then
    raise exception 'Only an approved delivery or transport provider can share a working location.'
      using errcode = '42501';
  end if;

  if p_lat is null or p_lng is null then
    raise exception 'A latitude and longitude are required.' using errcode = '22023';
  end if;

  -- Column checks carry the range rules; this keeps the error message useful to the caller.
  if p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then
    raise exception 'Coordinates are outside the valid range.' using errcode = '22023';
  end if;

  select p.updated_at into v_existing
  from public.provider_positions p where p.user_id = v_uid;

  if v_existing.updated_at is not null and v_existing.updated_at > now() - interval '2 seconds' then
    select * into v_row from public.provider_positions p where p.user_id = v_uid;
    return jsonb_build_object(
      'throttled', true,
      'latitude', v_row.latitude,
      'longitude', v_row.longitude,
      'updated_at', v_row.updated_at
    );
  end if;

  insert into public.provider_positions as p (
    user_id, latitude, longitude, accuracy_m, heading_deg, speed_mps, recorded_at, updated_at
  ) values (
    v_uid, p_lat, p_lng, p_accuracy_m, p_heading_deg, p_speed_mps, now(), now()
  )
  on conflict (user_id) do update
    set latitude = excluded.latitude,
        longitude = excluded.longitude,
        accuracy_m = excluded.accuracy_m,
        heading_deg = excluded.heading_deg,
        speed_mps = excluded.speed_mps,
        recorded_at = excluded.recorded_at,
        updated_at = excluded.updated_at
  returning * into v_row;

  return jsonb_build_object(
    'throttled', false,
    'latitude', v_row.latitude,
    'longitude', v_row.longitude,
    'updated_at', v_row.updated_at
  );
end;
$$;
revoke all on function public.publish_provider_position(numeric, numeric, numeric, numeric, numeric) from public, anon;
grant execute on function public.publish_provider_position(numeric, numeric, numeric, numeric, numeric) to authenticated;

/**
 * Stop sharing: the row is deleted, not merely flagged, so nothing stale survives for a later read.
 * Deleting is also what makes "off duty" mean off duty.
 */
create or replace function public.stop_provider_position_sharing()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'Not authenticated.' using errcode = '42501';
  end if;
  delete from public.provider_positions p where p.user_id = v_uid;
  return true;
end;
$$;
revoke all on function public.stop_provider_position_sharing() from public, anon;
grant execute on function public.stop_provider_position_sharing() to authenticated;

-- ---------------------------------------------------------------- tracking reads

/**
 * Read-model for a live delivery.
 *
 * Authorized readers: the order's customer, the assigned rider, the owner and delivery staff.
 * A position is returned only while the delivery is inside its live window (assigned → in_transit)
 * and only while the rider is still sharing. Nothing about a rider's documents, phone number or
 * email is returned — only a display name and the vehicle that will arrive.
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

  return jsonb_build_object(
    'delivery_id', v_row.id,
    'status', v_row.status,
    'live', v_live,
    'pickup_label', v_row.pickup_address,
    'dropoff_label', v_row.dropoff_address,
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
    'destination', null,
    'notice', case
      when not v_live then 'Live tracking starts when a rider is assigned and stops when the delivery ends.'
      when v_pos.latitude is null then 'Your rider is assigned but has not started sharing their location.'
      when v_stale then 'The last known position is out of date; tracking may have been interrupted.'
      else 'Live position reported by your rider''s device.'
    end
  );
end;
$$;
revoke all on function public.delivery_tracking(uuid) from public, anon;
grant execute on function public.delivery_tracking(uuid) to authenticated;

/**
 * Read-model for a live passenger ride.
 *
 * `rides` carries real pickup/dropoff coordinates, so this returns genuine endpoints as well as the
 * driver's live position. The same participation and live-window rules apply.
 */
create or replace function public.ride_tracking(p_ride_id uuid)
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
begin
  if v_uid is null then
    raise exception 'Not authenticated.' using errcode = '42501';
  end if;

  select r.id,
         r.status,
         r.rider_id,
         r.customer_id,
         r.pickup_label,
         r.dropoff_label,
         r.pickup_lat,
         r.pickup_lng,
         r.dropoff_lat,
         r.dropoff_lng,
         r.agreed_fare_minor,
         r.currency
    into v_row
  from public.rides r where r.id = p_ride_id;

  if v_row.id is null then
    raise exception 'Ride not found.' using errcode = 'P0002';
  end if;

  v_is_customer := v_row.customer_id = v_uid;
  v_is_rider := v_row.rider_id = v_uid;
  v_is_staff := (select public.is_shilevi_owner_admin());

  if not (v_is_customer or v_is_rider or v_is_staff) then
    raise exception 'Not authorized to track this ride.' using errcode = '42501';
  end if;

  v_live := v_row.status in ('agreed', 'paid', 'arrived', 'in_progress');

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

  return jsonb_build_object(
    'ride_id', v_row.id,
    'status', v_row.status,
    'live', v_live,
    'pickup_label', v_row.pickup_label,
    'dropoff_label', v_row.dropoff_label,
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
          'Your driver'
        ),
        'vehicle', (
          select nullif(concat_ws(' · ', nullif(v.make_model, ''), nullif(v.plate_number, '')), '')
          from public.transport_vehicles v
          where v.user_id = v_row.rider_id and v.is_active and v.verification_status = 'approved'
          order by v.created_at
          limit 1
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
    'notice', case
      when not v_live then 'Live tracking is available once the fare is agreed and stops when the ride ends.'
      when v_pos.latitude is null then 'Your driver has not started sharing their location.'
      when v_stale then 'The last known position is out of date; tracking may have been interrupted.'
      else 'Live position reported by your driver''s device.'
    end
  );
end;
$$;
revoke all on function public.ride_tracking(uuid) from public, anon;
grant execute on function public.ride_tracking(uuid) to authenticated;

/**
 * The signed-in provider's own position, for their operational map. Returns null when they are not
 * sharing, which is what "off duty" must look like to the app.
 */
create or replace function public.my_provider_position()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_pos record;
begin
  if v_uid is null then
    raise exception 'Not authenticated.' using errcode = '42501';
  end if;

  select p.latitude, p.longitude, p.accuracy_m, p.heading_deg, p.updated_at
    into v_pos
  from public.provider_positions p where p.user_id = v_uid;

  if v_pos.latitude is null then
    return jsonb_build_object('sharing', false, 'position', null);
  end if;

  return jsonb_build_object(
    'sharing', true,
    'position', jsonb_build_object(
      'latitude', v_pos.latitude,
      'longitude', v_pos.longitude,
      'accuracy_m', v_pos.accuracy_m,
      'heading_deg', v_pos.heading_deg,
      'updated_at', v_pos.updated_at,
      'age_seconds', round(extract(epoch from (now() - v_pos.updated_at))),
      'stale', now() - v_pos.updated_at > interval '120 seconds'
    )
  );
end;
$$;
revoke all on function public.my_provider_position() from public, anon;
grant execute on function public.my_provider_position() to authenticated;

commit;
