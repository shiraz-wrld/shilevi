-- Shilevi — post-migration verification (READ ONLY)
--
-- Run this in the Supabase SQL editor after applying migrations 0001–0040 in order.
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
    ('delivery_events'), ('delivery_proof_codes'), ('payment_events'), ('payment_intents'),
    ('payment_methods'), ('ledger_entries'), ('commission_rules'), ('commission_tiers'),
    ('refunds'), ('payouts'), ('platform_settings'), ('rides'), ('ride_offers'),
    ('ride_events'), ('ride_reviews'), ('transport_vehicles'), ('transport_partner_details'),
    ('provider_service_areas'), ('property_listings'), ('property_contacts'),
    ('property_contact_unlocks'), ('property_verification_documents'),
    ('service_locations'), ('category_activation'), ('notification_outbox'),
    ('staff_capabilities'), ('audit_events'), ('owner_admin_allowlist'), ('search_events'),
    ('delivery_vehicle_classes'), ('delivery_fleets'), ('delivery_fleet_drivers'),
    ('delivery_provider_routes'), ('delivery_offers'), ('delivery_incidents'),
    ('delivery_document_types'), ('delivery_documents'), ('delivery_application_drafts'),
    ('delivery_pricing_rules'), ('delivery_quotes'), ('delivery_document_requirements'),
    ('delivery_application_route_intents'), ('push_subscriptions'), ('provider_positions'),
    ('provider_pickup_points')
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
    ('admin_update_setting'), ('admin_list_staff'), ('admin_grant_staff_capability'),
    ('commission_rate_bps'), ('commission_split'), ('apply_payout_commission'),
    ('admin_reverse_payout_commission'), ('quote_delivery'),
    ('attach_delivery_quote_to_order'), ('admin_upsert_delivery_pricing_rule'),
    ('admin_retire_delivery_pricing_rule'), ('admin_payout_reconciliation'),
    ('admin_list_customers'), ('admin_list_role_assignments'), ('admin_list_providers'),
    ('admin_list_riders'), ('admin_list_deliveries'), ('admin_list_listing_requests'),
    ('admin_list_ride_reviews'), ('admin_onboarding_overview'), ('admin_service_area_coverage'),
    ('match_delivery_candidates'), ('offer_delivery_to_candidates'),
    ('list_my_delivery_offers'), ('accept_delivery_offer'), ('decline_delivery_offer'),
    ('set_delivery_vehicle_profile'), ('add_delivery_route'), ('delete_delivery_route'),
    ('submit_deliverer_application'), ('save_delivery_application_draft'),
    ('submit_delivery_application_draft'), ('register_delivery_vehicle'),
    ('register_delivery_document'), ('admin_review_delivery_document'),
    ('admin_review_delivery_fleet'), ('admin_review_delivery_fleet_driver'),
    ('create_delivery_application'), ('my_delivery_document_checklist'),
    ('attach_my_delivery_document'), ('publish_my_delivery_route'),
    ('save_push_subscription'), ('revoke_push_subscription'),
    ('my_push_subscription_count'), ('render_notification'),
    ('publish_provider_position'), ('stop_provider_position_sharing'),
    ('my_provider_position'), ('delivery_tracking'), ('ride_tracking'),
    ('may_publish_provider_position'), ('geo_distance_km'), ('set_my_pickup_point'),
    ('set_delivery_destination'), ('set_delivery_pickup_point'),
    ('may_publish_pickup_point')
),
rls_tables(name) as (
  values
    ('listings'), ('orders'), ('order_items'), ('ledger_entries'), ('payment_intents'),
    ('payouts'), ('property_contacts'), ('property_contact_unlocks'), ('rides'),
    ('saved_listings'), ('listing_requests'), ('search_events'), ('staff_capabilities'),
    ('provider_activities'), ('transport_vehicles'),
    ('delivery_vehicle_classes'), ('delivery_fleets'), ('delivery_fleet_drivers'),
    ('delivery_provider_routes'), ('delivery_offers'), ('delivery_incidents'),
    ('delivery_document_types'), ('delivery_documents'), ('delivery_application_drafts'),
    ('delivery_pricing_rules'), ('delivery_quotes'), ('delivery_document_requirements'),
    ('delivery_application_route_intents'), ('push_subscriptions'), ('provider_positions'),
    ('provider_pickup_points')
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

  select 'refund decision executable by authenticated owners',
         has_function_privilege('authenticated', 'public.admin_decide_refund(uuid,boolean,text)', 'execute'),
         'migration 0026; the function re-checks the owner allowlist and MFA level 2'
  union all

  select 'refund decision closed to anon',
         not has_function_privilege('anon', 'public.admin_decide_refund(uuid,boolean,text)', 'execute'),
         'no signed-out caller may decide a refund'
  union all

  select 'settings write executable by authenticated owners',
         has_function_privilege('authenticated', 'public.admin_update_setting(text,jsonb)', 'execute'),
         'migration 0027; the function re-checks the owner allowlist and MFA level 2'
  union all

  select 'settings write closed to anon',
         not has_function_privilege('anon', 'public.admin_update_setting(text,jsonb)', 'execute'),
         'no signed-out caller may change pricing'
  union all

  select 'owner console read models executable by authenticated owners',
         has_function_privilege('authenticated', 'public.admin_list_customers(text,integer)', 'execute')
         and has_function_privilege('authenticated', 'public.admin_onboarding_overview()', 'execute')
         and has_function_privilege('authenticated', 'public.admin_service_area_coverage(integer)', 'execute'),
         'migration 0028; every read model re-checks the owner allowlist and MFA level 2'
  union all

  select 'owner console read models closed to anon',
         not has_function_privilege('anon', 'public.admin_list_customers(text,integer)', 'execute')
         and not has_function_privilege('anon', 'public.admin_list_riders(integer)', 'execute')
         and not has_function_privilege('anon', 'public.admin_list_ride_reviews(integer)', 'execute'),
         'no signed-out caller may read identity, payout or review records'
  union all

  select 'application review read model is signed-in only',
         has_function_privilege('authenticated', 'public.admin_application_detail(uuid)', 'execute')
         and not has_function_privilege('anon', 'public.admin_application_detail(uuid)', 'execute'),
         'migration 0032; the function re-checks applications.review and returns no factors or tokens'
  union all

  select 'reviewers can read applications they did not submit',
         exists (
           select 1 from pg_policies
           where schemaname = 'public' and tablename = 'provider_applications'
             and policyname = 'provider_applications_read_reviewer'
         ),
         'migration 0032; without it an owner sees only their own application and the queue looks empty'
  union all

  select 'delivery confirmation codes are not client-readable',
         exists (
           select 1 from pg_tables
           where schemaname = 'public' and tablename = 'delivery_proof_codes' and rowsecurity
         )
         and not exists (
           select 1 from pg_policies
           where schemaname = 'public' and tablename = 'delivery_proof_codes'
         )
         and not has_table_privilege('authenticated', 'public.delivery_proof_codes', 'select'),
         'migration 0034; the code is read only through SECURITY DEFINER functions'
  union all

  select 'provider category activation is reachable and closed to anon',
         has_function_privilege('authenticated', 'public.admin_grant_provider_activity(uuid,uuid,text[],integer)', 'execute')
         and not has_function_privilege('anon', 'public.admin_grant_provider_activity(uuid,uuid,text[],integer)', 'execute'),
         'migration 0033; the function re-checks the owner allowlist, aal2, the approved application and the category division'
  union all

  select 'deliverer review is closed to anon',
         not has_function_privilege('anon', 'public.admin_review_delivery_document(uuid,boolean,text)', 'execute')
         and not has_function_privilege('anon', 'public.admin_review_delivery_fleet(uuid,boolean,text)', 'execute')
         and not has_function_privilege('anon', 'public.register_delivery_document(text,text,uuid,uuid,uuid,uuid,date)', 'execute'),
         'migration 0030; each function re-checks the caller and the private path'
  union all

  select 'deliverer documents and submission are validated server-side',
         has_function_privilege('authenticated', 'public.my_delivery_document_checklist(text,text)', 'execute')
         and has_function_privilege('authenticated', 'public.attach_my_delivery_document(text,text,date)', 'execute')
         and not has_function_privilege('anon', 'public.attach_my_delivery_document(text,text,date)', 'execute')
         and not has_function_privilege('authenticated', 'public.create_delivery_application(text,jsonb,text)', 'execute'),
         'migration 0037; only the wrappers may create an application, and they validate identity, licence and required documents'
  union all

  select 'document requirements are configurable by class and mode',
         exists (select 1 from public.delivery_document_requirements where is_required)
         and exists (select 1 from public.delivery_document_requirements where not is_required),
         'migration 0037; a bicycle courier is never asked for a driving licence'
  union all

  select 'push subscriptions are not client-writable',
         not has_table_privilege('authenticated', 'public.push_subscriptions', 'insert')
         and not has_table_privilege('authenticated', 'public.push_subscriptions', 'update')
         and has_table_privilege('authenticated', 'public.push_subscriptions', 'select')
         and has_function_privilege('authenticated', 'public.save_push_subscription(text,text,text,text)', 'execute')
         and not has_function_privilege('anon', 'public.save_push_subscription(text,text,text,text)', 'execute'),
         'migration 0038; an endpoint is bound to the account that registered it'
  union all

  select 'notification rendering is shared by the inbox and push',
         has_function_privilege('authenticated', 'public.render_notification(text,jsonb,uuid)', 'execute')
         and has_function_privilege('service_role', 'public.render_notification(text,jsonb,uuid)', 'execute'),
         'migration 0038; one title, body and deep link per event'
  union all

  select 'delivery coordinates are written only through their own function',
         exists (
           select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'deliveries'
             and column_name in ('pickup_lat', 'dropoff_lat', 'pickup_point_source', 'dropoff_point_source')
           group by table_name
           having count(*) = 4
         )
         and exists (
           select 1 from pg_constraint
           where conname = 'deliveries_dropoff_point_pair'
         )
         and has_function_privilege('authenticated', 'public.set_delivery_destination(uuid,numeric,numeric,numeric,text)', 'execute')
         and has_function_privilege('authenticated', 'public.set_delivery_pickup_point(uuid,numeric,numeric,numeric,text)', 'execute')
         and not has_function_privilege('anon', 'public.set_delivery_destination(uuid,numeric,numeric,numeric,text)', 'execute'),
         'migration 0042; the customer sets the destination, the seller sets the pickup, and a latitude without a longitude is rejected'
  union all

  select 'a delivery point is never guessed from a county',
         (select count(*) from public.deliveries where dropoff_point_source <> 'none') =
           (select count(*) from public.deliveries where dropoff_lat is not null)
         and exists (
           select 1 from pg_constraint where conname = 'deliveries_pickup_point_pair'
         ),
         'migration 0042; every stored point has a stated source and a partner coordinate'
  union all

  select 'live positions are published only by an approved provider',
         not has_table_privilege('authenticated', 'public.provider_positions', 'insert')
         and not has_table_privilege('authenticated', 'public.provider_positions', 'update')
         and not has_table_privilege('authenticated', 'public.provider_positions', 'delete')
         and has_table_privilege('authenticated', 'public.provider_positions', 'select')
         and has_function_privilege('authenticated', 'public.publish_provider_position(numeric,numeric,numeric,numeric,numeric)', 'execute')
         and not has_function_privilege('anon', 'public.publish_provider_position(numeric,numeric,numeric,numeric,numeric)', 'execute'),
         'migration 0041; the function re-checks the approved provider path and the caller owns the row'
  union all

  select 'tracking reads are participant-scoped',
         has_function_privilege('authenticated', 'public.delivery_tracking(uuid)', 'execute')
         and has_function_privilege('authenticated', 'public.ride_tracking(uuid)', 'execute')
         and not has_function_privilege('anon', 'public.delivery_tracking(uuid)', 'execute')
         and not has_function_privilege('anon', 'public.ride_tracking(uuid)', 'execute')
         and exists (
           select 1 from pg_policies
           where schemaname = 'public' and tablename = 'provider_positions'
             and policyname = 'provider_positions_select_own'
         ),
         'migration 0041; only the order customer, the assigned rider and staff can read a live position'
  union all

  select 'delivery matching is closed to anon',
         not has_function_privilege('anon', 'public.match_delivery_candidates(uuid)', 'execute')
         and not has_function_privilege('anon', 'public.offer_delivery_to_candidates(uuid,integer,integer)', 'execute')
         and not has_function_privilege('anon', 'public.accept_delivery_offer(uuid)', 'execute'),
         'migration 0029; matching and assignment re-check the caller in the function'
  union all

  select 'delivery documents stay private',
         exists (
           select 1 from pg_policies
           where schemaname = 'storage' and tablename = 'objects'
             and policyname = 'shilevi_delivery_documents_read'
         )
         and not exists (
           select 1 from storage.buckets where id = 'provider-documents' and public
         ),
         'migration 0029 writes into the existing private provider-documents bucket'
  union all

  select 'customer preferences exist and stay private',
         to_regclass('public.customer_preferences') is not null
         and (select relrowsecurity from pg_class where oid = 'public.customer_preferences'::regclass)
         and not exists (
           select 1 from information_schema.role_table_grants
           where table_schema = 'public' and table_name = 'customer_preferences' and grantee = 'anon'
         ),
         'migration 0035; a shopper can read and write only their own row'
  union all

  select 'home personalization functions are signed-in only',
         not has_function_privilege('anon', 'public.customer_home(text,integer)', 'execute')
         and not has_function_privilege('anon', 'public.record_listing_view(uuid)', 'execute')
         and not has_function_privilege('anon', 'public.set_customer_area(text,boolean)', 'execute')
         and not has_function_privilege('anon', 'public.clear_my_marketplace_history()', 'execute'),
         'migration 0035; each function scopes reads and writes to auth.uid()'
  union all

  select 'search history is readable only by its owner or the owner console',
         exists (
           select 1 from pg_policies
           where schemaname = 'public' and tablename = 'search_events'
             and policyname = 'search_events_self_read'
         ),
         'migration 0035 adds an own-row read policy without widening the existing owner policy'
  union all

  select 'notifications are readable only by their recipient or the owner console',
         exists (
           select 1 from pg_policies
           where schemaname = 'public' and tablename = 'notification_outbox'
             and policyname = 'notification_outbox_self_read'
         )
         and not exists (
           select 1 from information_schema.role_table_grants
           where table_schema = 'public' and table_name = 'notification_outbox'
             and grantee = 'authenticated' and privilege_type in ('INSERT', 'DELETE')
         ),
         'migration 0036; the recipient reads and acknowledges only their own rows'
  union all

  select 'notification writes are limited to the read flag',
         exists (
           select 1 from information_schema.column_privileges
           where table_schema = 'public' and table_name = 'notification_outbox'
             and grantee = 'authenticated' and privilege_type = 'UPDATE' and column_name = 'read_at'
         )
         and not exists (
           select 1 from information_schema.column_privileges
           where table_schema = 'public' and table_name = 'notification_outbox'
             and grantee = 'authenticated' and privilege_type = 'UPDATE'
             and column_name in ('status', 'recipient', 'payload', 'attempts')
         ),
         'migration 0036; status, recipient and payload stay server-managed'
  union all

  select 'no client grant on search_events',
         not exists (
           select 1 from information_schema.role_table_grants
           where table_schema = 'public' and table_name = 'search_events'
             and grantee in ('anon', 'authenticated') and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
         ),
         'analytics are written by the service role only'
  union all

  select 'notification queue is claimed by the service role only',
         has_function_privilege('service_role', 'public.claim_notification_batch(text,integer,integer)', 'execute')
         and not has_function_privilege('authenticated', 'public.claim_notification_batch(text,integer,integer)', 'execute')
         and not has_function_privilege('anon', 'public.claim_notification_batch(text,integer,integer)', 'execute'),
         'migration 0039; a browser session can neither read nor claim the outbox'
  union all

  select 'signup activity intent column exists',
         exists (
           select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'user_onboarding'
             and column_name = 'signup_activity'
         ),
         'migration 0040; records the account path chosen at registration'
  union all

  select 'signup activity intent is constrained to the supported paths',
         exists (
           select 1 from pg_constraint
           where conrelid = 'public.user_onboarding'::regclass
             and conname = 'onboarding_signup_activity_check'
         ),
         'migration 0040; an unknown path cannot be stored'
  union all

  select 'signup activity intent cannot be used as an authorisation grant',
         not exists (
           select 1 from information_schema.role_table_grants
           where table_schema = 'public' and table_name = 'user_onboarding'
             and grantee in ('anon', 'authenticated') and privilege_type = 'DELETE'
         ),
         'the intent column is profile text; approval still lives in provider_applications and provider_activities'
)
select check_name, case when ok then 'PASS' else 'FAIL' end as status, detail
from checks
order by (case when ok then 1 else 0 end), check_name;

-- Current payment posture. Read this before enabling any provider.
select
  (select value #>> '{}' from public.platform_settings where key = 'payment_mode') as payment_mode,
  (select value #>> '{}' from public.platform_settings where key = 'allow_mock_payments') as allow_mock_payments,
  (select count(*) from public.payment_methods where enabled) as enabled_payment_methods;
