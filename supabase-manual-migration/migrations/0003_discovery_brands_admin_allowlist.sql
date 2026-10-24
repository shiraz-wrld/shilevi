-- Shilevi migration 0003: discovery, brand storefronts, and owner allowlist foundation.
-- Review and execute manually in the owner's Supabase project. This migration is not run by the app.
-- Brand names here are records/configuration, not a claim that any brand has partnered with Shilevi.
begin;

create table if not exists public.marketplace_brands (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text not null default '',
  logo_url text,
  website_url text,
  is_active boolean not null default false,
  is_featured boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketplace_brand_name_length check (char_length(name) between 1 and 120),
  constraint marketplace_brand_description_length check (char_length(description) <= 1200),
  constraint marketplace_brand_slug_format check (slug ~ '^[a-z0-9]+([a-z0-9-]*[a-z0-9])?$'),
  constraint marketplace_brand_logo_url_https check (logo_url is null or logo_url ~ '^https://'),
  constraint marketplace_brand_website_url_https check (website_url is null or website_url ~ '^https://')
);

alter table public.marketplace_brands enable row level security;
revoke all on public.marketplace_brands from anon, authenticated;
grant select on public.marketplace_brands to anon, authenticated;
drop policy if exists "brands_read_active" on public.marketplace_brands;
create policy "brands_read_active" on public.marketplace_brands
for select to anon, authenticated using (is_active = true);

drop trigger if exists brands_set_updated_at on public.marketplace_brands;
create trigger brands_set_updated_at before update on public.marketplace_brands
for each row execute function public.set_updated_at();

alter table public.listings
  add column if not exists brand_id uuid references public.marketplace_brands(id) on delete set null,
  add column if not exists is_featured boolean not null default false,
  add column if not exists published_at timestamptz;

create index if not exists listings_brand_status_idx on public.listings(brand_id, status);
create index if not exists listings_published_recent_idx on public.listings(published_at desc) where status = 'published';
create index if not exists listings_featured_idx on public.listings(is_featured, published_at desc) where status = 'published';

-- Published listings attached to an inactive brand are hidden from public browsing.
drop policy if exists "listings_read_published_or_own" on public.listings;
create policy "listings_read_published_or_own" on public.listings
for select to anon, authenticated
using (
  (status = 'published' and (
    brand_id is null or exists (
      select 1 from public.marketplace_brands b
      where b.id = listings.brand_id and b.is_active = true
    )
  ))
  or (select auth.uid()) = owner_id
);

-- Publication timestamps are server-managed; no public client may publish or feature a listing.
create or replace function public.set_listing_published_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'published' then
      new.published_at = now();
    else
      new.published_at = null;
    end if;
  elsif new.status = 'published' and old.status is distinct from 'published' then
    new.published_at = now();
  elsif new.status <> 'published' then
    new.published_at = null;
  end if;
  return new;
end;
$$;
drop trigger if exists listings_set_published_at on public.listings;
create trigger listings_set_published_at before insert or update of status on public.listings
for each row execute function public.set_listing_published_at();

-- Owner allowlist is deliberately not exposed to anon/authenticated. Trusted server code must
-- normalize verified Auth email and check membership; never trust a client-supplied email or role.
create table if not exists public.owner_admin_allowlist (
  email text primary key,
  created_at timestamptz not null default now(),
  constraint owner_admin_email_lowercase check (email = lower(trim(email))),
  constraint owner_admin_email_format check (email ~ '^[^@[:space:]]+@gmail[.]com$')
);
alter table public.owner_admin_allowlist enable row level security;
revoke all on public.owner_admin_allowlist from anon, authenticated;

insert into public.owner_admin_allowlist(email)
values ('russhiraz565@gmail.com'), ('russhiraz1@gmail.com')
on conflict (email) do nothing;

-- No demo brands or fake partnership claims are seeded. Admins can create real brand records later.
commit;
