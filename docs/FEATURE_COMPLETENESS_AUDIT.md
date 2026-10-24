# Shilevi Feature Completeness Audit

Audit date: 2026-10-20 (updated after customer/provider request workflow implementation)  
Scope: repository source and authored migrations on `main`. This is a code/documentation audit only. No live Supabase project was accessed, no SQL was executed, and no browser-based end-to-end test was performed.

## Status definitions

- **Implemented in code**: a route or workflow exists in the repository; this does not prove it works against a configured database.
- **Partial**: only part of the expected journey exists.
- **Missing**: no corresponding end-user workflow was found in the inspected application tree.
- **Needs environment verification**: requires the owner to apply reviewed migrations and test against staging Supabase/Auth/provider settings.

## Customer journey

| Capability | Status | Evidence / gap |
|---|---|---|
| Email signup | Implemented in code; needs environment verification | `/signup` calls Supabase Auth sign-up. Verify email confirmation, redirect allowlist and error states in staging. |
| Google signup/login | Implemented in code; needs environment verification | OAuth actions exist. Provider credentials and redirect configuration are external prerequisites. |
| Email/password login | Implemented in code; needs environment verification | `/login` calls Supabase password sign-in. Test session persistence and safe return paths in staging. |
| Forgot/reset password | Implemented in code; needs environment verification | `/forgot-password` and `/reset-password` exist. Email delivery, callback and expired-link flows need testing. |
| Auth callback | Implemented in code; needs environment verification | Callback route exists; test real email/OAuth links and direct post-login routing. |
| Initial profile onboarding | Partial | Name, phone, country, county, town and first-use intent can be saved. It is not a complete profile/settings center. |
| View/edit personal profile after onboarding | Implemented in code; needs environment verification | `/account/settings` now edits onboarding profile fields with client validation; requires migration 0004 and staging RLS verification. |
| Account settings | Partial | `/account/settings` includes profile fields, password changes and deletion-request submission. Notification preferences and pending-request cancellation are implemented in code; connected identity management and session/MFA management remain outstanding. Email change requests provider confirmation and needs staging verification. |
| Change password while signed in | Implemented in code for email/password identities; needs environment verification | `/account/settings` verifies the current password before calling Supabase Auth to update it. OAuth-only identities must change passwords with their identity provider. |
| Delete account / request account deletion | Partial | `/account/settings` submits a confirmed, recent-authentication-gated request (migrations 0008–0009). `/admin/deletion-requests` adds an owner-only MFA-gated review queue. Neither route deletes the account or cleans Storage; actual deletion processing and retention verification remain missing; pending-request cancellation is implemented in migration 0010 and the account settings UI; staging verification is still required. |
| Browse divisions and categories | Implemented in code; needs environment verification | Homepage and `/marketplace/[division]` query active categories. |
| Homepage feeds and brands | Implemented in code; needs environment verification | Homepage has category/listing discovery and brand presentation; content depends on database records. |
| Search, filters and sorting | Implemented in code; needs environment verification | `/search` provides global published-title search across active divisions with price filters and sorting; division pages support category selection, title search, price range and sorting. Results are capped at 100 globally / 48 per division view. |
| Listing detail page | Partial | `/listing/[id]` displays published listing description, price, category, active brand and approximate location, with unavailable transaction/payment workflows clearly disclosed. Provider profile, availability, purchase/booking and report actions remain missing. |
| Saved/favourite listings | Implemented in code; needs environment verification | `/listing/[id]` can save/unsave published listings; `/account/saved` lists and removes saved items; migration 0011 applies user-scoped RLS. Test after manual migration. |
| Customer-to-provider listing enquiry | Implemented in code; needs environment verification | `/listing/[id]` submits enquiries; `/account/requests` lists customer requests and allows customer closure; `/provider/requests` provides the provider inbox and guarded accept/decline responses. Migration 0014 enforces participant access, published-listing checks, immutable original messages and status transitions. Requires manual migration review/application and staging negative tests. This is not checkout, a booking, or a contract. |
| Cart / checkout / service booking | Missing | No complete order/booking flow or confirmed-total checkout found. Avoid implying a customer can already purchase or book end-to-end. |
| Order history and order status | Missing | No customer orders area found. |
| Customer-provider messaging | Missing | No in-product communication workflow found. |
| Cancellation, refund, issue report and dispute | Missing | No customer-facing case-management workflow found. |
| Reviews/ratings | Missing | No end-to-end review workflow found. |
| Customer notifications | Partial | Account settings store per-user preferences through migrations 0012–0013 with column-level grants. Notification delivery, inbox, unsubscribe handling and event generation are not implemented. |

## Provider journey

| Capability | Status | Evidence / gap |
|---|---|---|
| Apply for provider activities | Implemented in code; needs environment verification | `/provider/apply` supports separate applications by activity, saving drafts and submitting for review. |
| Review provider application as owner | Implemented in code; needs environment verification | Admin application UI and migration 0006 transition guards exist. Actual RLS behavior must be tested after manual migration execution. |
| Provider transport details draft | Partial | `/provider/transport-details` saves vehicle type, optional registration, counties and towns against a draft transport application. It is not identity, licence or vehicle verification. |
| Provider listing draft creation | Implemented in code; needs environment verification | `/provider/listings` supports draft creation for approved activity/category combinations. |
| Edit existing listing drafts | Partial/needs verification | Database permissions are intended to limit providers to draft content fields; inspect UI and test policy/column-grant interactions in staging. |
| Upload listing photos/media | Missing | No full media upload and moderation flow found. |
| Listing inventory, availability, variants and attributes | Missing/partial | Schema has a generic attributes field, but a complete division-specific listing editor and stock/availability lifecycle are not present. |
| Provider storefront management | Partial | Public brand storefront exists, but a full provider profile/storefront editor was not found. |
| Customer enquiry responses | Implemented in code; needs environment verification | `/provider/requests` supports responses to open listing enquiries; it does not establish a confirmed quote, booking, or order. |
| Quotes, bookings and order management | Missing | No provider order/quote lifecycle found. |
| Provider earnings, fees, payout setup and payout history | Missing | No provider finance dashboard or payout onboarding found. |
| Provider identity/business verification | Missing | Draft application text is not verification. A secure document review/verification process remains to be designed and implemented. |
| Provider settings, pause/deactivate and account deletion | Missing | No full provider settings and lifecycle controls found. |

