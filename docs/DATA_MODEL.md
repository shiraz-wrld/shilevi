# Data Model

All migrations under `supabase/migrations/` are ordered SQL files for owner review and manual execution. They have not been run against a live database.

## Identity and permissions
- `auth.users`: Supabase Auth identity.
- `profiles`: bounded display name, phone, country code; users may only read their own row and edit explicitly granted profile fields.
- `user_roles`: server-managed role grants. Ordinary users cannot grant or change roles.
- `owner_admin_allowlist`: private allowlist seeded with `russhiraz565@gmail.com` and `russhiraz1@gmail.com`. No anon/authenticated access is granted. Future server-side admin guards must use the verified Auth email, normalize it, check email verification, and fail closed. A browser-side email comparison is not authorization.

## Marketplace taxonomy and brands
- `marketplace_categories`: division, parent category, slug, label, description, active state, sort order and a JSON object for category-specific schema.
- `marketplace_brands`: public brand storefront metadata; inactive brands are private to trusted operations. A brand record does not prove a partnership or endorsement.
- `listings`: provider-owned listings with category, approved provider application, draft/review/published lifecycle, integer minor-unit price, currency, structured attributes, optional approximate location, optional brand, featured flag and publication timestamp.
- Public listing discovery must return published listings only and must hide listings attached to inactive brands. Client users cannot publish or feature content.
- Featured/newest feeds must derive from real database rows. Do not label listings as best-selling, trending, or popular until trustworthy order/event data exists.

## Onboarding and transport details
- `user_onboarding`: user-owned full name, optional phone, country code, optional county/town, and initial customer/provider intent. It does not store live GPS coordinates.
- `transport_partner_details`: vehicle type and service-area counties/towns linked to the user's own draft transport application. Verification and review fields are server-managed and cannot be changed through ordinary client column grants.
- Do not require a customer to provide rider-only information. Driver/rider documents require a separately designed private Storage and verification workflow.
- Exact delivery addresses and live rider GPS belong to later order/delivery flows with purpose limitation and active-job access checks, not registration or public listings.

## Owner administration\n- `owner_admin_allowlist` stores the two approved owner emails and is inaccessible to anon/authenticated clients. Migration 0005 adds `is_shilevi_owner_admin()` for database RLS checks. Category and brand management is owner-only; listing moderation grants are deliberately limited to status, featured flag, and brand association. A publication trigger validates approved provider ownership, matching active category division, and active brand status.\n\n## Provider workflow
- `provider_applications`: one application per user/activity; draft creation is client-accessible only for the signed-in user. Submission/review/approval/rejection/suspension are trusted server/admin transitions.
- Activities: product seller, service provider, transport/delivery partner, property/places provider.
- Approval and active category must match the listing's division before a listing draft can be created.

## Audit
- `audit_events`: intended for trusted server-side audit writes; not available to ordinary client roles.

## Orders and deliveries (migration 0016)
- `orders`: one customer, one provider, one delivery method, a server-generated order number (`SX-YYMMDD-NNNNNN`), integer-minor-unit totals, a frozen price/commission snapshot, contact phone, delivery address and a per-vertical status. Customers may read only their own orders; providers only orders addressed to them.
- `order_items`: title, unit price and quantity snapshotted at order time, so a later listing edit cannot rewrite a past order.
- `order_status_history`: append-only status trail written by trusted RPCs, not by clients.
- `deliveries`: optional assignment of an approved transport partner to an order, with pickup/drop-off text, delivery fee, rider payout, an atomic claim timestamp and a hashed handover code.
- `delivery_events`: append-only rider/delivery trail.
- All state changes go through `security definer` RPCs with participant checks: `create_order`, `customer_cancel_order`, `provider_update_order_status`, `customer_confirm_order`, `accept_delivery`, `rider_update_delivery`, plus read helpers `list_available_deliveries` and `get_delivery_proof_code`. Direct client `update` on these tables is not granted.
- `platform_settings` is private configuration (currency, payment mode, commission and delivery fee) readable only through `get_checkout_settings()`, which exposes an allowlisted subset.

## Payments, ledger and commission (migration 0017)
- `commission_rules` / `commission_tiers`: configurable rate in basis points, scoped global/division/category, with min/max commission, effective dates and optional tiers. Default is 10% (1000 bps).
- `payment_events`: provider-agnostic payment records (provider, reference, amount, status, raw payload). Unique reference per provider makes webhook handling idempotent.
- `ledger_entries`: double-entry rows in integer minor units, each tied to an account (`customer`, `platform_commission`, `platform_delivery`, `provider_payable`, `rider_payable`, `settlement`). Sum per order must balance; no client access.
- `refunds` and `payouts`: request/decision/execution records with status trails.
- `confirm_mock_payment` explicitly simulates a successful payment in sandbox mode. It is not a real charge and must never be presented as one.
- `request_order_refund` is customer-initiated; `admin_decide_refund` is owner-only; `admin_update_setting` / `get_admin_settings` are owner-only configuration paths. Provider credentials are **not** stored in `platform_settings` — only the enabled flag and non-secret parameters belong there.

## Coverage and activation (migration 0018)
- `service_locations`: Kenyan counties/towns with codes, active flag and sort order, used for delivery pricing and provider coverage.
- `provider_service_areas`: which counties a provider or rider actually covers; a rider job is only offered where coverage matches.
- `category_activation`: per-category switches (enabled, enquiry-only, payment provider) so a division can be opened to transactions only when its legal and payment requirements are met.

## Still to model
- Bookings and quotations for services and property (the order spine exists, but per-vertical booking schedules and inspection/visit slots do not).
- Inventory and stock reservation against concurrent orders.
- Reviews and rating aggregates, disputes with evidence, notifications, and identity/KYC verification with retention rules.
- Rider identity/location fields must be collected only when relevant, with clear consent and purpose; precise live location should be disclosed only during an active assigned delivery.
