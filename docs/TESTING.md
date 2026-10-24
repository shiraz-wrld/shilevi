# Testing strategy and current results

## What runs today

| Command | Scope | Current result |
|---|---|---|
| `npm run typecheck` | `tsc --noEmit` | **PASS** |
| `npm run lint` | ESLint over `src/` | **PASS** (0 errors; warnings only) |
| `npm run build` | Production Next.js build | **PASS** |
| `npm run test:db` | Migrations 0015–0024 + real RPCs in PGlite | **PASS** |
| `npm run test:search` | Migration 0025 search, analytics and reporting in PGlite | **PASS — 33 checks** |
| `npm run test:auth` | Open-redirect and post-login destination guards | **PASS — 34 checks** |
| `npm run test:rls:selftest` | TOTP, config guards, denial classification, report redaction (offline) | **PASS** |
| `npm run verify:routes` | Built server HTTP/SEO/security audit | **PASS — 311/311** (run against the `vercel-deploy/` build) |
| `npm run secrets:scan` | Credential scan (keys, JWTs, env files) | **PASS** — 440 files, no findings |
| `npm run release:verify` | Deployment and migration bundles match the source | **PASS** |
| `cd vercel-deploy && npm ci && npx next build` | Independent build of the deployment folder | **PASS** — exit 0 |
| `npm run test:rls:live` | RLS negative suite against a hosted Supabase project | **BLOCKED — NOT RUN**, exit 2 (no credentials) |

Release commands (`release:sync`, `release:verify`, `deploy:verify`, `migrations:verify`,
`secrets:scan`) and the independent deployment build are documented in
[FINAL_RELEASE_STATUS.md](FINAL_RELEASE_STATUS.md) and [VERCEL_DEPLOYMENT.md](VERCEL_DEPLOYMENT.md).

`test:db` applies the actual migration SQL and drives the RPCs as four identities (customer,
provider, rider, owner) plus an anonymous/public reader where relevant. It asserts:

### Orders and delivery (0015–0019)
- order totals, delivery fee split and commission come from database rows, not client input;
- KSh 50 sale → KSh 5 commission → KSh 45 provider net;
- handover proof code exists; delivery alone does not complete an order;
- the rider job board hides the drop-off address until the job is claimed;
- the ledger balances on payment and after refund; settlement nets to zero;
- refunds require a customer request and an owner decision;
- 47 Kenyan counties are seeded.

### Passenger transport (0020)
- an approved transport partner with a pending vehicle cannot receive trips until an owner approves it;
- the customer sees only approved, active vehicles for the requested mode;
- a KSh 2,000 proposal → KSh 2,200 counter → accepted agreement is snapshotted;
- payment before agreement is rejected; invalid trip transitions are rejected;
- KSh 2,200 → KSh 220 commission → KSh 1,980 rider net;
- the ride ledger balances;
- contact details are available only after payment;
- rider completion alone does not release earnings; customer confirmation completes the trip;
- one rating per completed ride;
- available balance equals the ledger; over-withdrawal is rejected;
- a pending withdrawal is reserved; a paid withdrawal debits once and repeats are idempotent;
- a provider-verified M-Pesa reference settles through the same path; duplicate callbacks return
  `already-succeeded`.

### House Hunt (0021)
- published property is publicly searchable without an account;
- public search results contain no exact address;
- contact access is refused before payment;
- KSh 20 unlock releases the exact address/phone only to the buyer;
- repeating the unlock creates no second entitlement and no second charge;
- the fee is platform revenue and the ledger balances;
- a different account cannot read the unlocked contact;
- invalid contact details are rejected.

### Search and demand intelligence (0025)
`test:search` stubs the production column definitions and runs the real migration, then asserts:
- only published listings in active categories are returned — drafts, paused and inactive-category
  listings never appear;
- title and description full-text matching, relevance order, and price sorting;
- parent-category scope, division, county and price filters, alone and combined;
- stable totals, disjoint pages and clamped page size;
- a `%` term and a `'; drop table …` term match nothing and damage nothing;
- the protected House Hunt address, phone and contact name never appear in a payload;
- only the service role can record or prune analytics; a click on a draft listing is refused;
- non-owners cannot read insights, and an empty window reports `has_data = false` rather than
  presenting zeros as history.

### Payments and sandbox safety (0023–0024)
- sandbox settlement is refused while `allow_mock_payments` is off, and the ride stays unpaid;
- the payment-method registry seeds four providers disabled, with no client write path;
- migration 0024 no-ops safely where no `storage` schema exists (PGlite).

### Staff
- an ordinary customer has no capability;
- an ordinary user cannot grant themselves a capability;
- an owner grant becomes effective for the staff account;
- revocation takes effect immediately.

The test stubs the pre-existing `auth.users`, `listings`, `provider_applications`,
`marketplace_categories`, `user_roles` and `profiles` tables plus the owner check. It is therefore a
migration/flow test, not a live Supabase RLS test.

### Live RLS negative suite (`tests/rls`)

The suite exists and is documented in `docs/RLS_NEGATIVE_TESTS.md`. It creates isolated identities
(anonymous, two customers, approved and unapproved providers, two riders, a landlord, a limited
staff member and an owner), signs each one in for real, and attacks the authorization boundary with
direct PostgREST requests and RPC calls.

It has **never run against a hosted project**: no Supabase URL, publishable key or service-role key
is configured. `npm run test:rls:live` therefore prints `BLOCKED — NOT RUN` and exits 2. The offline
self-test proves the harness internals (including the TOTP challenge used to reach aal2); it proves
nothing about the policies themselves.

## What is NOT tested

- **Live Supabase:** applying migrations, the RLS negative role tests, storage, auth cookies, MFA
  enrollment, email verification, password recovery.
- **Live M-Pesa:** STK Push, callback verification against Daraja, B2C dispatch/result.
- **Live email:** Resend delivery, SPF/DKIM/DMARC, Supabase SMTP.
- **Browser end-to-end:** no seeded live project was available, so the new transport/House Hunt UI
  was compiled and route-audited but not driven with an authenticated session.
- **Concurrency:** two riders claiming one delivery was designed with row locks but is not tested
  under parallel connections.
- **Load, accessibility, mobile devices, restore-from-backup.**

## Manual release checks

1. Apply migrations `0001`–`0021` to staging in order. Confirm no SQL errors and no data loss.
2. Run `npm run test:rls:live` against the staging project. Every check must pass; any BLOCKED entry
   must be explained (MFA disabled, sandbox payment mode, or no storage buckets).
3. Run the full ride: request → counter → accept → pay (sandbox) → arrived → in progress → rider
   completes → customer confirms → rate → withdraw.
4. Run House Hunt: browse anonymously → sign in → unlock (sandbox) → read contact → repeat unlock
   → confirm no second charge.
5. Approve a vehicle and a property as owner with MFA; confirm the audit log records each decision.
6. Switch one staging transaction to Daraja sandbox, complete STK and B2C tests, and reconcile the
   provider statement against `ledger_entries`.
7. Send a real email and inspect authentication results in the received headers.
8. On a narrow viewport and keyboard only, complete the transport and House Hunt flows.

## Required before launch

- Run the RLS negative suite green against staging (`npm run test:rls:live`, exit code 0).
- Payment webhook replay and amount-mismatch tests against the provider sandbox.
- Concurrency tests for ride/delivery assignment and payout dispatch.
- BOLA/IDOR tests for every `:id` route.
- Rate-limit tests behind the real edge platform.
- Accessibility audit and device lab pass.
- Restore and reconciliation drills.

Record the exact command, environment and result. Never report an unrun provider test as passing.
