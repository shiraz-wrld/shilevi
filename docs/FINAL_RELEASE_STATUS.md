# Final release status

**Date:** 2026-10-24 (latest update 2026-10-29) · **Release pass:** product completion, repository organisation, deployment
preparation, security audit, Supabase migration packaging.
**Repository state:** local Git repository created in this pass (there was none). Nothing pushed —
see [GITHUB_RELEASE.md](GITHUB_RELEASE.md).

> **2026-10-25 update — migration recovery and refund completion.** `0005` used a bare `$` as a
dollar-quote delimiter and could never apply; it is fixed and the full `0001`–`0026` chain now
passes `npm run test:migrations` (56 checks). New `0026` makes the owner refund decision reachable
(the previous service-role-only grant made every decision fail with “Not authorized.”), and a
refund review screen + API now exist. The customer-facing refund status is real, not a placeholder.
The **hosted** migration state of `kdygwbymgpmssuszhski` is still unverified: no database password or
management token is available here, so `supabase migration list`, `db push --dry-run`, hosted schema
verification and the live RLS suite remain **BLOCKED — NOT RUN**. Full evidence in
[IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md).

> **2026-10-28 update — personalized customer home.** Migration `0035` adds `customer_preferences`,
an own-row read policy on `search_events`, `record_listing_view`, `clear_my_marketplace_history`,
`set_customer_area` and the `customer_home()` ranking read model. The shell now knows who is signed
in (`AuthProvider` + session-aware header with workspace links), `/` renders the customer dashboard
on the server for a signed-in visitor and the marketing page for everyone else, and sign-in lands on
`/account` instead of `/onboarding`. `0035` is applied hosted and production is redeployed
(`shilevi-main-1pz0ustcd-russhiraz1-maxs-projects.vercel.app`, Ready, aliased to
`https://shilevi-main.vercel.app`). Device GPS is deliberately not read: listings have no
coordinates and no geocoder is configured, so discovery is county-based and labelled as such.
A signed-in render against production is **NOT TESTED** — no customer session was available.
Details in [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md).

> **2026-10-28 (later) — in-app notifications.** Migration `0036` adds `read_at`, an own-row
read policy, column-level `update (read_at)` and the `my_notifications` / unread / mark-read
functions; `/account/notifications` and a header badge now show real application, ride, order,
delivery and payout updates. Applied hosted and deployed
(`shilevi-main-lq3x8k9l8-russhiraz1-maxs-projects.vercel.app`, Ready). Web push does not exist (no
service worker), and email is still blocked by unset Resend variables. Reading the inbox with a real
signed-in account is **NOT TESTED**.

> **2026-10-29 — notification dispatch is channel-scoped and lease-based.** Migration `0039`
(`claim_notification_batch`) is **applied to the hosted project**: `supabase migration list
--linked` reports `0039 | 0039 | 0039`, and `claim_notification_batch` appears in
`supabase gen types typescript --linked`. Two defects were fixed: the email dispatcher read the
outbox without a channel filter and retired every `push` row as “No usable email recipient”, so
push could never deliver once `0038` began queueing rows; and a row claimed into `sending` by a
request that died mid-flight was never selected again, losing the notification. The claim is now
one security-definer function with a ten-minute lease, an attempt counted at claim time, channel
scoping, `for update skip locked` and a five-attempt ceiling. Both dispatchers call it. New test
`tests/db/notification-dispatch.test.mjs` (25 assertions) plus 7 checks inside `test:migrations`
(307 total, 0 failures). **The dispatchers themselves still cannot deliver anything in production:
no VAPID keys, no `RESEND_API_KEY`, no scheduler.**

> **2026-10-29 — activity-specific rider onboarding and the push channel.** Migrations `0037`
(activity-specific deliverer document requirements, one-transaction `create_delivery_application`,
document checklist/replacement, route-intent publication) and `0038` (`push_subscriptions`, shared
`render_notification`, `channel = 'push'` outbox rows, offer/proposal triggers) are **applied to the
hosted project** `kdygwbymgpmssuszhski`: `supabase migration list --linked` now reports
`0037 | 0037 | 0037` and `0038 | 0038 | 0038`, and `supabase gen types typescript --linked` shows
`push_subscriptions`, `delivery_document_requirements`, `delivery_application_route_intents`,
`create_delivery_application`, `my_delivery_document_checklist`, `publish_my_delivery_route`,
`attach_my_delivery_document`, `save_push_subscription`, `revoke_push_subscription` and
`my_push_subscription_count` on the remote schema. Local: `test:migrations` 299 checks, `test:db`,
`test:auth` 29, `test:search`, `test:rls:selftest`, `tsc`, lint, build, route audit 331/331,
`release:sync`/`release:verify` and `secrets:scan` (596 files) all pass. **Deployment was not
performed**: Vercel builds the committed `vercel-deploy/` folder, and committing/pushing was not
authorized in this pass. Push delivery to a real device is **NOT TESTED** — no VAPID keys and no
scheduler are configured, and the dispatcher refuses to run without keys. Configuration and live
test steps: [PUSH_NOTIFICATIONS.md](PUSH_NOTIFICATIONS.md).

