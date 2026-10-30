-- Shilevi migration 0005: database-enforced owner admin policies for taxonomy and brand operations.
-- Manual review/execution only. Do not apply from the application or CI.
begin;

create or replace function public.is_shilevi_owner_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users u
    join public.owner_admin_allowlist a
      on a.email = lower(trim(u.email))
    where u.id = (select auth.uid())
      and u.email_confirmed_at is not null
      and coalesce((select auth.jwt() ->> 'aal'), 'aal1') = 'aal2'
  );
$$;

revoke all on function public.is_shilevi_owner_admin() from public, anon;
grant execute on function public.is_shilevi_owner_admin() to authenticated;

-- Keep public category reads active-only; verified owners can see inactive categories and manage taxonomy.
drop policy if exists "categories_admin_select_all" on public.marketplace_categories;
create policy "categories_admin_select_all" on public.marketplace_categories
for select to authenticated using ((select public.is_shilevi_owner_admin()));
drop policy if exists "categories_admin_insert" on public.marketplace_categories;
create policy "categories_admin_insert" on public.marketplace_categories
for insert to authenticated with check ((select public.is_shilevi_owner_admin()));
drop policy if exists "categories_admin_update" on public.marketplace_categories;
create policy "categories_admin_update" on public.marketplace_categories
for update to authenticated using ((select public.is_shilevi_owner_admin()))
with check ((select public.is_shilevi_owner_admin()));
drop policy if exists "categories_admin_delete" on public.marketplace_categories;
create policy "categories_admin_delete" on public.marketplace_categories
for delete to authenticated using ((select public.is_shilevi_owner_admin()));

grant select, insert, update, delete on public.marketplace_categories to authenticated;

-- Brands can only be managed by the two email-verified owner accounts above.
drop policy if exists "brands_admin_select_all" on public.marketplace_brands;
create policy "brands_admin_select_all" on public.marketplace_brands
for select to authenticated using ((select public.is_shilevi_owner_admin()));
drop policy if exists "brands_admin_insert" on public.marketplace_brands;
create policy "brands_admin_insert" on public.marketplace_brands
for insert to authenticated with check ((select public.is_shilevi_owner_admin()));
drop policy if exists "brands_admin_update" on public.marketplace_brands;
create policy "brands_admin_update" on public.marketplace_brands
for update to authenticated using ((select public.is_shilevi_owner_admin()))
with check ((select public.is_shilevi_owner_admin()));
drop policy if exists "brands_admin_delete" on public.marketplace_brands;
create policy "brands_admin_delete" on public.marketplace_brands
for delete to authenticated using ((select public.is_shilevi_owner_admin()));

grant insert, update, delete on public.marketplace_brands to authenticated;


-- Owner list access is separate from public/owner visibility.
drop policy if exists "listings_admin_select_all" on public.listings;
create policy "listings_admin_select_all" on public.listings
for select to authenticated using ((select public.is_shilevi_owner_admin()));

-- Even an owner cannot publish a listing whose provider/category/brand prerequisites are invalid.
create or replace function public.set_listing_published_at()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  category_division text;
  application_activity text;
begin
  if new.status = 'published' then
    select mc.division into category_division
    from public.marketplace_categories mc
    where mc.id = new.category_id and mc.is_active = true;

    select pa.activity_type into application_activity
    from public.provider_applications pa
    where pa.id = new.provider_application_id
      and pa.user_id = new.owner_id
      and pa.status = 'approved';

    if category_division is null or application_activity is null then
      raise exception 'Listing cannot be published until its category is active and its provider application is approved.'
        using errcode = '23514';
    end if;

    if not (
      (application_activity = 'product_seller' and category_division = 'products')
      or (application_activity = 'service_provider' and category_division = 'services')
      or (application_activity = 'transport_partner' and category_division = 'transport_delivery')
      or (application_activity = 'property_provider' and category_division = 'property_places')
    ) then
      raise exception 'Listing category does not match the approved provider activity.'
        using errcode = '23514';
    end if;

    if new.brand_id is not null and not exists (
      select 1 from public.marketplace_brands b where b.id = new.brand_id and b.is_active = true
    ) then
      raise exception 'Listing cannot be published with an inactive brand.'
        using errcode = '23514';
    end if;

    if tg_op = 'INSERT' then
      new.published_at = now();
    elsif old.status is distinct from 'published' then
      new.published_at = now();
    end if;
  else
    new.published_at = null;
  end if;
  return new;
