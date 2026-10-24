-- Shilevi migration 0004: customer onboarding and provider-specific transport profile foundation.
-- Manual owner review/execution only. No live Supabase project is accessed by this repository workflow.
begin;

create table if not exists public.user_onboarding (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  phone text,
  country_code char(2) not null default 'KE',
  county text,
  town text,
  account_intent text not null default 'customer' check (account_intent in ('customer','provider')),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint onboarding_name_length check (char_length(trim(full_name)) between 1 and 120),
  constraint onboarding_phone_length check (phone is null or char_length(phone) between 7 and 32),
  constraint onboarding_country_format check (country_code ~ '^[A-Z]{2}$'),
  constraint onboarding_county_length check (county is null or char_length(county) <= 100),
  constraint onboarding_town_length check (town is null or char_length(town) <= 100)
);
alter table public.user_onboarding enable row level security;
revoke all on public.user_onboarding from anon, authenticated;
grant select, insert on public.user_onboarding to authenticated;
grant update (full_name, phone, country_code, county, town, account_intent) on public.user_onboarding to authenticated;
drop policy if exists "user_onboarding_select_own" on public.user_onboarding;
create policy "user_onboarding_select_own" on public.user_onboarding
for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "user_onboarding_insert_own" on public.user_onboarding;
create policy "user_onboarding_insert_own" on public.user_onboarding
for insert to authenticated with check (user_id = (select auth.uid()) and completed_at is null);
drop policy if exists "user_onboarding_update_own" on public.user_onboarding;
create policy "user_onboarding_update_own" on public.user_onboarding
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop trigger if exists user_onboarding_set_updated_at on public.user_onboarding;
create trigger user_onboarding_set_updated_at before update on public.user_onboarding
for each row execute function public.set_updated_at();

-- Rider/transport profile stores a service area, not continuously collected GPS coordinates.
-- License/verification/review fields are server-managed and not writable by ordinary users.
create table if not exists public.transport_partner_details (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider_application_id uuid not null references public.provider_applications(id) on delete cascade,
  vehicle_type text not null check (vehicle_type in ('bicycle','motorcycle','car','van','truck','other')),
  service_counties text[] not null default '{}',
  service_towns text[] not null default '{}',
  vehicle_registration text,
  license_verification_status text not null default 'not_submitted' check (license_verification_status in ('not_submitted','pending','verified','rejected')),
  review_status text not null default 'draft' check (review_status in ('draft','pending','approved','rejected','suspended')),
  reviewer_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transport_counties_limit check (cardinality(service_counties) <= 20),
  constraint transport_towns_limit check (cardinality(service_towns) <= 30),
  constraint transport_registration_length check (vehicle_registration is null or char_length(vehicle_registration) between 3 and 32),
  constraint transport_application_unique unique (provider_application_id)
);
create index if not exists transport_details_user_idx on public.transport_partner_details(user_id);
alter table public.transport_partner_details enable row level security;
revoke all on public.transport_partner_details from anon, authenticated;
grant select, insert on public.transport_partner_details to authenticated;
-- Users may update only ordinary profile inputs; review and license state are not in the column grant.
grant update (vehicle_type, service_counties, service_towns, vehicle_registration) on public.transport_partner_details to authenticated;
drop policy if exists "transport_details_select_own" on public.transport_partner_details;
create policy "transport_details_select_own" on public.transport_partner_details
for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "transport_details_insert_own_draft" on public.transport_partner_details;
create policy "transport_details_insert_own_draft" on public.transport_partner_details
for insert to authenticated with check (
  user_id = (select auth.uid())
  and review_status = 'draft'
  and license_verification_status = 'not_submitted'
  and reviewer_note is null
  and exists (
    select 1 from public.provider_applications pa
    where pa.id = provider_application_id
      and pa.user_id = (select auth.uid())
      and pa.activity_type = 'transport_partner'
      and pa.status = 'draft'
  )
);
drop policy if exists "transport_details_update_own_draft" on public.transport_partner_details;
create policy "transport_details_update_own_draft" on public.transport_partner_details
for update to authenticated
using (
  user_id = (select auth.uid())
  and review_status = 'draft'
  and exists (
    select 1 from public.provider_applications pa
    where pa.id = provider_application_id
      and pa.user_id = (select auth.uid())
      and pa.status = 'draft'
  )
)
with check (
  user_id = (select auth.uid())
  and review_status = 'draft'
  and license_verification_status = 'not_submitted'
  and reviewer_note is null
);

drop trigger if exists transport_details_set_updated_at on public.transport_partner_details;
create trigger transport_details_set_updated_at before update on public.transport_partner_details
for each row execute function public.set_updated_at();

commit;