## Rider / transport journey

| Capability | Status | Evidence / gap |
|---|---|---|
| Apply as transport partner | Partial | Transport activity can be selected in provider applications. |
| Vehicle and service area details | Partial | Draft form supports vehicle type, optional registration, counties and towns. |
| Rider personal/identity information | Missing/partial | No complete rider-specific profile, identity verification, licence/insurance/vehicle document workflow was found. Sensitive documents must use private storage and narrow access. |
| Rider payment/payout details | Missing | No payout provider onboarding, verified payout destination, change-protection or payout history found. Do not collect bank/mobile-money credentials in ordinary profile fields. |
| Rider offer inbox and accept/decline | Missing | No delivery offer workflow found. |
| Seller selection and atomic rider assignment | Missing | No assignment transaction or race-condition protection found. |
| Pickup/destination privacy and active-delivery tracking | Missing | No location-sharing lifecycle or role-limited exact-address reveal found. |
| Handover PIN/proof, failed delivery and safety events | Missing | No completion or exception workflow found. |
| Rider earnings, fees, disputes and ratings | Missing | No complete rider operations dashboard found. |

## Admin and operations

| Capability | Status | Evidence / gap |
|---|---|---|
| Owner allowlist and MFA gate | Implemented in code/migrations; needs environment verification | Exact allowlist is documented as `russhiraz565@gmail.com` and `russhiraz1@gmail.com`; sensitive DB writes intend to require `aal2`. Verify server and database gates in staging. |
| Category and brand administration | Implemented in code; needs environment verification | Admin routes and database policy migration exist. |
| Listing moderation | Implemented in code; needs environment verification | Admin listing UI and publication validation are authored; test negative cases against actual RLS. |
| Provider application review | Implemented in code; needs environment verification | UI and guarded state transitions exist. |
| User management, suspension and role support | Missing/partial | No complete admin user/session/role management suite found. |
| Orders, deliveries, refunds, payouts and disputes admin | Missing | These underlying business workflows are not implemented yet. |
| Payments and commission ledger | Missing | No payment integration or auditable double-entry/ledger flow found. Commission is a product requirement, not an implemented financial system. |
| Support inbox, reports, moderation cases | Missing/partial | No complete operational case management suite found. |
| Feature flags, integration credentials and settings console | Missing | No secure owner-only settings center for integrations, feature switches or secret rotation found. Secrets must remain server-side. |
| Audit and analytics | Partial | Some database audit patterns are drafted, but a complete operational audit viewer and reliable analytics are not present. |

## Repository / security / release readiness

- Twelve SQL migration files (0001–0012) are authored. They are **manual-review artifacts**, not proof of a deployed schema.
- The repo has GitHub Actions for lint/typecheck/build; a passing CI run does not prove runtime, RLS, Auth redirects, payment flows or mobile usability.
- No live Supabase project was accessed and no migration was run as part of this audit.
- Need staging tests for unauthenticated access, cross-user reads/writes, owner vs non-owner admin access, MFA-required writes, draft/publish transitions, profile editing, password/email changes, notification preferences, saved listings, global search, recent-authentication deletion-request submission, and owner-only request review transitions.
- Dependency audit previously reported 7 npm vulnerabilities (6 high); triage and safe upgrades are still required.
- Responsive homepage exists and is vertically scrollable, but marketplace cards/details and complete purchase/booking actions are not yet a finished marketplace journey.
- Trust/legal pages and reviewed policies (terms, privacy, prohibited listings, cancellation/refunds, provider/rider terms, complaints and data retention) remain necessary before launch.

## Recommended build order: finish the customer experience first

1. **Customer account lifecycle**: profile editing and email/password change UI are now implemented in code; actual deletion processing, session/MFA controls, notification preferences and full staging tests remain outstanding; email change and pending-request cancellation are implemented in code and need staging verification.
2. **Discovery**: global search, division/category filters, sorting, robust empty/error/loading states, clickable cards and listing detail pages.
3. **Customer transaction journey**: saved items, quote/cart/booking model per division, transparent totals, order creation, order history/status, cancellation and support/disputes.
4. **Provider lifecycle**: complete activity-specific profile and verification, listing media/editor, availability/inventory, quotes/orders, settings and provider status.
5. **Rider lifecycle**: private verification, payout setup through a suitable provider, service areas, offer/assignment flow, tracking privacy, handover and safety exceptions.
6. **Finance and admin operations**: payment integration, ledger, commission rules, refunds/payouts, disputes, secure integration settings, support and audit.
7. **Launch gates**: reviewed legal requirements, migration review/application by owner, staging E2E tests, RLS negative tests, accessibility, dependency audit, performance and recovery drills.

## Completion rule

A feature is not marked complete just because a page exists. Mark it complete only when its UI, validation, authorization, database transitions, success/failure states and tests have been reviewed. Where live credentials or a staging database are required, keep the status as **needs environment verification** until those checks are actually performed.
