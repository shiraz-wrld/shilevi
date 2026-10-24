# Supabase SQL workflow

All database changes must be versioned under `supabase/migrations/` and reviewed before application. This repository is not connected to a live Supabase project, and no SQL in this repository has been executed by ChatGPT.

1. Create your own Supabase project.
2. Review each migration and the official current Supabase documentation.
3. Apply migrations in order using your own authenticated Supabase CLI or dashboard workflow.
4. Verify schema, RLS policies and advisors in that project.
5. Never commit service-role keys or database passwords.
6. Do not apply unreviewed migrations directly to production.

## Current migration sequence

- `0001_initial_marketplace_schema.sql` — profiles, categories, provider applications, listings, and audit-event base table.
- `0002_identity_provider_workflow.sql` — profile bootstrap, protected role grants, provider application constraints, and draft-only listing rules.
- `0003_discovery_brands_admin_allowlist.sql` — brand storefront records, listing publication timestamps/visibility, and the two-email owner allowlist.
- `0004_customer_provider_onboarding.sql` — customer profile onboarding and transport-partner service-area/vehicle draft details.
- `0005_admin_database_policies.sql` — verified-owner RLS helper, category/brand management policies, narrow moderation grants, and PII-minimized audit triggers.
- `0006_provider_application_transitions.sql` — applicant-only draft submission transition and owner review transition guard; relies on the verified-owner `aal2` helper and existing audit trigger.
- `0007_provider_listing_drafts.sql` — narrow listing write grants and owner-scoped draft creation policy for approved providers and matching active categories.
- `0008_account_settings_deletion_requests.sql` — user-scoped account-deletion request records with one open request per user and no client-side permission to modify request status or erase the request audit trail.
- `0009_account_deletion_review_workflow.sql` — recent-authentication gate for submissions, owner/MFA-gated review policies, and guarded request state transitions.
- `0010_account_deletion_request_cancellation.sql` — lets a user cancel their own still-pending request, while preventing cancellation after review begins.
- `0011_saved_listings.sql` — private saved-listing records with user-scoped read/delete and insert checks requiring a currently published listing in an active category.
- `0012_notification_preferences.sql` — user-scoped notification preference storage; it does not implement delivery channels.
- `0013_notification_preferences_column_grants.sql` — corrective hardening that limits authenticated users to updating preference fields, not the row identity or server-managed timestamp.
- `0014_listing_requests.sql` — customer-to-provider listing enquiries with participant-only reads, published-listing checks, immutable messages, guarded provider responses and customer closure. This does not create orders, bookings or payments.

Review these sequentially before applying. They are authored migrations, not evidence that the database has the matching schema. Migrations 0008–0010 store requests, allow cancellation while pending, and provide an MFA-gated owner review queue; they do not delete an Auth user or remove Storage objects automatically. “Completed” is only a recorded review status and must be used after the actual deletion/retention work is separately completed. Any future deletion processor must use a trusted server environment, check storage ownership and legal/financial retention obligations, and never expose a Supabase secret/service-role key in the browser. The auth callback, owner guard, UI and migration sequence still require manual staging validation. Orders, bookings, inventory, payments/ledger, webhooks, rider assignment, private Storage policies, identity verification, and complete admin operations are not implemented yet.