end;
$$;

drop trigger if exists listings_set_published_at on public.listings;
create trigger listings_set_published_at
before insert or update of status, brand_id, category_id, provider_application_id, owner_id
on public.listings
for each row execute function public.set_listing_published_at();

-- Listing moderation is intentionally narrow. Admins can publish/pause/reject and feature listings,
-- but cannot change owner, provider application, price, or content through these moderation grants.
revoke update on public.listings from authenticated;
grant update (status, is_featured, brand_id) on public.listings to authenticated;
drop policy if exists "listings_admin_moderate" on public.listings;
create policy "listings_admin_moderate" on public.listings
for update to authenticated using ((select public.is_shilevi_owner_admin()))
with check ((select public.is_shilevi_owner_admin()));

-- Provider review fields are only writable by verified owners; ordinary applicants still cannot update
-- their own applications because no own-update policy is created.
grant update (status, submitted_at, reviewed_at, reviewed_by, reviewer_note, rejection_reason) on public.provider_applications to authenticated;
drop policy if exists "provider_applications_admin_review" on public.provider_applications;
create policy "provider_applications_admin_review" on public.provider_applications
for update to authenticated using ((select public.is_shilevi_owner_admin()))
with check ((select public.is_shilevi_owner_admin()));


-- Audit writes happen inside a trusted SECURITY DEFINER trigger, not from client code.
-- Metadata is deliberately allowlisted and excludes application_data, reviewer notes, email and phone.
create or replace function public.audit_marketplace_admin_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_data jsonb;
  event_id text;
  event_metadata jsonb;
begin
  if tg_op = 'DELETE' then
    row_data := to_jsonb(old);
  else
    row_data := to_jsonb(new);
  end if;

  event_id := row_data ->> 'id';
  event_metadata := jsonb_build_object('operation', tg_op, 'table', tg_table_name);

  if tg_table_name in ('marketplace_categories', 'marketplace_brands') then
    event_metadata := event_metadata || jsonb_build_object(
      'slug', row_data ->> 'slug',
      'name', row_data ->> 'name',
      'is_active', row_data ->> 'is_active'
    );
  elsif tg_table_name = 'listings' then
    event_metadata := event_metadata || jsonb_build_object(
      'status', row_data ->> 'status',
      'is_featured', row_data ->> 'is_featured',
      'brand_id', row_data ->> 'brand_id'
    );
  elsif tg_table_name = 'provider_applications' then
    event_metadata := event_metadata || jsonb_build_object(
      'activity_type', row_data ->> 'activity_type',
      'status', row_data ->> 'status'
    );
  end if;

  insert into public.audit_events(actor_id, action, resource_type, resource_id, outcome, metadata)
  values (
    (select auth.uid()),
    lower(tg_op) || '.' || tg_table_name,
    tg_table_name,
    event_id,
    'success',
    event_metadata
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.audit_marketplace_admin_change() from public, anon, authenticated;

drop trigger if exists audit_marketplace_categories_admin on public.marketplace_categories;
create trigger audit_marketplace_categories_admin
after insert or update or delete on public.marketplace_categories
for each row execute function public.audit_marketplace_admin_change();

drop trigger if exists audit_marketplace_brands_admin on public.marketplace_brands;
create trigger audit_marketplace_brands_admin
after insert or update or delete on public.marketplace_brands
for each row execute function public.audit_marketplace_admin_change();

drop trigger if exists audit_marketplace_listings_admin on public.listings;
create trigger audit_marketplace_listings_admin
after update on public.listings
for each row
when (old.status is distinct from new.status or old.is_featured is distinct from new.is_featured or old.brand_id is distinct from new.brand_id)
execute function public.audit_marketplace_admin_change();

drop trigger if exists audit_provider_applications_admin on public.provider_applications;
create trigger audit_provider_applications_admin
after update on public.provider_applications
for each row
when (old.status is distinct from new.status or old.submitted_at is distinct from new.submitted_at or old.reviewed_at is distinct from new.reviewed_at or old.reviewed_by is distinct from new.reviewed_by)
execute function public.audit_marketplace_admin_change();


commit;
