-- Shilevi — post-migration verification (READ ONLY)
--
-- Run this in the Supabase SQL editor after applying migrations 0001–0025 in order.
-- It creates nothing, writes nothing and deletes nothing, so it is safe on any environment,
-- including production. Every row it returns is a check you can read: PASS means the object or
-- setting exists in the shape the application expects.
--
-- A FAIL on a table, function, policy or bucket means the migration chain did not complete.
-- A FAIL on `sandbox payments disabled` is expected only on a deliberate sandbox/staging project.

with expected_tables(name) as (
  values
    ('profiles'), ('user_roles'), ('user_onboarding'), ('marketplace_categories'),
    ('marketplace_brands'), ('listings'), ('provider_applications'), ('provider_activities'),
    ('saved_listings'), ('listing_requests'), ('orders'), ('order_items'), ('deliveries'),
    ('delivery_events'), ('payment_events'), ('payment_intents'),
    ('payment_methods'), ('ledger_entries'), ('commission_rules'), ('commission_tiers'),
    ('refunds'), ('payouts'), ('platform_settings'), ('rides'), ('ride_offers'),
    ('ride_events'), ('ride_reviews'), ('transport_vehicles'), ('transport_partner_details'),
    ('provider_service_areas'), ('property_listings'), ('property_contacts'),
    ('property_contact_unlocks'), ('property_verification_documents'),
    ('service_locations'), ('category_activation'), ('notification_outbox'),
    ('staff_capabilities'), ('audit_events'), ('owner_admin_allowlist'), ('search_events')
),
expected_functions(name) as (
  values
    ('search_marketplace'), ('record_search_event'), ('prune_search_events'),
    ('admin_search_insights'), ('is_shilevi_owner_admin'), ('mock_payments_allowed'),
    ('confirm_mock_payment'), ('confirm_mock_property_unlock'), ('confirm_mock_ride_payment'),
    ('create_order'), ('create_payment_intent'), ('create_property_payment_intent'),
    ('mark_order_paid'), ('mark_ride_paid'), ('request_order_refund'), ('admin_decide_refund'),
    ('request_rider_payout'), ('confirm_provider_payout'), ('rider_available_balance'),
    ('accept_delivery'), ('request_ride'), ('ride_respond'),
    ('cancel_ride'), ('complete_property_unlock'), ('get_property_contact'),
    ('has_property_access'), ('grant_provider_activity'), ('admin_set_payment_method'),
    ('admin_update_setting'), ('admin_list_staff'), ('admin_grant_staff_capability')
),
rls_tables(name) as (
  values
    ('listings'), ('orders'), ('order_items'), ('ledger_entries'), ('payment_intents'),
    ('payouts'), ('property_contacts'), ('property_contact_unlocks'), ('rides'),
    ('saved_listings'), ('listing_requests'), ('search_events'), ('staff_capabilities'),
    ('provider_activities'), ('transport_vehicles')
),
checks as (
  select 'table ' || name as check_name,
         to_regclass('public.' || name) is not null as ok,
         'public schema' as detail
  from expected_tables

  union all

  select 'function ' || name,
         exists (
           select 1 from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = name
         ),
         'public schema'
  from expected_functions

  union all

  select 'row level security on ' || name,
         coalesce((select c.relrowsecurity from pg_class c where c.oid = to_regclass('public.' || name)), false),
         'must be enabled'
  from rls_tables

  union all

  select 'search_vector column on listings',
         exists (
           select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'listings' and column_name = 'search_vector'
         ),
         'migration 0025'
  union all

  select 'search vector index',
         exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'listings_search_vector_idx'),
         'GIN index from 0025'
  union all

  select 'storage bucket listing-images (public)',
         exists (select 1 from storage.buckets where id = 'listing-images' and public = true),
         'migration 0024'
  union all

  select 'storage bucket provider-documents (private)',
         exists (select 1 from storage.buckets where id = 'provider-documents' and public = false),
         'migration 0024'
  union all

  select 'sandbox payments disabled',
         coalesce(
           (select not (value #>> '{}')::boolean from public.platform_settings where key = 'allow_mock_payments'),
           true
         ),
         'must be true before taking real money'
  union all

  select 'payment method registry populated',
         exists (select 1 from public.payment_methods),
         'migration 0023'
  union all

  select 'no client grant on search_events',
         not exists (
           select 1 from information_schema.role_table_grants
           where table_schema = 'public' and table_name = 'search_events'
             and grantee in ('anon', 'authenticated') and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
         ),
         'analytics are written by the service role only'
)
select check_name, case when ok then 'PASS' else 'FAIL' end as status, detail
from checks
order by (case when ok then 1 else 0 end), check_name;

-- Current payment posture. Read this before enabling any provider.
select
  (select value #>> '{}' from public.platform_settings where key = 'payment_mode') as payment_mode,
  (select value #>> '{}' from public.platform_settings where key = 'allow_mock_payments') as allow_mock_payments,
  (select count(*) from public.payment_methods where enabled) as enabled_payment_methods;
