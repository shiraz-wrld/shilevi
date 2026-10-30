-- Shilevi migration 0033: make provider activation reachable and category-scoped.
-- Forward-only and additive: one grant, one wrapper function. No row is rewritten.
--
-- The gap this closes:
--   `provider_activities` is the only record that says "this approved provider may trade in this
--   category". `can_publish_with_activity()` reads it, the admin Providers screen counts it, and
--   `verify_schema.sql` asserts it exists. But nothing could ever write one:
--     * migration 0015 revoked the RPC from `authenticated` and granted it to `service_role` only,
--       and no server route, job or edge function calls it;
--     * there was no owner-facing screen for it, so approval produced an application badge and
--       zero activations.
--   That is the "approval badge is not activation" failure: a provider is approved, their category
--   permissions are empty, and the console cannot tell the difference between "not yet activated"
--   and "no permission granted".
--
-- This migration does not auto-activate anything on approval on purpose. Activating a category is a
-- least-privilege decision: the owner names the exact category and transaction types. It only makes
-- that decision possible, audited, and enforced against the application's own activity.

begin;

-- 0015's function already refuses anyone who is not an allowlisted owner at aal2 and refuses an
-- application that is not approved. Granting it to `authenticated` therefore exposes the decision to
-- the owner's own session and to nobody else; `service_role` keeps its grant.
grant execute on function public.grant_provider_activity(uuid, uuid, text[], smallint) to authenticated;

create or replace function public.admin_grant_provider_activity(
  p_application_id uuid,
  p_category_id uuid,
  p_transaction_types text[],
  p_verification_tier integer default 1
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := (select auth.uid());
  v_activity_type text;
  v_division text;
  v_category_division text;
  v_category_active boolean;
  v_activity_id uuid;
begin
  if not public.is_shilevi_owner_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  select pa.activity_type into v_activity_type
  from public.provider_applications pa
  where pa.id = p_application_id and pa.status = 'approved';

  if v_activity_type is null then
    raise exception 'An approved provider application is required before a category can be activated.'
      using errcode = '42501';
  end if;

  select mc.division, mc.is_active into v_category_division, v_category_active
  from public.marketplace_categories mc
  where mc.id = p_category_id;

  if v_category_division is null then
    raise exception 'Unknown category.';
  end if;
  if not v_category_active then
    raise exception 'An inactive category cannot be activated for a provider.';
  end if;

  v_division := case v_activity_type
    when 'product_seller' then 'products'
    when 'service_provider' then 'services'
    when 'transport_partner' then 'transport_delivery'
    when 'property_provider' then 'property_places'
    else null
  end;

  -- An approval for one activity must never authorise another. Publishing already enforces the same
  -- division rule in `set_listing_published_at()`; this keeps the activity record itself honest.
  if v_division is null or v_division <> v_category_division then
    raise exception 'That category belongs to a different provider activity.'
      using errcode = '23514';
  end if;

  if p_transaction_types is null or array_length(p_transaction_types, 1) is null then
    raise exception 'Choose at least one transaction type.' using errcode = '23514';
  end if;

  -- `grant_provider_activity` takes a smallint tier, and integer -> smallint is not an implicit cast,
  -- so it is cast explicitly rather than relying on resolution to find the function.
  v_activity_id := public.grant_provider_activity(
    p_application_id, p_category_id, p_transaction_types, coalesce(p_verification_tier, 1)::smallint
  );

  insert into public.audit_events (actor_id, action, resource_type, resource_id, outcome, metadata)
  values (
    v_owner,
    'provider_activity.grant',
    'provider_activities',
    v_activity_id::text,
    'success',
    jsonb_build_object(
      'application_id', p_application_id,
      'category_id', p_category_id,
      'activity_type', v_activity_type,
      'transaction_types', to_jsonb(p_transaction_types),
      'verification_tier', coalesce(p_verification_tier, 1)
    )
  );

  return v_activity_id;
end;
$$;

revoke all on function public.admin_grant_provider_activity(uuid, uuid, text[], integer) from public, anon;
grant execute on function public.admin_grant_provider_activity(uuid, uuid, text[], integer) to authenticated;

commit;
