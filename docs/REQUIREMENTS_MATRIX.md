# Shilevi requirements matrix

**Updated:** 2026-10-24 (release pass: repository organisation, deployment packaging, security audit)
**Sources read:** `docs/MASTER_BLUEPRINT.md`, `docs/TAXONOMY.md`, `docs/PRODUCT_REQUIREMENTS.md`,
`docs/ROADMAP.md`, `docs/FEATURE_COMPLETENESS_AUDIT.md`, `docs/DATA_MODEL.md`, `docs/SECURITY.md`,
`docs/PLATFORM_AUDIT.md`, all `supabase/migrations/0001–0021`, the application routes and the
existing tests.

**Status labels:** PASS — implemented and verified by the named test · PARTIAL — some required
behaviour is missing · BLOCKED — external credential, approval or decision required · NOT TESTED —
insufficient evidence · FAIL — the relevant test failed.

This matrix describes the repository, not a live deployment. No live Supabase, Safaricom, Resend
or DNS check was performed.

---

## 1. Accounts, roles and onboarding

| Requirement | Status | Implementation / evidence |
|---|---|---|
| Customer signup, login, logout, password recovery | PARTIAL | `src/app/signup`, `login`, `forgot-password`, `reset-password`, `/api/auth/signout`; typecheck/build pass. Live Supabase flow **NOT TESTED**. |
| Email verification | PARTIAL | Supabase callback + owner confirmation check; live delivery **BLOCKED** (`docs/EMAIL.md`). |
| MFA for privileged access | PARTIAL | Enrollment UI + owner `aal2` checks in `is_shilevi_owner_admin`; live enrollment **NOT TESTED**. |
| Customer profile/settings | PARTIAL | `/account/settings` exists; no address book or saved payment methods. |
| One account, multiple activities | PASS (DB) | `provider_applications` unique per `(user_id, activity_type)`; separate approvals; no cross-activity permission. |
| Activity-specific application questions | PARTIAL | `provider/apply` now asks seller/service/transport/property-specific questions and saves them in `application_data`; documents are not uploaded here. |
| Salon/beauty-specific workflows | PARTIAL | Service application collects services, area, availability and qualifications; no treatment catalogue, staff calendars or appointment slots. |
| Approval gate before provider capability | PASS (DB) | `provider_activities` + listing policies/triggers; an unapproved activity cannot publish. |
| Owner allowlist, no self-elevation | PASS (DB) | `owner_admin_allowlist` seeds the two owner emails; `user_roles`/`staff_capabilities` have no client write policy; self-grant test passes. |
| Staff capabilities | PARTIAL | `staff_capabilities` + `has_staff_capability` + grant/revoke RPCs; scoped pages for rides, properties and payments. Other admin modules remain owner-only. |

## 2. Products, services, orders and delivery

| Requirement | Status | Implementation / evidence |
|---|---|---|
| Product discovery and listing detail | PARTIAL | `/search` now runs database full-text search with taxonomy, county and price filters, relevance ranking and pagination (`0025`, `docs/SEARCH.md`); listing detail pages unchanged; sandbox data only. |
| Cart and single-seller checkout | PARTIAL | Cart provider + `/checkout`; order creation is server-priced. |
| Seller order acceptance and fulfilment | PASS (DB) | `provider_update_order_status`; tested. |
| Delivery job claim and proof of handover | PASS (DB) | `accept_delivery`, `rider_update_delivery`, proof code; tested. |
| Delivery distinct from passenger rides | PASS (DB) | `deliveries` and `rides` are separate tables, state machines and UI flows. |
| Service booking/quote workflow | PARTIAL | Enquiries exist; no calendar/booking entity. |
| Category-specific seller fields | PARTIAL | Application asks product groups/fulfilment; listing attributes remain generic. |
| Real product payments | BLOCKED | M-Pesa code exists; credentials and approval missing. Card provider undecided. |

## 3. Passenger transport

