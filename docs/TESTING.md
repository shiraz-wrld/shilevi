# Testing strategy and current results

## What runs today

| Command | Scope | Current result |
|---|---|---|
| `npm run typecheck` | `tsc --noEmit` | **PASS** |
| `npm run lint` | ESLint over `src/` | **PASS** (0 errors; warnings only) |
| `npm run build` | Production Next.js build | **PASS** |
| `npm run test:db` | Migrations 0015–0030 + real RPCs in PGlite (orders, refunds, rides, House Hunt, staff, settings, delivery), then the notification-dispatch claim contract | **PASS** |
| `npm run test:notifications` | `claim_notification_batch`: channel scoping, lease release, attempt ceiling, batch bounds, browser-call refusal (PGlite) | **PASS — 25 assertions** |
| `npm run test:migrations` | Full `0001`–`0042` chain in PGlite, schema invariants, grant checks, functional owner-read-model, reviewer visibility, provider category activation, delivery-code vault, customer-home personalization, in-app notifications, delivery-matching, deliverer-onboarding, web push, dispatch leases, live-position publishing/tracking authorization, delivery coordinates and proximity ranking, signup path intent, pricing/quote and 10% commission calls, `verify_schema.sql` | **PASS — 354 checks** |
| `npm run test:search` | Migration 0025 search, analytics and reporting in PGlite | **PASS — 33 checks** |
| `npm run test:auth` | Open-redirect guards, post-login landing defaults, owner/staff gate decisions, console error classification | **PASS — 72 checks** |
| `npm run test:rls:selftest` | TOTP, config guards, denial classification, report redaction (offline) | **PASS** |
| `npm run verify:routes` | Built server HTTP/SEO/security audit, including owner-console concealment and the new private routes | **PASS — 331/331** |
| `npm run secrets:scan` | Credential scan (keys, JWTs, env files) | **PASS** — 599 files, no findings |
| `npm run release:verify` | Deployment and migration bundles match the source | **PASS** |
| `cd vercel-deploy && npm ci && npx next build` | Independent build of the deployment folder | **PASS** — exit 0 |
| `npm run test:rls:live` | RLS negative suite against a hosted Supabase project | **BLOCKED — NOT RUN**, exit 2 (no credentials) |

### Owner console, MFA and concealment

The route audit asserts the security behaviour that unit tests cannot: every `/admin*` path returns
HTTP **404** with the ordinary not-found page for an anonymous caller (not a redirect, not a 403,
not an "Access denied" screen), and the two privileged endpoints answer an unauthorized POST/GET
with `404 {"error":"Not found"}`. A client-side message that looks like a 404 is not a pass; the
check reads the status line.

`tests/auth/access-gate.test.mjs` covers the decision table behind those gates: anonymous,
unconfirmed email, non-owner, owner at aal1 with and without a verified factor, owner at aal2, the
setup surface that must stay reachable at aal1, staff at aal1/aal2 with and without a grant, an owner
who must not slip through the staff path, and hostile `next` paths. It also checks that console
error messages name the real cause (missing function, MFA, permission, session, network) and never
contain a stack trace or connection string.

**Not covered locally:** a real TOTP enrolment, a real code challenge and an authorized owner
rendering a console page. Those require a hosted account with an authenticator and are listed as
live verification steps, not as passing checks.

Release commands (`release:sync`, `release:verify`, `deploy:verify`, `migrations:verify`,
`secrets:scan`) and the independent deployment build are documented in
[FINAL_RELEASE_STATUS.md](FINAL_RELEASE_STATUS.md) and [VERCEL_DEPLOYMENT.md](VERCEL_DEPLOYMENT.md).

`test:db` applies the actual migration SQL and drives the RPCs as four identities (customer,
provider, rider, owner) plus an anonymous/public reader where relevant. It asserts:

### Application review visibility and evidence (0032)

- a submitted application belonging to a different account is readable by an **aal2 owner** and by
  nobody else: an applicant still reads only their own row, and an aal1 owner reads none;
- `admin_application_detail` returns the applicant's confirmed email and identity for an owner, and
  raises for a customer; the payload contains no factor, token or other account's record;
- an owner still cannot approve **their own** application — the trigger keeps refusing after the
  read policy is widened;
