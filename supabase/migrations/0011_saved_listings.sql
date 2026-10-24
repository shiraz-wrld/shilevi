-- Shilevi migration 0011: customer saved listings / favourites.
-- Review and run manually after migrations 0001-0010. Never run from the app or CI.
begin;

create table if not exists public.saved_listings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  listing_id uuid not null references public.listings(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint saved_listings_user_listing_unique unique (user_id, listing_id)
);

create index if not exists saved_listings_user_recent_idx
  on public.saved_listings(user_id, created_at desc);

alter table public.saved_listings enable row level security;
revoke all on public.saved_listings from anon, authenticated;
grant select, insert, delete on public.saved_listings to authenticated;

drop policy if exists "saved_listings_select_own" on public.saved_listings;
create policy "saved_listings_select_own" on public.saved_listings
for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "saved_listings_insert_own_published" on public.saved_listings;
create policy "saved_listings_insert_own_published" on public.saved_listings
for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.listings l
    join public.marketplace_categories c on c.id = l.category_id
    where l.id = saved_listings.listing_id
      and l.status = 'published'
      and c.is_active = true
      and (l.brand_id is null or exists (
        select 1 from public.marketplace_brands b
        where b.id = l.brand_id and b.is_active = true
      ))
  )
);

drop policy if exists "saved_listings_delete_own" on public.saved_listings;
create policy "saved_listings_delete_own" on public.saved_listings
for delete to authenticated
using (user_id = (select auth.uid()));

commit;
