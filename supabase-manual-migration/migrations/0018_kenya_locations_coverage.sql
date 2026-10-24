-- Shilevi migration 0018: Kenyan location reference data and launch coverage controls.
-- Review and run manually after 0017. No live Supabase project was accessed.
-- A county being listed does not mean riders or sellers are available there. Operational coverage
-- is controlled separately by provider service areas and category activation.
begin;

create table if not exists public.service_locations (
  id uuid primary key default gen_random_uuid(),
  country_code char(2) not null default 'KE' check (country_code ~ '^[A-Z]{2}$'),
  county_code smallint not null unique check (county_code between 1 and 47),
  county text not null,
  slug text not null unique,
  is_active boolean not null default true,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists service_locations_set_updated_at on public.service_locations;
create trigger service_locations_set_updated_at before update on public.service_locations
for each row execute function public.set_updated_at();

insert into public.service_locations (county_code, county, slug, sort_order) values
  (1, 'Mombasa', 'kenya-mombasa', 1),
  (2, 'Kwale', 'kenya-kwale', 2),
  (3, 'Kilifi', 'kenya-kilifi', 3),
  (4, 'Tana River', 'kenya-tana-river', 4),
  (5, 'Lamu', 'kenya-lamu', 5),
  (6, 'Taita Taveta', 'kenya-taita-taveta', 6),
  (7, 'Garissa', 'kenya-garissa', 7),
  (8, 'Wajir', 'kenya-wajir', 8),
  (9, 'Mandera', 'kenya-mandera', 9),
  (10, 'Marsabit', 'kenya-marsabit', 10),
  (11, 'Isiolo', 'kenya-isiolo', 11),
  (12, 'Meru', 'kenya-meru', 12),
  (13, 'Tharaka-Nithi', 'kenya-tharaka-nithi', 13),
  (14, 'Embu', 'kenya-embu', 14),
  (15, 'Kitui', 'kenya-kitui', 15),
  (16, 'Machakos', 'kenya-machakos', 16),
  (17, 'Makueni', 'kenya-makueni', 17),
  (18, 'Nyandarua', 'kenya-nyandarua', 18),
  (19, 'Nyeri', 'kenya-nyeri', 19),
  (20, 'Kirinyaga', 'kenya-kirinyaga', 20),
  (21, 'Murang''a', 'kenya-muranga', 21),
  (22, 'Kiambu', 'kenya-kiambu', 22),
  (23, 'Turkana', 'kenya-turkana', 23),
  (24, 'West Pokot', 'kenya-west-pokot', 24),
  (25, 'Samburu', 'kenya-samburu', 25),
  (26, 'Trans Nzoia', 'kenya-trans-nzoia', 26),
  (27, 'Uasin Gishu', 'kenya-uasin-gishu', 27),
  (28, 'Elgeyo-Marakwet', 'kenya-elgeyo-marakwet', 28),
  (29, 'Nandi', 'kenya-nandi', 29),
  (30, 'Baringo', 'kenya-baringo', 30),
  (31, 'Laikipia', 'kenya-laikipia', 31),
  (32, 'Nakuru', 'kenya-nakuru', 32),
  (33, 'Narok', 'kenya-narok', 33),
  (34, 'Kajiado', 'kenya-kajiado', 34),
  (35, 'Kericho', 'kenya-kericho', 35),
  (36, 'Bomet', 'kenya-bomet', 36),
  (37, 'Kakamega', 'kenya-kakamega', 37),
  (38, 'Vihiga', 'kenya-vihiga', 38),
  (39, 'Bungoma', 'kenya-bungoma', 39),
  (40, 'Busia', 'kenya-busia', 40),
  (41, 'Siaya', 'kenya-siaya', 41),
  (42, 'Kisumu', 'kenya-kisumu', 42),
  (43, 'Homa Bay', 'kenya-homa-bay', 43),
  (44, 'Migori', 'kenya-migori', 44),
  (45, 'Kisii', 'kenya-kisii', 45),
  (46, 'Nyamira', 'kenya-nyamira', 46),
  (47, 'Nairobi', 'kenya-nairobi', 47)
on conflict (county_code) do nothing;

alter table public.service_locations enable row level security;
revoke all on public.service_locations from anon, authenticated;
grant select on public.service_locations to anon, authenticated;

drop policy if exists "service_locations_select_public" on public.service_locations;
create policy "service_locations_select_public" on public.service_locations
for select to anon, authenticated using (is_active = true);

drop policy if exists "service_locations_select_admin" on public.service_locations;
create policy "service_locations_select_admin" on public.service_locations
for select to authenticated using (public.is_shilevi_owner_admin());

create table if not exists public.provider_service_areas (
  id uuid primary key default gen_random_uuid(),
  provider_activity_id uuid not null references public.provider_activities(id) on delete cascade,
  location_id uuid not null references public.service_locations(id) on delete cascade,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (provider_activity_id, location_id)
);

create index if not exists provider_service_areas_location_idx
  on public.provider_service_areas(location_id, is_active);

alter table public.provider_service_areas enable row level security;
revoke all on public.provider_service_areas from anon, authenticated;
grant select, insert, update, delete on public.provider_service_areas to authenticated;

drop policy if exists "provider_service_areas_select_public" on public.provider_service_areas;
create policy "provider_service_areas_select_public" on public.provider_service_areas
for select to anon, authenticated using (is_active = true);

drop policy if exists "provider_service_areas_manage_own" on public.provider_service_areas;
create policy "provider_service_areas_manage_own" on public.provider_service_areas
for all to authenticated
using (
  exists (
    select 1 from public.provider_activities pa
    where pa.id = provider_service_areas.provider_activity_id
      and pa.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.provider_activities pa
    where pa.id = provider_service_areas.provider_activity_id
      and pa.user_id = (select auth.uid())
      and pa.status = 'approved'
  )
);

create table if not exists public.category_activation (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.marketplace_categories(id) on delete cascade,
  location_id uuid not null references public.service_locations(id) on delete cascade,
  state text not null default 'inactive' check (state in ('inactive','waitlist','active')),
  min_supply integer not null default 0 check (min_supply between 0 and 1000),
  notes text,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (category_id, location_id)
);

create index if not exists category_activation_location_idx
  on public.category_activation(location_id, state);

alter table public.category_activation enable row level security;
revoke all on public.category_activation from anon, authenticated;
grant select on public.category_activation to anon, authenticated;

drop policy if exists "category_activation_select_public" on public.category_activation;
create policy "category_activation_select_public" on public.category_activation
for select to anon, authenticated using (state in ('active','waitlist'));

drop policy if exists "category_activation_admin" on public.category_activation;
create policy "category_activation_admin" on public.category_activation
for all to authenticated
using (public.is_shilevi_owner_admin())
with check (public.is_shilevi_owner_admin());

-- Only the launch county is marked operationally active. The remaining 46 records are address
-- reference data and may be activated as supply and delivery coverage become real.
insert into public.category_activation (category_id, location_id, state)
select mc.id, sl.id, case when sl.county_code = 47 then 'active' else 'inactive' end
from public.marketplace_categories mc
cross join public.service_locations sl
where mc.is_active = true
on conflict (category_id, location_id) do nothing;

commit;
