-- Shilevi migration 0020: passenger transport.
-- Review and run manually after 0019. This file does not touch a live project.
--
-- Design notes
--   * A ride is NOT a delivery. It has its own table, its own state machine, its own fare
--     negotiation and its own ledger entries. Deliveries remain in public.deliveries.
--   * A transport partner may serve both, but a passenger ride requires an approved vehicle whose
--     mode matches the requested mode. Delivery handover rules do not apply here.
--   * Money is integer minor units (KES cents). The customer proposes a fare; the rider may accept,
--     counter once, or decline; the customer must accept a counter before payment is allowed.
--   * Earnings become payable only after the rider completes the trip AND the customer confirms.
--   * The ledger stays balanced after every mutation. Settlement nets to zero.
begin;

create sequence if not exists public.ride_number_seq start 1000;

create table if not exists public.transport_vehicles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mode text not null check (mode in ('car','motorcycle','bicycle','tuk_tuk','van')),
  make_model text not null,
  plate_number text not null,
  seat_capacity integer not null default 1 check (seat_capacity between 1 and 60),
  verification_status text not null default 'pending'
    check (verification_status in ('pending','approved','rejected','suspended')),
  reviewer_note text,
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transport_vehicle_make_size check (char_length(make_model) between 1 and 120),
  constraint transport_vehicle_plate_size check (char_length(plate_number) between 2 and 24)
);

create unique index if not exists transport_vehicles_user_plate_unique
  on public.transport_vehicles(user_id, upper(plate_number));
create index if not exists transport_vehicles_mode_idx
  on public.transport_vehicles(mode, verification_status, is_active);

drop trigger if exists transport_vehicles_set_updated_at on public.transport_vehicles;
create trigger transport_vehicles_set_updated_at before update on public.transport_vehicles
for each row execute function public.set_updated_at();

create table if not exists public.rides (
  id uuid primary key default gen_random_uuid(),
  ride_number text not null unique,
  customer_id uuid not null references auth.users(id) on delete restrict,
  rider_id uuid not null references auth.users(id) on delete restrict,
  status text not null default 'requested' check (status in (
    'requested','countered','agreed','paid','arrived','in_progress','rider_completed',
    'completed','cancelled'
  )),
  ride_mode text not null check (ride_mode in ('car','motorcycle','bicycle','tuk_tuk','van')),
  pickup_label text not null,
  dropoff_label text not null,
  pickup_area text,
  dropoff_area text,
  pickup_lat numeric(9,6) check (pickup_lat is null or pickup_lat between -90 and 90),
  pickup_lng numeric(9,6) check (pickup_lng is null or pickup_lng between -180 and 180),
  dropoff_lat numeric(9,6) check (dropoff_lat is null or dropoff_lat between -90 and 90),
  dropoff_lng numeric(9,6) check (dropoff_lng is null or dropoff_lng between -180 and 180),
  distance_km numeric(8,2) check (distance_km is null or distance_km >= 0),
  proposed_fare_minor bigint not null check (proposed_fare_minor > 0),
  counter_fare_minor bigint check (counter_fare_minor is null or counter_fare_minor > 0),
  agreed_fare_minor bigint check (agreed_fare_minor is null or agreed_fare_minor > 0),
  currency char(3) not null default 'KES' check (currency ~ '^[A-Z]{3}$'),
  commission_rate_bps integer not null default 1000 check (commission_rate_bps between 0 and 5000),
  commission_minor bigint not null default 0 check (commission_minor >= 0),
  rider_net_minor bigint not null default 0 check (rider_net_minor >= 0),
  payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid','paid','refund_pending','refunded','failed')),
  payment_provider text,
  payment_reference text,
  paid_at timestamptz,
  arrived_at timestamptz,
  started_at timestamptz,
  rider_confirmed_at timestamptz,
  customer_confirmed_at timestamptz,
  released_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rides_party_distinct check (customer_id <> rider_id),
  constraint rides_pickup_size check (char_length(pickup_label) between 3 and 300),
  constraint rides_dropoff_size check (char_length(dropoff_label) between 3 and 300),
  constraint rides_fare_floor check (proposed_fare_minor >= 1000),
  constraint rides_fare_ceiling check (proposed_fare_minor <= 10000000),
  constraint rides_agreed_split check (
    payment_status <> 'paid'
    or (agreed_fare_minor is not null and commission_minor + rider_net_minor = agreed_fare_minor)
  )
);

create unique index if not exists rides_payment_reference_unique
  on public.rides(payment_reference) where payment_reference is not null;
create index if not exists rides_customer_idx on public.rides(customer_id, created_at desc);
create index if not exists rides_rider_idx on public.rides(rider_id, status, created_at desc);
create index if not exists rides_status_idx on public.rides(status, created_at);

drop trigger if exists rides_set_updated_at on public.rides;
create trigger rides_set_updated_at before update on public.rides
for each row execute function public.set_updated_at();

