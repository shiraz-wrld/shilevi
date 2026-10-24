-- Shilevi initial schema foundation.
-- This file is intended for review and execution by the project owner in their own Supabase project.
-- It has NOT been run against any live Supabase project.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  phone text,
  country_code text not null default 'KE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_display_name_length check (display_name is null or char_length(display_name) <= 120)
);

create table if not exists public.marketplace_categories (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.marketplace_categories(id),
  slug text not null unique,
  name text not null,
  division text not null check (division in ('products','services','transport_delivery','property_places')),
  description text,
  is_active boolean not null default false,
  sort_order integer not null default 0,
  attributes_schema jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint category_name_length check (char_length(name) between 1 and 120),
  constraint category_schema_object check (jsonb_typeof(attributes_schema) = 'object')
);

create table if not exists public.provider_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  activity_type text not null check (activity_type in ('product_seller','service_provider','transport_partner','property_provider')),
  status text not null default 'pending' check (status in ('draft','pending','under_review','approved','rejected','suspended','withdrawn')),
  business_name text,
  application_data jsonb not null default '{}'::jsonb,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  reviewer_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint provider_application_data_object check (jsonb_typeof(application_data) = 'object')
);
create index if not exists provider_applications_user_idx on public.provider_applications(user_id);
create index if not exists provider_applications_status_idx on public.provider_applications(status);

create table if not exists public.listings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  category_id uuid not null references public.marketplace_categories(id) on delete restrict,
  provider_application_id uuid not null references public.provider_applications(id) on delete restrict,
  title text not null,
  description text not null default '',
  status text not null default 'draft' check (status in ('draft','pending_review','published','paused','rejected','archived')),
  price_minor bigint check (price_minor is null or price_minor >= 0),
  currency char(3) not null default 'KES',
  attributes jsonb not null default '{}'::jsonb,
  approximate_location jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint listing_title_length check (char_length(title) between 1 and 180),
  constraint listing_attributes_object check (jsonb_typeof(attributes) = 'object')
);
create index if not exists listings_category_status_idx on public.listings(category_id, status);
create index if not exists listings_owner_idx on public.listings(owner_id);

create table if not exists public.audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  resource_type text not null,
  resource_id text,
  outcome text not null default 'success' check (outcome in ('success','denied','failure')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint audit_metadata_object check (jsonb_typeof(metadata) = 'object')
);
create index if not exists audit_events_created_idx on public.audit_events(created_at desc);
create index if not exists audit_events_actor_idx on public.audit_events(actor_id, created_at desc);

-- Enable RLS on every exposed table from the outset.
alter table public.profiles enable row level security;
alter table public.marketplace_categories enable row level security;
alter table public.provider_applications enable row level security;
alter table public.listings enable row level security;
alter table public.audit_events enable row level security;

-- Profile owners can read/update their own profile only. No user may change their auth user ID.
create policy "profiles_select_own" on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy "profiles_insert_own" on public.profiles for insert to authenticated with check ((select auth.uid()) = id);
create policy "profiles_update_own" on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

-- Active categories are publicly readable. Category writes are intentionally unavailable until a
-- server-enforced admin authorization model is implemented in a later reviewed migration.
create policy "categories_read_active" on public.marketplace_categories for select to anon, authenticated using (is_active = true);

-- Applicants may read their own applications and create their own draft/pending application.
-- Review/approval policies are deliberately not granted to ordinary users.
create policy "provider_applications_select_own" on public.provider_applications for select to authenticated using ((select auth.uid()) = user_id);
create policy "provider_applications_insert_own" on public.provider_applications for insert to authenticated with check ((select auth.uid()) = user_id and status in ('draft','pending'));

-- Public can read published listings; owners can read their own records.
create policy "listings_read_published_or_own" on public.listings for select to anon, authenticated using (status = 'published' or (select auth.uid()) = owner_id);
create policy "listings_insert_own_draft" on public.listings for insert to authenticated with check ((select auth.uid()) = owner_id and status = 'draft');

-- Audit events are not exposed to end users. Writes must be made through trusted server-side code.
revoke all on public.audit_events from anon, authenticated;