## Status vocabulary

| Label | Meaning |
|---|---|
| **COMPLETE AND VERIFIED** | Implemented and the named check actually ran and passed in this workspace |
| **IMPLEMENTED, HOSTED VERIFICATION REQUIRED** | Code exists and compiles; proving it needs a configured Supabase project or provider |
| **PARTIALLY IMPLEMENTED** | A real subset exists and works within its limits; named behaviour is missing |
| **BLOCKED — MISSING ACCESS OR CREDENTIALS** | Cannot proceed here: needs an account, key, approval or provider decision |
| **NOT IMPLEMENTED** | No corresponding code exists |

Nothing below is marked complete because a page rendered or a build exited zero. Every "verified"
row names the command that produced the result.

---

## 1. Verdict

- **The application is deployable.** `vercel-deploy/` is a self-contained Next.js app that was
  installed and built **from its own directory** (exit 0) and then served and audited over HTTP
  (311/311 checks). It is the configured Vercel Root Directory.
- **The backend is packaged for manual migration.** `supabase-manual-migration/` holds all 25
  migrations in order, a hashed manifest, a read-only verification script and the guide.
- **The repository is secret-free and reproducible.** A credential scanner (proven against a
  planted secret) reports no key material in 440 scanned files; a drift check guarantees the
  deployment and migration bundles match the source.
- **The product is not production-ready.** Hosted authentication, email delivery, MFA, RLS, storage,
  payments and payouts have never run against a real project. Several substantial features (card
  payments, Airtel Money, live maps, account-deletion processing, provider document review,
  bookings/calendars, reviews) are absent or partial. Commission rate conflicts remain unresolved.
- **No Vercel deployment and no Supabase migration was performed.** Both require your credentials
  and are documented as exact steps.

## 2. Requirement ledger

### 2.1 Repository, release and deployment

| Requirement | Status | Evidence |
|---|---|---|
| Safe recovery point before changes | **COMPLETE AND VERIFIED** | `git init` + checkpoint commit `ac27aeb` (256 files). No history existed before. |
| Single self-contained Vercel deployment folder | **COMPLETE AND VERIFIED** | `vercel-deploy/` (160 files) generated by `scripts/prepare-deploy.mjs`; built independently (exit 0) and served for the HTTP audit |
| Deployment folder cannot silently drift | **COMPLETE AND VERIFIED** | `npm run deploy:verify` — PASS (file set, bytes and SHA-256 recomputed) |
| Manual Supabase migration bundle | **COMPLETE AND VERIFIED** | `supabase-manual-migration/` — 27 migrations + README + `verify_schema.sql` + `MANIFEST.md`; `npm run migrations:verify` PASS |
| Every file classified | **COMPLETE AND VERIFIED** | [FILE_CLASSIFICATION.md](FILE_CLASSIFICATION.md) + machine-readable [DEPLOY_MANIFEST.json](DEPLOY_MANIFEST.json) |
| Obsolete/duplicate material identified | **COMPLETE AND VERIFIED** | `shilevi-foundation/` moved to `archive/` (verified unreferenced first); `.domain-build/` removed and ignored |
| Secret-free `.env.example` | **COMPLETE AND VERIFIED** | Every variable the code reads is documented; placeholders only; `npm run secrets:scan` PASS |
| Vercel deployment guide | **COMPLETE AND VERIFIED** | [VERCEL_DEPLOYMENT.md](VERCEL_DEPLOYMENT.md) |
| Supabase migration guide | **COMPLETE AND VERIFIED** | [SUPABASE_MIGRATION.md](SUPABASE_MIGRATION.md) |
| GitHub repository updated/pushed | **BLOCKED — MISSING ACCESS** | Remote exists and is empty; `gh` not installed and no credentials in this environment. Exact push steps in [GITHUB_RELEASE.md](GITHUB_RELEASE.md). |
| Vercel deployment performed | **BLOCKED — MISSING ACCESS** | Preparing a verified project is the deliverable; deploying needs your account |

