-- Shilevi migration 0023: payment-method registry and a fail-closed sandbox switch.
--
-- Two problems are closed here.
--
-- 1. Sandbox settlement was reachable whenever platform_settings.payment_mode = 'mock', which is
--    the default. A production deployment could therefore mark orders paid, settle rides and grant
--    House Hunt contact access without any verified provider payment. Mock settlement now requires
--    BOTH payment_mode = 'mock' AND allow_mock_payments = true, and that switch defaults to false.
--    A real deployment therefore fails closed until the owner deliberately enables sandbox money.
--
-- 2. There was no record of which payment methods the marketplace offers, so the checkout could not
--    distinguish "M-Pesa configured" from "not configured" and copy implied that only mock existed.
--    payment_methods records the owner's intent; whether a provider is *usable* is still derived on
--    the server from its credentials. An enabled flag alone never makes a method chargeable.
--
-- Apply after 0022. It adds a setting, a table and replaces function bodies; it deletes no data.

begin;

-- ---------------------------------------------------------------- sandbox switch

insert into public.platform_settings (key, value)
values ('allow_mock_payments', 'false'::jsonb)
on conflict (key) do nothing;

create or replace function public.mock_payments_allowed()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select (value #>> '{}')::boolean from public.platform_settings where key = 'allow_mock_payments'),
    false
  )
  and coalesce(
    (select (value #>> '{}') from public.platform_settings where key = 'payment_mode'),
    ''
  ) = 'mock';
$$;
revoke all on function public.mock_payments_allowed() from public, anon;
grant execute on function public.mock_payments_allowed() to authenticated, service_role;

-- Sandbox order settlement. The settlement logic is unchanged; only the gate differs.
create or replace function public.confirm_mock_payment(
  p_order_id uuid,
  p_reference text default null
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order record;
  v_provider_net bigint;
  v_rider_fee bigint;
  v_platform_delivery bigint;
  v_reference text;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.';
  end if;

  if not public.mock_payments_allowed() then
    raise exception 'Sandbox payments are disabled. Use a configured payment provider.';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null or v_order.customer_id <> auth.uid() then
    raise exception 'Order not found.';
  end if;

  -- Idempotent success: a repeated callback must not charge or credit twice.
  if v_order.payment_status = 'paid' then
    return coalesce(v_order.payment_reference, 'already-paid');
  end if;
  if v_order.status <> 'pending_payment' or v_order.payment_status <> 'unpaid' then
    raise exception 'This order is not awaiting payment.';
  end if;

  v_reference := left(coalesce(
    nullif(trim(p_reference), ''),
    'MOCK-' || v_order.order_number || '-' || extract(epoch from now())::bigint::text
  ), 120);

  if exists (
    select 1 from public.payment_events pe
    where pe.provider = 'mock' and pe.reference = v_reference
  ) then
    raise exception 'That payment reference has already been used.';
  end if;

  select coalesce(sum(oi.provider_net_minor), 0) into v_provider_net
  from public.order_items oi where oi.order_id = p_order_id;

  select coalesce(max(d.rider_fee_minor), 0) into v_rider_fee
  from public.deliveries d where d.order_id = p_order_id;

  v_platform_delivery := v_order.delivery_fee_minor - v_rider_fee;

  update public.orders
  set status = 'paid', payment_status = 'paid', paid_at = now(), payment_reference = v_reference
  where id = p_order_id;

  insert into public.payment_events (order_id, provider, event_type, amount_minor, currency, reference, payload)
  values (
    p_order_id, 'mock', 'payment.succeeded', v_order.total_minor, v_order.currency, v_reference,
    jsonb_build_object('mode', 'sandbox', 'note', 'Simulated payment. No real funds moved.')
  );

  -- Balanced double-entry: customer charge is split into commission, seller payable and delivery.
  insert into public.ledger_entries (order_id, entry_type, account, party_id, debit_minor, credit_minor, currency, reference)
  values
    (p_order_id, 'customer_charge', 'customer', v_order.customer_id, v_order.total_minor, 0, v_order.currency, v_reference),
    (p_order_id, 'customer_charge', 'settlement', null, 0, v_order.total_minor, v_order.currency, v_reference),
    (p_order_id, 'commission', 'settlement', null, v_order.commission_minor, 0, v_order.currency, v_reference),
    (p_order_id, 'commission', 'platform_commission', null, 0, v_order.commission_minor, v_order.currency, v_reference),
    (p_order_id, 'provider_payable', 'settlement', null, v_provider_net, 0, v_order.currency, v_reference),
    (p_order_id, 'provider_payable', 'provider_payable', null, 0, v_provider_net, v_order.currency, v_reference);

  if v_order.delivery_fee_minor > 0 then
    insert into public.ledger_entries (order_id, entry_type, account, party_id, debit_minor, credit_minor, currency, reference)
    values
      (p_order_id, 'delivery_split', 'settlement', null, v_order.delivery_fee_minor, 0, v_order.currency, v_reference),
      (p_order_id, 'delivery_split', 'rider_payable', null, 0, v_rider_fee, v_order.currency, v_reference),
      (p_order_id, 'delivery_split', 'platform_delivery', null, 0, v_platform_delivery, v_order.currency, v_reference);
  end if;

  insert into public.order_status_history (order_id, from_status, to_status, actor_id, actor_role, note)
  values (p_order_id, v_order.status, 'paid', auth.uid(), 'customer', 'Sandbox payment confirmed.');

  return v_reference;
end;
$$;
revoke all on function public.confirm_mock_payment(uuid, text) from public, anon;
grant execute on function public.confirm_mock_payment(uuid, text) to authenticated;

-- Sandbox ride settlement.
create or replace function public.confirm_mock_ride_payment(
  p_ride_id uuid,
  p_reference text default null
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ride record;
  v_reference text;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.';
  end if;

  if not public.mock_payments_allowed() then
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

-- Sandbox House Hunt unlock.
create or replace function public.confirm_mock_property_unlock(p_listing_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_listing record;
  v_fee bigint;
  v_intent_id uuid;
  v_reference text;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.';
  end if;

  if not public.mock_payments_allowed() then
    raise exception 'Sandbox payments are disabled. Use a configured payment provider.';
  end if;

  select l.id, l.status into v_listing from public.listings l
  join public.property_listings pl on pl.listing_id = l.id
  where l.id = p_listing_id;

  if v_listing.id is null or v_listing.status <> 'published' then
    raise exception 'Property listing not found.';
  end if;

  if public.has_property_access(p_listing_id) then
    return 'already-unlocked';
  end if;

  select (value #>> '{}')::bigint into v_fee
  from public.platform_settings where key = 'property_contact_fee_minor';
  v_fee := coalesce(v_fee, 2000);

  v_reference := 'MOCK-PROPERTY-' || p_listing_id::text || '-' || extract(epoch from now())::bigint::text;

  insert into public.payment_intents (
    user_id, purpose, listing_id, provider, amount_minor, status, provider_reference, metadata
  ) values (
    auth.uid(), 'property_contact', p_listing_id, 'mock', v_fee, 'pending', v_reference,
    jsonb_build_object('mode', 'sandbox', 'note', 'Simulated payment. No real funds moved.')
  )
  returning id into v_intent_id;

  perform public.complete_property_unlock(v_intent_id, v_reference, 'mock');
  return v_reference;
end;
$$;
revoke all on function public.confirm_mock_property_unlock(uuid) from public, anon;
grant execute on function public.confirm_mock_property_unlock(uuid) to authenticated;

-- Checkout needs to know whether sandbox money is actually available before offering it.
create or replace function public.get_checkout_settings()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
  from public.platform_settings
  where key in (
    'currency','payment_mode','commission_rate_bps','delivery_commission_bps',
    'delivery_flat_fee_minor','allow_mock_payments'
  );
$$;
revoke all on function public.get_checkout_settings() from public;
grant execute on function public.get_checkout_settings() to anon, authenticated;

-- ---------------------------------------------------------------- payment methods

-- This table records the owner's intent. It is not a claim that a provider is chargeable: the
-- application still requires the matching server credentials before it will offer a method.
create table if not exists public.payment_methods (
  provider text primary key check (provider in ('mpesa','card','airtel_money','mock')),
  label text not null,
  enabled boolean not null default false,
  purposes text[] not null default array['order','ride','property_contact']::text[],
  currencies text[] not null default array['KES']::text[],
  sort_order integer not null default 100,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.payment_methods enable row level security;
revoke all on public.payment_methods from anon, authenticated;
grant select on public.payment_methods to anon, authenticated;

drop policy if exists "payment_methods_read_enabled" on public.payment_methods;
create policy "payment_methods_read_enabled" on public.payment_methods
for select to anon, authenticated
using (enabled = true);

-- The owner must see disabled rows to manage them. This grants read only; writes stay in the RPC.
drop policy if exists "payment_methods_owner_read_all" on public.payment_methods;
create policy "payment_methods_owner_read_all" on public.payment_methods
for select to authenticated
using ((select public.is_shilevi_owner_admin()));

-- No client write policy. Enabling and disabling is an owner action through the RPC below, which
-- also records an audit event.

insert into public.payment_methods (provider, label, enabled, purposes, currencies, sort_order)
values
  ('mpesa', 'M-Pesa', false, array['order','ride','property_contact']::text[], array['KES']::text[], 10),
  ('card', 'Card (Visa or Mastercard)', false, array['order','ride','property_contact']::text[], array['KES']::text[], 20),
  ('airtel_money', 'Airtel Money', false, array['order','ride','property_contact']::text[], array['KES']::text[], 30),
  ('mock', 'Sandbox payment', false, array['order','ride','property_contact']::text[], array['KES']::text[], 90)
on conflict (provider) do nothing;

create or replace function public.admin_set_payment_method(
  p_provider text,
  p_enabled boolean
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_shilevi_owner_admin() then
    raise exception 'Not authorized.';
  end if;
  if p_provider not in ('mpesa','card','airtel_money','mock') then
    raise exception 'Unknown payment provider.';
  end if;

  update public.payment_methods
  set enabled = p_enabled, updated_by = auth.uid(), updated_at = now()
  where provider = p_provider;

  if not found then
    raise exception 'Payment provider not found.';
  end if;

  insert into public.audit_events(actor_id, action, resource_type, resource_id, outcome, metadata)
  values (auth.uid(), 'payment_method.update', 'payment_methods', p_provider, 'success',
    jsonb_build_object('enabled', p_enabled));
end;
$$;
revoke all on function public.admin_set_payment_method(text, boolean) from public, anon;
grant execute on function public.admin_set_payment_method(text, boolean) to authenticated;

-- Reserve the provider value so an Airtel adapter can be added without another constraint change.
alter table public.payment_intents drop constraint if exists payment_intents_provider_check;
alter table public.payment_intents add constraint payment_intents_provider_check
  check (provider in ('mock','mpesa','card','airtel_money'));

commit;
