-- Shilevi migration 0016: orders, deliveries, platform settings and order lifecycle RPCs.
-- Review and run manually after 0015. No live Supabase project was accessed.
-- Money is stored in integer minor units. Kenya shillings use cents (100 minor units = KES 1).
begin;

create table if not exists public.platform_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.platform_settings (key, value) values
  ('currency', '"KES"'::jsonb),
  ('payment_mode', '"mock"'::jsonb),
  ('commission_rate_bps', '1000'::jsonb),
  ('delivery_commission_bps', '1000'::jsonb),
  ('delivery_flat_fee_minor', '10000'::jsonb)
on conflict (key) do nothing;

alter table public.platform_settings enable row level security;
revoke all on public.platform_settings from anon, authenticated;

create or replace function public.get_checkout_settings()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
  from public.platform_settings
  where key in ('currency','payment_mode','commission_rate_bps','delivery_commission_bps','delivery_flat_fee_minor');
$$;
revoke all on function public.get_checkout_settings() from public;
grant execute on function public.get_checkout_settings() to anon, authenticated;

create sequence if not exists public.order_number_seq start 1;

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  customer_id uuid not null references auth.users(id) on delete restrict,
  status text not null default 'pending_payment' check (status in (
    'pending_payment','paid','accepted','preparing','ready','dispatched','delivered',
    'completed','cancelled','refund_requested','refunded','failed'
  )),
  payment_status text not null default 'unpaid' check (payment_status in (
    'unpaid','paid','refund_pending','refunded','failed'
  )),
  currency char(3) not null default 'KES' check (currency ~ '^[A-Z]{3}$'),
  subtotal_minor bigint not null check (subtotal_minor >= 0),
  delivery_fee_minor bigint not null default 0 check (delivery_fee_minor >= 0),
  total_minor bigint not null check (total_minor >= 0),
  commission_minor bigint not null default 0 check (commission_minor >= 0),
  commission_rate_bps integer not null default 1000 check (commission_rate_bps between 0 and 5000),
  commission_base_minor bigint not null default 0 check (commission_base_minor >= 0),
  delivery_method text not null check (delivery_method in ('platform_delivery','seller_delivery','pickup')),
  delivery_address text,
  contact_phone text,
  notes text,
  payment_reference text,
  paid_at timestamptz,
  cancelled_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_total_matches_parts check (total_minor = subtotal_minor + delivery_fee_minor),
  constraint orders_commission_within_subtotal check (commission_minor <= subtotal_minor),
  constraint orders_delivery_address_size check (delivery_address is null or char_length(delivery_address) <= 500),
  constraint orders_contact_phone_size check (contact_phone is null or char_length(contact_phone) <= 32),
  constraint orders_notes_size check (notes is null or char_length(notes) <= 1000)
);

create index if not exists orders_customer_idx on public.orders(customer_id, created_at desc);
create index if not exists orders_status_idx on public.orders(status);
create index if not exists orders_created_idx on public.orders(created_at desc);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  listing_id uuid references public.listings(id) on delete set null,
  owner_id uuid not null references auth.users(id) on delete restrict,
  title_snapshot text not null,
  unit_price_minor bigint not null check (unit_price_minor >= 0),
  quantity integer not null check (quantity between 1 and 99),
  line_total_minor bigint not null check (line_total_minor >= 0),
  commission_minor bigint not null default 0 check (commission_minor >= 0),
  provider_net_minor bigint not null default 0 check (provider_net_minor >= 0),
  created_at timestamptz not null default now(),
  constraint order_items_line_total_matches check (line_total_minor = unit_price_minor * quantity),
  constraint order_items_split_matches check (commission_minor + provider_net_minor = line_total_minor)
);

create index if not exists order_items_order_idx on public.order_items(order_id);
create index if not exists order_items_owner_idx on public.order_items(owner_id, created_at desc);

create table if not exists public.order_status_history (
  id bigserial primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  from_status text,
  to_status text not null,
  actor_id uuid references auth.users(id) on delete set null,
  actor_role text not null check (actor_role in ('customer','provider','rider','admin','system')),
  note text,
  created_at timestamptz not null default now()
);

create index if not exists order_status_history_order_idx on public.order_status_history(order_id, created_at desc);