-- Negotiation history. Every proposal, counter, acceptance and decline is retained; the final
-- agreed fare is additionally snapshotted on the ride so it cannot be silently rewritten.
create table if not exists public.ride_offers (
  id bigserial primary key,
  ride_id uuid not null references public.rides(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete restrict,
  actor_role text not null check (actor_role in ('customer','rider')),
  offer_type text not null check (offer_type in ('proposal','counteroffer','accept','decline','cancel')),
  amount_minor bigint check (amount_minor is null or amount_minor > 0),
  note text,
  created_at timestamptz not null default now(),
  constraint ride_offer_note_size check (note is null or char_length(note) <= 500)
);

create index if not exists ride_offers_ride_idx on public.ride_offers(ride_id, created_at);

create table if not exists public.ride_events (
  id bigserial primary key,
  ride_id uuid not null references public.rides(id) on delete cascade,
  status text not null,
  actor_id uuid references auth.users(id) on delete set null,
  actor_role text not null check (actor_role in ('customer','rider','admin','system')),
  note text,
  created_at timestamptz not null default now()
);

create index if not exists ride_events_ride_idx on public.ride_events(ride_id, created_at desc);

create table if not exists public.ride_reviews (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null unique references public.rides(id) on delete cascade,
  customer_id uuid not null references auth.users(id) on delete restrict,
  rider_id uuid not null references auth.users(id) on delete restrict,
  rating smallint not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now(),
  constraint ride_review_comment_size check (comment is null or char_length(comment) <= 1000)
);

create index if not exists ride_reviews_rider_idx on public.ride_reviews(rider_id, created_at desc);

-- Extend the single ledger so ride money is recorded in the same double-entry book as orders.
alter table public.ledger_entries alter column order_id drop not null;
alter table public.ledger_entries
  add column if not exists ride_id uuid references public.rides(id) on delete cascade;
alter table public.ledger_entries
  add column if not exists payout_id uuid references public.payouts(id) on delete set null;

alter table public.ledger_entries drop constraint if exists ledger_entries_entry_type_check;
alter table public.ledger_entries add constraint ledger_entries_entry_type_check check (entry_type in (
  'customer_charge','commission','provider_payable','delivery_split','refund','adjustment',
  'ride_charge','ride_commission','ride_payout','payout'
));

alter table public.ledger_entries drop constraint if exists ledger_entries_account_check;
alter table public.ledger_entries add constraint ledger_entries_account_check check (account in (
  'customer','settlement','platform_commission','platform_delivery','provider_payable','rider_payable','platform_cash'
));

alter table public.ledger_entries drop constraint if exists ledger_entry_one_side;
alter table public.ledger_entries add constraint ledger_entry_one_side check (
  (debit_minor > 0 and credit_minor = 0) or (credit_minor > 0 and debit_minor = 0)
);

alter table public.ledger_entries drop constraint if exists ledger_entry_subject;
alter table public.ledger_entries add constraint ledger_entry_subject check (
  (order_id is not null)::int + (ride_id is not null)::int + (payout_id is not null)::int = 1
);

alter table public.payouts
  add column if not exists destination_phone text,
  add column if not exists failure_reason text;
alter table public.payouts alter column status set default 'pending';

alter table public.payouts drop constraint if exists payouts_status_check;
alter table public.payouts add constraint payouts_status_check check (
  status in ('pending','processing','paid','failed','cancelled')
);

-- Keep the proof of the split immutable once money has been taken.
create or replace function public.prevent_paid_ride_rewrite()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.payment_status = 'paid' then
    if new.agreed_fare_minor is distinct from old.agreed_fare_minor
      or new.commission_minor is distinct from old.commission_minor
      or new.rider_net_minor is distinct from old.rider_net_minor
      or new.customer_id is distinct from old.customer_id
      or new.rider_id is distinct from old.rider_id then
      raise exception 'A paid ride cannot be repriced or reassigned. Raise a refund instead.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists rides_prevent_paid_rewrite on public.rides;
create trigger rides_prevent_paid_rewrite before update on public.rides
for each row execute function public.prevent_paid_ride_rewrite();

-- ---------------------------------------------------------------- RLS and grants

alter table public.transport_vehicles enable row level security;
alter table public.rides enable row level security;
alter table public.ride_offers enable row level security;
alter table public.ride_events enable row level security;
alter table public.ride_reviews enable row level security;

revoke all on public.transport_vehicles, public.rides, public.ride_offers,
  public.ride_events, public.ride_reviews from anon, authenticated;
grant select on public.transport_vehicles, public.rides, public.ride_offers,
  public.ride_events, public.ride_reviews to authenticated;

create or replace function public.is_ride_participant(p_ride_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.rides r
    where r.id = p_ride_id
      and (r.customer_id = auth.uid() or r.rider_id = auth.uid() or public.is_shilevi_owner_admin())
  );
$$;
revoke all on function public.is_ride_participant(uuid) from public, anon;
grant execute on function public.is_ride_participant(uuid) to authenticated;

drop policy if exists "transport_vehicles_select_own_or_admin" on public.transport_vehicles;
create policy "transport_vehicles_select_own_or_admin" on public.transport_vehicles
for select to authenticated
using (user_id = (select auth.uid()) or (select public.is_shilevi_owner_admin()));

drop policy if exists "rides_select_participant" on public.rides;
create policy "rides_select_participant" on public.rides
for select to authenticated using (public.is_ride_participant(id));

drop policy if exists "ride_offers_select_participant" on public.ride_offers;
create policy "ride_offers_select_participant" on public.ride_offers
for select to authenticated using (public.is_ride_participant(ride_id));

drop policy if exists "ride_events_select_participant" on public.ride_events;
create policy "ride_events_select_participant" on public.ride_events
for select to authenticated using (public.is_ride_participant(ride_id));

drop policy if exists "ride_reviews_select_related" on public.ride_reviews;
create policy "ride_reviews_select_related" on public.ride_reviews
for select to authenticated
using (
  customer_id = (select auth.uid())
  or rider_id = (select auth.uid())
  or (select public.is_shilevi_owner_admin())
);

-- No client write policies exist. Every ride mutation goes through the RPCs below, which validate
-- the actor, the current state and the amount before touching a row.

-- ---------------------------------------------------------------- rider eligibility

create or replace function public.is_approved_transport_partner(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.provider_applications pa
    where pa.user_id = p_user_id
      and pa.activity_type = 'transport_partner'
      and pa.status = 'approved'
  ) or exists (
    select 1 from public.user_roles ur
    where ur.user_id = p_user_id and ur.role = 'transport_partner'
  );
$$;
revoke all on function public.is_approved_transport_partner(uuid) from public, anon;
grant execute on function public.is_approved_transport_partner(uuid) to authenticated;

create or replace function public.add_transport_vehicle(
  p_mode text,
  p_make_model text,
  p_plate_number text,
  p_seat_capacity integer default 1
) returns uuid
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
  if p_mode not in ('car','motorcycle','bicycle','tuk_tuk','van') then
    raise exception 'Unsupported transport mode.';
  end if;
  if not public.is_approved_transport_partner(auth.uid()) then
    raise exception 'Submit and pass a transport partner application before adding a vehicle.';
  end if;
  if p_make_model is null or char_length(trim(p_make_model)) < 1
    or p_plate_number is null or char_length(trim(p_plate_number)) < 2 then
    raise exception 'A vehicle description and plate or identifier are required.';
  end if;

  insert into public.transport_vehicles (
    user_id, mode, make_model, plate_number, seat_capacity, verification_status
  ) values (
    auth.uid(), p_mode, left(trim(p_make_model), 120), upper(left(trim(p_plate_number), 24)),
    greatest(1, least(coalesce(p_seat_capacity, 1), 60)), 'pending'
  )
  returning id into v_id;

  return v_id;
end;
$$;
revoke all on function public.add_transport_vehicle(text, text, text, integer) from public, anon;
grant execute on function public.add_transport_vehicle(text, text, text, integer) to authenticated;

create or replace function public.set_transport_vehicle_active(p_vehicle_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in required.';
  end if;
  update public.transport_vehicles
  set is_active = p_active
  where id = p_vehicle_id and user_id = auth.uid();
  if not found then
    raise exception 'Vehicle not found.';
  end if;
end;
$$;
revoke all on function public.set_transport_vehicle_active(uuid, boolean) from public, anon;
grant execute on function public.set_transport_vehicle_active(uuid, boolean) to authenticated;

create or replace function public.admin_review_transport_vehicle(
  p_vehicle_id uuid,
  p_approve boolean,
  p_note text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_staff_capability('rides.manage') then
    raise exception 'Not authorized.';
  end if;

  update public.transport_vehicles
  set verification_status = case when p_approve then 'approved' else 'rejected' end,
      reviewer_note = left(coalesce(p_note, ''), 1000),
      reviewed_at = now(),
      reviewed_by = auth.uid()
  where id = p_vehicle_id;
  if not found then
    raise exception 'Vehicle not found.';
  end if;

  insert into public.audit_events(actor_id, action, resource_type, resource_id, outcome, metadata)
  values (
    auth.uid(), 'vehicle.review', 'transport_vehicles', p_vehicle_id::text, 'success',
    jsonb_build_object('approved', p_approve)
  );
end;
$$;
revoke all on function public.admin_review_transport_vehicle(uuid, boolean, text) from public, anon;
grant execute on function public.admin_review_transport_vehicle(uuid, boolean, text) to authenticated;

-- Customer-facing rider discovery. Only approved, active vehicles are listed, and only the public
-- profile and vehicle description are returned. No location or contact detail is exposed here.
create or replace function public.list_available_riders(p_mode text default null)
returns table (
  rider_id uuid,
  display_name text,
  vehicle_id uuid,
  mode text,
  make_model text,
  plate_number text,
  seat_capacity integer,
  rating_average numeric,
  rating_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in required.';
  end if;
  if p_mode is not null and p_mode not in ('car','motorcycle','bicycle','tuk_tuk','van') then
    raise exception 'Unsupported transport mode.';
  end if;

  return query
    select
      v.user_id,
      coalesce(nullif(pr.display_name, ''), 'Shilevi transport partner'),
      v.id,
      v.mode,
      v.make_model,
      v.plate_number,
      v.seat_capacity,
      coalesce(round(avg(rr.rating)::numeric, 2), 0),
      count(rr.id)::integer
    from public.transport_vehicles v
    left join public.profiles pr on pr.id = v.user_id
    left join public.ride_reviews rr on rr.rider_id = v.user_id
    where v.verification_status = 'approved'
      and v.is_active = true
      and v.user_id <> auth.uid()
      and (p_mode is null or v.mode = p_mode)
    group by v.user_id, pr.display_name, v.id, v.mode, v.make_model, v.plate_number, v.seat_capacity
    order by rating_average desc, v.created_at asc
    limit 50;
end;
$$;
revoke all on function public.list_available_riders(text) from public, anon;
grant execute on function public.list_available_riders(text) to authenticated;

-- ---------------------------------------------------------------- fare negotiation

create or replace function public.request_ride(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer uuid := auth.uid();
  v_rider uuid;
  v_mode text;
  v_proposed bigint;
  v_ride_id uuid;
  v_vehicle uuid;
  v_number text;
begin
  if v_customer is null then
    raise exception 'Sign in required.';
  end if;

  begin
    v_rider := (p_payload ->> 'rider_id')::uuid;
  exception when others then
    raise exception 'Choose a valid transport partner.';
  end;

  v_mode := p_payload ->> 'ride_mode';
  v_proposed := coalesce((p_payload ->> 'proposed_fare_minor')::bigint, 0);

  if v_rider is null or v_rider = v_customer then
    raise exception 'Choose a transport partner other than yourself.';
  end if;
  if v_mode not in ('car','motorcycle','bicycle','tuk_tuk','van') then
    raise exception 'Unsupported transport mode.';
  end if;
  if char_length(trim(coalesce(p_payload ->> 'pickup_label', ''))) < 3
    or char_length(trim(coalesce(p_payload ->> 'dropoff_label', ''))) < 3 then
    raise exception 'Pickup and destination are required.';
  end if;
  if v_proposed < 1000 or v_proposed > 10000000 then
    raise exception 'Propose a fare between KSh 10 and KSh 100,000.';
  end if;

  if not public.is_approved_transport_partner(v_rider) then
    raise exception 'That transport partner is not approved for passenger trips.';
  end if;

  select v.id into v_vehicle
  from public.transport_vehicles v
  where v.user_id = v_rider
    and v.mode = v_mode
    and v.verification_status = 'approved'
    and v.is_active = true
  order by v.created_at asc
  limit 1;

  if v_vehicle is null then
    raise exception 'That partner has no approved, active vehicle for this mode.';
  end if;

  v_number := 'R' || to_char(now(), 'YYMMDD') || '-' ||
    lpad(nextval('public.ride_number_seq')::text, 6, '0');

  insert into public.rides (
    ride_number, customer_id, rider_id, ride_mode,
    pickup_label, dropoff_label, pickup_area, dropoff_area,
    pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, distance_km,
    proposed_fare_minor
  ) values (
    v_number, v_customer, v_rider, v_mode,
    left(trim(p_payload ->> 'pickup_label'), 300), left(trim(p_payload ->> 'dropoff_label'), 300),
    nullif(left(trim(coalesce(p_payload ->> 'pickup_area', '')), 120), ''),
    nullif(left(trim(coalesce(p_payload ->> 'dropoff_area', '')), 120), ''),
    nullif(p_payload ->> 'pickup_lat', '')::numeric,
    nullif(p_payload ->> 'pickup_lng', '')::numeric,
    nullif(p_payload ->> 'dropoff_lat', '')::numeric,
    nullif(p_payload ->> 'dropoff_lng', '')::numeric,
    nullif(p_payload ->> 'distance_km', '')::numeric,
    v_proposed
  )
  returning id into v_ride_id;

  insert into public.ride_offers (ride_id, actor_id, actor_role, offer_type, amount_minor, note)
  values (v_ride_id, v_customer, 'customer', 'proposal', v_proposed, 'Customer proposed a fare.');

  insert into public.ride_events (ride_id, status, actor_id, actor_role, note)
  values (v_ride_id, 'requested', v_customer, 'customer', 'Ride requested.');

  return v_ride_id;
end;
$$;
revoke all on function public.request_ride(jsonb) from public, anon;
grant execute on function public.request_ride(jsonb) to authenticated;

create or replace function public.ride_respond(
  p_ride_id uuid,
  p_action text,
  p_counter_fare_minor bigint default null,
  p_note text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ride record;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.';
  end if;

  select * into v_ride from public.rides where id = p_ride_id for update;
  if v_ride.id is null or v_ride.rider_id <> auth.uid() then
    raise exception 'Ride request not found.';
  end if;
  if v_ride.status <> 'requested' then
    raise exception 'This request can only be answered while it is awaiting a response.';
  end if;
  if p_action not in ('accept','counter','decline') then
    raise exception 'Unsupported response.';
  end if;

  if p_action = 'accept' then
    update public.rides
    set status = 'agreed', agreed_fare_minor = proposed_fare_minor,
        commission_rate_bps = coalesce((
          select cr.rate_bps from public.commission_rules cr
          where cr.is_active and cr.scope = 'division' and cr.division = 'transport_delivery'
            and (cr.effective_to is null or cr.effective_to > now())
            and cr.effective_from <= now()
          order by cr.effective_from desc limit 1
        ), 1000)
    where id = p_ride_id;
    insert into public.ride_offers (ride_id, actor_id, actor_role, offer_type, amount_minor, note)
    values (p_ride_id, auth.uid(), 'rider', 'accept', v_ride.proposed_fare_minor,
      left(coalesce(p_note, 'Rider accepted the proposed fare.'), 500));
  elsif p_action = 'counter' then
    if p_counter_fare_minor is null or p_counter_fare_minor < 1000 or p_counter_fare_minor > 10000000 then
      raise exception 'Counter with a fare between KSh 10 and KSh 100,000.';
    end if;
    if p_counter_fare_minor = v_ride.proposed_fare_minor then
      raise exception 'A counteroffer must differ from the proposed fare.';
    end if;
    update public.rides
    set status = 'countered', counter_fare_minor = p_counter_fare_minor, agreed_fare_minor = null
    where id = p_ride_id;
    insert into public.ride_offers (ride_id, actor_id, actor_role, offer_type, amount_minor, note)
    values (p_ride_id, auth.uid(), 'rider', 'counteroffer', p_counter_fare_minor,
      left(coalesce(p_note, 'Rider countered the fare.'), 500));
  else
    update public.rides
    set status = 'cancelled', cancelled_at = now(), cancellation_reason = 'Declined by transport partner.'
    where id = p_ride_id;
    insert into public.ride_offers (ride_id, actor_id, actor_role, offer_type, note)
    values (p_ride_id, auth.uid(), 'rider', 'decline', left(coalesce(p_note, 'Rider declined the request.'), 500));
  end if;

  insert into public.ride_events (ride_id, status, actor_id, actor_role, note)
  values (p_ride_id, p_action, auth.uid(), 'rider', left(coalesce(p_note, ''), 500));
end;
$$;
revoke all on function public.ride_respond(uuid, text, bigint, text) from public, anon;
grant execute on function public.ride_respond(uuid, text, bigint, text) to authenticated;

create or replace function public.ride_customer_respond(p_ride_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ride record;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.';
  end if;

  select * into v_ride from public.rides where id = p_ride_id for update;
  if v_ride.id is null or v_ride.customer_id <> auth.uid() then
    raise exception 'Ride not found.';
  end if;
  if v_ride.status <> 'countered' then
    raise exception 'There is no counteroffer to answer.';
  end if;

  if p_accept then
    update public.rides
    set status = 'agreed', agreed_fare_minor = counter_fare_minor,
        commission_rate_bps = coalesce((
          select cr.rate_bps from public.commission_rules cr
          where cr.is_active and cr.scope = 'division' and cr.division = 'transport_delivery'
            and (cr.effective_to is null or cr.effective_to > now())
            and cr.effective_from <= now()
          order by cr.effective_from desc limit 1
        ), 1000)
    where id = p_ride_id;
    insert into public.ride_offers (ride_id, actor_id, actor_role, offer_type, amount_minor, note)
    values (p_ride_id, auth.uid(), 'customer', 'accept', v_ride.counter_fare_minor,
      'Customer accepted the counteroffer.');
    insert into public.ride_events (ride_id, status, actor_id, actor_role, note)
    values (p_ride_id, 'agreed', auth.uid(), 'customer', 'Fare agreed.');
  else
    update public.rides
    set status = 'cancelled', cancelled_at = now(), cancellation_reason = 'Counteroffer declined by customer.'
    where id = p_ride_id;
    insert into public.ride_events (ride_id, status, actor_id, actor_role, note)
    values (p_ride_id, 'cancelled', auth.uid(), 'customer', 'Counteroffer declined.');
  end if;
end;
$$;
revoke all on function public.ride_customer_respond(uuid, boolean) from public, anon;
grant execute on function public.ride_customer_respond(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------- payment and trip lifecycle

-- Internal: the only path that turns an agreed ride into a paid one. It is called by the sandbox
-- RPC below and by the server-verified provider callback. It is not callable by a browser client.
create or replace function public.mark_ride_paid(
  p_ride_id uuid,
  p_reference text,
  p_provider text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ride record;
  v_commission bigint;
begin
  select * into v_ride from public.rides where id = p_ride_id for update;
  if v_ride.id is null then
    raise exception 'Ride not found.';
  end if;

  -- Idempotent success: a retried callback must not charge or credit twice.
  if v_ride.payment_status = 'paid' then
    return;
  end if;
  if v_ride.status <> 'agreed' or v_ride.payment_status <> 'unpaid' then
    raise exception 'This ride is not awaiting payment.';
  end if;
  if v_ride.agreed_fare_minor is null or v_ride.agreed_fare_minor <= 0 then
    raise exception 'No agreed fare exists for this ride.';
  end if;
  if p_reference is null or char_length(trim(p_reference)) < 3 then
    raise exception 'A payment reference is required.';
  end if;

  v_commission := floor(v_ride.agreed_fare_minor * v_ride.commission_rate_bps / 10000.0)::bigint;

  update public.rides
  set status = 'paid', payment_status = 'paid', paid_at = now(),
      payment_reference = left(trim(p_reference), 120),
      payment_provider = left(coalesce(p_provider, 'unknown'), 32),
      commission_minor = v_commission,
      rider_net_minor = v_ride.agreed_fare_minor - v_commission
  where id = p_ride_id;

  insert into public.ledger_entries (
    ride_id, entry_type, account, party_id, debit_minor, credit_minor, currency, reference
  ) values
    (p_ride_id, 'ride_charge', 'customer', v_ride.customer_id, v_ride.agreed_fare_minor, 0, v_ride.currency, p_reference),
    (p_ride_id, 'ride_charge', 'settlement', null, 0, v_ride.agreed_fare_minor, v_ride.currency, p_reference),
    (p_ride_id, 'ride_commission', 'settlement', null, v_commission, 0, v_ride.currency, p_reference),
    (p_ride_id, 'ride_commission', 'platform_commission', null, 0, v_commission, v_ride.currency, p_reference),
    (p_ride_id, 'ride_payout', 'settlement', null, v_ride.agreed_fare_minor - v_commission, 0, v_ride.currency, p_reference),
    (p_ride_id, 'ride_payout', 'rider_payable', v_ride.rider_id, 0, v_ride.agreed_fare_minor - v_commission, v_ride.currency, p_reference);

  insert into public.ride_events (ride_id, status, actor_id, actor_role, note)
  values (p_ride_id, 'paid', auth.uid(), 'system', 'Payment confirmed by ' || coalesce(p_provider, 'unknown') || '.');
end;
$$;
revoke all on function public.mark_ride_paid(uuid, text, text) from public, anon, authenticated;
grant execute on function public.mark_ride_paid(uuid, text, text) to service_role;

create or replace function public.confirm_mock_ride_payment(
  p_ride_id uuid,
  p_reference text default null
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mode text;
  v_ride record;
  v_reference text;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.';
  end if;

  select (value #>> '{}') into v_mode from public.platform_settings where key = 'payment_mode';
  if v_mode is distinct from 'mock' then
    raise exception 'Sandbox payments are disabled. Use a configured payment provider.';
  end if;

  select * into v_ride from public.rides where id = p_ride_id for update;
  if v_ride.id is null or v_ride.customer_id <> auth.uid() then
    raise exception 'Ride not found.';
  end if;
  if v_ride.payment_status = 'paid' then
    return coalesce(v_ride.payment_reference, 'already-paid');
  end if;

  v_reference := left(coalesce(nullif(trim(p_reference), ''),
    'MOCK-RIDE-' || v_ride.ride_number || '-' || extract(epoch from now())::bigint::text), 120);

  perform public.mark_ride_paid(p_ride_id, v_reference, 'mock');
  return v_reference;
end;
$$;
revoke all on function public.confirm_mock_ride_payment(uuid, text) from public, anon;
grant execute on function public.confirm_mock_ride_payment(uuid, text) to authenticated;

create or replace function public.ride_rider_progress(p_ride_id uuid, p_to_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ride record;
  v_expected text;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.';
  end if;

  select * into v_ride from public.rides where id = p_ride_id for update;
  if v_ride.id is null or v_ride.rider_id <> auth.uid() then
    raise exception 'Ride not found.';
  end if;

  v_expected := case v_ride.status
    when 'paid' then 'arrived'
    when 'arrived' then 'in_progress'
    when 'in_progress' then 'rider_completed'
    else null
  end;

  if p_to_status in ('cancelled') then
    if v_ride.status not in ('paid','arrived') then
      raise exception 'This ride cannot be cancelled by the transport partner at this stage.';
    end if;
  elsif v_expected is null or p_to_status <> v_expected then
    raise exception 'This ride cannot move from % to %.', v_ride.status, p_to_status;
  end if;

  update public.rides
  set status = p_to_status,
      arrived_at = case when p_to_status = 'arrived' then now() else arrived_at end,
      started_at = case when p_to_status = 'in_progress' then now() else started_at end,
      rider_confirmed_at = case when p_to_status = 'rider_completed' then now() else rider_confirmed_at end,
      cancelled_at = case when p_to_status = 'cancelled' then now() else cancelled_at end,
      cancellation_reason = case when p_to_status = 'cancelled' then 'Cancelled by transport partner.' else cancellation_reason end,
      payment_status = case when p_to_status = 'cancelled' and payment_status = 'paid' then 'refund_pending' else payment_status end
  where id = p_ride_id;

  insert into public.ride_events (ride_id, status, actor_id, actor_role, note)
  values (p_ride_id, p_to_status, auth.uid(), 'rider', 'Transport partner updated the trip.');
end;
$$;
revoke all on function public.ride_rider_progress(uuid, text) from public, anon;
grant execute on function public.ride_rider_progress(uuid, text) to authenticated;

-- Both parties confirm: the rider confirms at rider_completed, the customer confirms here. Only
-- then does the earning become releasable.
create or replace function public.ride_customer_confirm(p_ride_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ride record;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.';
  end if;

  select * into v_ride from public.rides where id = p_ride_id for update;
  if v_ride.id is null or v_ride.customer_id <> auth.uid() then
    raise exception 'Ride not found.';
  end if;
  if v_ride.status <> 'rider_completed' or v_ride.rider_confirmed_at is null then
    raise exception 'The transport partner must confirm completion first.';
  end if;

  update public.rides
  set status = 'completed', customer_confirmed_at = now(), released_at = now()
  where id = p_ride_id;

  insert into public.ride_events (ride_id, status, actor_id, actor_role, note)
  values (p_ride_id, 'completed', auth.uid(), 'customer', 'Customer confirmed completion.');
end;
$$;
revoke all on function public.ride_customer_confirm(uuid) from public, anon;
grant execute on function public.ride_customer_confirm(uuid) to authenticated;

create or replace function public.cancel_ride(p_ride_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ride record;
  v_reason text;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.';
  end if;

  select * into v_ride from public.rides where id = p_ride_id for update;
  if v_ride.id is null or v_ride.customer_id <> auth.uid() then
    raise exception 'Ride not found.';
  end if;
  if v_ride.status not in ('requested','countered','agreed') then
    raise exception 'A paid or started ride cannot be cancelled here. Contact support for a refund review.';
  end if;

  v_reason := left(coalesce(nullif(trim(p_reason), ''), 'Cancelled by customer.'), 500);

  update public.rides
  set status = 'cancelled', cancelled_at = now(), cancellation_reason = v_reason
  where id = p_ride_id;

  insert into public.ride_offers (ride_id, actor_id, actor_role, offer_type, note)
  values (p_ride_id, auth.uid(), 'customer', 'cancel', v_reason);
  insert into public.ride_events (ride_id, status, actor_id, actor_role, note)
  values (p_ride_id, 'cancelled', auth.uid(), 'customer', v_reason);
end;
$$;
revoke all on function public.cancel_ride(uuid, text) from public, anon;
grant execute on function public.cancel_ride(uuid, text) to authenticated;

create or replace function public.rate_ride(p_ride_id uuid, p_rating integer, p_comment text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ride record;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.';
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'Choose a rating from 1 to 5.';
  end if;

  select * into v_ride from public.rides where id = p_ride_id;
  if v_ride.id is null or v_ride.customer_id <> auth.uid() then
    raise exception 'Ride not found.';
  end if;
  if v_ride.status <> 'completed' then
    raise exception 'Only a completed ride can be rated.';
  end if;
  if exists (select 1 from public.ride_reviews rr where rr.ride_id = p_ride_id) then
    raise exception 'This ride has already been reviewed.';
  end if;

  insert into public.ride_reviews (ride_id, customer_id, rider_id, rating, comment)
  values (p_ride_id, auth.uid(), v_ride.rider_id, p_rating, nullif(left(trim(coalesce(p_comment, '')), 1000), ''));
end;
$$;
revoke all on function public.rate_ride(uuid, integer, text) from public, anon;
grant execute on function public.rate_ride(uuid, integer, text) to authenticated;

-- Contact details are released only to the two parties, and only once a fare has been agreed and
-- paid. Before that, the app communicates through the booking record.
create or replace function public.get_ride_contact(p_ride_id uuid)
returns table (display_name text, phone text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ride record;
  v_other uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.';
  end if;

  select * into v_ride from public.rides where id = p_ride_id;
  if v_ride.id is null then
    raise exception 'Ride not found.';
  end if;
  if auth.uid() not in (v_ride.customer_id, v_ride.rider_id) then
    raise exception 'Ride not found.';
  end if;
  if v_ride.status not in ('paid','arrived','in_progress','rider_completed','completed') then
    raise exception 'Contact details are released after the fare is paid.';
  end if;

  v_other := case when auth.uid() = v_ride.customer_id then v_ride.rider_id else v_ride.customer_id end;

  return query
    select nullif(pr.display_name, ''), pr.phone
    from public.profiles pr
    where pr.id = v_other;
end;
$$;
revoke all on function public.get_ride_contact(uuid) from public, anon;
grant execute on function public.get_ride_contact(uuid) to authenticated;

-- ---------------------------------------------------------------- earnings and withdrawals

-- Available balance = rider_payable credits - rider_payable debits from paid payouts - payouts
-- currently pending or processing. A rider can never withdraw money the ledger has not earned.
create or replace function public.rider_available_balance(p_rider_id uuid default auth.uid())
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(
    coalesce((
      select sum(le.credit_minor - le.debit_minor)
      from public.ledger_entries le
      where le.account = 'rider_payable' and le.party_id = p_rider_id
    ), 0)
    - coalesce((
      select sum(p.amount_minor) from public.payouts p
      where p.payee_id = p_rider_id and p.status in ('pending','processing')
    ), 0),
    0
  )::bigint;
$$;
revoke all on function public.rider_available_balance(uuid) from public, anon;
grant execute on function public.rider_available_balance(uuid) to authenticated;

create or replace function public.request_rider_payout(
  p_amount_minor bigint,
  p_phone text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance bigint;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.';
  end if;
  if not public.is_approved_transport_partner(auth.uid()) then
    raise exception 'Only approved transport partners can request a payout.';
  end if;
  if p_amount_minor is null or p_amount_minor < 10000 then
    raise exception 'The minimum withdrawal is KSh 100.';
  end if;
  if p_phone is null or char_length(regexp_replace(p_phone, '[^0-9]', '', 'g')) < 9 then
    raise exception 'Enter a valid M-Pesa phone number.';
  end if;

  v_balance := public.rider_available_balance(auth.uid());
  if p_amount_minor > v_balance then
    raise exception 'Your available balance is KES %.', round(v_balance / 100.0, 2);
  end if;

  insert into public.payouts (
    payee_id, payee_role, amount_minor, currency, status, method, destination_phone
  ) values (
    auth.uid(), 'rider', p_amount_minor, 'KES', 'pending', 'mpesa',
    left(regexp_replace(p_phone, '[^0-9+]', '', 'g'), 20)
  )
  returning id into v_id;

  return v_id;
end;
$$;
revoke all on function public.request_rider_payout(bigint, text) from public, anon;
grant execute on function public.request_rider_payout(bigint, text) to authenticated;

-- Owner decision. Marking a payout paid writes the matching debit only once. A real M-Pesa B2C
-- result must be supplied by the trusted server path; this RPC does not itself move money.
create or replace function public.admin_update_payout(
  p_payout_id uuid,
  p_status text,
  p_reference text default null,
  p_failure_reason text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payout record;
begin
  if not public.has_staff_capability('finance.payout') then
    raise exception 'Not authorized.';
  end if;
  if p_status not in ('processing','paid','failed','cancelled') then
    raise exception 'Unsupported payout status.';
  end if;

  select * into v_payout from public.payouts where id = p_payout_id for update;
  if v_payout.id is null then
    raise exception 'Payout not found.';
  end if;
  if v_payout.status = 'paid' then
    return;
  end if;
  if v_payout.status = 'cancelled' or v_payout.status = 'failed' then
    raise exception 'A closed payout cannot be changed.';
  end if;

  update public.payouts
  set status = p_status,
      reference = coalesce(nullif(trim(p_reference), ''), reference),
      failure_reason = case when p_status = 'failed' then left(coalesce(p_failure_reason, ''), 1000) else failure_reason end,
      processed_by = auth.uid(),
      processed_at = case when p_status in ('paid','failed') then now() else processed_at end
  where id = p_payout_id;

  if p_status = 'paid' then
    insert into public.ledger_entries (
      entry_type, account, party_id, debit_minor, credit_minor, currency, reference, payout_id
    ) values
      ('payout', 'rider_payable', v_payout.payee_id, v_payout.amount_minor, 0, v_payout.currency, p_payout_id::text, p_payout_id),
      ('payout', 'platform_cash', null, 0, v_payout.amount_minor, v_payout.currency, p_payout_id::text, p_payout_id);
  end if;

  insert into public.audit_events(actor_id, action, resource_type, resource_id, outcome, metadata)
  values (auth.uid(), 'payout.update', 'payouts', p_payout_id::text, 'success',
    jsonb_build_object('status', p_status, 'amount_minor', v_payout.amount_minor));
end;
$$;
revoke all on function public.admin_update_payout(uuid, text, text, text) from public, anon;
grant execute on function public.admin_update_payout(uuid, text, text, text) to authenticated;

commit;
