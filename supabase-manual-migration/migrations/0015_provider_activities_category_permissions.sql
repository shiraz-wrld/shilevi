-- Shilevi migration 0015: per-category provider activities and listing permissions.
-- Review and run manually after 0001-0014. This file does not touch a live project.
-- An approved provider application is not, by itself, permission to sell in every category in a
-- division. This migration records the categories a provider is actually approved to transact in.
begin;

create table if not exists public.provider_activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  application_id uuid not null references public.provider_applications(id) on delete cascade,
  category_id uuid not null references public.marketplace_categories(id) on delete restrict,
  transaction_types text[] not null default array['sale']::text[],
  status text not null default 'pending' check (status in ('pending','approved','suspended','expired')),
  verification_tier smallint not null default 0 check (verification_tier between 0 and 3),
  approved_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint provider_activity_transaction_types_valid check (
    transaction_types <@ array['sale','rent','short_stay','booking','quote','viewing','delivery','ride','hire','lease']::text[]
  )
);

create unique index if not exists provider_activities_application_category_unique
  on public.provider_activities(application_id, category_id);
create index if not exists provider_activities_user_idx on public.provider_activities(user_id);
create index if not exists provider_activities_category_idx on public.provider_activities(category_id);

drop trigger if exists provider_activities_set_updated_at on public.provider_activities;
create trigger provider_activities_set_updated_at before update on public.provider_activities
for each row execute function public.set_updated_at();

alter table public.provider_activities enable row level security;
revoke all on public.provider_activities from anon, authenticated;
grant select on public.provider_activities to authenticated;

drop policy if exists "provider_activities_select_own" on public.provider_activities;
create policy "provider_activities_select_own" on public.provider_activities
for select to authenticated
using (user_id = (select auth.uid()) or public.is_shilevi_owner_admin());

-- Activities are granted by a trusted server path. No client INSERT/UPDATE policy is provided.
-- Sellers still need to attach a permitted activity to a listing before it can be published.
alter table public.listings
  add column if not exists provider_activity_id uuid references public.provider_activities(id) on delete set null,
  add column if not exists transaction_type text not null default 'sale';

alter table public.listings
  drop constraint if exists listings_transaction_type_valid;
alter table public.listings
  add constraint listings_transaction_type_valid check (
    transaction_type in ('sale','rent','short_stay','booking','quote','viewing','delivery','ride','hire','lease')
  );

create index if not exists listings_provider_activity_idx on public.listings(provider_activity_id);

create or replace function public.can_publish_with_activity(
  p_activity_id uuid,
  p_category_id uuid,
  p_transaction_type text
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.provider_activities pa
    join public.marketplace_categories mc on mc.id = p_category_id
    where pa.id = p_activity_id
      and pa.user_id = auth.uid()
      and pa.status = 'approved'
      and pa.category_id = p_category_id
      and p_transaction_type = any(pa.transaction_types)
      and (pa.expires_at is null or pa.expires_at > now())
      and mc.is_active = true
  );
$$;
revoke all on function public.can_publish_with_activity(uuid, uuid, text) from public, anon;
grant execute on function public.can_publish_with_activity(uuid, uuid, text) to authenticated;

-- Insert policy: a provider may create a draft in a category they were actually approved for.
-- The legacy branch (provider_activity_id is null) preserves existing provider screens until they
-- submit an activity. It is intentionally marked for removal once the activity selector ships.
drop policy if exists "listings_insert_own_draft_valid_provider" on public.listings;
create policy "listings_insert_own_draft_valid_provider" on public.listings
for insert to authenticated
with check (
  owner_id = (select auth.uid())
  and status = 'draft'
  and (
    (
      provider_activity_id is not null
      and public.can_publish_with_activity(provider_activity_id, category_id, transaction_type)
    )
    or (
      provider_activity_id is null
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
    )
  )
);

drop policy if exists "listings_update_own_draft" on public.listings;
create policy "listings_update_own_draft" on public.listings
for update to authenticated
using (
  owner_id = (select auth.uid())
  and status = 'draft'
  and exists (
    select 1 from public.provider_applications pa
    where pa.id = listings.provider_application_id
      and pa.user_id = (select auth.uid())
      and pa.status = 'approved'
  )
)
with check (
  owner_id = (select auth.uid())
  and status = 'draft'
  and (
    (
      provider_activity_id is not null
      and public.can_publish_with_activity(provider_activity_id, category_id, transaction_type)
    )
    or (
      provider_activity_id is null
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
    )
  )
);

-- Publication must still be an owner-only transition. This trigger blocks a listing from being
-- published if its activity has since been suspended or no longer covers the category.
create or replace function public.enforce_listing_activity_on_publish()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'published' and new.provider_activity_id is not null then
    if not exists (
      select 1
      from public.provider_activities pa
      where pa.id = new.provider_activity_id
        and pa.user_id = new.owner_id
        and pa.status = 'approved'
        and pa.category_id = new.category_id
        and new.transaction_type = any(pa.transaction_types)
        and (pa.expires_at is null or pa.expires_at > now())
    ) then
      raise exception 'This listing is not covered by an approved provider activity.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists listings_enforce_activity_on_publish on public.listings;
create trigger listings_enforce_activity_on_publish
before insert or update of status, provider_activity_id, category_id, transaction_type on public.listings
for each row execute function public.enforce_listing_activity_on_publish();

-- Admin-only grant. A provider cannot self-approve a new category or transaction type.
create or replace function public.grant_provider_activity(
  p_application_id uuid,
  p_category_id uuid,
  p_transaction_types text[],
  p_verification_tier smallint default 1
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_activity_id uuid;
begin
  if not public.is_shilevi_owner_admin() then
    raise exception 'Not authorized to grant provider activities.';
  end if;

  select pa.user_id into v_user_id
  from public.provider_applications pa
  where pa.id = p_application_id and pa.status = 'approved';

  if v_user_id is null then
    raise exception 'An approved provider application is required.';
  end if;

  if p_transaction_types is null or array_length(p_transaction_types, 1) is null then
    raise exception 'At least one transaction type is required.';
  end if;

  insert into public.provider_activities (
    user_id, application_id, category_id, transaction_types, status, verification_tier, approved_at
  ) values (
    v_user_id, p_application_id, p_category_id, p_transaction_types, 'approved', p_verification_tier, now()
  )
  on conflict (application_id, category_id) do update
    set transaction_types = excluded.transaction_types,
        status = 'approved',
        verification_tier = excluded.verification_tier,
        approved_at = now(),
        updated_at = now()
  returning id into v_activity_id;

  return v_activity_id;
end;
$$;
revoke all on function public.grant_provider_activity(uuid, uuid, text[], smallint) from public, anon, authenticated;
grant execute on function public.grant_provider_activity(uuid, uuid, text[], smallint) to service_role;
-- Deliberately not granted to authenticated: owner/admin actions run through a trusted server path.

commit;
