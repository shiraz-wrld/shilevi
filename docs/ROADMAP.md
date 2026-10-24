# Roadmap

## Current build status (2026-10-20)

The first end-to-end transaction slice exists in the repository:
- Customer cart (`/cart`), checkout (`/checkout`), order history (`/account/orders`), order detail with status and refund request (`/account/orders/[id]`).
- Provider order queue (`/provider/orders`) and rider job board plus job detail (`/rider/jobs`, `/rider/jobs/[id]`).
- Migrations `0016_orders_deliveries.sql`, `0017_payments_ledger_commission.sql` and `0018_kenya_locations_coverage.sql` add orders, deliveries, commission rules, payment events, a double-entry ledger, refunds, payouts, Kenyan service locations and category activation.
- Money is integer minor units in `src/lib/money.ts`; order status transitions live in `src/lib/order-status.ts`.
- Payment is **sandbox only** (`payment_mode = mock`). No M-Pesa or card charge happens. `confirm_mock_payment` writes a simulated payment and real ledger entries so the loop can be tested before a licensed provider is connected.
- These migrations are repository code only and must be reviewed and manually applied before the pages work against Supabase. No live project was touched.

## Previously recorded (2026-10-19)

The customer account-centre implementation has begun:
- `/account/settings` now provides profile editing, password change for email/password identities, and a deletion-request submission UI.
- Migration `0008_account_settings_deletion_requests.sql` records one open deletion request per user and prevents ordinary users from changing request status.
- The account dashboard links to settings.
- These changes are repository code only. Migration 0008 must be reviewed and manually applied by the owner before its deletion-request form can work against Supabase.
- Account deletion is **request-only**, not automatic deletion. A secure staff processing workflow, request cancellation, verified OAuth reauthentication, active-session management, email-change verification and staging tests remain outstanding.

## Product roadmap

1. Foundation, branded responsive shell, email/Google auth and password recovery.
2. Customer account lifecycle: profile view/edit, security, deletion request and account preferences. This is in progress; not all account controls are complete.
3. Marketplace discovery: active categories, public published listings, featured/newest feeds, brand storefronts, global search, filters, sorting and listing detail pages. Existing discovery is partial.
4. Profile bootstrap, protected roles, provider applications and database integrity.
5. Customer/provider onboarding and division-specific profiles, including rider eligibility, service areas, vehicle details and privacy-aware location handling (migration 0004 and customer-first onboarding UI drafted; rider verification and payout details remain pending).
6. Listing creation/editing and secure admin category/brand/listing moderation (owner gate, category manager, brand manager, listing moderation UI, and manual SQL policies drafted; database workflow not yet tested against Supabase).
7. Orders for products: cart, checkout, status spine, customer/provider/rider queues. **Drafted (0016).** Bookings, quotes and inventory are still outstanding.
8. Payments, ledger, disclosed commission, refunds and payouts; confirm Kenyan legal/provider requirements before escrow-like behavior. **Sandbox ledger drafted (0017).** A real provider integration, webhook verification, payout execution and reconciliation remain.
9. Rider offers, atomic assignment, active-delivery tracking, handover proof and safety flows. **Claim, status updates and proof code drafted (0016).** Live tracking, offers expiry/reassignment and the PWA are outstanding.
10. Admin operations, notifications, integrations, audit and analytics. Owner settings/refund decisions drafted; staff roles, queues, transactional notifications and analytics remain.
11. Legal, accessibility, automated E2E/security/load testing, staging review and staged production rollout.

No milestone is considered production-ready merely because its UI exists. Each needs database/RLS review, server authorization, real execution tests, and documented manual setup.