### 2.2 Homepage, discovery and analytics

| Requirement | Status | Evidence |
|---|---|---|
| Agreed Shilevi homepage at `/` | **COMPLETE AND VERIFIED (unconfigured state)** | `GET /` 200, hero "One place for what you need.", four divisions, canonical `/`, title/canonical/header checks pass; audit "home page internal links (9 checked) — 0 broken". Live categories/listings need Supabase. |
| No redirect masking a missing homepage | **COMPLETE AND VERIFIED** | Audit asserts `/` returns 200 directly (no redirect) |
| Database-backed search, ranking, filters, pagination | **COMPLETE AND VERIFIED (database)** | `npm run test:search` — 33 checks against migration 0025 in PGlite |
| Search visibility, moderation and contact secrecy | **COMPLETE AND VERIFIED (database)** | Drafts/paused/inactive categories excluded; `property_contacts` never in payloads — asserted |
| Search API validation and fail-closed behaviour | **COMPLETE AND VERIFIED (HTTP)** | `GET /api/search` → 503 unconfigured; unknown division/price inversion → 400; `POST` → 405; `no-store` + `X-Robots-Tag` present |
| Server-trusted analytics | **COMPLETE AND VERIFIED (database)** | `record_search_event` executable by service role only — asserted; writes cannot be made by `authenticated` |
| Owner demand intelligence | **IMPLEMENTED, HOSTED VERIFICATION REQUIRED** | `/admin/insights` renders the denial panel signed out and shows no data; aggregation tested in PGlite only |
| Analytics retention actually scheduled | **PARTIALLY IMPLEMENTED** | `prune_search_events` exists and is tested; no cron configured (documented) |
| Personalised recommendations / AI matching | **NOT IMPLEMENTED** | Deterministic relevance only; nothing is labelled AI |

### 2.3 Authentication and accounts

| Requirement | Status | Evidence |
|---|---|---|
| Sign-up, sign-in, sign-out, forgot/reset password in code | **IMPLEMENTED, HOSTED VERIFICATION REQUIRED** | Routes and Supabase calls exist; HTTP surfaces pass the audit; no hosted project to test against |
| Post-login destination preserved and open redirect blocked | **COMPLETE AND VERIFIED** | `npm run test:auth` — 34 checks; one shared validator now used by the login form and the callback (previously two divergent allowlists silently dropped deep links) |
| Safe auth callback, no off-site redirect | **COMPLETE AND VERIFIED** | Same suite: absolute, protocol-relative, backslash, NUL and traversal values rejected |
| Session refresh and private-route redirect | **IMPLEMENTED, HOSTED VERIFICATION REQUIRED** | Middleware refreshes cookies and redirects signed-out visitors when Supabase is configured; unconfigured, private pages render their setup state |
| Email verification and recovery delivery | **BLOCKED — MISSING CREDENTIALS** | Needs Supabase SMTP + a verified sending domain |
| MFA enrolment and aal2 owner gate | **IMPLEMENTED, HOSTED VERIFICATION REQUIRED** | UI + database helper + server guard; enrolment requires a live project and an authenticator |
| Self-elevation prevention | **COMPLETE AND VERIFIED (database)** | `user_roles`/`staff_capabilities` have no client write path; self-grant denied in `npm run test:db` |

### 2.4 Marketplace, money and administration

