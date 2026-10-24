-- Shilevi migration 0017: payment events, ledger, commission rules, refunds, payouts and settings.
-- Review and run manually after 0016. No live Supabase project was accessed.
-- The default payment mode is an explicit sandbox simulator. It must not be presented as a real
-- charge. Real providers (M-Pesa and others) require a separate server-verified integration.
begin;

create table if not exists public.commission_rules (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  scope text not null default 'global' check (scope in ('global','division','category')),
  division text check (division is null or division in ('products','services','transport_delivery','property_places')),
  category_id uuid references public.marketplace_categories(id) on delete cascade,
  transaction_type text,
  rate_bps integer not null check (rate_bps between 0 and 5000),
  min_commission_minor bigint not null default 0 check (min_commission_minor >= 0),
  max_commission_minor bigint check (max_commission_minor is null or max_commission_minor >= min_commission_minor),
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commission_rule_scope_target check (
    (scope = 'global' and division is null and category_id is null)
    or (scope = 'division' and division is not null and category_id is null)
    or (scope = 'category' and category_id is not null)
  )
);

insert into public.commission_rules (slug, name, scope, rate_bps, is_active)
values ('default-marketplace', 'Default marketplace commission', 'global', 1000, true)
on conflict (slug) do nothing;

create table if not exists public.commission_tiers (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.commission_rules(id) on delete cascade,
  min_base_minor bigint not null check (min_base_minor >= 0),
  max_base_minor bigint check (max_base_minor is null or max_base_minor > min_base_minor),
  rate_bps integer not null check (rate_bps between 0 and 5000),
  created_at timestamptz not null default now(),
  constraint commission_tier_range check (max_base_minor is null or max_base_minor > min_base_minor)
);

create index if not exists commission_tiers_rule_idx on public.commission_tiers(rule_id, min_base_minor);

alter table public.commission_rules enable row level security;
alter table public.commission_tiers enable row level security;
revoke all on public.commission_rules, public.commission_tiers from anon, authenticated;
grant select on public.commission_rules, public.commission_tiers to authenticated;

drop policy if exists "commission_rules_select_admin" on public.commission_rules;
create policy "commission_rules_select_admin" on public.commission_rules
for select to authenticated using (public.is_shilevi_owner_admin());

drop policy if exists "commission_tiers_select_admin" on public.commission_tiers;
create policy "commission_tiers_select_admin" on public.commission_tiers
for select to authenticated using (public.is_shilevi_owner_admin());

