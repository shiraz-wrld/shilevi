-- Shilevi migration 0024: storage buckets and object policies.
--
-- No bucket existed, so provider verification documents had nowhere to live and listing images had
-- no defined access model. This migration creates two buckets and the object policies that go with
-- them:
--
--   listing-images      public read, authenticated upload into a folder named after the uploader.
--   provider-documents  private. Readable only by the uploader, the owner, or staff holding
--                       properties.verify. Never public and never URL-guessable.
--
-- Path convention: first path segment is the uploader's user id, e.g.
--   provider-documents/<user-id>/<listing-id>/ownership-proof.pdf
--   listing-images/<user-id>/<listing-id>/cover.webp
--
-- The storage schema is created by Supabase and does not exist in a plain PostgreSQL test database,
-- so every block below is guarded and becomes a no-op rather than failing there. Nothing here
-- deletes objects or buckets.

begin;

do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage.buckets is not present; skipping bucket provisioning';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values
    ('listing-images', 'listing-images', true, 5242880,
      array['image/jpeg','image/png','image/webp']::text[]),
    ('provider-documents', 'provider-documents', false, 10485760,
      array['image/jpeg','image/png','image/webp','application/pdf']::text[])
  on conflict (id) do nothing;
end $$;

do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'storage.objects is not present; skipping object policies';
    return;
  end if;

  -- ---------------------------------------------------------------- listing images (public)
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'shilevi_listing_images_read'
  ) then
    create policy "shilevi_listing_images_read" on storage.objects
      for select to anon, authenticated
      using (bucket_id = 'listing-images');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'shilevi_listing_images_insert'
  ) then
    create policy "shilevi_listing_images_insert" on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'listing-images'
        and (storage.foldername(name))[1] = (select auth.uid())::text
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'shilevi_listing_images_delete'
  ) then
    create policy "shilevi_listing_images_delete" on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'listing-images'
        and (
          (storage.foldername(name))[1] = (select auth.uid())::text
          or (select public.is_shilevi_owner_admin())
        )
      );
  end if;

  -- ---------------------------------------------------------------- provider documents (private)
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'shilevi_provider_documents_read'
  ) then
    create policy "shilevi_provider_documents_read" on storage.objects
      for select to authenticated
      using (
        bucket_id = 'provider-documents'
        and (
          (storage.foldername(name))[1] = (select auth.uid())::text
          or (select public.is_shilevi_owner_admin())
          or (select public.has_staff_capability('properties.verify'))
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'shilevi_provider_documents_insert'
  ) then
    create policy "shilevi_provider_documents_insert" on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'provider-documents'
        and (storage.foldername(name))[1] = (select auth.uid())::text
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'shilevi_provider_documents_delete'
  ) then
    create policy "shilevi_provider_documents_delete" on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'provider-documents'
        and (
          (storage.foldername(name))[1] = (select auth.uid())::text
          or (select public.is_shilevi_owner_admin())
        )
      );
  end if;
end $$;

commit;