| Requirement | Status | Evidence |
|---|---|---|
| Order → payment → provider → rider → delivery → refund ledger | **COMPLETE AND VERIFIED (database)** | `npm run test:db`: migrations 0015–0024 applied, balanced ledger, KSh 50 → KSh 5 commission / KSh 45 net, refund returns every account to zero |
| Passenger rides, dual confirmation, withdrawal | **COMPLETE AND VERIFIED (database)** | KSh 2,200 → KSh 220 commission / KSh 1,980 rider net; KSh 1,000 withdrawal settles |
| House Hunt paid contact unlock | **COMPLETE AND VERIFIED (database)** | KSh 20 unlock; exact contact released only after payment; duplicate unlock blocked |
| Staff capability grant/revoke | **COMPLETE AND VERIFIED (database)** | Self-grant denied, owner grant effective, revocation effective |
| Sandbox payments fail closed | **COMPLETE AND VERIFIED (database + HTTP)** | Requires `payment_mode='mock'` **and** `allow_mock_payments`; `/api/payments/methods` → 503 with no credentials |
| M-Pesa STK, callback verification, B2C payouts | **IMPLEMENTED, HOSTED VERIFICATION REQUIRED** | Code and amount/idempotency guards exist; no Daraja credentials, never called |
| Card payments, Airtel Money | **BLOCKED — PROVIDER DECISION** | No gateway contracted; collecting raw card data is deliberately unsupported |
| Checkout UI and cart | **PARTIALLY IMPLEMENTED** | Real cart and server-priced order creation; renders payment-unavailable state without a provider |
| Owner administration surface | **IMPLEMENTED, HOSTED VERIFICATION REQUIRED** | 14 admin routes behind owner + MFA gate; signed-out requests render a denial panel containing no admin data |
| Admin returns HTTP 403 for denials | **PARTIALLY IMPLEMENTED** | Denial renders with status 200 and no data; consistent with the existing design, but not ideal semantics |
| Provider onboarding, listings, moderation | **PARTIALLY IMPLEMENTED** | Applications, drafts, publication checks exist; no document upload/review workflow, no category field editor |
| Provider earnings / payouts dashboard | **PARTIALLY IMPLEMENTED** | Ledger and payout RPCs exist; no provider-facing balance history |
| Bookings, calendars, quotes, messaging, reviews | **NOT IMPLEMENTED** | Enquiries only; no booking entity, no in-app messaging, no review workflow |
| Live maps, GPS, ETA | **NOT IMPLEMENTED** | Coordinates stored; no map or tracking |

### 2.5 Site-wide visual design

| Requirement | Status | Evidence |
|---|---|---|
| Shared header/footer, typography, focus states, responsive layout | **PARTIALLY IMPLEMENTED** | Consistent slate/blue system and accessible focus styles across public and auth pages; provider/rider pages use bespoke headers; the homepage uses its own header/footer rather than the shared shell |
| Full visual redesign of every route | **NOT IMPLEMENTED** | This pass prioritised correctness, security and deployability; the redesign was explicitly out of scope for the stage and is not claimed |
| No fake statistics, reviews or live tracking | **COMPLETE AND VERIFIED** | Homepage copy and empty states state that content is pending real listings; no fabricated counts anywhere |

## 3. Executed checks

All commands were run in this workspace on 2026-10-24. `exit` is the real process code.

| Check | Command | Result |
|---|---|---|
| Type check | `npm run typecheck` | **exit 0** |
| Lint | `npm run lint` | **exit 0** — 0 errors, 4 warnings (`no-img-element`, hook deps) |
| Auth redirect suite | `npm run test:auth` | **exit 0** — 34 checks, 0 failures |
| Database migrations and flows | `npm run test:db` | **exit 0** — `ALL MIGRATION AND FLOW CHECKS PASSED` |
| Search and analytics | `npm run test:search` | **exit 0** — 33 checks, `ALL SEARCH AND ANALYTICS CHECKS PASSED` |
| RLS harness self-test | `npm run test:rls:selftest` | **exit 0** |
| Credential scan | `npm run secrets:scan` | **exit 0** — 440 files, no findings |
| Credential scan is effective | planted `MPESA_CONSUMER_SECRET=<literal>` in a temp file, then scanned | **caught, exit 1** — the probe file was deleted |
| Deployment bundle drift | `npm run deploy:verify` | **exit 0** — 160 files match by hash |
| Migration bundle drift | `npm run migrations:verify` | **exit 0** — 27 migrations + guide + verifier |
| Independent build of `vercel-deploy/` | `cd vercel-deploy && npm ci && npx next build` | **exit 0** — full route table emitted, middleware 94 kB |
| HTTP/SEO/security audit of that build | `BASE_URL=http://127.0.0.1:3200 npm run verify:routes` | **exit 0 — 311/311 checks passed** |
| Production build of the repository root | `npm run build` | **exit 0** (see §3.1) |
| Live RLS suite | `npm run test:rls:live` | **exit 2 — BLOCKED — NOT RUN**, no request made |

### 3.1 Runtime probes on the packaged build (port 3200)