| Requirement | Status | Implementation / evidence |
|---|---|---|
| Separate ride entity | PASS (DB) | `rides`, `ride_offers`, `ride_events`, `ride_reviews` in `0020`. |
| Approved rider + vehicle eligibility | PASS (DB) | Approved transport activity plus approved, active vehicle for the requested mode; tested. |
| Customer chooses approved rider | PASS (DB) | `list_available_riders` exposes only approved active vehicles. |
| Proposed fare, accept/counter/decline | PASS (DB) | `request_ride`, `ride_respond`, `ride_customer_respond`; history retained; tested. |
| Final fare cannot be silently changed | PASS (DB) | Agreed fare snapshotted; paid ride rewrite blocked by trigger; tested. |
| Payment before trip starts | PASS (DB) | `mark_ride_paid`; rider progress requires `paid`; tested. |
| Trip lifecycle | PASS (DB) | `requested → countered/agreed → paid → arrived → in_progress → rider_completed → completed`; invalid transitions rejected; tested. |
| Dual confirmation and earnings release | PASS (DB) | Rider confirms at `rider_completed`, customer via `ride_customer_confirm`; `released_at` only then; tested. |
| Contact privacy | PASS (DB) | `get_ride_contact` only for the two parties after payment; tested. |
| Rating | PASS (DB) | `rate_ride`, one per completed ride; tested. |
| Cancellation/refund after payment | PARTIAL | Customer cancel before payment; after payment a rider cancellation marks `refund_pending`; no dedicated ride refund RPC/dispute case yet. |
| Live map / GPS tracking | NOT IMPLEMENTED | The schema stores optional coordinates but there is no map, live location or ETA. |
| Customer and rider UI | PARTIAL | `/transport` and `/rider/rides` call the real RPCs; no authenticated browser test was run because there is no live project. |

## 4. House Hunt

| Requirement | Status | Implementation / evidence |
|---|---|---|
| Free browsing and search | PASS (DB) | `search_public_properties`; no exact address/contact columns; tested. |
| Public facts: rent, deposit, type, bedrooms, amenities, general area | PASS (DB) | `property_listings` + search RPC; tested. |
| Dedicated landlord/property application | PARTIAL | Property provider application questions + `/provider/properties`; ownership evidence upload not built. |
| Protected exact address and contact | PASS (DB) | Separate `property_contacts` table; no public/anon read policy; `get_property_contact` requires paid access; tested. |
| KSh 20 contact fee | PASS (DB) | `property_contact_fee_minor = 2000`; fee read from settings, not the request; tested. |
| Payment before unlock | PASS (DB) | Mock unlock plus server-verified provider intent; pending/failed payments unlock nothing; duplicate unlock blocked; tested (sandbox). |
| Platform keeps the fee | PASS (DB) | Ledger credits `platform_commission`; tested. |
| Access record visible to user/admin | PASS (DB) | `property_contact_unlocks` RLS and admin payments view. |
| Access duration | DEFAULT DECISION | 90 days via `property_contact_access_days`; not specified in the brief. Change with a product decision. |
| Landlord verification and duplicate detection | PARTIAL | Verification status/actions exist; no document upload/storage flow, no automated duplicate detection. |
| Exact address never sent before payment | PASS (DB/UI) | Separate table + RPC gate; public search result has no address field; tested. |

## 5. Money, commission and withdrawals

| Requirement | Status | Implementation / evidence |
|---|---|---|
| Integer minor units | PASS | `bigint` money columns; no floats. |
| 10% commission, KSh 50 → 5/45 | PASS (DB) | `npm run test:db` asserts 5000/500/4500. |
| Ride commission and rider net | PASS (DB) | KSh 2,200 → 220/1,980 asserted. |
| Balanced double-entry ledger | PASS (DB) | Payment and refund totals balanced; settlement zero; tested. |
| Commission configurable without rewriting history | PASS (DB) | `commission_rules`, snapshot on order/ride. |
| Minimum/maximum commission enforcement | PARTIAL | Columns and constraints exist; order/ride creation does not yet apply min/max. |
| Rider available balance | PASS (DB) | `rider_available_balance`; pending withdrawals reserved; tested. |
| Withdrawal request | PASS (DB) | `request_rider_payout`, minimum KSh 100; tested. |
| Withdrawal settlement | PARTIAL / BLOCKED | Owner dispatch + B2C result + idempotent ledger debit implemented; **NOT TESTED** and requires Daraja B2C credentials/approval. |
| Refunds | PARTIAL | Order refunds tested; rides/property refunds have no completed workflow. |
| Disputes | NOT IMPLEMENTED | No dispute entity, evidence, or decision workflow. |
| Payout reserve after post-payout dispute | NOT IMPLEMENTED | Ledger tracks obligations but no reserve policy. |

