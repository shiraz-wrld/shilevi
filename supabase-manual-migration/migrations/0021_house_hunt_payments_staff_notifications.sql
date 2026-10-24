-- Shilevi migration 0021: House Hunt, verified payment intents, staff capabilities, notification outbox.
-- Review and run manually after 0020. This file does not touch a live project.
--
-- House Hunt rules implemented here
--   * Browsing and searching are free. Public rows never contain the exact address or phone number.
--   * Revealing the landlord's contact and exact address costs a platform fee (default KSh 20),
--     paid to Shilevi, not to the landlord.
--   * Access is granted only after a payment intent is confirmed by a trusted server path. A browser
--     cannot unlock a property by writing a row, guessing a URL, or hiding a field with CSS.
--   * A successful unlock is idempotent per user and property, so a repeated callback cannot charge
--     twice or create a second entitlement.
begin;

-- ---------------------------------------------------------------- House Hunt data

create table if not exists public.property_listings (
  listing_id uuid primary key references public.listings(id) on delete cascade,
  county text not null,
  city text not null,
  neighbourhood text,
  property_type text not null check (property_type in (
    'apartment','house','bungalow','bedsitter','studio','townhouse','shop','office','warehouse','land','venue'
  )),
  bedrooms integer check (bedrooms is null or bedrooms between 0 and 50),
  bathrooms integer check (bathrooms is null or bathrooms between 0 and 50),
  rent_minor bigint not null check (rent_minor between 0 and 100000000),
  deposit_minor bigint not null default 0 check (deposit_minor between 0 and 100000000),
  is_vacant boolean not null default true,
  available_from date,
  amenities text[] not null default '{}'::text[],
  verification_status text not null default 'pending'
    check (verification_status in ('pending','verified','rejected','suspended')),
  verification_note text,
  verified_at timestamptz,
  verified_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint property_county_size check (char_length(trim(county)) between 2 and 80),
  constraint property_city_size check (char_length(trim(city)) between 2 and 80),
  constraint property_neighbourhood_size check (neighbourhood is null or char_length(neighbourhood) <= 120)
);

create index if not exists property_listings_public_idx
  on public.property_listings(county, city, rent_minor) where is_vacant = true;
create index if not exists property_listings_verification_idx
  on public.property_listings(verification_status, created_at desc);

drop trigger if exists property_listings_set_updated_at on public.property_listings;
create trigger property_listings_set_updated_at before update on public.property_listings
for each row execute function public.set_updated_at();

-- Restricted contact data. It is deliberately a separate table so a public listing query cannot
-- accidentally select it, and so RLS can restrict it independently of the public record.
create table if not exists public.property_contacts (
  listing_id uuid primary key references public.listings(id) on delete cascade,
  exact_address text not null,
  unit_number text,
  contact_name text not null,
  contact_phone text not null,
  contact_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint property_exact_address_size check (char_length(exact_address) between 3 and 500),
  constraint property_contact_name_size check (char_length(contact_name) between 1 and 120),
  constraint property_contact_phone_size check (char_length(contact_phone) between 7 and 32)
);

drop trigger if exists property_contacts_set_updated_at on public.property_contacts;
create trigger property_contacts_set_updated_at before update on public.property_contacts
for each row execute function public.set_updated_at();

create table if not exists public.property_verification_documents (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  storage_path text not null,
  document_type text not null,
  uploaded_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint property_document_type_size check (char_length(document_type) between 1 and 80),
  constraint property_document_path_size check (char_length(storage_path) between 1 and 500)
);

create index if not exists property_documents_listing_idx
  on public.property_verification_documents(listing_id, created_at desc);

create table if not exists public.property_contact_unlocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  listing_id uuid not null references public.listings(id) on delete cascade,
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null default 'KES' check (currency ~ '^[A-Z]{3}$'),
  provider text not null,
  payment_reference text not null unique,
  status text not null default 'paid' check (status in ('paid','refunded','revoked')),
  paid_at timestamptz not null default now(),
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists property_unlock_user_listing_unique
  on public.property_contact_unlocks(user_id, listing_id) where status = 'paid';
create index if not exists property_unlock_listing_idx
  on public.property_contact_unlocks(listing_id, created_at desc);

-- ---------------------------------------------------------------- payment intents

create table if not exists public.payment_intents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  purpose text not null check (purpose in ('order','ride','property_contact')),
  order_id uuid references public.orders(id) on delete cascade,
  ride_id uuid references public.rides(id) on delete cascade,
  listing_id uuid references public.listings(id) on delete cascade,
  provider text not null check (provider in ('mock','mpesa','card')),
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null default 'KES' check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'created'
    check (status in ('created','pending','succeeded','failed','cancelled','expired')),
  provider_reference text unique,
  checkout_request_id text unique,
  idempotency_key text unique,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_intent_target check (
    (purpose = 'order' and order_id is not null and ride_id is null and listing_id is null)
    or (purpose = 'ride' and ride_id is not null and order_id is null and listing_id is null)
    or (purpose = 'property_contact' and listing_id is not null and order_id is null and ride_id is null)
  )
);

create index if not exists payment_intents_user_idx on public.payment_intents(user_id, created_at desc);
create index if not exists payment_intents_status_idx on public.payment_intents(status, created_at);
create unique index if not exists payment_intents_live_property_unique
  on public.payment_intents(user_id, listing_id)
  where purpose = 'property_contact' and status in ('created','pending');

drop trigger if exists payment_intents_set_updated_at on public.payment_intents;
create trigger payment_intents_set_updated_at before update on public.payment_intents
for each row execute function public.set_updated_at();

-- Attach property unlock entries to the shared ledger. Every financial event now points at exactly
-- one subject: an order, a ride, a platform fee unlock, or a payout settlement.
alter table public.ledger_entries
  add column if not exists property_unlock_id uuid references public.property_contact_unlocks(id) on delete cascade;