| Probe | Result |
|---|---|
| `GET /` | 200; hero and divisions present |
| `GET /api/search?q=headphones` (no Supabase) | 503 `Search is not available on this deployment yet.` |
| `GET /api/search?division=bogus` | 400 `Unknown marketplace section.` |
| `GET /api/search` headers | `cache-control: no-store`, `x-robots-tag: noindex, nofollow` |
| `GET /api/payments/methods?purpose=order` | 503 `Payments are not configured on this deployment.`, empty method list, `sandbox:false` |
| `GET /account` signed out, **unconfigured** | 200 with the app's setup/denial state and `X-Robots-Tag: noindex`; with Supabase configured, middleware redirects to `/login` |
| `GET /admin/insights` signed out | 200 denial panel, **zero** occurrences of admin insight content |
| `GET /api/search/event` | 405; cross-origin POST 403 |
| `GET /api/auth/signout` | 405; cross-origin POST 403 |

## 4. Security and privacy audit performed

- **Secrets:** full-tree scan for private-key blocks, JWTs, Stripe/Resend/AWS/Google/Slack/GitHub
  tokens, literal Daraja and service-role assignments, committed `.env*` and key files — none found.
  No `.env` file exists in the workspace. No `NEXT_PUBLIC_` variable carries a secret; the service
  role is read only by `src/lib/env.server.ts` (`server-only`).
- **Client bundle:** the deployment copy built cleanly; the service-role key, Daraja secrets and
  Resend key are never referenced from client components.
- **Redirect safety:** one validator (`src/lib/auth/redirect.ts`) now guards the login form and the
  auth callback; 34 adversarial cases tested, including `//evil.example`, `\/evil.example`,
  `javascript:`, NUL bytes, traversal and 300+ character paths.
- **Authorization:** owner gate is two-sided (server guard + `is_shilevi_owner_admin()` with
  allowlist and aal2). `record_search_event`/`prune_search_events` are not executable by
  `authenticated` or `anon`. `rider_available_balance` still rejects other accounts (migration
  0022 regression test). `user_roles` self-grant denied.
- **Private data:** search payloads exclude `property_contacts`, reviewer fields and attributes;
  House Hunt contact release requires a confirmed payment; admin denial pages contain no data.
- **Rate limits and size limits:** `/api/search` 60/min per client, `/api/search/event` and payment
  routes limited, CSP report endpoint caps body size (413 verified), payment initiate caps body at
  4 KiB.
- **Fail-closed integrations:** unconfigured search, payments and M-Pesa answer 503/409 with no
  environment detail. Sandbox settlement needs two switches and defaults off.
- **Logging:** payment failures log an intent id and error code, never a key, token or phone number.
- **Dependency note (not remediated):** `npm ci` reports a deprecated `eslint@9` line in its
  transitive range and the earlier audit recorded npm advisories. Running `npm audit` and upgrading
  is still outstanding; no upgrade was made in this pass because it must be tested, not guessed.

## 5. User journeys

| Journey | Verified here | Not verified |
|---|---|---|
| Visitor → homepage → divisions/search | `/`, `/search`, division pages, transport and House Hunt return 200 with correct metadata and internal links (audit) | Real listings, images, filters against a populated database |
| Visitor → sign-up → confirm → onboarding → account | Code path reviewed; HTTP surfaces and redirect allowlist tested; callback rejects off-site targets | Actual Supabase sign-up, email delivery, session cookie behaviour, refresh persistence |
| Visitor → forgot password → reset | UI and callback route present and validated | Email arrival, expired-link handling, `updateUser` success |
| Customer → cart → checkout → order | Checkout renders payment-unavailable state; order RPC tested in the database | End-to-end purchase, payment callback, refund through the UI |
| Provider → apply → listing draft → publish | Database transitions tested; routes respond | Document upload, reviewer flow, real browser journey |
| Rider → job → delivery → payout | Delivery/ride state machines and dual confirmation tested in PGlite | Live claim under concurrency, proof PIN UX, payout settlement |
| Owner → MFA → admin → insights | Denial path verified over HTTP; owner-only SQL asserts pass | Real aal2 enrolment, real admin data, staff-scoped views |

## 6. Files changed in this pass

**Added**

- `vercel-deploy/` (generated, 160 files) and `docs/DEPLOY_MANIFEST.json`
- `supabase-manual-migration/` (generated bundle)
- `supabase/verify_schema.sql`
- `src/lib/auth/redirect.ts`, `tests/auth/redirect.test.mjs`
- `scripts/prepare-deploy.mjs`, `scripts/prepare-migrations.mjs`, `scripts/secret-scan.mjs`
- `docs/FINAL_RELEASE_STATUS.md`, `docs/VERCEL_DEPLOYMENT.md`, `docs/SUPABASE_MIGRATION.md`,
  `docs/GITHUB_RELEASE.md`, `docs/FILE_CLASSIFICATION.md`

**Modified**