## 6. Payments and integrations

| Requirement | Status | Implementation / evidence |
|---|---|---|
| M-Pesa STK initiation | IMPLEMENTED — NOT TESTED | `mpesa.ts`, `/api/payments/mpesa/initiate`; fails closed without config. |
| Trusted callback verification | IMPLEMENTED — NOT TESTED | Callback queries Daraja, checks amount, uses service-role RPC. |
| Idempotency / replay protection | PASS (DB code path) | Unique references, idempotent RPCs; DB duplicate tests pass; live payload replay **NOT TESTED**. |
| B2C payout dispatch/result | IMPLEMENTED — NOT TESTED | Owner route + service callback + ledger debit; needs credentials. |
| Sandbox payments fail closed | PASS (DB) | `allow_mock_payments` defaults to false; settlement requires it **and** `payment_mode = mock`; the DB test asserts the refusal and that the ride stays unpaid. |
| Payment-method registry and readiness | IMPLEMENTED — VERIFIED LOCALLY | `payment_methods`, owner RPC, `GET /api/payments/methods`, `/admin/payments/providers`. Checkout offers only enabled **and** server-configured methods. |
| Card payments | BLOCKED | No gateway selected; the integration catalog returned no matching provider. Adapter deliberately not invented. |
| Airtel Money | NOT IMPLEMENTED — BLOCKED | Registry entry carries an explicit blocker; needs a merchant account and documented API contract. |
| Email delivery | BLOCKED | Resend/SMTP configuration required; outbox code exists. |
| SMS/push | NOT IMPLEMENTED | Outbox channel exists, no provider. |
| Identity/KYC vendor | NOT IMPLEMENTED | No vendor selected or integrated. |
| Maps/routing | NOT IMPLEMENTED | Coordinates stored; no provider. |

## 7. Administration

| Requirement | Status | Implementation / evidence |
|---|---|---|
| Server-side owner gate | PASS | `requireOwnerAdmin` / `requireStaffCapability`; DB owner check requires verified email + aal2. |
| Application review | PASS (DB/RLS) | Owner review updates with audit; live **NOT TESTED**. |
| Listing/property moderation | PARTIAL | `/admin/listings`, `/admin/properties`; property verify/publish tested at SQL level only. |
| Vehicle approval | PASS (DB) | `admin_review_transport_vehicle`; exercised in DB test. |
| Ride oversight | PARTIAL | Read-only `/admin/rides`; no cancellation/refund/dispute controls. |
| Payments/payouts reconciliation | PARTIAL | `/admin/payments`; manual view, dispatch action; no automated daily reconciliation. |
| Payment-method configuration | PASS (owner surface) | `/admin/payments/providers`: owner + aal2 only, audited RPC, shows per-provider blocker derived from server credentials. Hosted run **NOT TESTED**. |
| Staff management | PARTIAL | Grant/revoke + audit; owner-only route; not all staff modules exposed. |
| Categories/brands | PASS (existing RLS) | Existing owner CRUD; live **NOT TESTED**. |
| Audit log | PARTIAL | Append-only `audit_events`, owner/staff read policy, `/admin/audit-log`; live **NOT TESTED**. |
| `/control` route | NOT CREATED | The repository's control centre is `/admin`; duplicating it would fragment authorization. |

## 8. Security and privacy

