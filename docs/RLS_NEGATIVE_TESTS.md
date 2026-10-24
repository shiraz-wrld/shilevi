# Live Supabase RLS negative tests

**Status:** implemented, **BLOCKED — NOT RUN**. No hosted Supabase project is configured in this
repository, so the suite has never contacted a real project. The harness has been exercised offline
(see [Offline verification](#offline-verification)); the security matrix itself is unproven until it
runs against a disposable staging project.

**Command:** `npm run test:rls:live`

The in-process test (`npm run test:db`) proves the SQL logic executes. It cannot prove authorization,
because PGlite has no PostgREST, no JWT, no `anon`/`authenticated` roles and no storage. This suite
closes that gap by issuing real PostgREST requests and RPC calls with each identity's own access
token.

---

## 1. Safety model

| Rule | Implementation |
|---|---|
| Never touch production | `SHILEVI_RLS_ALLOW_LIVE=1` is mandatory. The runner also refuses a host containing `prod`. |
| Use a disposable project | All fixtures are namespaced with a per-run id; cleanup removes only those records. |
| No real customer data | The suite creates its own accounts (`rls.<run>.<role>@example.com`) and its own listings, orders and rides. |
| Service role is setup only | The service key creates accounts, seeds the approval chain a reviewer would create, and cleans up. Every authorization assertion runs with an `anon` key and a real user session. |
| No secrets in output | Keys, tokens and passwords are never printed; error text is passed through a JWT/key redactor before it reaches console or report. |
| No client-side evidence | A route guard is never treated as proof; the probes are direct PostgREST and RPC calls. |

`SHILEVI_RLS_KEEP_DATA=1` skips cleanup for inspection. It is intentionally not the default.

---

## 2. Required configuration

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<staging-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable / anon key>
SUPABASE_SERVICE_ROLE_KEY=<service role key>
SHILEVI_RLS_ALLOW_LIVE=1
```

Values belong in an untracked `.env.local` or in the shell environment. `.env.example` documents the
names only. Before the first run, apply migrations `0001`–`0024` in order to the staging project and
confirm `platform_settings.payment_mode` and `platform_settings.allow_mock_payments` match the mode
you intend to test. The suite reads the effective answer from `mock_payments_allowed()`, so a
project that has not applied `0023` reports a warning instead of guessing.

### First-run checklist

1. Create a **separate** Supabase project used only for testing. Never point the suite at the
   production project, even for a "quick check" — it creates and deletes accounts.
2. Apply the migrations manually in order (see `docs/REQUIREMENTS_MATRIX.md`). Confirm the auth
   bootstrap trigger exists: a new account must produce a `profiles` row. The suite fails setup with
   an explicit message if it does not.
3. Enable TOTP MFA in Supabase Auth if you want the owner/staff positive checks to run. Without it
   those checks report **BLOCKED**; the aal1 denial checks still run and pass.
4. Set the environment variables and `SHILEVI_RLS_ALLOW_LIVE=1`.
5. Run `npm run test:rls:live`.
6. Read `reports/rls-live-<timestamp>.md` (also written as JSON).

---

## 3. Test identities

Created fresh per run, then deleted.

| Identity | Purpose | Provisioning |
|---|---|---|
| `anon` | unauthenticated visitor | anon key, no session |
| `customerA` | buyer, rider customer, property buyer | self-service signup |
| `customerB` | unrelated customer and attacker | self-service signup |
| `seller` | approved product seller with a published and a draft listing | approved application + activity |
| `sellerB` | **unapproved** provider (pending application) | pending application only |
| `landlord` | approved property provider with a verified, published property | approved application + activity |
| `landlordB` | second approved landlord | approved application + activity |
| `rider` | approved transport partner with an approved active vehicle | approved application + activity + vehicle |
| `riderB` | second approved rider | approved application + activity + vehicle |
| `staff` | `orders.read`, `properties.verify`, `finance.read`; **no** `audit.read` | capability rows |
| `owner` | allowlisted owner administrator | `owner_admin_allowlist` entry (gmail.com, per the table constraint) + TOTP |

The staff account deliberately lacks `audit.read` so the suite can prove that holding *some*
capabilities does not grant the whole admin surface. Staff capability checks include a live TOTP
challenge because `has_staff_capability` and `is_shilevi_owner_admin` both require `aal2`.

---

## 4. Coverage

Check ids are stable and appear verbatim in the report.

### A. Profiles, roles and capabilities (`A1`–`A19`)
Anonymous profile read; own-profile read/write; cross-account read/write with stored-value
verification; self-promotion by `insert` and by `update` into `user_roles`; self-grant of
`staff_capabilities`; `admin_grant_staff_capability` refusal; capability read scope; staff reads at
aal1 (denied) versus aal2 (allowed); owner identity at aal1 versus aal2; owner audit read; client
write to `owner_admin_allowlist`; client write to the `allow_mock_payments` switch with a
stored-value check, because that flag decides whether orders can settle without a verified payment.

### B. Applications, listings and orders (`B1`–`B16`)
Unapproved provider cannot publish or even draft; cross-provider listing edit; own-draft edit; direct
self-publication of a draft; self-approval of an application; reviewer-field tampering during
submission; cross-customer and cross-provider order reads; direct edits to `total_minor`,
`payment_status` and `order_items.provider_net_minor`; provider status RPC from a foreign provider
and from the customer; anonymous order read.

### C. Passenger transport (`C1`–`C17`)
Cross-customer and cross-rider ride reads; foreign rider progress; customer driving rider
transitions; agreed-fare tampering; browser calls to `mark_ride_paid` and `confirm_provider_payment`;
contact access before payment for both parties; reading another rider's balance; requesting a ride
from an ineligible account; foreign rating; foreign completion confirmation. Then the server-side
settlement is simulated **with the service role only**, and the suite proves contact is released to
the two parties and still refused to a stranger.

### D. House Hunt and sandbox settlement (`D1`–`D21`)
Public search columns and values (exact address and phone must be absent); anonymous and
non-owner contact reads; private verification documents; `get_property_contact` before payment;
self-granted and mutated entitlements; `complete_property_unlock` from a browser; cross-landlord
edits of `property_listings` and `property_contacts`; staff contact access at aal1 versus aal2;
paying buyer receives the address; second customer and raw-table reads still refused.

The sandbox branch follows the **effective** switch, not `payment_mode` alone:

- Sandbox off (the production default): the unlock RPC, the order confirmation and the ride
  confirmation must all refuse, and the suite re-reads the database to prove no entitlement, order
  status change or ride payment was produced (`D19`, `D19b`, `D20`, `D21`).
- Sandbox on: the free unlock is reported **BLOCKED** by design with the exact setting named, and the
  suite additionally proves a customer still cannot settle another customer's order (`D20`).

### E. Payments, ledger and payouts (`E1`–`E14`)
Cross-customer and own intent reads; intent status tampering with stored-value check; direct intent
insert; intent creation against another customer's order; ledger read/insert/update; browser payout
decision with stored-value check; cross-rider and customer payout reads; browser `mark_order_paid`
and `confirm_provider_payout`.

### F. Notifications and audit (`F1`–`F10`)
Outbox read/insert/update; audit read/insert/update; staff without `audit.read`; own preference
write; cross-customer preference read and write.

### G. Storage
Every bucket is enumerated with the service role. Private buckets must refuse listing to both a
customer and an anonymous visitor. Public buckets are reported as **NOT TESTED** with a note, because
"public" is a product decision the suite cannot infer. A project with no buckets reports
**NOT TESTED**, not a pass.

---

## 5. Reading the results

Denial is asserted as an outcome, not a message: a denied `SELECT` normally returns zero rows, a
denied write returns zero rows or an RLS/privilege error, and a missing grant returns an error. Every
write probe also re-reads the row with the service role to prove the stored value did not change.

| Exit code | Meaning |
|---|---|
| `0` | the suite ran; no FAIL (see BLOCKED/NOT TESTED entries in the report) |
| `1` | at least one authorization boundary failed |
| `2` | the suite could not run: configuration missing or provisioning failed. **No security claim is implied.** |

Reports are written to `reports/`, which is git-ignored. They contain account labels, table and
column names and error codes — never keys, tokens or passwords.

---

## 6. What this suite does not cover

- **Anything without credentials.** As of this commit it has never run against a hosted project.
- **MFA-disabled projects:** owner/staff positive checks are BLOCKED, not passed.
- **Concurrency:** parallel claims and payout dispatch are not exercised.
- **Edge rate limiting, browser flows, accessibility, load.**
- **Payment provider behaviour:** Daraja callbacks and amounts are simulated by the documented
  server-side path, not by a real provider.
- **Storage policies when no buckets exist.**

---

## 7. Findings from the static review

Static review of the policies, grants and `SECURITY DEFINER` bodies found one real authorization gap:

- `rider_available_balance(p_rider_id)` was executable by any authenticated user and returned the
  balance for **any** rider id, leaking another account's earnings position. Because the function is
  `SECURITY DEFINER`, the RLS policies on `ledger_entries` and `payouts` did not apply.
  **Fixed in `0022_rider_balance_authorization.sql`**: the caller may read their own balance, or the
  owner (aal2) and holders of `finance.read` / `finance.payout` may read another rider's balance for
  reconciliation. `npm run test:db` now asserts both the denial and the owner allowance.

Everything else reviewed held: ride, property, order and payment state changes go through
ownership-checked RPCs; `complete_property_unlock`, `mark_ride_paid`, `mark_order_paid`,
`confirm_provider_payment` and `confirm_provider_payout` are service-role only; contact tables have
no public or buyer read policy; `staff_capabilities`, `user_roles` and `owner_admin_allowlist` have
no client write policy.

Two configuration hazards are worth repeating:

1. Sandbox money needs two settings. `payment_mode` still defaults to `"mock"`, but `0023` added
   `allow_mock_payments`, which defaults to **false**, so the sandbox RPCs refuse until an owner
   deliberately enables both. If they are enabled the RPCs create entitlements and settle orders
   without a verified provider payment; the suite reports that check as BLOCKED and names the
   settings.
2. Staff and owner authorization depends on `aal2`. A project that never enforces MFA makes those
   roles unusable rather than unsafe — the denial direction is the one that is tested unconditionally.

---

## 8. Offline verification

`node tests/rls/selftest.mjs` checks the parts that do not need a project:

- base32 decoding and TOTP generation against the RFC 6238 SHA-1 vectors;
- `aal` extraction from an access token;
- configuration refusals (missing keys, missing opt-in, production-looking host) and acceptance of a
  staging host;
- denial classification for errors, empty reads and empty writes;
- redaction of JWTs in report text.

That self-test passes. It does not exercise any policy.

The last live attempt is recorded in `reports/` and ends with `BLOCKED — NOT RUN` and exit code 2,
because `NEXT_PUBLIC_SUPABASE_URL`, the publishable key, the service-role key and
`SHILEVI_RLS_ALLOW_LIVE` are all unset.
