# Platform Audit — 21 October 2026

Scope: the repository on disk. This audit is based on source inspection plus executed checks. No
live Supabase project, payment provider, SMTP provider, or domain was accessed. Anything that needs
those is marked **BLOCKED** rather than passed.

## Verdict

Shilevi is a working single-deployable marketplace spine with real database-enforced money and
order rules, but it is **not a complete multi-service platform**. The four divisions exist as one
generic listing/order system. Transport, House Hunt and category-specific business onboarding are
not dedicated workflows yet. Owner administration covers taxonomy, brands, listings, applications,
deletions, orders and audit; it has no user, finance or staff-role management. Authentication
depends on Supabase configuration that this repository cannot verify.

## Evidence run in this session

| Check | Command | Result |
|---|---|---|
| TypeScript | `npm run typecheck` | PASS |
| Lint | `npm run lint` | PASS — 0 errors, 4 warnings |
| Production build | `NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3100 npm run build` | PASS — 61 build entries (pages, handlers and metadata files) |
| Route/header audit | `BASE_URL=http://127.0.0.1:3100 npm run verify:routes` | PASS — 278/278 checks |
| Database integration | `npm run test:db` | PASS — migrations 0015–0019 applied in PGlite, order → payment → provider → rider → delivery → completion → refund, balanced ledger, KSh 50 → KSh 5 / KSh 45 |

Not run: authenticated browser journeys, email delivery, MFA enrollment against live Auth, RLS
negative tests against Supabase, real payment webhooks, payouts, concurrent withdrawals. These need
credentials or a staging project.

## Architecture

- Next.js 15 App Router, React 19, Tailwind CSS 4, TypeScript. One deployable on Vercel.
- Supabase Auth/Postgres/Storage/RLS via `@supabase/ssr`; browser and server clients separated;
  no service-role key in the bundle.
- Pure domain layer in `src/domain/` (money, commission, order/delivery state, eligibility).
- 19 numbered SQL migrations; migrations are reviewed and applied manually, never by the app or CI.
- Route handlers: `/api/health`, `/api/auth/signout` (POST, origin-checked),
  `/api/security/csp-report` (POST, rate/size-limited, no persistence).
- Middleware refreshes sessions, redirects signed-out visitors from private prefixes and marks
  private responses `no-store`.
- Verification: PGlite integration test plus the new HTTP route audit. There is no browser E2E
  suite and no live RLS test.

## Service categories — the actual inventory

These come from the repository, not from examples in any brief.

**Divisions (fixed in schema/UI):** `products`, `services`, `transport_delivery`,
`property_places`.

**Category records:** data-driven in `marketplace_categories`, managed by the owner in
`/admin/categories`. Migration 0002 seeds four **inactive** generic categories:
`general-products`, `professional-services`, `transport-delivery`, `property-places`. No salon,
perfume, beauty or other vertical-specific category is seeded. The public site shows whatever
active categories the database contains.

**Provider activities (fixed enum):** `product_seller`, `service_provider`, `transport_partner`,
`property_provider`. Each approval is separate and grants categories through
`provider_activities`. There is no salon-specific, landlord-specific, or advertiser-specific
activity type.

## Role and workflow inventory

| Role | Registration | Dashboard | Status |
|---|---|---|---|
| Customer | `/signup`, Supabase email confirmation | `/account` | Implemented in code; **not tested against live Auth** |
| Customer orders | checkout | `/account/orders`, `/account/orders/[id]` | Implemented in code; DB flow verified in PGlite |
| Provider | `/provider/apply` (draft → pending) | `/provider` (new hub), listings, orders, requests, transport details | PARTIAL — generic application (activity + business name + intro), no category selection, no documents, no category-specific fields |
| Rider / transport partner | same generic application + `/provider/transport-details` | `/rider`, `/rider/jobs`, `/rider/jobs/[id]` | PARTIAL — no rider photo/licence/vehicle documents, no earnings dashboard, no withdrawals |
| Landlord / property provider | same generic application | same provider workspace | PARTIAL — no property-specific fields, filters, verification or document review |
| Salon / beauty / retail | none distinct | — | MISSING — falls under `service_provider` / `product_seller` generic flows |
| Staff (support/finance/moderator) | none | — | MISSING — capability model and `user_roles` labels exist, but no staff grant UI or staff-scoped admin route; only the two owners can enter `/admin` |
| Owner administrator | Supabase account | `/admin/*` | Implemented in code; live MFA/RLS **not tested** |

## Security architecture — verified by source inspection

- Admin access: `requireOwnerAdmin()` checks a server session, verified email, the two-address
  allowlist and MFA level. The database helper `is_shilevi_owner_admin()` independently requires the
  allowlist and JWT `aal2`. Emails: `russhiraz565@gmail.com`, `russhiraz1@gmail.com`
  (`src/lib/admin/auth.ts`, `supabase/migrations/0003...sql`).
- Ordinary users cannot grant roles: `user_roles` revokes all from `anon`/`authenticated`, grants
  only `SELECT`, and has a self-select policy. The signup trigger inserts `customer` as a
  security-definer function. No client insert/update/delete policy exists. **Source-verified, not
  live-tested.**
- Orders, deliveries, refunds and ledger writes go through security-definer RPCs that derive prices
  and identity server-side. Rider job listings omit the drop-off address until assignment.
- New owner reads (migration 0019) add `SELECT`-only policies for audit events, orders and order
  items with `aal2`; no client write grant is added. The SQL applies cleanly in the PGlite harness, but **migration 0019 has not been applied to a Supabase project.**
