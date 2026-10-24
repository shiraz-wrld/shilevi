-- Shilevi migration 0007: provider-owned listing drafts and narrow client write privileges.
-- Review and run manually after migrations 0001-0006. Never apply from app or CI.
-- No live Supabase project was accessed to create this migration.
begin;

-- A provider may create and edit only their own draft content. Publication/moderation remains
-- an owner-only operation protected by migration 0005 and its database trigger.
revoke insert, update, delete on public.listings from anon, authenticated;
grant select on public.listings to anon, authenticated;
grant insert (owner_id, category_id, provider_application_id, title, description, status, price_minor, currency, attributes, approximate_location)
  on public.listings to authenticated;
grant update (title, description, price_minor, currency, attributes, approximate_location)
  on public.listings to authenticated;
-- Preserve the separate owner-only moderation column grants established in migration 0005.
grant update (status, is_featured, brand_id) on public.listings to authenticated;

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

-- The UPDATE policy above allows only draft records; column grants exclude status, ownership,
-- provider application, category and publication metadata from applicant edits.
commit;