- `src/app/login/page.tsx`, `src/app/auth/callback/route.ts` — one shared redirect validator
- `next.config.ts` — `outputFileTracingRoot` so both builds trace from their own directory
- `package.json` — test/release scripts, Node engine floor `>=20.9.0`
- `.env.example` — complete, documented, placeholders only
- `.gitignore` — generated/secret output, removed duplicate rule
- `.github/workflows/verify.yml` — `npm ci`, all offline suites, secret scan, bundle drift
- `README.md`, `docs/DEPLOYMENT.md`, `docs/TESTING.md`, `docs/REQUIREMENTS_MATRIX.md`
- `tests/rls/selftest.mjs` — marked the synthetic redaction fixture for the scanner

**Moved / removed**

- `shilevi-foundation/` → `archive/shilevi-foundation-2026-10-20/` (unreferenced scaffold, kept)
- `.domain-build/` removed and ignored (generated)

**Not touched:** migrations `0001`–`0025` (no SQL edited in this pass), RLS policies, ledger
arithmetic, the double-gated sandbox, the live-RLS harness, payment adapters.

## 7. What you must do — exact actions

1. **Push the repository** (remote `shiraz-wrld/shilevi` exists and is empty): follow
   [GITHUB_RELEASE.md](GITHUB_RELEASE.md) §"Exact steps for you to publish". A personal access token
   is required if HTTPS asks for a password.
2. **Create the Vercel project** from that repository with **Root Directory = `vercel-deploy`**
   ([VERCEL_DEPLOYMENT.md](VERCEL_DEPLOYMENT.md) §2) and Node 24.
3. **Set environment variables** (Production and Preview): `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SITE_URL`; then server-side
   `SUPABASE_SERVICE_ROLE_KEY` and any provider credentials you actually have.
4. **Apply migrations `0001`–`0025`** in the Supabase project `kdygwbymgpmssuszhski`, one file at a
   time, then run `verify_schema.sql` ([SUPABASE_MIGRATION.md](SUPABASE_MIGRATION.md)).
5. **Configure Auth:** Site URL, `/auth/callback` redirects for production/preview/local, enable
   TOTP, and SMTP for verification/recovery email.
6. **Confirm the owner allowlist** matches your real owner addresses (migration 0003 seeds two
   `@gmail.com` addresses), enrol MFA, and verify `/admin` denies an ordinary account.
7. **Run the live RLS suite against a staging project** and the post-deploy checklist in
   `VERCEL_DEPLOYMENT.md` §5. Until then, hosted security is unproven.
8. **Decide the business questions** that block real money: commission rate (10% vs 20% and the
   base), payout/settlement model, card and Airtel providers, provider-document retention, refund
   policy. These are recorded as open in the requirements matrix and must not be guessed in code.

## 8. Remaining external blockers

| Blocker | Needs |
|---|---|
| Hosted auth, RLS, storage, MFA verification | A staging Supabase project + credentials + TOTP enrolment |
| Verification/recovery email | Verified sending domain, SPF/DKIM/DMARC, Supabase SMTP |
| Real M-Pesa charges and B2C payouts | Daraja production credentials, public HTTPS callback, approved shortcode |
| Card payments | A gateway decision and contract (hosted/tokenised only) |
| Airtel Money | Merchant account and adapter decision |
| Live maps/ETA, SMS/push, ID verification | Vendor selection, contracts, API keys |
| Legal/regulatory sign-off | ODPC registration, PSP licensing, counsel-reviewed terms and policies |
| Deployment | Your Vercel account (the project is ready to import) |

## 9. Recommended next stage

**Verify this release on hosted staging and close the authentication loop.** Apply the bundle,
configure Auth/SMTP/TOTP, then run the live RLS suite and the deployment checklist with two real
accounts (owner and ordinary customer) plus one provider. That converts the largest block of
"implemented, unverified" rows into evidence and will surface the first real hosted defects.
After that, the highest-value product work is provider onboarding depth (documents, category
fields, review) and a booking/messaging spine — the two gaps that most limit the marketplace.

## 10. Final statements

- `vercel-deploy/` **builds independently**: `npm ci` + `npx next build` from inside that directory,
  exit 0.
- The homepage, static routes, headers, SEO surface and fail-closed API behaviour were **verified
  locally** against that build.
- Registration, login, provider onboarding and administration were **verified in code, in the
  database tests and over HTTP**, but **not verified against Supabase** — no credential exists here.
- No live payment, email, storage, MFA or RLS check was performed, and none is claimed.