create table if not exists public.deliveries (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  status text not null default 'requested' check (status in (
    'requested','assigned','to_pickup','collected','in_transit','delivered','failed','cancelled'
  )),
  pickup_address text,
  dropoff_address text not null,
  pickup_county text,
  dropoff_county text,
  distance_km numeric(8,2) check (distance_km is null or distance_km >= 0),
  delivery_fee_minor bigint not null check (delivery_fee_minor >= 0),
  rider_fee_minor bigint not null check (rider_fee_minor >= 0),
  platform_fee_minor bigint not null check (platform_fee_minor >= 0),
  rider_id uuid references auth.users(id) on delete set null,
  proof_code text check (proof_code is null or proof_code ~ '^[0-9]{4}$'),
  proof_note text,
  assigned_at timestamptz,
  picked_up_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint deliveries_fee_split_matches check (delivery_fee_minor = rider_fee_minor + platform_fee_minor),
  constraint deliveries_dropoff_size check (char_length(dropoff_address) <= 500)
);

create unique index if not exists deliveries_order_unique on public.deliveries(order_id);
create index if not exists deliveries_status_idx on public.deliveries(status, created_at);
create index if not exists deliveries_rider_idx on public.deliveries(rider_id, status);

create table if not exists public.delivery_events (
  id bigserial primary key,
  delivery_id uuid not null references public.deliveries(id) on delete cascade,
  status text not null,
  actor_id uuid references auth.users(id) on delete set null,
  actor_role text,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists delivery_events_delivery_idx on public.delivery_events(delivery_id, created_at desc);

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at before update on public.orders
for each row execute function public.set_updated_at();

drop trigger if exists deliveries_set_updated_at on public.deliveries;
create trigger deliveries_set_updated_at before update on public.deliveries
for each row execute function public.set_updated_at();

-- A single security-definer predicate keeps RLS simple and avoids recursive policy evaluation.
create or replace function public.is_order_participant(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1 from public.orders o
      where o.id = p_order_id
        and (o.customer_id = auth.uid() or public.is_shilevi_owner_admin())
    )
    or exists (
      select 1 from public.order_items oi
      where oi.order_id = p_order_id and oi.owner_id = auth.uid()
    )
    or exists (
      select 1 from public.deliveries d
      where d.order_id = p_order_id and d.rider_id = auth.uid()
    );
$$;
revoke all on function public.is_order_participant(uuid) from public, anon;
grant execute on function public.is_order_participant(uuid) to authenticated;

create or replace function public.is_delivery_participant(p_delivery_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.deliveries d
    where d.id = p_delivery_id
      and (d.rider_id = auth.uid() or public.is_order_participant(d.order_id))
  );
$$;
revoke all on function public.is_delivery_participant(uuid) from public, anon;
grant execute on function public.is_delivery_participant(uuid) to authenticated;

alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_status_history enable row level security;
alter table public.deliveries enable row level security;
alter table public.delivery_events enable row level security;

revoke all on public.orders, public.order_items, public.order_status_history,
  public.deliveries, public.delivery_events from anon, authenticated;
grant select on public.orders, public.order_items, public.order_status_history,
  public.delivery_events to authenticated;
-- The handover code is deliberately excluded from rider-readable columns. A rider must receive it
-- from the customer at handover, not read it from the job record.
grant select (
  id, order_id, status, pickup_address, dropoff_address, pickup_county, dropoff_county,
  distance_km, delivery_fee_minor, rider_fee_minor, platform_fee_minor, rider_id,
  assigned_at, picked_up_at, delivered_at, cancelled_at, created_at, updated_at
) on public.deliveries to authenticated;

drop policy if exists "orders_select_participant" on public.orders;
create policy "orders_select_participant" on public.orders
for select to authenticated using (public.is_order_participant(id));

drop policy if exists "order_items_select_participant" on public.order_items;
create policy "order_items_select_participant" on public.order_items
for select to authenticated using (public.is_order_participant(order_id));

drop policy if exists "order_status_history_select_participant" on public.order_status_history;
create policy "order_status_history_select_participant" on public.order_status_history
for select to authenticated using (public.is_order_participant(order_id));

drop policy if exists "deliveries_select_participant" on public.deliveries;
create policy "deliveries_select_participant" on public.deliveries
for select to authenticated using (public.is_delivery_participant(id));

drop policy if exists "delivery_events_select_participant" on public.delivery_events;
create policy "delivery_events_select_participant" on public.delivery_events
for select to authenticated using (public.is_delivery_participant(delivery_id));

-- Orders are created, priced and split exclusively by this function. A browser cannot post a
-- lower price, a different commission or a paid status. Listing rows are locked while the cart is
-- validated so two checkouts cannot both consume a changed price.
create or replace function public.create_order(
  p_items jsonb,
  p_delivery_method text,
  p_delivery_address text default null,
  p_contact_phone text default null,
  p_notes text default null
) returns table (order_id uuid, order_number text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer uuid := auth.uid();
  v_item record;
  v_listing record;
  v_line record;
  v_lines jsonb := '[]'::jsonb;
  v_subtotal bigint := 0;
  v_commission bigint := 0;
  v_line_total bigint;
  v_line_commission bigint;
  v_rate_bps integer;
  v_delivery_fee bigint := 0;
  v_delivery_rider_fee bigint := 0;
  v_delivery_platform_fee bigint := 0;
  v_delivery_rate_bps integer;
  v_owner uuid;
  v_currency text;
  v_order_id uuid;
  v_order_number text;
  v_delivery_id uuid;
  v_proof_code text;
begin
  if v_customer is null then
    raise exception 'Sign in required.';
  end if;
  if p_delivery_method is null or p_delivery_method not in ('platform_delivery','seller_delivery','pickup') then
    raise exception 'Choose a valid delivery method.';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Your cart is empty.';
  end if;
  if jsonb_array_length(p_items) > 20 then
    raise exception 'An order can contain at most 20 items.';
  end if;
  if p_delivery_method = 'platform_delivery' and coalesce(trim(p_delivery_address), '') = '' then
    raise exception 'A delivery address is required.';
  end if;

  select coalesce(
    (select (value #>> '{}')::integer from public.platform_settings where key = 'commission_rate_bps'),
    1000
  ) into v_rate_bps;

  for v_item in
    select * from jsonb_to_recordset(p_items) as x(listing_id uuid, quantity integer)
  loop
    if v_item.listing_id is null then
      raise exception 'A cart item is missing its listing.';
    end if;
    if v_item.quantity is null or v_item.quantity < 1 or v_item.quantity > 99 then
      raise exception 'Quantity must be between 1 and 99.';
    end if;

    select l.id, l.owner_id, l.title, l.price_minor, l.currency, l.status
      into v_listing
      from public.listings l
      where l.id = v_item.listing_id
      for update;

    if v_listing.id is null then
      raise exception 'A listing in your cart no longer exists.';
    end if;
    if v_listing.status <> 'published' then
      raise exception 'A listing in your cart is no longer available.';
    end if;
    if v_listing.owner_id = v_customer then
      raise exception 'You cannot order your own listing.';
    end if;
    if v_listing.price_minor is null or v_listing.price_minor <= 0 then
      raise exception 'A listing in your cart does not have a valid price.';
    end if;
    if v_currency is null then
      v_currency := v_listing.currency;
    elsif v_currency <> v_listing.currency then
      raise exception 'All items in one order must use the same currency.';
    end if;
    if v_owner is null then
      v_owner := v_listing.owner_id;
    elsif v_owner <> v_listing.owner_id then
      raise exception 'Please order from one seller at a time.';
    end if;

    v_line_total := v_listing.price_minor * v_item.quantity;
    v_line_commission := (round((v_line_total::numeric * v_rate_bps / 10000.0) / 100.0) * 100)::bigint;
    if v_line_commission > v_line_total then
      v_line_commission := v_line_total;
    end if;
    v_subtotal := v_subtotal + v_line_total;
    v_commission := v_commission + v_line_commission;

    v_lines := v_lines || jsonb_build_object(
      'listing_id', v_listing.id,
      'owner_id', v_listing.owner_id,
      'title_snapshot', v_listing.title,
      'unit_price_minor', v_listing.price_minor,
      'quantity', v_item.quantity,
      'line_total_minor', v_line_total,
      'commission_minor', v_line_commission,
      'provider_net_minor', v_line_total - v_line_commission
    );
  end loop;

  if v_subtotal <= 0 then
    raise exception 'Your cart total is invalid.';
  end if;

  if p_delivery_method = 'platform_delivery' then
    select coalesce(
      (select (value #>> '{}')::bigint from public.platform_settings where key = 'delivery_flat_fee_minor'),
      10000
    ) into v_delivery_fee;
    select coalesce(
      (select (value #>> '{}')::integer from public.platform_settings where key = 'delivery_commission_bps'),
      1000
    ) into v_delivery_rate_bps;
    v_delivery_rider_fee := (round(
      (v_delivery_fee::numeric * (10000 - v_delivery_rate_bps) / 10000.0) / 100.0
    ) * 100)::bigint;
    v_delivery_platform_fee := v_delivery_fee - v_delivery_rider_fee;
  end if;

  v_order_number := format(
    'SX-%s-%s',
    to_char(now(), 'YYMMDD'),
    lpad(nextval('public.order_number_seq'::regclass)::text, 6, '0')
  );

  insert into public.orders as o (
    order_number, customer_id, status, payment_status, currency,
    subtotal_minor, delivery_fee_minor, total_minor,
    commission_minor, commission_rate_bps, commission_base_minor,
    delivery_method, delivery_address, contact_phone, notes
  ) values (
    v_order_number, v_customer, 'pending_payment', 'unpaid', v_currency,
    v_subtotal, v_delivery_fee, v_subtotal + v_delivery_fee,
    v_commission, v_rate_bps, v_subtotal,
    p_delivery_method, nullif(trim(p_delivery_address), ''),
    nullif(trim(p_contact_phone), ''), nullif(trim(p_notes), '')
  ) returning o.id, o.order_number into v_order_id, v_order_number;

  for v_line in
    select * from jsonb_to_recordset(v_lines) as x(
      listing_id uuid,
      owner_id uuid,
      title_snapshot text,
      unit_price_minor bigint,
      quantity integer,
      line_total_minor bigint,
      commission_minor bigint,
      provider_net_minor bigint
    )
  loop
    insert into public.order_items (
      order_id, listing_id, owner_id, title_snapshot, unit_price_minor,
      quantity, line_total_minor, commission_minor, provider_net_minor
    ) values (
      v_order_id, v_line.listing_id, v_line.owner_id, v_line.title_snapshot,
      v_line.unit_price_minor, v_line.quantity, v_line.line_total_minor,
      v_line.commission_minor, v_line.provider_net_minor
    );
  end loop;

  if p_delivery_method = 'platform_delivery' then
    v_proof_code := lpad((floor(random() * 10000))::int::text, 4, '0');
    insert into public.deliveries (
      order_id, status, dropoff_address, delivery_fee_minor, rider_fee_minor,
      platform_fee_minor, proof_code
    ) values (
      v_order_id, 'requested', trim(p_delivery_address), v_delivery_fee,
      v_delivery_rider_fee, v_delivery_platform_fee, v_proof_code
    ) returning id into v_delivery_id;

    insert into public.delivery_events (delivery_id, status, actor_id, actor_role, note)
    values (v_delivery_id, 'requested', v_customer, 'customer', 'Delivery requested with order.');
  end if;

  insert into public.order_status_history (order_id, from_status, to_status, actor_id, actor_role, note)
  values (v_order_id, null, 'pending_payment', v_customer, 'customer', 'Order created.');

  return query select v_order_id, v_order_number;
end;
$$;
revoke all on function public.create_order(jsonb, text, text, text, text) from public, anon;
grant execute on function public.create_order(jsonb, text, text, text, text) to authenticated;

create or replace function public.customer_cancel_order(p_order_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order record;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null or v_order.customer_id <> auth.uid() then
    raise exception 'Order not found.';
  end if;
  if v_order.status <> 'pending_payment' then
    raise exception 'This order can no longer be cancelled here. Request a refund instead.';
  end if;

  update public.orders
  set status = 'cancelled', cancelled_at = now()
  where id = p_order_id;

  update public.deliveries
  set status = 'cancelled', cancelled_at = now()
  where order_id = p_order_id and status = 'requested';

  insert into public.order_status_history (order_id, from_status, to_status, actor_id, actor_role, note)
  values (p_order_id, v_order.status, 'cancelled', auth.uid(), 'customer', left(coalesce(p_reason, 'Cancelled before payment.'), 500));
end;
$$;
revoke all on function public.customer_cancel_order(uuid, text) from public, anon;
grant execute on function public.customer_cancel_order(uuid, text) to authenticated;

create or replace function public.provider_update_order_status(
  p_order_id uuid,
  p_to_status text,
  p_note text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order record;
  v_expected text;
  v_is_platform_delivery boolean;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.';
  end if;
  if not exists (
    select 1 from public.order_items oi
    where oi.order_id = p_order_id and oi.owner_id = auth.uid()
  ) then
    raise exception 'Order not found.';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null then
    raise exception 'Order not found.';
  end if;

  v_expected := case v_order.status
    when 'paid' then 'accepted'
    when 'accepted' then 'preparing'
    when 'preparing' then 'ready'
    when 'ready' then 'dispatched'
    when 'dispatched' then 'delivered'
    else null
  end;

  if v_expected is null or p_to_status <> v_expected then
    raise exception 'This order cannot move from % to %.', v_order.status, p_to_status;
  end if;

  v_is_platform_delivery := v_order.delivery_method = 'platform_delivery';
  if p_to_status = 'dispatched' and v_is_platform_delivery then
    if not exists (
      select 1 from public.deliveries d
      where d.order_id = p_order_id
        and d.rider_id is not null
        and d.status in ('assigned','to_pickup','collected','in_transit')
    ) then
      raise exception 'A rider must be assigned before dispatching a platform delivery.';
    end if;
  end if;

  update public.orders
  set status = p_to_status
  where id = p_order_id;

  insert into public.order_status_history (order_id, from_status, to_status, actor_id, actor_role, note)
  values (p_order_id, v_order.status, p_to_status, auth.uid(), 'provider', left(coalesce(p_note, ''), 500));
end;
$$;
revoke all on function public.provider_update_order_status(uuid, text, text) from public, anon;
grant execute on function public.provider_update_order_status(uuid, text, text) to authenticated;

create or replace function public.customer_confirm_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order record;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null or v_order.customer_id <> auth.uid() then
    raise exception 'Order not found.';
  end if;
  if v_order.status <> 'delivered' then
    raise exception 'This order is not ready to be confirmed.';
  end if;

  update public.orders set status = 'completed', completed_at = now() where id = p_order_id;
  insert into public.order_status_history (order_id, from_status, to_status, actor_id, actor_role, note)
  values (p_order_id, 'delivered', 'completed', auth.uid(), 'customer', 'Customer confirmed completion.');
end;
$$;
revoke all on function public.customer_confirm_order(uuid) from public, anon;
grant execute on function public.customer_confirm_order(uuid) to authenticated;

-- Rider assignment is a row-locked claim. Two riders racing for one job cannot both win: the
-- second transaction waits for the row lock and then sees that rider_id is no longer null.
create or replace function public.accept_delivery(p_delivery_id uuid)
returns table (delivery_id uuid, order_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delivery record;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.';
  end if;

  if not exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role = 'transport_partner'
  ) and not exists (
    select 1 from public.provider_applications pa
    where pa.user_id = auth.uid()
      and pa.activity_type = 'transport_partner'
      and pa.status = 'approved'
  ) then
    raise exception 'Only approved transport partners can accept deliveries.';
  end if;

  select * into v_delivery from public.deliveries where id = p_delivery_id for update;
  if v_delivery.id is null then
    raise exception 'Delivery not found.';
  end if;
  if v_delivery.status <> 'requested' or v_delivery.rider_id is not null then
    raise exception 'This delivery has already been claimed.';
  end if;

  update public.deliveries
  set rider_id = auth.uid(), status = 'assigned', assigned_at = now()
  where id = p_delivery_id;

  insert into public.delivery_events (delivery_id, status, actor_id, actor_role, note)
  values (p_delivery_id, 'assigned', auth.uid(), 'rider', 'Rider accepted the delivery.');

  return query select p_delivery_id, v_delivery.order_id;
end;
$$;
revoke all on function public.accept_delivery(uuid) from public, anon;
grant execute on function public.accept_delivery(uuid) to authenticated;

create or replace function public.rider_update_delivery(
  p_delivery_id uuid,
  p_to_status text,
  p_proof_code text default null,
  p_note text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delivery record;
  v_expected text;
  v_order_status text;
  v_actor_role text := 'rider';
begin
  if auth.uid() is null then
    raise exception 'Sign in required.';
  end if;

  select * into v_delivery from public.deliveries where id = p_delivery_id for update;
  if v_delivery.id is null or v_delivery.rider_id <> auth.uid() then
    raise exception 'Delivery not found.';
  end if;

  v_expected := case v_delivery.status
    when 'assigned' then 'to_pickup'
    when 'to_pickup' then 'collected'
    when 'collected' then 'in_transit'
    when 'in_transit' then 'delivered'
    else null
  end;

  if p_to_status = 'failed' then
    if v_delivery.status not in ('assigned','to_pickup','collected') then
      raise exception 'This delivery cannot be marked failed at this stage.';
    end if;
  elsif v_expected is null or p_to_status <> v_expected then
    raise exception 'This delivery cannot move from % to %.', v_delivery.status, p_to_status;
  end if;

  if p_to_status = 'delivered' then
    if v_delivery.proof_code is not null and p_proof_code is distinct from v_delivery.proof_code then
      raise exception 'The delivery confirmation code is incorrect.';
    end if;
  end if;

  update public.deliveries
  set status = p_to_status,
      picked_up_at = case when p_to_status = 'collected' then now() else picked_up_at end,
      delivered_at = case when p_to_status = 'delivered' then now() else delivered_at end,
      proof_note = case when p_to_status = 'delivered' then left(coalesce(p_note, ''), 500) else proof_note end
  where id = p_delivery_id;

  insert into public.delivery_events (delivery_id, status, actor_id, actor_role, note)
  values (p_delivery_id, p_to_status, auth.uid(), v_actor_role, left(coalesce(p_note, ''), 500));

  if p_to_status = 'delivered' then
    select o.status into v_order_status
    from public.orders o
    where o.id = v_delivery.order_id
    for update;

    update public.orders
    set status = 'delivered'
    where id = v_delivery.order_id and status in ('dispatched','ready');

    if found then
      insert into public.order_status_history (order_id, from_status, to_status, actor_id, actor_role, note)
      values (v_delivery.order_id, v_order_status, 'delivered', auth.uid(), 'rider', 'Delivery completed.');
    end if;
  end if;
end;
$$;
revoke all on function public.rider_update_delivery(uuid, text, text, text) from public, anon;
grant execute on function public.rider_update_delivery(uuid, text, text, text) to authenticated;

create or replace function public.get_delivery_proof_code(p_order_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.';
  end if;
  if not exists (
    select 1 from public.orders o
    where o.id = p_order_id and o.customer_id = auth.uid()
  ) then
    raise exception 'Order not found.';
  end if;
  select d.proof_code into v_code from public.deliveries d where d.order_id = p_order_id;
  return v_code;
end;
$$;
revoke all on function public.get_delivery_proof_code(uuid) from public, anon;
grant execute on function public.get_delivery_proof_code(uuid) to authenticated;

-- Available jobs expose only the information a rider needs to decide whether to claim the job.
-- The full drop-off address is released by RLS only after the rider is assigned.
create or replace function public.list_available_deliveries()
returns table (
  delivery_id uuid,
  order_id uuid,
  dropoff_county text,
  distance_km numeric,
  rider_fee_minor bigint,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$ 
begin
  if auth.uid() is null then
    raise exception 'Sign in required.';
  end if;
  if not exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role = 'transport_partner'
  ) and not exists (
    select 1 from public.provider_applications pa
    where pa.user_id = auth.uid()
      and pa.activity_type = 'transport_partner'
      and pa.status = 'approved'
  ) then
    raise exception 'Only approved transport partners can view delivery jobs.';
  end if;

  return query
    select d.id, d.order_id, d.dropoff_county, d.distance_km, d.rider_fee_minor, d.created_at
    from public.deliveries d
    where d.status = 'requested' and d.rider_id is null
    order by d.created_at asc
    limit 50;
end;
$$;
revoke all on function public.list_available_deliveries() from public, anon;
grant execute on function public.list_available_deliveries() to authenticated;

commit;