| Requirement | Status | Implementation / evidence |
|---|---|---|
| RLS on exposed tables | PARTIAL | All new tables have RLS and explicit grants. The live negative suite exists (`npm run test:rls:live`, `docs/RLS_NEGATIVE_TESTS.md`) and now follows the effective sandbox switch (`A19`, `D19`–`D21`) but has **NOT RUN** — no hosted project is configured. |
| Cross-account financial reads | PASS (fixed) | `rider_available_balance` leaked any rider's balance to any signed-in user; `0022` restricts it to the rider, the owner (aal2) and finance staff. Asserted in `npm run test:db`; live confirmation pending. |
| Owner/staff authorization requires MFA | PASS (DB) | `is_shilevi_owner_admin` and `has_staff_capability` require `aal2`; the live suite's aal1 denial checks are unrun. |
| No client writes to ride/property/payment state | PASS (SQL design) | RPC-only mutations; no insert/update policies. |
| Private contact data separated | PASS | `property_contacts`, `get_property_contact`, `get_ride_contact`. |
| Storage buckets and object policies | IMPLEMENTED — NOT TESTED | `0024` creates public `listing-images` (owner-folder writes) and private `provider-documents` (uploader, owner, or `properties.verify` staff). Guarded so it no-ops without the storage schema; hosted upload/read/signed-URL behaviour **NOT TESTED**. See `docs/STORAGE.md`. |
| Owner/staff cannot self-elevate | PASS (DB) | Tested self-grant denial. |
| Payment callback trusted | IMPLEMENTED — NOT TESTED | Daraja query verification. |
| Rate limiting | PARTIAL | In-memory per instance; not distributed. |
| CSRF on cookie routes | PASS | Same-origin checks on initiate/dispatch/signout; route audit verifies signout rejection. |
| Security headers / CSP report-only | PASS | Route audit 311/311. |
| Secrets server-only | PASS (review) | `server-only` modules; `.env.example` names only; no secret values committed. |
| Data retention/ODPC registration | NOT IMPLEMENTED | Legal/privacy review required. |

## 9. UI, accessibility, SEO and legal

| Requirement | Status | Implementation / evidence |
|---|---|---|
| Modern customer transport UI | PARTIAL | New `/transport`; route audit passes; not tested with live data. |
| House Hunt UI | PARTIAL | `/house-hunt`, `/house-hunt/[id]`; no photo gallery because no verified images. |
| Rider workspace | PARTIAL | `/rider/rides`; passenger + earnings + vehicles. |
| Provider property workspace | PARTIAL | `/provider/properties`; submission/verification flow, no document upload. |
| Admin UI | PARTIAL | New rides/properties/payments/staff modules; older screens remain. |
| Consistent design system | PARTIAL | Existing Tailwind palette/components extended; no formal token package. |
| Responsive/mobile | PARTIAL | Responsive utility classes; no device-lab test. |
| Accessible forms/labels | PARTIAL | Labels, `aria-invalid`, alerts; no full WCAG audit. |
| Public metadata/canonicals | PASS | Metadata on new pages; route audit checks canonicals. |
| Sitemap/robots | PASS | `/transport`, `/house-hunt` added; audit passes. |
| Legal pages | PASS (surface) | Terms, privacy, cookies, refunds, provider agreement, acceptable use; legal review still required. |
| 404/error states | PASS (surface) | Branded 404 and error boundary; audit passes. |

## 9b. Discovery, search and demand intelligence

