-- Shilevi migration 0031: delivery pricing, auditable quotes, and the two transaction commissions.
--
-- Money rules in this file:
--   * client payment commission  = 10% of the marketplace commissionable base (already stored on
--     orders.commission_minor by create_order; the rate is resolved from commission_rules here);
--   * deliverer payout commission = 10% of the payout amount, recorded in the ledger when the payout
--     is prepared and reversed with an auditable adjustment entry if the payout fails.
-- Both rates live in public.commission_rules with an explicit transaction_type, so no page or
-- endpoint hard-codes 10%. Every amount is integer minor units, rounded to whole currency units the
-- same way create_order rounds, and every write is idempotent.
--
-- Nothing here invents a price: a quote is only issued when an active owner-configured rule matches
-- the route and vehicle class, and it is stored as an immutable snapshot with the rule version.

begin;

-- ------------------------------------------------------------------ commission policy (one source)

insert into public.commission_rules (slug, name, scope, transaction_type, rate_bps, is_active)
values
  ('client-payment-commission', 'Client payment commission (10%)', 'global', 'client_payment', 1000, true),
  ('deliverer-payout-commission', 'Deliverer payout commission (10%)', 'global', 'deliverer_payout', 1000, true)
on conflict (slug) do nothing;

create or replace function public.commission_rate_bps(p_transaction_type text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select r.rate_bps
      from public.commission_rules r
      where r.is_active
        and r.transaction_type = p_transaction_type
        and r.effective_from <= now()
        and (r.effective_to is null or r.effective_to > now())
      order by r.effective_from desc, r.created_at desc
      limit 1
    ),
    coalesce(
      (select (value #>> '{}')::integer from public.platform_settings where key = 'commission_rate_bps'),
      1000
    )
  );
$$;

revoke all on function public.commission_rate_bps(text) from public, anon;
grant execute on function public.commission_rate_bps(text) to authenticated, service_role;

-- Single arithmetic implementation for both transaction types. Rounds the commission to the nearest
-- whole currency unit (100 minor units), matching create_order, and never exceeds the base.
create or replace function public.commission_split(p_base_minor bigint, p_transaction_type text)
returns table (rate_bps integer, commission_minor bigint, net_minor bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rate integer;
  v_commission bigint;
begin
  if p_base_minor is null or p_base_minor < 0 then
    raise exception 'A commission base must be a non-negative amount.' using errcode = '22023';
  end if;
  v_rate := greatest(least(coalesce(public.commission_rate_bps(p_transaction_type), 1000), 5000), 0);
  v_commission := (round((p_base_minor::numeric * v_rate / 10000.0) / 100.0) * 100)::bigint;
  if v_commission > p_base_minor then
    v_commission := p_base_minor;
  end if;
  rate_bps := v_rate;
  commission_minor := v_commission;
  net_minor := p_base_minor - v_commission;
  return next;
end;
$$;

revoke all on function public.commission_split(bigint, text) from public, anon;
grant execute on function public.commission_split(bigint, text) to authenticated, service_role;

-- ------------------------------------------------------------- ledger can carry payout commission

alter table public.ledger_entries
  add column if not exists payout_id uuid references public.payouts(id) on delete cascade;
alter table public.ledger_entries alter column order_id drop not null;
alter table public.ledger_entries drop constraint if exists ledger_entry_subject;
alter table public.ledger_entries
  add constraint ledger_entry_subject check (num_nonnulls(order_id, payout_id) = 1);

-- One commission and one adjustment row per account per payout: retries cannot double-charge.
create unique index if not exists ledger_entries_payout_unique
  on public.ledger_entries(payout_id, entry_type, account)
  where payout_id is not null;
create index if not exists ledger_entries_payout_idx
  on public.ledger_entries(payout_id) where payout_id is not null;

alter table public.payouts
  add column if not exists commission_rate_bps integer not null default 0
    check (commission_rate_bps between 0 and 5000),
  add column if not exists commission_minor bigint not null default 0
    check (commission_minor >= 0),
  add column if not exists net_minor bigint generated always as (amount_minor - commission_minor) stored,
  add column if not exists commission_applied_at timestamptz,
  add column if not exists commission_reversed_at timestamptz;
alter table public.payouts drop constraint if exists payouts_commission_within_amount;
alter table public.payouts
  add constraint payouts_commission_within_amount check (commission_minor <= amount_minor);

-- --------------------------------------------------------------- deliverer payout commission (10%)

create or replace function public.apply_payout_commission(p_payout_id uuid)
returns table (commission_minor bigint, net_minor bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payout record;
  v_split record;
begin
  if not (public.is_shilevi_owner_admin() or public.has_staff_capability('finance.payout')) then
    raise exception 'Payout commission requires finance permission.' using errcode = '42501';
  end if;

  select * into v_payout from public.payouts where id = p_payout_id for update;
  if v_payout.id is null then
    raise exception 'Payout not found.' using errcode = 'P0002';
  end if;
  if v_payout.status in ('failed', 'cancelled') then
    raise exception 'A failed or cancelled payout cannot carry a new commission.' using errcode = '23514';
  end if;

  -- Idempotent: a retried request returns the recorded figures and writes nothing.
  if v_payout.commission_applied_at is not null then
    commission_minor := v_payout.commission_minor;
    net_minor := v_payout.net_minor;
    return next;
    return;
  end if;

  select * into v_split from public.commission_split(v_payout.amount_minor, 'deliverer_payout');

  insert into public.ledger_entries
    (payout_id, entry_type, account, party_id, debit_minor, credit_minor, currency, reference)
  values
    (p_payout_id, 'commission', 'rider_payable', v_payout.payee_id, v_split.commission_minor, 0,
      v_payout.currency, 'PAYOUT-COMMISSION'),
    (p_payout_id, 'commission', 'platform_commission', null, 0, v_split.commission_minor,
      v_payout.currency, 'PAYOUT-COMMISSION')
  on conflict do nothing;

  update public.payouts
  set commission_rate_bps = v_split.rate_bps,
      commission_minor = v_split.commission_minor,
      commission_applied_at = now()
  where id = p_payout_id;

  insert into public.audit_events (actor_id, action, resource_type, resource_id, metadata)
  values (
    auth.uid(), 'payout.commission_applied', 'payout', p_payout_id::text,
    jsonb_build_object(
      'rate_bps', v_split.rate_bps,
      'gross_minor', v_payout.amount_minor,
      'commission_minor', v_split.commission_minor,
      'net_minor', v_split.net_minor,
      'currency', v_payout.currency
    )
  );

  commission_minor := v_split.commission_minor;
  net_minor := v_split.net_minor;
  return next;
end;
$$;

revoke all on function public.apply_payout_commission(uuid) from public, anon;
grant execute on function public.apply_payout_commission(uuid) to authenticated;

create or replace function public.admin_reverse_payout_commission(p_payout_id uuid, p_reason text)
returns table (reversed_commission_minor bigint, net_minor bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payout record;
begin
  if not (public.is_shilevi_owner_admin() or public.has_staff_capability('finance.payout')) then
    raise exception 'Payout commission reversal requires finance permission.' using errcode = '42501';
  end if;
  if p_reason is null or char_length(trim(p_reason)) < 5 then
    raise exception 'A reversal reason of at least 5 characters is required.' using errcode = '23514';
  end if;

  select * into v_payout from public.payouts where id = p_payout_id for update;
  if v_payout.id is null then
    raise exception 'Payout not found.' using errcode = 'P0002';
  end if;

  -- Nothing to reverse, or already reversed: return the current figures without writing again.
  if v_payout.commission_applied_at is null or v_payout.commission_reversed_at is not null then
    reversed_commission_minor := 0;
    net_minor := v_payout.net_minor;
    return next;
    return;
  end if;

  insert into public.ledger_entries
    (payout_id, entry_type, account, party_id, debit_minor, credit_minor, currency, reference)
  values
    (p_payout_id, 'adjustment', 'platform_commission', null, v_payout.commission_minor, 0,
      v_payout.currency, 'PAYOUT-COMMISSION-REVERSAL'),
    (p_payout_id, 'adjustment', 'rider_payable', v_payout.payee_id, 0, v_payout.commission_minor,
      v_payout.currency, 'PAYOUT-COMMISSION-REVERSAL')
  on conflict do nothing;

  update public.payouts
  set commission_reversed_at = now(),
      commission_minor = 0
  where id = p_payout_id;

  insert into public.audit_events (actor_id, action, resource_type, resource_id, metadata)
  values (
    auth.uid(), 'payout.commission_reversed', 'payout', p_payout_id::text,
    jsonb_build_object(
      'reversed_commission_minor', v_payout.commission_minor,
      'reason', left(trim(p_reason), 500),
      'currency', v_payout.currency
    )
  );

  reversed_commission_minor := v_payout.commission_minor;
  net_minor := v_payout.amount_minor;
  return next;
end;
$$;

revoke all on function public.admin_reverse_payout_commission(uuid, text) from public, anon;
grant execute on function public.admin_reverse_payout_commission(uuid, text) to authenticated;

-- ------------------------------------------------------------------------------- pricing rules

create table if not exists public.delivery_pricing_rules (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{2,63}$'),
  name text not null check (char_length(trim(name)) between 3 and 120),
  -- null means "any", which keeps one rule usable across a whole vehicle family or county
  vehicle_class_code text references public.delivery_vehicle_classes(code) on delete restrict,
  pickup_county text check (pickup_county is null or char_length(trim(pickup_county)) between 2 and 100),
  dropoff_county text check (dropoff_county is null or char_length(trim(dropoff_county)) between 2 and 100),
  currency char(3) not null default 'KES' check (currency ~ '^[A-Z]{3}$'),
  base_fee_minor bigint not null check (base_fee_minor >= 0),
  per_kg_minor bigint not null default 0 check (per_kg_minor >= 0),
  per_package_minor bigint not null default 0 check (per_package_minor >= 0),
  fragile_surcharge_minor bigint not null default 0 check (fragile_surcharge_minor >= 0),
  covered_surcharge_minor bigint not null default 0 check (covered_surcharge_minor >= 0),
  temperature_surcharge_minor bigint not null default 0 check (temperature_surcharge_minor >= 0),
  platform_fee_bps integer not null default 1000 check (platform_fee_bps between 0 and 5000),
  min_fee_minor bigint not null default 0 check (min_fee_minor >= 0),
  max_fee_minor bigint check (max_fee_minor is null or max_fee_minor >= min_fee_minor),
  version integer not null default 1 check (version >= 1),
  is_active boolean not null default true,
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists delivery_pricing_rules_route_idx
  on public.delivery_pricing_rules(vehicle_class_code, pickup_county, dropoff_county)
  where is_active;

drop trigger if exists delivery_pricing_rules_set_updated_at on public.delivery_pricing_rules;
create trigger delivery_pricing_rules_set_updated_at before update on public.delivery_pricing_rules
for each row execute function public.set_updated_at();

alter table public.delivery_pricing_rules enable row level security;
revoke all on public.delivery_pricing_rules from anon, authenticated;
grant select on public.delivery_pricing_rules to authenticated;

drop policy if exists "delivery_pricing_rules_select_finance" on public.delivery_pricing_rules;
create policy "delivery_pricing_rules_select_finance" on public.delivery_pricing_rules
for select to authenticated
using (
  (select public.is_shilevi_owner_admin())
  or (select public.has_staff_capability('finance.read'))
  or (select public.has_staff_capability('finance.payout'))
);

-- ---------------------------------------------------------------------------- quote snapshots

create table if not exists public.delivery_quotes (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references auth.users(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  pickup_county text not null check (char_length(trim(pickup_county)) between 2 and 100),
  dropoff_county text not null check (char_length(trim(dropoff_county)) between 2 and 100),
  vehicle_class_code text references public.delivery_vehicle_classes(code) on delete restrict,
  package_count integer not null check (package_count between 1 and 20),
  weight_kg numeric(8, 2) check (weight_kg is null or weight_kg >= 0),
  length_cm integer check (length_cm is null or length_cm between 1 and 3000),
  width_cm integer check (width_cm is null or width_cm between 1 and 500),
  height_cm integer check (height_cm is null or height_cm between 1 and 500),
  fragile boolean not null default false,
  requires_covered boolean not null default false,
  temperature_controlled boolean not null default false,
  pricing_rule_id uuid not null references public.delivery_pricing_rules(id) on delete restrict,
  pricing_rule_version integer not null,
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  base_fee_minor bigint not null check (base_fee_minor >= 0),
  weight_fee_minor bigint not null check (weight_fee_minor >= 0),
  package_fee_minor bigint not null check (package_fee_minor >= 0),
  handling_fee_minor bigint not null check (handling_fee_minor >= 0),
  surge_or_discount_minor bigint not null default 0,
  total_minor bigint not null check (total_minor >= 0),
  platform_fee_minor bigint not null check (platform_fee_minor >= 0),
  rider_fee_minor bigint not null check (rider_fee_minor >= 0),
  status text not null default 'quoted' check (status in ('quoted', 'consumed', 'expired', 'cancelled')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  constraint delivery_quotes_expiry_after_creation check (expires_at > created_at),
  constraint delivery_quotes_fee_split_matches check (total_minor = rider_fee_minor + platform_fee_minor)
);

create index if not exists delivery_quotes_customer_idx
  on public.delivery_quotes(customer_id, created_at desc);
create unique index if not exists delivery_quotes_order_unique
  on public.delivery_quotes(order_id) where order_id is not null;

alter table public.delivery_quotes enable row level security;
revoke all on public.delivery_quotes from anon, authenticated;
grant select on public.delivery_quotes to authenticated;

drop policy if exists "delivery_quotes_select_own_or_staff" on public.delivery_quotes;
create policy "delivery_quotes_select_own_or_staff" on public.delivery_quotes
for select to authenticated
using (
  customer_id = (select auth.uid())
  or (select public.is_shilevi_owner_admin())
  or (select public.has_staff_capability('finance.read'))
);

-- ------------------------------------------------------------------------- quote calculation RPC

create or replace function public.quote_delivery(
  p_pickup_county text,
  p_dropoff_county text,
  p_vehicle_class_code text default null,
  p_package_count integer default 1,
  p_weight_kg numeric default null,
  p_length_cm integer default null,
  p_width_cm integer default null,
  p_height_cm integer default null,
  p_fragile boolean default false,
  p_requires_covered boolean default false,
  p_temperature_controlled boolean default false
) returns table (
  quote_id uuid,
  currency char(3),
  total_minor bigint,
  platform_fee_minor bigint,
  rider_fee_minor bigint,
  expires_at timestamptz,
  pricing_rule_slug text,
  pricing_rule_version integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer uuid := auth.uid();
  v_rule record;
  v_class record;
  v_pickup text := trim(coalesce(p_pickup_county, ''));
  v_dropoff text := trim(coalesce(p_dropoff_county, ''));
  v_packages integer := coalesce(p_package_count, 1);
  v_weight numeric(8, 2) := p_weight_kg;
  v_weight_fee bigint := 0;
  v_package_fee bigint := 0;
  v_handling bigint := 0;
  v_subtotal bigint;
  v_total bigint;
  v_platform bigint;
  v_rider bigint;
  v_quote_id uuid;
  v_expires timestamptz := now() + interval '30 minutes';
begin
  if v_customer is null then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;
  if char_length(v_pickup) < 2 or char_length(v_dropoff) < 2 then
    raise exception 'Choose a pickup and delivery county to price this shipment.' using errcode = '22023';
  end if;
  if v_packages < 1 or v_packages > 20 then
    raise exception 'Package count must be between 1 and 20.' using errcode = '22023';
  end if;
  if v_weight is not null and (v_weight < 0 or v_weight > 60000) then
    raise exception 'Weight must be between 0 and 60000 kg.' using errcode = '22023';
  end if;

  select r.* into v_rule
  from public.delivery_pricing_rules r
  where r.is_active
    and r.effective_from <= now()
    and (r.effective_to is null or r.effective_to > now())
    and (r.pickup_county is null or lower(trim(r.pickup_county)) = lower(v_pickup))
    and (r.dropoff_county is null or lower(trim(r.dropoff_county)) = lower(v_dropoff))
    and (r.vehicle_class_code is null or r.vehicle_class_code = p_vehicle_class_code)
  order by
    ((r.vehicle_class_code is not null)::int + (r.pickup_county is not null)::int + (r.dropoff_county is not null)::int) desc,
    r.effective_from desc,
    r.created_at desc
  limit 1;

  if v_rule.id is null then
    -- Fail closed: no configured price means no quote, never an invented one.
    raise exception 'Delivery is not priced for this route yet. Contact support to arrange it.' using errcode = 'P0002';
  end if;

  if p_vehicle_class_code is not null then
    select c.* into v_class from public.delivery_vehicle_classes c where c.code = p_vehicle_class_code;
    if v_class.code is null or not v_class.is_active then
      raise exception 'That vehicle class is not available.' using errcode = '22023';
    end if;
    if v_weight is not null and v_weight > v_class.max_payload_kg then
      raise exception 'This cargo exceeds the % payload limit.', v_class.label using errcode = '22023';
    end if;
    if p_fragile and not v_class.supports_fragile then
      raise exception 'The % class cannot carry fragile cargo.', v_class.label using errcode = '22023';
    end if;
    if p_requires_covered and not v_class.supports_covered then
      raise exception 'The % class is not covered.', v_class.label using errcode = '22023';
    end if;
    if p_temperature_controlled and not v_class.supports_temperature_controlled then
      raise exception 'The % class cannot keep cargo temperature controlled.', v_class.label using errcode = '22023';
    end if;
  end if;

  if v_weight is not null then
    v_weight_fee := (v_rule.per_kg_minor * ceil(v_weight))::bigint;
  end if;
  v_package_fee := v_rule.per_package_minor * v_packages;
  if coalesce(p_fragile, false) then
    v_handling := v_handling + v_rule.fragile_surcharge_minor;
  end if;
  if coalesce(p_requires_covered, false) then
    v_handling := v_handling + v_rule.covered_surcharge_minor;
  end if;
  if coalesce(p_temperature_controlled, false) then
    v_handling := v_handling + v_rule.temperature_surcharge_minor;
  end if;

  v_subtotal := v_rule.base_fee_minor + v_weight_fee + v_package_fee + v_handling;
  v_total := greatest(v_subtotal, v_rule.min_fee_minor);
  if v_rule.max_fee_minor is not null then
    v_total := least(v_total, v_rule.max_fee_minor);
  end if;
  if v_total <= 0 then
    raise exception 'Delivery is not priced for this route yet. Contact support to arrange it.' using errcode = 'P0002';
  end if;

  v_platform := least(
    (round((v_total::numeric * v_rule.platform_fee_bps / 10000.0) / 100.0) * 100)::bigint,
    v_total
  );
  v_rider := v_total - v_platform;

  insert into public.delivery_quotes (
    customer_id, pickup_county, dropoff_county, vehicle_class_code, package_count, weight_kg,
    length_cm, width_cm, height_cm, fragile, requires_covered, temperature_controlled,
    pricing_rule_id, pricing_rule_version, currency, base_fee_minor, weight_fee_minor,
    package_fee_minor, handling_fee_minor, surge_or_discount_minor, total_minor,
    platform_fee_minor, rider_fee_minor, expires_at
  ) values (
    v_customer, v_pickup, v_dropoff, p_vehicle_class_code, v_packages, v_weight,
    p_length_cm, p_width_cm, p_height_cm, coalesce(p_fragile, false),
    coalesce(p_requires_covered, false), coalesce(p_temperature_controlled, false),
    v_rule.id, v_rule.version, v_rule.currency, v_rule.base_fee_minor, v_weight_fee,
    v_package_fee, v_handling, 0, v_total, v_platform, v_rider, v_expires
  ) returning id into v_quote_id;

  quote_id := v_quote_id;
  currency := v_rule.currency;
  total_minor := v_total;
  platform_fee_minor := v_platform;
  rider_fee_minor := v_rider;
  expires_at := v_expires;
  pricing_rule_slug := v_rule.slug;
  pricing_rule_version := v_rule.version;
  return next;
end;
$$;

revoke all on function public.quote_delivery(text, text, text, integer, numeric, integer, integer, integer, boolean, boolean, boolean) from public, anon;
grant execute on function public.quote_delivery(text, text, text, integer, numeric, integer, integer, integer, boolean, boolean, boolean) to authenticated;

-- ------------------------------------------------------- attach a quote to the customer's order

create or replace function public.attach_delivery_quote_to_order(p_order_id uuid, p_quote_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer uuid := auth.uid();
  v_order record;
  v_quote record;
  v_delivery record;
  v_new_total bigint;
begin
  if v_customer is null then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null or v_order.customer_id <> v_customer then
    raise exception 'Order not found.' using errcode = 'P0002';
  end if;
  if v_order.payment_status <> 'unpaid' or v_order.status <> 'pending_payment' then
    raise exception 'The delivery price can only change before payment.' using errcode = '23514';
  end if;

  select * into v_quote from public.delivery_quotes where id = p_quote_id for update;
  if v_quote.id is null or v_quote.customer_id <> v_customer then
    raise exception 'Delivery quote not found.' using errcode = 'P0002';
  end if;
  if v_quote.status <> 'quoted' or v_quote.order_id is not null then
    raise exception 'This delivery quote has already been used.' using errcode = '23514';
  end if;
  if v_quote.expires_at <= now() then
    update public.delivery_quotes set status = 'expired' where id = p_quote_id and status = 'quoted';
    raise exception 'This delivery quote has expired. Request a new price.' using errcode = '23514';
  end if;

  select * into v_delivery from public.deliveries
  where order_id = p_order_id and status = 'requested'
  order by created_at asc
  limit 1
  for update;
  if v_delivery.id is null then
    raise exception 'This order has no delivery awaiting a price.' using errcode = 'P0002';
  end if;

  -- Refuse to touch an order whose stored arithmetic already disagrees with itself.
  if v_order.total_minor <> v_order.subtotal_minor + v_order.delivery_fee_minor then
    raise exception 'This order total cannot be repriced safely.' using errcode = '23514';
  end if;
  v_new_total := v_order.subtotal_minor + v_quote.total_minor;

  update public.orders
  set delivery_fee_minor = v_quote.total_minor,
      total_minor = v_new_total
  where id = p_order_id;

  update public.deliveries
  set pickup_county = v_quote.pickup_county,
      dropoff_county = v_quote.dropoff_county,
      package_count = v_quote.package_count,
      weight_kg = v_quote.weight_kg,
      length_cm = v_quote.length_cm,
      width_cm = v_quote.width_cm,
      height_cm = v_quote.height_cm,
      fragile = v_quote.fragile,
      requires_covered = v_quote.requires_covered,
      temperature_controlled = v_quote.temperature_controlled,
      required_vehicle_class_code = coalesce(v_quote.vehicle_class_code, required_vehicle_class_code),
      delivery_fee_minor = v_quote.total_minor,
      rider_fee_minor = v_quote.rider_fee_minor,
      platform_fee_minor = v_quote.platform_fee_minor,
      quote_snapshot = jsonb_build_object(
        'quote_id', v_quote.id,
        'pricing_rule_id', v_quote.pricing_rule_id,
        'pricing_rule_version', v_quote.pricing_rule_version,
        'currency', v_quote.currency,
        'base_fee_minor', v_quote.base_fee_minor,
        'weight_fee_minor', v_quote.weight_fee_minor,
        'package_fee_minor', v_quote.package_fee_minor,
        'handling_fee_minor', v_quote.handling_fee_minor,
        'total_minor', v_quote.total_minor,
        'platform_fee_minor', v_quote.platform_fee_minor,
        'rider_fee_minor', v_quote.rider_fee_minor,
        'quoted_at', v_quote.created_at
      )
  where id = v_delivery.id;

  update public.delivery_quotes
  set status = 'consumed', order_id = p_order_id, consumed_at = now()
  where id = p_quote_id;

  insert into public.audit_events (actor_id, action, resource_type, resource_id, metadata)
  values (
    v_customer, 'delivery.quote_attached', 'order', p_order_id::text,
    jsonb_build_object(
      'quote_id', v_quote.id,
      'pricing_rule_id', v_quote.pricing_rule_id,
      'pricing_rule_version', v_quote.pricing_rule_version,
      'total_minor', v_quote.total_minor,
      'currency', v_quote.currency
    )
  );
end;
$$;

revoke all on function public.attach_delivery_quote_to_order(uuid, uuid) from public, anon;
grant execute on function public.attach_delivery_quote_to_order(uuid, uuid) to authenticated;

-- --------------------------------------------------------------- owner pricing administration

create or replace function public.admin_upsert_delivery_pricing_rule(
  p_slug text,
  p_name text,
  p_base_fee_minor bigint,
  p_vehicle_class_code text default null,
  p_pickup_county text default null,
  p_dropoff_county text default null,
  p_per_kg_minor bigint default 0,
  p_per_package_minor bigint default 0,
  p_fragile_surcharge_minor bigint default 0,
  p_covered_surcharge_minor bigint default 0,
  p_temperature_surcharge_minor bigint default 0,
  p_platform_fee_bps integer default 1000,
  p_min_fee_minor bigint default 0,
  p_max_fee_minor bigint default null,
  p_currency text default 'KES'
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_slug text := trim(coalesce(p_slug, ''));
  v_currency text := upper(left(trim(coalesce(p_currency, 'KES')), 3));
begin
  if not public.is_shilevi_owner_admin() then
    raise exception 'Only a verified owner can change delivery pricing.' using errcode = '42501';
  end if;
  if v_slug !~ '^[a-z0-9][a-z0-9-]{2,63}$' then
    raise exception 'Use a lowercase slug of at least 3 characters.' using errcode = '22023';
  end if;
  if p_base_fee_minor is null or p_base_fee_minor < 0 then
    raise exception 'A base fee is required.' using errcode = '22023';
  end if;
  if p_max_fee_minor is not null and p_max_fee_minor < coalesce(p_min_fee_minor, 0) then
    raise exception 'The maximum fee cannot be below the minimum fee.' using errcode = '22023';
  end if;
  if p_vehicle_class_code is not null
    and not exists (select 1 from public.delivery_vehicle_classes where code = p_vehicle_class_code)
  then
    raise exception 'Unknown vehicle class.' using errcode = '22023';
  end if;
  if v_currency !~ '^[A-Z]{3}$' then
    raise exception 'Use a three-letter currency code.' using errcode = '22023';
  end if;

  insert into public.delivery_pricing_rules (
    slug, name, vehicle_class_code, pickup_county, dropoff_county, currency,
    base_fee_minor, per_kg_minor, per_package_minor, fragile_surcharge_minor,
    covered_surcharge_minor, temperature_surcharge_minor, platform_fee_bps,
    min_fee_minor, max_fee_minor, created_by
  ) values (
    v_slug, p_name, p_vehicle_class_code, nullif(trim(coalesce(p_pickup_county, '')), ''),
    nullif(trim(coalesce(p_dropoff_county, '')), ''), v_currency,
    p_base_fee_minor, coalesce(p_per_kg_minor, 0), coalesce(p_per_package_minor, 0),
    coalesce(p_fragile_surcharge_minor, 0), coalesce(p_covered_surcharge_minor, 0),
    coalesce(p_temperature_surcharge_minor, 0), coalesce(p_platform_fee_bps, 1000),
    coalesce(p_min_fee_minor, 0), p_max_fee_minor, auth.uid()
  )
  on conflict (slug) do update
  set name = excluded.name,
      vehicle_class_code = excluded.vehicle_class_code,
      pickup_county = excluded.pickup_county,
      dropoff_county = excluded.dropoff_county,
      currency = excluded.currency,
      base_fee_minor = excluded.base_fee_minor,
      per_kg_minor = excluded.per_kg_minor,
      per_package_minor = excluded.per_package_minor,
      fragile_surcharge_minor = excluded.fragile_surcharge_minor,
      covered_surcharge_minor = excluded.covered_surcharge_minor,
      temperature_surcharge_minor = excluded.temperature_surcharge_minor,
      platform_fee_bps = excluded.platform_fee_bps,
      min_fee_minor = excluded.min_fee_minor,
      max_fee_minor = excluded.max_fee_minor,
      version = public.delivery_pricing_rules.version + 1,
      is_active = true,
      effective_to = null
  returning id into v_id;

  insert into public.audit_events (actor_id, action, resource_type, resource_id, metadata)
  values (
    auth.uid(), 'delivery_pricing_rule.upserted', 'delivery_pricing_rule', v_id::text,
    jsonb_build_object(
      'slug', v_slug,
      'base_fee_minor', p_base_fee_minor,
      'per_kg_minor', p_per_kg_minor,
      'per_package_minor', p_per_package_minor,
      'platform_fee_bps', p_platform_fee_bps,
      'currency', v_currency
    )
  );

  return v_id;
end;
$$;

revoke all on function public.admin_upsert_delivery_pricing_rule(text, text, bigint, text, text, text, bigint, bigint, bigint, bigint, bigint, integer, bigint, bigint, text) from public, anon;
grant execute on function public.admin_upsert_delivery_pricing_rule(text, text, bigint, text, text, text, bigint, bigint, bigint, bigint, bigint, integer, bigint, bigint, text) to authenticated;

create or replace function public.admin_retire_delivery_pricing_rule(p_rule_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_shilevi_owner_admin() then
    raise exception 'Only a verified owner can retire delivery pricing.' using errcode = '42501';
  end if;
  if p_reason is null or char_length(trim(p_reason)) < 5 then
    raise exception 'A retirement reason of at least 5 characters is required.' using errcode = '23514';
  end if;

  update public.delivery_pricing_rules
  set is_active = false,
      effective_to = coalesce(effective_to, now()),
      version = version + 1
  where id = p_rule_id and is_active;
  if not found then
    raise exception 'That pricing rule is not active.' using errcode = 'P0002';
  end if;

  insert into public.audit_events (actor_id, action, resource_type, resource_id, metadata)
  values (
    auth.uid(), 'delivery_pricing_rule.retired', 'delivery_pricing_rule', p_rule_id::text,
    jsonb_build_object('reason', left(trim(p_reason), 500))
  );
end;
$$;

revoke all on function public.admin_retire_delivery_pricing_rule(uuid, text) from public, anon;
grant execute on function public.admin_retire_delivery_pricing_rule(uuid, text) to authenticated;

-- ------------------------------------------------------------------ reconciliation read model

-- One row per payout with its gross, 10% commission, net and the ledger totals, so finance can
-- reconcile the books against the payout record instead of trusting a page. A function (not a view)
-- so the caller's authorisation runs first and the base table's RLS is never bypassed by accident.
create or replace function public.admin_payout_reconciliation(p_limit integer default 100)
returns table (
  payout_id uuid,
  payee_id uuid,
  payee_role text,
  status text,
  currency char(3),
  gross_minor bigint,
  commission_rate_bps integer,
  commission_minor bigint,
  net_minor bigint,
  ledger_commission_minor bigint,
  ledger_reversed_minor bigint,
  commission_applied_at timestamptz,
  commission_reversed_at timestamptz,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.is_shilevi_owner_admin() or public.has_staff_capability('finance.payout')) then
    raise exception 'Payout reconciliation requires finance permission.' using errcode = '42501';
  end if;

  return query
  select
    p.id,
    p.payee_id,
    p.payee_role,
    p.status,
    p.currency,
    p.amount_minor,
    p.commission_rate_bps,
    p.commission_minor,
    p.net_minor,
    coalesce((
      select sum(l.debit_minor)::bigint from public.ledger_entries l
      where l.payout_id = p.id and l.entry_type = 'commission' and l.account = 'rider_payable'
    ), 0::bigint),
    coalesce((
      select sum(l.credit_minor)::bigint from public.ledger_entries l
      where l.payout_id = p.id and l.entry_type = 'adjustment' and l.account = 'rider_payable'
    ), 0::bigint),
    p.commission_applied_at,
    p.commission_reversed_at,
    p.created_at
  from public.payouts p
  order by p.created_at desc
  limit greatest(least(coalesce(p_limit, 100), 500), 1);
end;
$$;

revoke all on function public.admin_payout_reconciliation(integer) from public, anon;
grant execute on function public.admin_payout_reconciliation(integer) to authenticated;

commit;
