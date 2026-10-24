-- Shilevi migration 0002: identity bootstrap, protected roles, provider application workflow.
-- Review and run manually in the owner's Supabase project. Never run automatically from the app.
-- No live Supabase project was accessed to create this migration.

begin;

-- Keep updated_at reliable for tables touched by user-facing flows.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists categories_set_updated_at on public.marketplace_categories;
create trigger categories_set_updated_at before update on public.marketplace_categories
for each row execute function public.set_updated_at();

drop trigger if exists provider_applications_set_updated_at on public.provider_applications;
create trigger provider_applications_set_updated_at before update on public.provider_applications
for each row execute function public.set_updated_at();

drop trigger if exists listings_set_updated_at on public.listings;
create trigger listings_set_updated_at before update on public.listings
for each row execute function public.set_updated_at();

-- Create a minimal profile on Auth signup. Metadata is user-controlled; only copy a bounded display name.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  safe_name text;
begin
  safe_name := left(trim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), 120);
  insert into public.profiles (id, display_name)
  values (new.id, nullif(safe_name, ''))
  on conflict (id) do nothing;
  insert into public.user_roles (user_id, role)
  values (new.id, 'customer')
  on conflict (user_id, role) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
after insert on auth.users
for each row execute function public.handle_new_auth_user();

-- Restrict profile writes to editable fields. Timestamp and identity columns are server-managed.
revoke insert, update, delete on public.profiles from authenticated;
grant select on public.profiles to authenticated;
grant update (display_name, phone, country_code) on public.profiles to authenticated;

-- Role assignments are server-managed only. A user cannot grant themselves a role via RLS.
create table if not exists public.user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('customer','product_seller','service_provider','transport_partner','property_provider','staff','admin','super_admin')),
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);
alter table public.user_roles enable row level security;
revoke all on public.user_roles from anon, authenticated;
grant select on public.user_roles to authenticated;
drop policy if exists "user_roles_select_self" on public.user_roles;
create policy "user_roles_select_self" on public.user_roles
for select to authenticated using (user_id = (select auth.uid()));

-- Only trusted server-side processes with a service role or database owner may manage roles.
-- No INSERT/UPDATE/DELETE policies are intentionally provided for end users.

-- Provider applications have one current record per user and activity. Status is not client-editable
-- after submission/review; later API/server actions must own those transitions.
create unique index if not exists provider_applications_user_activity_unique
on public.provider_applications(user_id, activity_type);

alter table public.provider_applications
  add column if not exists public_reference text unique,
  add column if not exists business_registration_number text,
  add column if not exists country_code char(2) not null default 'KE',
  add column if not exists rejection_reason text;

alter table public.provider_applications
  drop constraint if exists provider_application_country_code_format;
alter table public.provider_applications
  add constraint provider_application_country_code_format
  check (country_code ~ '^[A-Z]{2}$');

alter table public.provider_applications
  drop constraint if exists provider_application_business_name_length;
alter table public.provider_applications
  add constraint provider_application_business_name_length
  check (business_name is null or char_length(business_name) <= 160);

alter table public.provider_applications
  drop constraint if exists provider_application_data_size;
alter table public.provider_applications
  add constraint provider_application_data_size
  check (pg_column_size(application_data) <= 16384);

-- The original client policy permits a user to insert only a draft listing, but did not prove that
-- the referenced application belongs to that user and matches the category. Remove that policy now.
drop policy if exists "listings_insert_own_draft" on public.listings;
drop policy if exists "listings_insert_own_draft_valid_provider" on public.listings;
create policy "listings_insert_own_draft_valid_provider" on public.listings
for insert to authenticated
with check (
  owner_id = (select auth.uid())
  and status = 'draft'
  and exists (
    select 1
    from public.provider_applications pa
    join public.marketplace_categories mc on mc.id = listings.category_id
    where pa.id = listings.provider_application_id
      and pa.user_id = (select auth.uid())
      and pa.status = 'approved'
      and mc.is_active = true
      and (
        (pa.activity_type = 'product_seller' and mc.division = 'products')
        or (pa.activity_type = 'service_provider' and mc.division = 'services')
        or (pa.activity_type = 'transport_partner' and mc.division = 'transport_delivery')
        or (pa.activity_type = 'property_provider' and mc.division = 'property_places')
      )
  )
);

-- Provider applicants may create their own draft application. Once submitted, status changes must
-- be performed by a trusted server/admin path; client RLS alone cannot securely distinguish all
-- columns in an UPDATE, so deny client updates and require the server action for transitions.
drop policy if exists "provider_applications_update_own" on public.provider_applications;
revoke update, delete on public.provider_applications from authenticated;
grant select, insert on public.provider_applications to authenticated;
drop policy if exists "provider_applications_insert_own" on public.provider_applications;

drop policy if exists "provider_applications_insert_own_draft" on public.provider_applications;
create policy "provider_applications_insert_own_draft" on public.provider_applications
for insert to authenticated
with check (
  user_id = (select auth.uid())
  and status = 'draft'
  and submitted_at is null
  and reviewed_at is null
  and reviewed_by is null
  and reviewer_note is null
);

-- Safe initial category records. They remain inactive until an authorized admin explicitly activates them.
insert into public.marketplace_categories (slug, name, division, description, is_active, sort_order)
values
  ('general-products', 'General Products', 'products', 'Everyday goods and approved merchandise.', false, 10),
  ('professional-services', 'Professional Services', 'services', 'Services offered by approved providers.', false, 20),
  ('transport-delivery', 'Transport & Delivery', 'transport_delivery', 'Transport and parcel delivery services.', false, 30),
  ('property-places', 'Property & Places', 'property_places', 'Property, accommodation, venues and places.', false, 40)
on conflict (slug) do nothing;

commit;