| Requirement | Status | Implementation / evidence |
|---|---|---|
| Database-backed search over published listings | PASS | `search_marketplace` in `0025`; drafts, paused listings and inactive categories excluded; `npm run test:search`. |
| Full-text search of title and description | PASS | Generated `search_vector` + GIN index; description match asserted. |
| Relevance ranking and sorting | PASS | `ts_rank_cd`, featured tiebreak, stable `id`; `newest`, `price_low`, `price_high`, `title` asserted. |
| Taxonomy-aware category filter | PASS | Recursive descendant CTE; parent category returns child listings. |
| Division, county and price filters | PASS | Applied in SQL, combinable; county resolves property county or listing attribute. |
| Stable pagination with exact totals | PASS | `total`/`pages`/disjoint pages; page and size clamped. |
| Injection and wildcard resistance | PASS | Parameterised RPC; LIKE metacharacters escaped; `%` and DDL text match nothing. |
| Protected House Hunt contact never in results | PASS | `property_contacts` not joined; whitelisted payload; asserted in test and by live-suite design. |
| Server-trusted analytics writes | PASS | `record_search_event` service-role only; counts come from the database, not the browser. |
| Privacy-minimal analytics schema | PASS | No IP, user agent, session, referrer or free-form payload; query ≤120; shown ids ≤24. |
| Click engagement limited to published listings | PASS | `/api/search/event` same-origin + rate limited; RPC refuses unpublished listing. |
| Owner demand intelligence | PASS (RPC) / NOT TESTED (hosted) | `admin_search_insights` owner+aal2 only; empty window returns `has_data=false`; `/admin/insights`. |
| Analytics retention | PARTIAL | `prune_search_events` exists, tested, service-role only; **no schedule configured**. |
| Recommendations / personalised matching | NOT IMPLEMENTED | Deterministic relevance only; no AI component is claimed. |
| Search UI accessibility and states | PARTIAL | Labelled controls, `aria-live` count, `aria-busy` loading, empty/error/retry states; no WCAG audit or hosted browser pass. |

Search analytics are **not** financial truth: no event can mark an order paid, unlock contact data or
complete a ride. Orders, payments and unlocks remain the only evidence of a conversion.

## 10. Verification performed

| Check | Result |
|---|---|
| `npm run typecheck` | PASS |
| `npm run lint` | PASS (0 errors; warnings only) |
| `npm run build` | PASS |
| `npm run test:db` (migrations 0015–0024) | PASS — order, delivery, refund, ride, House Hunt, staff, rider-balance authorization, sandbox switch |
| `npm run verify:routes` against the production build | PASS — 311/311 checks |
| `node tests/rls/selftest.mjs` | PASS — TOTP RFC 6238 vectors, config guards, denial classification |
| `npm run test:rls:live` | **BLOCKED — NOT RUN** — exit 2 with a clean setup report; no Supabase URL, publishable key, service-role key or live opt-in |
| `node tests/rls/selftest.mjs` after the sandbox-switch changes | PASS — harness internals unchanged by the new checks; the matrix file still parses |
| `npm run test:search` | PASS — 33 checks over migration `0025` in PGlite (visibility, filters, ranking, pagination, injection, contact secrecy, analytics authorization, retention) |
| Live Supabase RLS/auth/email | NOT TESTED — no project credentials |
| Live Daraja STK/B2C | NOT TESTED — no credentials/approval |
| Resend delivery and domain verification | NOT TESTED — no API key/DNS proof |

The database test is real PostgreSQL (PGlite) executing the actual migration SQL and RPCs. It is
not a live Supabase deployment and does not prove hosting, storage or network behaviour.

## 11. Ordered migrations

Apply manually in this order; never let the app or CI apply them:

```text
0001_initial_marketplace_schema.sql
0002_identity_provider_workflow.sql
0003_discovery_brands_admin_allowlist.sql
0004_customer_provider_onboarding.sql
0005_admin_database_policies.sql
0006_provider_application_transitions.sql
0007_provider_listing_drafts.sql
0008_account_settings_deletion_requests.sql
0009_account_deletion_review_workflow.sql
0010_account_deletion_request_cancellation.sql
0011_saved_listings.sql
0012_notification_preferences.sql
0013_notification_preferences_column_grants.sql
0014_listing_requests.sql
0015_provider_activities_category_permissions.sql
0016_orders_deliveries.sql
0017_payments_ledger_commission.sql
0018_kenya_locations_coverage.sql
0019_owner_audit_and_order_reads.sql
0020_passenger_transport_rides.sql
0021_house_hunt_payments_staff_notifications.sql
0022_rider_balance_authorization.sql
0023_payment_methods_and_sandbox_switch.sql
0024_storage_buckets_and_policies.sql
0025_marketplace_search_and_demand_intelligence.sql
```

`0025` adds the search function, the analytics table and the owner reporting function. `0020`–`0025` are new and unapplied. They are idempotent where practical and safe on a database with
existing orders/listings; they add tables, columns, policies and functions but do not delete data.
`0022`–`0023` replace function bodies; `0024` is guarded so it no-ops where Supabase storage is absent.