create table if not exists public.payment_events (
  id bigserial primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  provider text not null,
  event_type text not null,
  amount_minor bigint not null check (amount_minor >= 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  reference text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists payment_events_provider_reference_unique
  on public.payment_events(provider, reference)
  where reference is not null;
create index if not exists payment_events_order_idx on public.payment_events(order_id, created_at desc);

create table if not exists public.ledger_entries (
  id bigserial primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  entry_type text not null check (entry_type in (
    'customer_charge','commission','provider_payable','delivery_split','refund','adjustment'
  )),
  account text not null check (account in (
    'customer','settlement','platform_commission','platform_delivery','provider_payable','rider_payable'
  )),
  party_id uuid references auth.users(id) on delete set null,
  debit_minor bigint not null default 0 check (debit_minor >= 0),
  credit_minor bigint not null default 0 check (credit_minor >= 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  reference text,
  created_at timestamptz not null default now(),
  constraint ledger_entry_one_side check (
    (debit_minor > 0 and credit_minor = 0) or (credit_minor > 0 and debit_minor = 0)
  )
);

create index if not exists ledger_entries_order_idx on public.ledger_entries(order_id, created_at);
create index if not exists ledger_entries_account_idx on public.ledger_entries(account, created_at);

create table if not exists public.refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete restrict,
  reason text not null,
  amount_minor bigint not null check (amount_minor > 0),
  status text not null default 'requested' check (status in ('requested','approved','rejected','processed','failed')),
  previous_order_status text not null,
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  processed_at timestamptz,
  provider_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint refund_reason_size check (char_length(reason) between 1 and 1000)
);

create index if not exists refunds_order_idx on public.refunds(order_id, created_at desc);
create index if not exists refunds_status_idx on public.refunds(status, created_at);

create table if not exists public.payouts (
  id uuid primary key default gen_random_uuid(),
  payee_id uuid not null references auth.users(id) on delete restrict,
  payee_role text not null check (payee_role in ('provider','rider')),
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null default 'KES' check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'pending' check (status in ('pending','processing','paid','failed','cancelled')),
  method text,
  reference text,
  period_start timestamptz,
  period_end timestamptz,
  processed_by uuid references auth.users(id) on delete set null,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists payouts_payee_idx on public.payouts(payee_id, created_at desc);
create index if not exists payouts_status_idx on public.payouts(status, created_at);

drop trigger if exists commission_rules_set_updated_at on public.commission_rules;
create trigger commission_rules_set_updated_at before update on public.commission_rules
for each row execute function public.set_updated_at();

drop trigger if exists refunds_set_updated_at on public.refunds;
create trigger refunds_set_updated_at before update on public.refunds
for each row execute function public.set_updated_at();

alter table public.payment_events enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.refunds enable row level security;
alter table public.payouts enable row level security;

revoke all on public.payment_events, public.ledger_entries, public.refunds, public.payouts
  from anon, authenticated;
grant select on public.refunds, public.payouts to authenticated;

drop policy if exists "refunds_select_participant" on public.refunds;
create policy "refunds_select_participant" on public.refunds
for select to authenticated
using (
  requested_by = (select auth.uid())
  or public.is_shilevi_owner_admin()
  or exists (
    select 1 from public.order_items oi
    where oi.order_id = refunds.order_id and oi.owner_id = (select auth.uid())
  )
);

drop policy if exists "payouts_select_own" on public.payouts;
create policy "payouts_select_own" on public.payouts
for select to authenticated
using (payee_id = (select auth.uid()) or public.is_shilevi_owner_admin());

-- Payment events and ledger rows are server-only. Even an authenticated browser cannot read the
-- full provider payload or write a ledger entry directly.

create or replace function public.confirm_mock_payment(
  p_order_id uuid,
  p_reference text default null
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mode text;
  v_order record;
  v_provider_net bigint;
  v_rider_fee bigint;
  v_platform_delivery bigint;
  v_reference text;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.';
  end if;

  select (value #>> '{}') into v_mode
  from public.platform_settings where key = 'payment_mode';

  if v_mode is distinct from 'mock' then
    raise exception 'Mock payments are disabled. Use a configured payment provider.';
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

create or replace function public.request_order_refund(p_order_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order record;
  v_refund_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.';
  end if;
  if p_reason is null or char_length(trim(p_reason)) < 5 then
    raise exception 'Please describe the problem in at least five characters.';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null or v_order.customer_id <> auth.uid() then
    raise exception 'Order not found.';
  end if;
  if v_order.payment_status <> 'paid' then
    raise exception 'Only a paid order can be refunded.';
  end if;
  if v_order.status not in ('paid','accepted','preparing','ready','dispatched','delivered','completed') then
    raise exception 'This order cannot be refunded in its current state.';
  end if;
  if exists (
    select 1 from public.refunds r
    where r.order_id = p_order_id and r.status in ('requested','approved')
  ) then
    raise exception 'A refund request is already open for this order.';
  end if;

  insert into public.refunds (order_id, requested_by, reason, amount_minor, previous_order_status)
  values (p_order_id, auth.uid(), left(trim(p_reason), 1000), v_order.total_minor, v_order.status)
  returning id into v_refund_id;

  update public.orders
  set status = 'refund_requested', payment_status = 'refund_pending'
  where id = p_order_id;

  insert into public.order_status_history (order_id, from_status, to_status, actor_id, actor_role, note)
  values (p_order_id, v_order.status, 'refund_requested', auth.uid(), 'customer', 'Refund requested.');

  return v_refund_id;
end;
$$;
revoke all on function public.request_order_refund(uuid, text) from public, anon;
grant execute on function public.request_order_refund(uuid, text) to authenticated;

create or replace function public.admin_decide_refund(
  p_refund_id uuid,
  p_approve boolean,
  p_note text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_refund record;
  v_order record;
  v_provider_net bigint;
  v_rider_fee bigint;
  v_platform_delivery bigint;
begin
  if not public.is_shilevi_owner_admin() then
    raise exception 'Not authorized.';
  end if;

  select * into v_refund from public.refunds where id = p_refund_id for update;
  if v_refund.id is null then
    raise exception 'Refund not found.';
  end if;
  if v_refund.status <> 'requested' then
    raise exception 'This refund has already been decided.';
  end if;

  select * into v_order from public.orders where id = v_refund.order_id for update;

  if not p_approve then
    update public.refunds
    set status = 'rejected', decided_by = auth.uid(), decided_at = now(),
        decision_note = left(coalesce(p_note, ''), 1000)
    where id = p_refund_id;

    update public.orders
    set status = v_refund.previous_order_status, payment_status = 'paid'
    where id = v_refund.order_id;

    insert into public.order_status_history (order_id, from_status, to_status, actor_id, actor_role, note)
    values (v_refund.order_id, 'refund_requested', v_refund.previous_order_status, auth.uid(), 'admin', 'Refund rejected.');

    return;
  end if;

  select coalesce(sum(oi.provider_net_minor), 0) into v_provider_net
  from public.order_items oi where oi.order_id = v_refund.order_id;
  select coalesce(max(d.rider_fee_minor), 0) into v_rider_fee
  from public.deliveries d where d.order_id = v_refund.order_id;
  v_platform_delivery := v_order.delivery_fee_minor - v_rider_fee;

  insert into public.ledger_entries (order_id, entry_type, account, party_id, debit_minor, credit_minor, currency, reference)
  values
    (v_refund.order_id, 'refund', 'settlement', null, v_order.total_minor, 0, v_order.currency, v_refund.id::text),
    (v_refund.order_id, 'refund', 'customer', v_order.customer_id, 0, v_order.total_minor, v_order.currency, v_refund.id::text),
    (v_refund.order_id, 'refund', 'platform_commission', null, v_order.commission_minor, 0, v_order.currency, v_refund.id::text),
    (v_refund.order_id, 'refund', 'settlement', null, 0, v_order.commission_minor, v_order.currency, v_refund.id::text),
    (v_refund.order_id, 'refund', 'provider_payable', null, v_provider_net, 0, v_order.currency, v_refund.id::text),
    (v_refund.order_id, 'refund', 'settlement', null, 0, v_provider_net, v_order.currency, v_refund.id::text);

  if v_order.delivery_fee_minor > 0 then
    insert into public.ledger_entries (order_id, entry_type, account, party_id, debit_minor, credit_minor, currency, reference)
    values
      (v_refund.order_id, 'refund', 'rider_payable', null, v_rider_fee, 0, v_order.currency, v_refund.id::text),
      (v_refund.order_id, 'refund', 'platform_delivery', null, v_platform_delivery, 0, v_order.currency, v_refund.id::text),
      (v_refund.order_id, 'refund', 'settlement', null, 0, v_order.delivery_fee_minor, v_order.currency, v_refund.id::text);
  end if;

  update public.refunds
  set status = 'processed', decided_by = auth.uid(), decided_at = now(),
      processed_at = now(), decision_note = left(coalesce(p_note, ''), 1000)
  where id = p_refund_id;

  update public.orders
  set status = 'refunded', payment_status = 'refunded'
  where id = v_refund.order_id;

  insert into public.order_status_history (order_id, from_status, to_status, actor_id, actor_role, note)
  values (v_refund.order_id, 'refund_requested', 'refunded', auth.uid(), 'admin', 'Refund processed.');
end;
$$;
revoke all on function public.admin_decide_refund(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.admin_decide_refund(uuid, boolean, text) to service_role;
-- Admin actions are intentionally not executable from the browser client. Use a trusted server path.

create or replace function public.admin_update_setting(p_key text, p_value jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_shilevi_owner_admin() then
    raise exception 'Not authorized.';
  end if;
  if p_key not in (
    'currency','payment_mode','commission_rate_bps','delivery_commission_bps','delivery_flat_fee_minor'
  ) then
    raise exception 'Unknown setting.';
  end if;

  insert into public.platform_settings (key, value, updated_by)
  values (p_key, p_value, auth.uid())
  on conflict (key) do update
    set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
end;
$$;
revoke all on function public.admin_update_setting(text, jsonb) from public, anon, authenticated;
grant execute on function public.admin_update_setting(text, jsonb) to service_role;

create or replace function public.get_admin_settings()
returns table (key text, value jsonb, updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_shilevi_owner_admin() then
    raise exception 'Not authorized.';
  end if;
  return query select ps.key, ps.value, ps.updated_at from public.platform_settings ps order by ps.key;
end;
$$;
revoke all on function public.get_admin_settings() from public, anon, authenticated;
grant execute on function public.get_admin_settings() to service_role;

commit;