- `verify_schema.sql` asserts the read model's grants and the presence of
  `provider_applications_read_reviewer`, because a missing policy makes the queue look legitimately
  empty rather than broken.

The review endpoint (`POST /api/admin/applications/review`) is checked over HTTP: anonymous, `GET`
and foreign-Origin callers receive `404 {"error":"Not found"}`, and the new console paths
(`/admin/incidents`, `/admin/document-requirements`, `/admin/payouts/reconciliation`) return a real
`404` for an anonymous visitor. What is **not** covered locally is a real owner approving a real
application on the hosted project: that needs the owner's session and an applied `0032`.

### In-app notifications (0036)

`tests/db/migrations-full.test.mjs` inserts real outbox rows for two accounts and then drives the
functions as each one:

- a signed-out caller cannot read notifications;
- only the caller's rows are returned, and no raw payload or recipient field is echoed;
- `application_status` for a transport application links to `/deliver`;
- an order link is built only from a well-formed UUID — `../admin` becomes `/account/orders`;
- bodies are composed server-side from known fields;
- acknowledging one notification decrements the unread count;
- another account's notification cannot be acknowledged and is left untouched;
- mark-all clears the rest, and the unread count reaches zero;
- under RLS, a signed-in client selects **zero** rows belonging to another account.

### Customer home personalization (0035)

`tests/db/migrations-full.test.mjs` drives the real functions, not a reimplementation:

- a signed-out caller cannot load `customer_home()`;
- a new account gets `has_history = false` and the newest published listings as a real fallback;
- a draft listing is never recommended;
- `record_listing_view` records one view and deduplicates a repeat inside 30 minutes;
- the viewed category becomes the leading interest and the top recommendation;
- a price-band preference does not collapse the feed to one price, and another county stays eligible;
- `set_customer_area('Nairobi')` persists, `'Atlantis'` is rejected;
- the saved area drives the "nearby" row, and every row in it really carries that county;
- opting out stops history ranking while keeping real listings;
- a second signed-in account reads **zero** rows of the first account's history under RLS, and is
  never recommended a listing it owns;
- `clear_my_marketplace_history()` detaches the account's rows (they stay as anonymous demand), and
  removes the saved area.

### Delivery confirmation code vault (0034)

- the code is removed from `deliveries` (a row the assigned rider can read), so a provider can no
  longer read the customer's code or complete a delivery with it;
- the customer still reads it through `get_delivery_proof_code`, and it reports nothing once used;
- `verify_delivery_proof_code` counts a wrong guess and commits the count, because a raised
  exception would roll the counter back and leave the code freely guessable; five failures lock the
  delivery for 15 minutes, and a locked delivery rejects even the correct code afterwards;
- `rider_update_delivery` refuses to complete a delivery that has not been verified in the last ten
  minutes, consumes the code on success, and rejects a replay;
- `verify_schema.sql` asserts the vault has RLS on, no policy and no `authenticated` SELECT grant.

### Provider category activation (0033)

- approval on its own creates **no** `provider_activities` row (the badge is not activation);
- the owner can activate exactly one category for an approved application, and
  `can_publish_with_activity` then returns true for that provider in that category;
- a provider cannot activate a category for themselves, an unapproved application cannot be
  activated, and a category from another division is refused;
- `verify_schema.sql` asserts the activation function is executable by `authenticated` and not by
  `anon`, because an unreachable grant is how the gap appeared in the first place.

### Delivery pricing and commissions (0031)

- an unpriced route raises instead of returning an invented price, and cargo above a vehicle
  class's payload or handling capability is refused;
- a real quote's components add up and satisfy `total_minor = rider_fee_minor + platform_fee_minor`,
  with the rule version stored;
- `attach_delivery_quote_to_order` reprices the unpaid order and shipment once, moves the cargo and
  the quote snapshot onto the shipment, and refuses to reuse the quote;
- 10% client payment commission (`commission_split`) and 10% deliverer payout commission are
  computed centrally, the payout retry writes no second ledger pair, a reversal needs a reason,
  posts an `adjustment` pair and restores the net amount;
- a customer cannot create pricing rules or read payout reconciliation, and a ledger row must
  reference exactly one order or payout.

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