## 12. External dependencies and decisions

1. **Live Supabase project** — apply migrations, seed real categories, run the RLS negative suite
   (`docs/RLS_NEGATIVE_TESTS.md`) against a disposable staging project with TOTP MFA enabled, then
   test auth/email/MFA end to end.
2. **Safaricom Daraja** — consumer key/secret, shortcode, passkey, callback URL; B2C initiator and
   encrypted credential. Production approval and a controlled live test are required.
3. **Card provider** — undecided. Choose before implementing; do not store card data.
4. **Card / Airtel gateway** — choose a licensed provider before any card or wallet work. No adapter
   exists; both methods are registered and blocked.
5. **Resend + DNS** — verify `shilevi.com` / `shilevi.app`, SPF/DKIM/DMARC, then configure Supabase
   SMTP. Actual delivery must be proven.
5. **Commission rate** — repository default is 10%; the brief also mentions 20%. Confirm the
   production rate before enabling real money.
6. **House Hunt access duration/refunds** — currently 90 days, no refund flow. Confirm policy.
7. **Legal** — ODPC registration, PSP licensing, consumer/refund terms, property and transport
   compliance.
8. **Leases/licences for verification vendors** — identity, KYC, maps, SMS/push.

## 13. Files added or changed in this increment

Search and demand-intelligence stage:
- `supabase/migrations/0025_marketplace_search_and_demand_intelligence.sql`
- `src/app/api/search/route.ts`, `src/app/api/search/event/route.ts`
- `src/app/search/page.tsx` (rewritten on the API)
- `src/app/admin/insights/page.tsx`, `src/components/admin/AdminShell.tsx` (nav entry)
- `tests/search/search.test.mjs`, `package.json` (`test:search`), `scripts/route-audit.mjs` (9 new checks)
- `docs/SEARCH.md`, `docs/IMPLEMENTATION_STATUS.md`

Earlier increments:

Migrations:
- `supabase/migrations/0020_passenger_transport_rides.sql`
- `supabase/migrations/0021_house_hunt_payments_staff_notifications.sql`
- `supabase/migrations/0022_rider_balance_authorization.sql`

Domain and server code:
- `src/lib/env.server.ts`
- `src/lib/supabase/service.ts`
- `src/lib/payments/mpesa.ts`
- `src/lib/email/resend.ts`
- `src/app/api/payments/mpesa/initiate/route.ts`
- `src/app/api/payments/mpesa/callback/route.ts`
- `src/app/api/payments/mpesa/b2c-result/route.ts`
- `src/app/api/payments/payouts/dispatch/route.ts`
- `src/app/api/notifications/dispatch/route.ts`
- `src/lib/admin/auth.ts`

Customer/provider/rider UI:
- `src/app/transport/page.tsx`, `TransportClient.tsx`
- `src/app/house-hunt/page.tsx`, `HouseHuntSearch.tsx`
- `src/app/house-hunt/[id]/page.tsx`, `HouseHuntDetail.tsx`
- `src/app/rider/rides/page.tsx`
- `src/app/provider/properties/page.tsx`
- `src/app/provider/apply/page.tsx` (activity-specific questions)
- `src/app/provider/page.tsx`, `src/app/rider/page.tsx` (navigation/status copy)

Admin UI:
- `src/app/admin/rides/page.tsx`, `VehicleReview.tsx`
- `src/app/admin/properties/page.tsx`, `PropertyReview.tsx`
- `src/app/admin/payments/page.tsx`, `PayoutDispatch.tsx`
- `src/app/admin/staff/page.tsx`, `StaffManager.tsx`
- `src/components/admin/AdminShell.tsx`, `src/app/admin/page.tsx`

Tests and documentation:
- `tests/db/orders-flow.test.mjs`
- `tests/rls/live-rls.mjs`, `tests/rls/selftest.mjs`, `tests/rls/lib/*.mjs`
- `scripts/route-audit.mjs`
- `.env.example`
- `docs/PAYMENTS.md`, `docs/EMAIL.md`, `docs/RLS_NEGATIVE_TESTS.md`, `docs/STORAGE.md`,
  `docs/REQUIREMENTS_MATRIX.md`