alter table public.ledger_entries drop constraint if exists ledger_entries_entry_type_check;
alter table public.ledger_entries add constraint ledger_entries_entry_type_check check (entry_type in (
  'customer_charge','commission','provider_payable','delivery_split','refund','adjustment',
  'ride_charge','ride_commission','ride_payout','payout','property_unlock'
));

alter table public.ledger_entries drop constraint if exists ledger_entry_subject;
alter table public.ledger_entries add constraint ledger_entry_subject check (
  (order_id is not null)::int + (ride_id is not null)::int
  + (payout_id is not null)::int + (property_unlock_id is not null)::int = 1
);

alter table public.platform_settings
  drop constraint if exists platform_settings_property_fee_positive;

insert into public.platform_settings (key, value) values
  ('property_contact_fee_minor', '2000'::jsonb),
  ('property_contact_access_days', '90'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------------- staff capabilities

create table if not exists public.staff_capabilities (
  user_id uuid not null references auth.users(id) on delete cascade,
  capability text not null check (capability in (
    'applications.review','listings.moderate','orders.read','rides.manage','properties.verify',
    'finance.read','finance.payout','users.suspend','settings.manage','audit.read','staff.manage'
  )),
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (user_id, capability)
);

alter table public.staff_capabilities enable row level security;
revoke all on public.staff_capabilities from anon, authenticated;
grant select on public.staff_capabilities to authenticated;

drop policy if exists "staff_capabilities_select_self_or_owner" on public.staff_capabilities;
create policy "staff_capabilities_select_self_or_owner" on public.staff_capabilities
for select to authenticated
using (user_id = (select auth.uid()) or (select public.is_shilevi_owner_admin()));

-- No client write policy: grants and revocations are performed by a trusted server path only.

create or replace function public.has_staff_capability(p_capability text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_shilevi_owner_admin()
    or (
      coalesce((select auth.jwt() ->> 'aal'), 'aal1') = 'aal2'
      and exists (
        select 1 from public.staff_capabilities sc
        where sc.user_id = auth.uid()
          and sc.capability = p_capability
          and sc.revoked_at is null
          and exists (
            select 1 from auth.users u
            where u.id = sc.user_id and u.email_confirmed_at is not null
          )
      )
    );
$$;
revoke all on function public.has_staff_capability(text) from public, anon;
grant execute on function public.has_staff_capability(text) to authenticated;

-- Staff with rides.manage can read every ride. Recreated here because the staff table does not
-- exist when migration 0020 defines the original predicate.
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
      and (r.customer_id = auth.uid() or r.rider_id = auth.uid()
        or public.has_staff_capability('rides.manage'))
  );
$$;
revoke all on function public.is_ride_participant(uuid) from public, anon;
grant execute on function public.is_ride_participant(uuid) to authenticated;

-- Owner-only staff administration. Capabilities are granted to a confirmed account by email; the
-- caller cannot grant themselves a capability through the browser because the function checks the
-- owner allowlist and MFA at the database level.
create or replace function public.admin_grant_staff_capability(
  p_email text,
  p_capability text,
  p_grant boolean
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  if not public.is_shilevi_owner_admin() then
    raise exception 'Not authorized.';
  end if;
  if p_capability not in (
    'applications.review','listings.moderate','orders.read','rides.manage','properties.verify',
    'finance.read','finance.payout','users.suspend','settings.manage','audit.read','staff.manage'
  ) then
    raise exception 'Unknown capability.';
  end if;

  select u.id into v_user from auth.users u
  where lower(trim(u.email)) = lower(trim(p_email)) and u.email_confirmed_at is not null;
  if v_user is null then
    raise exception 'No confirmed account uses that email address.';
  end if;
  if v_user = auth.uid() then
    raise exception 'Owner permissions already cover your own account.';
  end if;

  if p_grant then
    insert into public.staff_capabilities (user_id, capability, granted_by)
    values (v_user, p_capability, auth.uid())
    on conflict (user_id, capability) do update
      set granted_by = auth.uid(), granted_at = now(), revoked_at = null;
  else
    update public.staff_capabilities
    set revoked_at = now()
    where user_id = v_user and capability = p_capability and revoked_at is null;
  end if;

  insert into public.audit_events(actor_id, action, resource_type, resource_id, outcome, metadata)
  values (auth.uid(), case when p_grant then 'staff.grant' else 'staff.revoke' end,
    'staff_capabilities', v_user::text, 'success', jsonb_build_object('capability', p_capability));
end;
$$;
revoke all on function public.admin_grant_staff_capability(text, text, boolean) from public, anon;
grant execute on function public.admin_grant_staff_capability(text, text, boolean) to authenticated;

create or replace function public.admin_list_staff()
returns table (user_id uuid, email text, capability text, granted_at timestamptz, revoked_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_shilevi_owner_admin() then
    raise exception 'Not authorized.';
  end if;
  return query
    select sc.user_id, lower(u.email), sc.capability, sc.granted_at, sc.revoked_at
    from public.staff_capabilities sc
    join auth.users u on u.id = sc.user_id
    order by sc.revoked_at nulls first, lower(u.email), sc.capability;
end;
$$;
revoke all on function public.admin_list_staff() from public, anon;
grant execute on function public.admin_list_staff() to authenticated;

-- ---------------------------------------------------------------- notification outbox

create table if not exists public.notification_outbox (
  id bigserial primary key,
  user_id uuid references auth.users(id) on delete cascade,
  channel text not null default 'email' check (channel in ('email','sms','push')),
  template text not null,
  recipient text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued','sending','sent','failed','skipped')),
  attempts integer not null default 0 check (attempts between 0 and 20),
  last_error text,
  next_attempt_at timestamptz not null default now(),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notification_template_size check (char_length(template) between 1 and 80)
);

create index if not exists notification_outbox_queue_idx
  on public.notification_outbox(status, next_attempt_at) where status in ('queued','failed');
create index if not exists notification_outbox_user_idx
  on public.notification_outbox(user_id, created_at desc);

alter table public.notification_outbox enable row level security;
revoke all on public.notification_outbox from anon, authenticated;
grant select on public.notification_outbox to authenticated;

drop policy if exists "notification_outbox_select_owner" on public.notification_outbox;
create policy "notification_outbox_select_owner" on public.notification_outbox
for select to authenticated using ((select public.is_shilevi_owner_admin()));

-- Internal enqueue helper. Payloads deliberately carry identifiers and statuses only; never phone
-- numbers, addresses, identity documents or payment credentials.
create or replace function public.enqueue_notification(
  p_user_id uuid,
  p_template text,
  p_payload jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
begin
  if p_user_id is null then
    return;
  end if;

  select lower(trim(u.email)) into v_email from auth.users u where u.id = p_user_id;
  if v_email is null then
    insert into public.notification_outbox (user_id, channel, template, payload, status)
    values (p_user_id, 'email', left(p_template, 80), coalesce(p_payload, '{}'::jsonb), 'skipped');
    return;
  end if;

  insert into public.notification_outbox (user_id, channel, template, recipient, payload)
  values (p_user_id, 'email', left(p_template, 80), v_email, coalesce(p_payload, '{}'::jsonb));
end;
$$;
revoke all on function public.enqueue_notification(uuid, text, jsonb) from public, anon, authenticated;

create or replace function public.notify_provider_application_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status and new.status in ('approved','rejected','under_review','suspended') then
    perform public.enqueue_notification(
      new.user_id, 'application_status',
      jsonb_build_object('application_id', new.id, 'activity_type', new.activity_type, 'status', new.status)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists provider_applications_enqueue_notification on public.provider_applications;
create trigger provider_applications_enqueue_notification
after update of status on public.provider_applications
for each row execute function public.notify_provider_application_status();

create or replace function public.notify_ride_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    perform public.enqueue_notification(
      new.customer_id, 'ride_status',
      jsonb_build_object('ride_id', new.id, 'ride_number', new.ride_number, 'status', new.status)
    );
    perform public.enqueue_notification(
      new.rider_id, 'ride_status',
      jsonb_build_object('ride_id', new.id, 'ride_number', new.ride_number, 'status', new.status)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists rides_enqueue_notification on public.rides;
create trigger rides_enqueue_notification
after update of status on public.rides
for each row execute function public.notify_ride_status();

create or replace function public.notify_payout_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    perform public.enqueue_notification(
      new.payee_id, 'payout_status',
      jsonb_build_object('payout_id', new.id, 'status', new.status)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists payouts_enqueue_notification on public.payouts;
create trigger payouts_enqueue_notification
after update of status on public.payouts
for each row execute function public.notify_payout_status();

-- ---------------------------------------------------------------- RLS

alter table public.property_listings enable row level security;
alter table public.property_contacts enable row level security;
alter table public.property_verification_documents enable row level security;
alter table public.property_contact_unlocks enable row level security;
alter table public.payment_intents enable row level security;

revoke all on public.property_listings, public.property_contacts, public.property_verification_documents,
  public.property_contact_unlocks, public.payment_intents from anon, authenticated;
grant select on public.property_listings to anon, authenticated;
grant select on public.property_contacts, public.property_verification_documents to authenticated;
grant select on public.property_contact_unlocks, public.payment_intents to authenticated;

drop policy if exists "property_listings_read_published" on public.property_listings;
create policy "property_listings_read_published" on public.property_listings
for select to anon, authenticated
using (
  exists (
    select 1 from public.listings l
    where l.id = property_listings.listing_id and l.status = 'published'
  )
  or exists (
    select 1 from public.listings l
    where l.id = property_listings.listing_id and l.owner_id = (select auth.uid())
  )
  or (select public.is_shilevi_owner_admin())
  or (select public.has_staff_capability('properties.verify'))
);

-- Only the owner, a properties.verify staff member, or the listing owner can read contacts directly.
drop policy if exists "property_contacts_read_owner" on public.property_contacts;
create policy "property_contacts_read_owner" on public.property_contacts
for select to authenticated
using (
  exists (
    select 1 from public.listings l
    where l.id = property_contacts.listing_id and l.owner_id = (select auth.uid())
  )
  or (select public.is_shilevi_owner_admin())
  or (select public.has_staff_capability('properties.verify'))
);

drop policy if exists "property_documents_read_owner" on public.property_verification_documents;
create policy "property_documents_read_owner" on public.property_verification_documents
for select to authenticated
using (
  uploaded_by = (select auth.uid())
  or exists (
    select 1 from public.listings l
    where l.id = property_verification_documents.listing_id and l.owner_id = (select auth.uid())
  )
  or (select public.is_shilevi_owner_admin())
  or (select public.has_staff_capability('properties.verify'))
);

drop policy if exists "property_unlocks_read_own" on public.property_contact_unlocks;
create policy "property_unlocks_read_own" on public.property_contact_unlocks
for select to authenticated
using (user_id = (select auth.uid()) or (select public.is_shilevi_owner_admin())
  or (select public.has_staff_capability('properties.verify'))
  or (select public.has_staff_capability('finance.read')));

drop policy if exists "payment_intents_read_own" on public.payment_intents;
create policy "payment_intents_read_own" on public.payment_intents
for select to authenticated
using (user_id = (select auth.uid()) or (select public.is_shilevi_owner_admin())
  or (select public.has_staff_capability('finance.read')));

-- Owner reconciliation reads. Ledger and provider events stay read-only; no client may write them.
grant select on public.ledger_entries, public.payment_events to authenticated;

drop policy if exists "ledger_entries_select_owner" on public.ledger_entries;
create policy "ledger_entries_select_owner" on public.ledger_entries
for select to authenticated using ((select public.is_shilevi_owner_admin())
  or (select public.has_staff_capability('finance.read')));

drop policy if exists "payment_events_select_owner" on public.payment_events;
create policy "payment_events_select_owner" on public.payment_events
for select to authenticated using ((select public.is_shilevi_owner_admin())
  or (select public.has_staff_capability('finance.read')));

-- Staff reads that back the scoped admin screens. Write access remains owner-only.
drop policy if exists "transport_vehicles_select_own_or_admin" on public.transport_vehicles;
create policy "transport_vehicles_select_own_or_admin" on public.transport_vehicles
for select to authenticated
using (user_id = (select auth.uid()) or (select public.is_shilevi_owner_admin())
  or (select public.has_staff_capability('rides.manage')));

drop policy if exists "payouts_select_staff" on public.payouts;
create policy "payouts_select_staff" on public.payouts
for select to authenticated using (
  (select public.has_staff_capability('finance.read'))
  or (select public.has_staff_capability('finance.payout'))
);

drop policy if exists "orders_select_staff" on public.orders;
create policy "orders_select_staff" on public.orders
for select to authenticated using ((select public.has_staff_capability('orders.read')));

drop policy if exists "order_items_select_staff" on public.order_items;
create policy "order_items_select_staff" on public.order_items
for select to authenticated using ((select public.has_staff_capability('orders.read')));

drop policy if exists "audit_events_select_staff" on public.audit_events;
create policy "audit_events_select_staff" on public.audit_events
for select to authenticated using ((select public.has_staff_capability('audit.read')));

revoke insert, update, delete on public.ledger_entries, public.payment_events from anon, authenticated;

-- ---------------------------------------------------------------- House Hunt RPCs

create or replace function public.save_property_details(p_listing_id uuid, p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_listing record;
  v_rent bigint;
  v_deposit bigint;
  v_phone text;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.';
  end if;

  select l.*, c.division into v_listing
  from public.listings l
  join public.marketplace_categories c on c.id = l.category_id
  where l.id = p_listing_id and l.owner_id = auth.uid();

  if v_listing.id is null then
    raise exception 'Listing not found.';
  end if;
  if v_listing.division <> 'property_places' then
    raise exception 'This listing is not in the property division.';
  end if;

  v_rent := coalesce((p_payload ->> 'rent_minor')::bigint, 0);
  v_deposit := coalesce((p_payload ->> 'deposit_minor')::bigint, 0);
  v_phone := trim(coalesce(p_payload ->> 'contact_phone', ''));

  if char_length(trim(coalesce(p_payload ->> 'county', ''))) < 2
    or char_length(trim(coalesce(p_payload ->> 'city', ''))) < 2 then
    raise exception 'County and town or city are required.';
  end if;
  if (p_payload ->> 'property_type') not in (
    'apartment','house','bungalow','bedsitter','studio','townhouse','shop','office','warehouse','land','venue'
  ) then
    raise exception 'Choose a supported property type.';
  end if;
  if v_rent < 0 or v_rent > 100000000 or v_deposit < 0 or v_deposit > 100000000 then
    raise exception 'Rent and deposit must be between KSh 0 and KSh 1,000,000.';
  end if;
  if char_length(trim(coalesce(p_payload ->> 'exact_address', ''))) < 3 then
    raise exception 'The exact address is required for verified contact access.';
  end if;
  if char_length(v_phone) < 7 or char_length(v_phone) > 32 then
    raise exception 'Enter a valid contact phone number.';
  end if;

  insert into public.property_listings (
    listing_id, county, city, neighbourhood, property_type, bedrooms, bathrooms,
    rent_minor, deposit_minor, is_vacant, available_from, amenities
  ) values (
    p_listing_id,
    left(trim(p_payload ->> 'county'), 80),
    left(trim(p_payload ->> 'city'), 80),
    nullif(left(trim(coalesce(p_payload ->> 'neighbourhood', '')), 120), ''),
    p_payload ->> 'property_type',
    nullif(p_payload ->> 'bedrooms', '')::integer,
    nullif(p_payload ->> 'bathrooms', '')::integer,
    v_rent, v_deposit,
    coalesce((p_payload ->> 'is_vacant')::boolean, true),
    nullif(p_payload ->> 'available_from', '')::date,
    coalesce(
      (select array_agg(left(value, 40)) from jsonb_array_elements_text(coalesce(p_payload -> 'amenities', '[]'::jsonb))),
      '{}'::text[]
    )
  )
  on conflict (listing_id) do update set
    county = excluded.county,
    city = excluded.city,
    neighbourhood = excluded.neighbourhood,
    property_type = excluded.property_type,
    bedrooms = excluded.bedrooms,
    bathrooms = excluded.bathrooms,
    rent_minor = excluded.rent_minor,
    deposit_minor = excluded.deposit_minor,
    is_vacant = excluded.is_vacant,
    available_from = excluded.available_from,
    amenities = excluded.amenities,
    verification_status = 'pending',
    verified_at = null,
    verified_by = null,
    updated_at = now();

  insert into public.property_contacts (
    listing_id, exact_address, unit_number, contact_name, contact_phone, contact_email
  ) values (
    p_listing_id,
    left(trim(p_payload ->> 'exact_address'), 500),
    nullif(left(trim(coalesce(p_payload ->> 'unit_number', '')), 60), ''),
    left(trim(coalesce(p_payload ->> 'contact_name', '')), 120),
    v_phone,
    nullif(lower(left(trim(coalesce(p_payload ->> 'contact_email', '')), 200)), '')
  )
  on conflict (listing_id) do update set
    exact_address = excluded.exact_address,
    unit_number = excluded.unit_number,
    contact_name = excluded.contact_name,
    contact_phone = excluded.contact_phone,
    contact_email = excluded.contact_email,
    updated_at = now();
end;
$$;
revoke all on function public.save_property_details(uuid, jsonb) from public, anon;
grant execute on function public.save_property_details(uuid, jsonb) to authenticated;

create or replace function public.set_property_vacancy(p_listing_id uuid, p_vacant boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in required.';
  end if;

  update public.property_listings pl
  set is_vacant = p_vacant
  where pl.listing_id = p_listing_id
    and exists (
      select 1 from public.listings l where l.id = pl.listing_id and l.owner_id = auth.uid()
    );

  if not found then
    raise exception 'Property not found.';
  end if;
end;
$$;
revoke all on function public.set_property_vacancy(uuid, boolean) from public, anon;
grant execute on function public.set_property_vacancy(uuid, boolean) to authenticated;

-- Providers cannot publish their own listing. They submit a complete draft for review; an owner
-- verifies the evidence and publishes it. This keeps moderation server-side.
create or replace function public.submit_property_listing(p_listing_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in required.';
  end if;

  if not exists (
    select 1 from public.listings l
    where l.id = p_listing_id and l.owner_id = auth.uid() and l.status = 'draft'
  ) then
    raise exception 'Draft listing not found.';
  end if;
  if not exists (select 1 from public.property_listings pl where pl.listing_id = p_listing_id)
    or not exists (select 1 from public.property_contacts pc where pc.listing_id = p_listing_id) then
    raise exception 'Save the property details and contact record before submitting.';
  end if;

  update public.listings set status = 'pending_review'
  where id = p_listing_id and owner_id = auth.uid() and status = 'draft';

  insert into public.audit_events(actor_id, action, resource_type, resource_id, outcome, metadata)
  values (auth.uid(), 'property.submit', 'listings', p_listing_id::text, 'success', '{}'::jsonb);
end;
$$;
revoke all on function public.submit_property_listing(uuid) from public, anon;
grant execute on function public.submit_property_listing(uuid) to authenticated;

create or replace function public.admin_verify_property(
  p_listing_id uuid,
  p_approve boolean,
  p_note text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_staff_capability('properties.verify') then
    raise exception 'Not authorized.';
  end if;

  update public.property_listings
  set verification_status = case when p_approve then 'verified' else 'rejected' end,
      verification_note = left(coalesce(p_note, ''), 1000),
      verified_at = now(),
      verified_by = auth.uid()
  where listing_id = p_listing_id;

  if not found then
    raise exception 'Property not found.';
  end if;

  perform public.enqueue_notification(
    (select owner_id from public.listings where id = p_listing_id),
    'property_verification',
    jsonb_build_object('listing_id', p_listing_id, 'approved', p_approve)
  );

  insert into public.audit_events(actor_id, action, resource_type, resource_id, outcome, metadata)
  values (auth.uid(), 'property.verify', 'property_listings', p_listing_id::text, 'success',
    jsonb_build_object('approved', p_approve));
end;
$$;
revoke all on function public.admin_verify_property(uuid, boolean, text) from public, anon;
grant execute on function public.admin_verify_property(uuid, boolean, text) to authenticated;

-- A property cannot be published without its public details and protected contact record.
create or replace function public.enforce_property_on_publish()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_division text;
begin
  if new.status = 'published' then
    select c.division into v_division
    from public.marketplace_categories c where c.id = new.category_id;

    if v_division = 'property_places' then
      if not exists (select 1 from public.property_listings pl where pl.listing_id = new.id)
        or not exists (select 1 from public.property_contacts pc where pc.listing_id = new.id) then
        raise exception 'Property details and a contact record are required before publishing.';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists listings_enforce_property_on_publish on public.listings;
create trigger listings_enforce_property_on_publish
before insert or update of status on public.listings
for each row execute function public.enforce_property_on_publish();

-- Free public search. Returns only public columns: area, rent, deposit, type, vacancy and amenities.
-- The exact address and contact are never part of this result.
create or replace function public.search_public_properties(
  p_county text default null,
  p_city text default null,
  p_max_rent_minor bigint default null,
  p_min_bedrooms integer default null,
  p_limit integer default 30
) returns table (
  listing_id uuid,
  title text,
  description text,
  county text,
  city text,
  neighbourhood text,
  property_type text,
  bedrooms integer,
  bathrooms integer,
  rent_minor bigint,
  deposit_minor bigint,
  is_vacant boolean,
  amenities text[],
  verification_status text,
  cover_image_url text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    l.id, l.title, l.description, pl.county, pl.city, pl.neighbourhood, pl.property_type,
    pl.bedrooms, pl.bathrooms, pl.rent_minor, pl.deposit_minor, pl.is_vacant, pl.amenities,
    pl.verification_status,
    nullif(l.attributes ->> 'cover_image_url', '')
  from public.listings l
  join public.property_listings pl on pl.listing_id = l.id
  where l.status = 'published'
    and (p_county is null or lower(pl.county) = lower(trim(p_county)))
    and (p_city is null or lower(pl.city) = lower(trim(p_city)))
    and (p_max_rent_minor is null or pl.rent_minor <= p_max_rent_minor)
    and (p_min_bedrooms is null or coalesce(pl.bedrooms, 0) >= p_min_bedrooms)
  order by (pl.verification_status = 'verified') desc, l.published_at desc nulls last
  limit greatest(1, least(coalesce(p_limit, 30), 60));
$$;
revoke all on function public.search_public_properties(text, text, bigint, integer, integer) from public;
grant execute on function public.search_public_properties(text, text, bigint, integer, integer) to anon, authenticated;

create or replace function public.has_property_access(p_listing_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.property_contact_unlocks u
    where u.user_id = auth.uid()
      and u.listing_id = p_listing_id
      and u.status = 'paid'
      and (u.expires_at is null or u.expires_at > now())
  );
$$;
revoke all on function public.has_property_access(uuid) from public, anon;
grant execute on function public.has_property_access(uuid) to authenticated;

create or replace function public.create_property_contact_intent()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fee bigint;
  v_mode text;
  v_intent record;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.';
  end if;

  select (value #>> '{}')::bigint into v_fee
  from public.platform_settings where key = 'property_contact_fee_minor';
  v_fee := coalesce(v_fee, 2000);

  select (value #>> '{}') into v_mode from public.platform_settings where key = 'payment_mode';

  return jsonb_build_object('amount_minor', v_fee, 'provider', case when v_mode = 'mock' then 'mock' else 'mpesa' end, 'payment_mode', coalesce(v_mode, 'mock'));
end;
$$;
revoke all on function public.create_property_contact_intent() from public, anon;
grant execute on function public.create_property_contact_intent() to authenticated;

-- Public price display. The fee itself is never accepted from a browser request.
create or replace function public.get_property_contact_fee()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select (value #>> '{}')::bigint from public.platform_settings where key = 'property_contact_fee_minor'),
    2000
  );
$$;
revoke all on function public.get_property_contact_fee() from public;
grant execute on function public.get_property_contact_fee() to anon, authenticated;

-- Creates (or reuses) the real payment intent for a House Hunt unlock. The amount always comes
-- from platform settings, never from the request body.
create or replace function public.create_property_payment_intent(p_listing_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fee bigint;
  v_mode text;
  v_intent record;
  v_listing record;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.';
  end if;

  select l.id, l.status into v_listing
  from public.listings l
  join public.property_listings pl on pl.listing_id = l.id
  where l.id = p_listing_id;

  if v_listing.id is null or v_listing.status <> 'published' then
    raise exception 'Property listing not found.';
  end if;
  if public.has_property_access(p_listing_id) then
    raise exception 'You already have contact access to this property.';
  end if;

  select * into v_intent from public.payment_intents
  where user_id = auth.uid() and listing_id = p_listing_id
    and purpose = 'property_contact' and status in ('created','pending')
  order by created_at desc limit 1;

  if v_intent.id is not null then
    return jsonb_build_object('intent_id', v_intent.id, 'amount_minor', v_intent.amount_minor, 'provider', v_intent.provider, 'reused', true);
  end if;

  select (value #>> '{}')::bigint into v_fee
  from public.platform_settings where key = 'property_contact_fee_minor';
  v_fee := coalesce(v_fee, 2000);
  select (value #>> '{}') into v_mode from public.platform_settings where key = 'payment_mode';

  insert into public.payment_intents (user_id, purpose, listing_id, provider, amount_minor, status)
  values (auth.uid(), 'property_contact', p_listing_id,
    case when v_mode = 'mock' then 'mock' else 'mpesa' end, v_fee, 'created')
  returning id into v_intent.id;

  return jsonb_build_object('intent_id', v_intent.id, 'amount_minor', v_fee,
    'provider', case when v_mode = 'mock' then 'mock' else 'mpesa' end, 'reused', false);
end;
$$;
revoke all on function public.create_property_payment_intent(uuid) from public, anon;
grant execute on function public.create_property_payment_intent(uuid) to authenticated;

-- Internal completion. Called by the sandbox RPC and by the server-verified provider callback.
create or replace function public.complete_property_unlock(
  p_intent_id uuid,
  p_provider_reference text,
  p_provider text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intent record;
  v_unlock_id uuid;
  v_days integer;
  v_expires timestamptz;
begin
  select * into v_intent from public.payment_intents where id = p_intent_id for update;
  if v_intent.id is null then
    raise exception 'Payment intent not found.';
  end if;
  if v_intent.purpose <> 'property_contact' then
    raise exception 'This intent is not a property contact payment.';
  end if;
  if v_intent.status = 'succeeded' then
    select id into v_unlock_id from public.property_contact_unlocks
    where user_id = v_intent.user_id and listing_id = v_intent.listing_id and status = 'paid';
    return v_unlock_id;
  end if;
  if v_intent.status not in ('created','pending') then
    raise exception 'This payment cannot be completed.';
  end if;

  select coalesce((value #>> '{}')::integer, 90) into v_days
  from public.platform_settings where key = 'property_contact_access_days';
  v_expires := now() + make_interval(days => greatest(1, least(coalesce(v_days, 90), 365)));

  insert into public.property_contact_unlocks (
    user_id, listing_id, amount_minor, currency, provider, payment_reference, status, paid_at, expires_at
  ) values (
    v_intent.user_id, v_intent.listing_id, v_intent.amount_minor, v_intent.currency,
    p_provider, p_provider_reference, 'paid', now(), v_expires
  )
  on conflict (user_id, listing_id) where status = 'paid' do nothing
  returning id into v_unlock_id;

  if v_unlock_id is null then
    select id into v_unlock_id from public.property_contact_unlocks
    where user_id = v_intent.user_id and listing_id = v_intent.listing_id and status = 'paid';
  end if;

  update public.payment_intents
  set status = 'succeeded', provider = p_provider,
      provider_reference = coalesce(provider_reference, p_provider_reference),
      metadata = metadata || jsonb_build_object('confirmed_at', now())
  where id = p_intent_id;

  -- Platform revenue, not landlord income. Balanced double entry.
  insert into public.ledger_entries (
    property_unlock_id, entry_type, account, party_id, debit_minor, credit_minor, currency, reference
  ) values
    (v_unlock_id, 'property_unlock', 'customer', v_intent.user_id, v_intent.amount_minor, 0, v_intent.currency, p_provider_reference),
    (v_unlock_id, 'property_unlock', 'settlement', null, 0, v_intent.amount_minor, v_intent.currency, p_provider_reference),
    (v_unlock_id, 'property_unlock', 'settlement', null, v_intent.amount_minor, 0, v_intent.currency, p_provider_reference),
    (v_unlock_id, 'property_unlock', 'platform_commission', null, 0, v_intent.amount_minor, v_intent.currency, p_provider_reference);

  return v_unlock_id;
end;
$$;
revoke all on function public.complete_property_unlock(uuid, text, text) from public, anon, authenticated;
grant execute on function public.complete_property_unlock(uuid, text, text) to service_role;

create or replace function public.confirm_mock_property_unlock(p_listing_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mode text;
  v_listing record;
  v_fee bigint;
  v_intent_id uuid;
  v_reference text;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.';
  end if;

  select (value #>> '{}') into v_mode from public.platform_settings where key = 'payment_mode';
  if v_mode is distinct from 'mock' then
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

create or replace function public.get_property_contact(p_listing_id uuid)
returns table (
  exact_address text,
  unit_number text,
  contact_name text,
  contact_phone text,
  contact_email text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in required.';
  end if;
  if not public.has_property_access(p_listing_id) then
    raise exception 'Contact access has not been purchased for this property.';
  end if;

  return query
    select pc.exact_address, pc.unit_number, pc.contact_name, pc.contact_phone, pc.contact_email,
      (select u.expires_at from public.property_contact_unlocks u
       where u.user_id = auth.uid() and u.listing_id = p_listing_id and u.status = 'paid'
       order by u.paid_at desc limit 1)
    from public.property_contacts pc
    where pc.listing_id = p_listing_id;
end;
$$;
revoke all on function public.get_property_contact(uuid) from public, anon;
grant execute on function public.get_property_contact(uuid) to authenticated;

-- ---------------------------------------------------------------- verified provider payments

create or replace function public.create_payment_intent(
  p_purpose text,
  p_target_id uuid,
  p_idempotency_key text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mode text;
  v_intent_id uuid;
  v_amount bigint;
  v_currency char(3) := 'KES';
  v_order record;
  v_ride record;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.';
  end if;

  if p_idempotency_key is not null then
    select id into v_intent_id from public.payment_intents
    where user_id = auth.uid() and idempotency_key = p_idempotency_key;
    if v_intent_id is not null then
      return v_intent_id;
    end if;
  end if;

  select (value #>> '{}') into v_mode from public.platform_settings where key = 'payment_mode';

  if p_purpose = 'order' then
    select * into v_order from public.orders where id = p_target_id;
    if v_order.id is null or v_order.customer_id <> auth.uid() then
      raise exception 'Order not found.';
    end if;
    if v_order.payment_status <> 'unpaid' or v_order.status <> 'pending_payment' then
      raise exception 'This order is not awaiting payment.';
    end if;
    v_amount := v_order.total_minor;
    v_currency := v_order.currency;
  elsif p_purpose = 'ride' then
    select * into v_ride from public.rides where id = p_target_id;
    if v_ride.id is null or v_ride.customer_id <> auth.uid() then
      raise exception 'Ride not found.';
    end if;
    if v_ride.status <> 'agreed' or v_ride.payment_status <> 'unpaid' then
      raise exception 'This ride is not awaiting payment.';
    end if;
    v_amount := v_ride.agreed_fare_minor;
    v_currency := v_ride.currency;
  else
    raise exception 'Unsupported payment purpose.';
  end if;

  if v_amount is null or v_amount <= 0 then
    raise exception 'The amount is not valid.';
  end if;

  insert into public.payment_intents (
    user_id, purpose, order_id, ride_id, provider, amount_minor, currency, status, idempotency_key
  ) values (
    auth.uid(), p_purpose,
    case when p_purpose = 'order' then p_target_id end,
    case when p_purpose = 'ride' then p_target_id end,
    case when v_mode = 'mock' then 'mock' else 'mpesa' end,
    v_amount, v_currency, 'created', nullif(trim(coalesce(p_idempotency_key, '')), '')
  )
  returning id into v_intent_id;

  return v_intent_id;
end;
$$;
revoke all on function public.create_payment_intent(text, uuid, text) from public, anon;
grant execute on function public.create_payment_intent(text, uuid, text) to authenticated;

create or replace function public.attach_payment_provider_reference(
  p_intent_id uuid,
  p_provider_reference text,
  p_checkout_request_id text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in required.';
  end if;

  update public.payment_intents
  set provider_reference = left(trim(p_provider_reference), 140),
      checkout_request_id = nullif(left(trim(coalesce(p_checkout_request_id, '')), 140), ''),
      status = 'pending'
  where id = p_intent_id
    and user_id = auth.uid()
    and status in ('created','pending');

  if not found then
    raise exception 'Payment intent not found.';
  end if;
end;
$$;
revoke all on function public.attach_payment_provider_reference(uuid, text, text) from public, anon;
grant execute on function public.attach_payment_provider_reference(uuid, text, text) to authenticated;

-- Provider-confirmed payment. Callable only by the server with a service-role key after it has
-- verified the provider response and the amount. Browser clients cannot call this.
create or replace function public.confirm_provider_payment(
  p_provider text,
  p_provider_reference text,
  p_amount_minor bigint,
  p_payload jsonb default '{}'::jsonb
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intent record;
begin
  if p_provider not in ('mpesa','card') then
    raise exception 'Unsupported provider.';
  end if;

  select * into v_intent from public.payment_intents
  where provider_reference = p_provider_reference and provider = p_provider
  for update;

  if v_intent.id is null then
    raise exception 'Unknown payment reference.';
  end if;
  if v_intent.status = 'succeeded' then
    return 'already-succeeded';
  end if;
  if v_intent.amount_minor <> p_amount_minor then
    update public.payment_intents set status = 'failed',
      metadata = metadata || jsonb_build_object('failure', 'amount_mismatch')
    where id = v_intent.id;
    raise exception 'Payment amount does not match the intent.';
  end if;

  if v_intent.purpose = 'ride' then
    perform public.mark_ride_paid(v_intent.ride_id, p_provider_reference, p_provider);
  elsif v_intent.purpose = 'property_contact' then
    perform public.complete_property_unlock(v_intent.id, p_provider_reference, p_provider);
  elsif v_intent.purpose = 'order' then
    perform public.mark_order_paid(v_intent.order_id, p_provider_reference, p_provider);
  end if;

  update public.payment_intents
  set status = 'succeeded', metadata = metadata || coalesce(p_payload, '{}'::jsonb)
  where id = v_intent.id and status <> 'succeeded';

  return 'succeeded';
end;
$$;
revoke all on function public.confirm_provider_payment(text, text, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.confirm_provider_payment(text, text, bigint, jsonb) to service_role;

-- Provider-path order settlement. The sandbox path remains confirm_mock_payment, which is gated by
-- the payment_mode setting. Both write exactly the same balanced ledger shape.
create or replace function public.mark_order_paid(
  p_order_id uuid,
  p_reference text,
  p_provider text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order record;
  v_provider_net bigint;
  v_rider_fee bigint;
  v_platform_delivery bigint;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null then
    raise exception 'Order not found.';
  end if;
  if v_order.payment_status = 'paid' then
    return;
  end if;
  if v_order.status <> 'pending_payment' or v_order.payment_status <> 'unpaid' then
    raise exception 'This order is not awaiting payment.';
  end if;

  select coalesce(sum(oi.provider_net_minor), 0) into v_provider_net
  from public.order_items oi where oi.order_id = p_order_id;
  select coalesce(max(d.rider_fee_minor), 0) into v_rider_fee
  from public.deliveries d where d.order_id = p_order_id;
  v_platform_delivery := v_order.delivery_fee_minor - v_rider_fee;

  update public.orders
  set status = 'paid', payment_status = 'paid', paid_at = now(), payment_reference = p_reference
  where id = p_order_id;

  insert into public.payment_events (order_id, provider, event_type, amount_minor, currency, reference, payload)
  values (p_order_id, p_provider, 'payment.succeeded', v_order.total_minor, v_order.currency, p_reference,
    jsonb_build_object('verified_server_side', true));

  insert into public.ledger_entries (order_id, entry_type, account, party_id, debit_minor, credit_minor, currency, reference)
  values
    (p_order_id, 'customer_charge', 'customer', v_order.customer_id, v_order.total_minor, 0, v_order.currency, p_reference),
    (p_order_id, 'customer_charge', 'settlement', null, 0, v_order.total_minor, v_order.currency, p_reference),
    (p_order_id, 'commission', 'settlement', null, v_order.commission_minor, 0, v_order.currency, p_reference),
    (p_order_id, 'commission', 'platform_commission', null, 0, v_order.commission_minor, v_order.currency, p_reference),
    (p_order_id, 'provider_payable', 'settlement', null, v_provider_net, 0, v_order.currency, p_reference),
    (p_order_id, 'provider_payable', 'provider_payable', null, 0, v_provider_net, v_order.currency, p_reference);

  if v_order.delivery_fee_minor > 0 then
    insert into public.ledger_entries (order_id, entry_type, account, party_id, debit_minor, credit_minor, currency, reference)
    values
      (p_order_id, 'delivery_split', 'settlement', null, v_order.delivery_fee_minor, 0, v_order.currency, p_reference),
      (p_order_id, 'delivery_split', 'rider_payable', null, 0, v_rider_fee, v_order.currency, p_reference),
      (p_order_id, 'delivery_split', 'platform_delivery', null, 0, v_platform_delivery, v_order.currency, p_reference);
  end if;

  insert into public.order_status_history (order_id, from_status, to_status, actor_id, actor_role, note)
  values (p_order_id, v_order.status, 'paid', auth.uid(), 'system', 'Payment verified by provider callback.');
end;
$$;
revoke all on function public.mark_order_paid(uuid, text, text) from public, anon, authenticated;
grant execute on function public.mark_order_paid(uuid, text, text) to service_role;

-- Provider-confirmed payout settlement, for the server handling the M-Pesa B2C result. It mirrors
-- admin_update_payout but authorizes the caller with the service role instead of an owner session.
create or replace function public.confirm_provider_payout(
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
  if p_status not in ('processing','paid','failed') then
    raise exception 'Unsupported payout status.';
  end if;

  select * into v_payout from public.payouts where id = p_payout_id for update;
  if v_payout.id is null then
    raise exception 'Payout not found.';
  end if;
  if v_payout.status = 'paid' then
    return;
  end if;
  if v_payout.status in ('failed','cancelled') then
    raise exception 'A closed payout cannot be changed.';
  end if;

  update public.payouts
  set status = p_status,
      reference = coalesce(nullif(trim(p_reference), ''), reference),
      failure_reason = case when p_status = 'failed' then left(coalesce(p_failure_reason, ''), 1000) else failure_reason end,
      processed_at = case when p_status in ('paid','failed') then now() else processed_at end
  where id = p_payout_id;

  if p_status = 'paid' then
    insert into public.ledger_entries (
      entry_type, account, party_id, debit_minor, credit_minor, currency, reference, payout_id
    ) values
      ('payout', 'rider_payable', v_payout.payee_id, v_payout.amount_minor, 0, v_payout.currency, p_payout_id::text, p_payout_id),
      ('payout', 'platform_cash', null, 0, v_payout.amount_minor, v_payout.currency, p_payout_id::text, p_payout_id);
  end if;
end;
$$;
revoke all on function public.confirm_provider_payout(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.confirm_provider_payout(uuid, text, text, text) to service_role;

commit;