- Response headers: HSTS, nosniff, frame denial, referrer and permissions policy, report-only CSP
  with a working report endpoint; private areas get `X-Robots-Tag`.
- Gaps not yet closed: no distributed rate limit (in-memory per instance), no browser E2E or live
  RLS negative tests, no staff least-privilege enforcement, no document storage policies because no
  document upload exists, no account-session management UI, no anomaly/security alerting.

## Payments, commission, payouts

- Payment mode is **sandbox only**. `confirm_mock_payment()` creates a simulated paid event and a
  balanced double-entry ledger. No M-Pesa, card, Stripe, Flutterwave or other provider is integrated,
  and there is no payment webhook route. Checkout states this plainly.
- Commission: default 10% of item subtotal, fixed per order; delivery split 10% platform / 90%
  rider. Verified in SQL: a KSh 50 sale yields KSh 5 commission and KSh 45 provider net; a KSh 1,000
  × 2 order yields KSh 200 commission, KSh 1,800 provider net, KSh 100 delivery → KSh 90 rider /
  KSh 10 platform. Refund reverses the ledger to zero.
- `payouts` table exists, but there is **no payout request RPC, withdrawal UI, provider balance
  dashboard, reconciliation job, or payment-provider adapter**. Any claim of working withdrawals
  would be false. This is **BLOCKED** on a contracted provider and payout design.

## Email, password recovery, MFA

- Password recovery and verification use Supabase Auth (`/forgot-password`, `/reset-password`,
  `/auth/callback`).
- MFA enrollment UI exists for owners (`/admin/security`) and database policies require `aal2` for
  privileged writes.
- **No SMTP configuration, sender domain verification, SPF/DKIM/DMARC records or email templates
  exist in this repository.** Both `shilevi.com` and `shilevi.app` must be verified in the email
  provider and Supabase Auth before delivery can be claimed. `site.ts` defaults to
  `support@shilevi.app`; that address is not proven to exist. **BLOCKED — external dependency.**
- Email delivery, expired recovery links and invalid MFA codes were not tested. **NOT TESTED.**

## UI/UX

Strengths: consistent Tailwind surfaces, clear status text, honest sandbox notices, mobile-first
layouts, skip link, labelled forms, focus styles.

Weaknesses:
- The home page is a client-rendered feed with a plain hero; the four service experiences look
  almost identical.
- Provider/rider pages use bespoke headers instead of the shared shell.
- Admin tables are functional but visually dense and not yet filtered/paginated server-side.
- Empty/loading/error states exist but are inconsistent between client pages.
- No dark mode; typography relies on system sans rather than a deliberate type scale.
- No dedicated 403 page; unauthorized admin pages render a 200 “Access denied” panel.

## Prioritised plan and dependencies

1. **Database verification (now, needs staging Supabase):** apply 0001–0019 in order, run RLS
   negative tests for customer/provider/rider/owner. This gates every “verified” claim.
2. **Auth and email (needs domains + SMTP):** configure custom SMTP, verify both domains, test
   verification/recovery/MFA end to end.
3. **Provider onboarding depth (can start now):** category selection, category-specific fields,
   private document upload with storage policies, reviewer evidence view. Schema change required.
4. **House Hunt (can start now):** property attributes, rent/sale, bedrooms, amenities, availability,
   owner application fields and verification state. Uses existing division and listing tables.
5. **Transport marketplace (can start now):** ride request/booking model, fare rules, rider
   eligibility, trip states — larger than the current delivery job model; needs a schema decision.
6. **Finance (blocked on provider):** payout adapter, balances, idempotent withdrawals, reconciliation.
7. **Staff roles (can start now):** explicit staff grants by owner, capability-scoped admin routes,
   database policies per staff role. The existing capability model is the starting point.
8. **Design modernization (can start now):** shared app shell, unified provider/rider dashboards,
   deliberate type scale, service-specific cards, filtered admin tables.
9. **Mobile distribution:** no Capacitor/native project exists. Web is installable via manifest only.
   App-store readiness is **MISSING**.

## Decisions needed before large changes

1. **Transport model:** is a “ride” a new booking entity, or an extension of deliveries? Intercity
   fares need a pricing rule (fixed route, distance, or rider quote), and the choice changes schema.
2. **Provider documents:** which documents are legally required per activity, where will they be
   stored, who reviews them and what is the retention period?
3. **Staff roles:** should support/finance/moderator be real database roles now, or remain owner-only
   until launch? The capability model exists but no policies implement it.
4. **Payments:** which licensed provider and payout rail will be contracted, and will funds be held?
5. **Email domains:** which domain is primary for sending, and are DNS records controllable?
6. **Property verification:** is pre-publication approval mandatory for every property listing?

## Honest status summary

- **PASS — VERIFIED:** build, typecheck, lint, HTTP route/header/SEO audit, sandbox order and ledger
  flow in PGlite, 10% commission including the KSh 50 example, refund reversal, delivery split,
  rider address privacy before assignment, 47-county seed.
- **PARTIAL — INCOMPLETE:** provider onboarding, rider onboarding, property listings, provider/rider
  dashboards, admin application review (no live test), audit log and admin orders (migration 0019
  unapplied), legal drafts (not counsel-reviewed), SEO for dynamic listings.
- **FAIL — NOT WORKING:** none observed in the executed checks.
- **BLOCKED — DEPENDENCY REQUIRED:** live Supabase, SMTP/domain verification, real payment provider,
  payouts, mobile app distribution.
- **NOT TESTED:** authenticated UI journeys, RLS on a real database, email delivery, MFA, webhooks,
  concurrency, storage policies, staff roles.