- `src/lib/payments/providers.ts`, `src/app/api/payments/methods/route.ts`
- `src/app/admin/payments/providers/page.tsx`, `PaymentMethodSettings.tsx`
- `supabase/migrations/0023_payment_methods_and_sandbox_switch.sql`,
  `0024_storage_buckets_and_policies.sql`

## 14. Release pass — repository, deployment and security (2026-10-24)

This section records the pass that organised the repository, packaged the deployment and audited
secrets. The full evidence, including every exit code, is in
[FINAL_RELEASE_STATUS.md](FINAL_RELEASE_STATUS.md). **No SQL file was modified in this pass.**

| Requirement | Status | Implementation / evidence |
|---|---|---|
| Recovery point before changes | PASS | No Git repository existed; `git init` + checkpoint commit `ac27aeb` (256 files) |
| Self-contained Vercel deployment folder | PASS | `vercel-deploy/` (160 files) generated by `scripts/prepare-deploy.mjs`; `npm ci` + `next build` from inside it exited 0 |
| Deployment folder integrity | PASS | `npm run deploy:verify` recomputes the SHA-256 of every file against `docs/DEPLOY_MANIFEST.json` |
| Manual Supabase migration bundle | PASS | `supabase-manual-migration/` — 25 migrations in order, `README.md`, read-only `verify_schema.sql`, hashed `MANIFEST.md`; `npm run migrations:verify` |
| File classification | PASS | `docs/FILE_CLASSIFICATION.md` — classes A–E, including the archived scaffold and the removed `.domain-build/` |
| Secret-free repository and template | PASS | `npm run secrets:scan` — 440 files, no findings; the scanner was proven to catch a planted `MPESA_CONSUMER_SECRET` |
| `.env.example` completeness | PASS | Every variable read by `src/`, `scripts/` and `tests/` is documented; placeholders only |
| CI covers the offline suites and bundle drift | PASS | `.github/workflows/verify.yml` — `npm ci`, lint, typecheck, auth, db, search, RLS self-test, build, route audit, secret scan, `release:verify` |
| Post-login destination preserved, open redirects blocked | PASS | `src/lib/auth/redirect.ts` shared by the login form and auth callback; `npm run test:auth` 34/34 |
| Build gets the right tracing root with two lockfiles | PASS | `next.config.ts` sets `outputFileTracingRoot: process.cwd()`; the previous warning is gone |
| Homepage at `/` (not a redirect, not `/search`) | PASS (unconfigured state) | `GET /` 200 with the Shilevi hero, four divisions, canonical `/`; 9 internal links checked, 0 broken |
| Private and admin surfaces leak nothing when unconfigured | PASS (HTTP) | `/account` and `/admin/insights` render setup/denial states with `X-Robots-Tag` and zero admin content |
| Vercel deployment performed | BLOCKED — MISSING ACCESS | Project is ready to import; needs the owner's Vercel account ([VERCEL_DEPLOYMENT.md](VERCEL_DEPLOYMENT.md)) |
| GitHub repository pushed | BLOCKED — MISSING ACCESS | Remote `shiraz-wrld/shilevi` exists and is empty; no `gh` and no credentials here ([GITHUB_RELEASE.md](GITHUB_RELEASE.md)) |
| Live Supabase verification | BLOCKED — MISSING ACCESS | `npm run test:rls:live` exits 2 and makes no request; no project or credentials configured |
| Hosted auth, MFA, email, storage, payments | IMPLEMENTED, HOSTED VERIFICATION REQUIRED | Code and local tests only; see §1–§7 and `FINAL_RELEASE_STATUS.md` |
| Full visual redesign of every route | NOT IMPLEMENTED | Deliberately out of scope for this pass; not claimed |
| Card payments, Airtel Money | BLOCKED — PROVIDER DECISION | No adapter invented |
| Bookings/calendars, messaging, reviews, live maps | NOT IMPLEMENTED | Unchanged from earlier audits |
