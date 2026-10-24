# Manual Supabase migration and verification guide

**Target project:** `shilevi pr 1` — reference `kdygwbymgpmssuszhski`, organisation
`qtdmqpaqtqjdcjhquyur`, region West EU (Ireland).
**Bundle:** [`supabase-manual-migration/`](../supabase-manual-migration) — generated from
[`supabase/migrations/`](../supabase/migrations) by `npm run migrations:sync`.
**Status:** every migration in this bundle has been applied and exercised **in PGlite only**
(`npm run test:db`, `npm run test:search`). **None has been applied to the hosted project.** Nothing
in this repository applies them automatically, and CI never does.

> Treat the reference and organisation IDs as configuration, not credentials. No key, token or
> password belongs in this guide, and none exists in the repository.

---

## 1. Confirm you are in the right project

1. Open <https://supabase.com/dashboard> and select organisation `qtdmqpaqtqjdcjhquyur`.
2. Open the project whose **reference** is `kdygwbymgpmssuszhski`. The reference is visible in the
   project URL (`/project/kdygwbymgpmssuszhski`) and under **Settings → General**.
3. Check the region reads **West EU (Ireland)**. A different region means a different project.
4. Confirm the project is empty before the first migration: **Table editor** shows no `public`
   tables. If tables already exist, stop and compare with the bundle before running anything.

Do not paste migrations into a project you did not select deliberately. If you are unsure, create a
second free project for staging and practise there first.

## 2. Prerequisites

- **Extension:** `pgcrypto` (used for `gen_random_uuid()`). Migration `0001` runs
  `create extension if not exists pgcrypto;`. No other extension is required. Do not add `pg_trgm`
  or a search extension: search uses built-in `tsvector`/`tsquery`.
- **Schemas:** `auth` (Supabase Auth, created by the platform) and `storage` (created by the
  platform). Migration `0024` creates the buckets inside `storage` and no-ops safely if the storage
  schema is absent.
- **Role:** run the SQL as `postgres` (the SQL editor default) so policies, grants and triggers can
  be created. Never run these files as `authenticated` or with an anon key.
- **Client:** the app only ever uses the publishable/anon key. The service-role key stays in Vercel
  server-side environment variables.

## 3. Apply the migrations, in order, one file per run

The bundle is ordered `0001` → `0025`. Each file assumes every earlier file succeeded.

1. Open **SQL editor → New query**.
2. Paste the whole file (not part of it) and run it **once**.
3. Read the result. Success looks like `Success. No rows returned` (or a short notice).
4. If a statement fails, **stop**. Do not continue to the next file and do not re-run a half-applied
   file: several migrations `revoke`/`grant` and re-running a partial script can leave a policy
   missing. Read the error, note the file and line, and fix the cause before continuing.
5. Repeat for the next file.

Some files wrap their work in `begin; … commit;` and some do not. A single SQL-editor run is
transactional per statement, not per file, so a mid-file failure can leave earlier statements in
that file applied. That is why step 4 matters.

### What each migration does

| # | File | Purpose |
|---|---|---|
| 0001 | initial marketplace schema | profiles, categories, brands, listings, storage-safe money columns |
| 0002 | identity and provider workflow | signup trigger, protected `user_roles`, provider applications |
| 0003 | discovery, brands, admin allowlist | brand storefronts, `is_shilevi_owner_admin()`, owner allowlist |
| 0004 | customer/provider onboarding | `user_onboarding`, transport profile drafts |
| 0005 | admin database policies | category and brand administration policies |
| 0006 | provider application transitions | guarded submission/review state machine |
| 0007 | provider listing drafts | provider-owned draft creation and narrow write grants |
| 0008 | account settings and deletion requests | `account_deletion_requests` |
| 0009 | deletion review workflow | recent-auth requirement and owner review |
| 0010 | deletion request cancellation | customer can cancel an open request |
| 0011 | saved listings | per-user favourites |
| 0012 | notification preferences | per-user channel preferences |
| 0013 | notification column grants | narrows insert/update columns |
| 0014 | listing requests | customer → provider enquiries |
| 0015 | provider activities | per-category activity permissions |
| 0016 | orders and deliveries | order spine, delivery states, platform settings |
| 0017 | payments, ledger, commission | integer-minor-unit ledger, refunds, payouts |
| 0018 | Kenya locations | 47 counties and coverage controls |
| 0019 | owner audit and order reads | owner reads for audit trail and orders |
| 0020 | passenger transport | rides, offers, fare states, ride ledger |
| 0021 | House Hunt | property listings, paid contact unlock, staff capabilities, notifications |
| 0022 | rider balance authorization | closes a cross-account balance read (security fix) |
| 0023 | payment methods and sandbox switch | fail-closed `allow_mock_payments`, provider registry |
| 0024 | storage buckets and policies | `listing-images` (public), `provider-documents` (private) |
| 0025 | search and demand intelligence | search RPC, `search_events`, admin insights, prune function |

## 4. Owner allowlist (do this immediately after 0003)

`0003` seeds the two owner addresses hard-coded by the original brief:
`russhiraz565@gmail.com` and `russhiraz1@gmail.com`. The table enforces lowercase and a `@gmail.com`
address.

If those are not the addresses you will sign in with, add yours **before** relying on `/admin`:

```sql
insert into public.owner_admin_allowlist (email)
values (lower(trim('you@example.com')))
on conflict (email) do nothing;
```

The owner gate has two independent halves: the database helper `is_shilevi_owner_admin()` requires
an allowlisted, email-confirmed account whose JWT is at **aal2** (TOTP verified), and the server
guard `requireOwnerAdmin()` re-checks the session, the allowlist and the MFA level. Adding an address
does not sign anyone in; it only permits that verified account.

## 5. Supabase Auth configuration

In **Authentication → URL Configuration**:

- **Site URL:** `https://<your-production-domain>` (for example `https://shilevi.app`).
- **Redirect allow list:** `https://<your-production-domain>/auth/callback`,
  `https://<your-vercel-preview-domain>/auth/callback` and `http://localhost:3000/auth/callback`
  for local development. The app sends users to `/auth/callback?next=…` and validates `next`
  against its own allowlist (`src/lib/auth/redirect.ts`).

In **Authentication → Providers**:

- **Email:** enabled. Decide whether **Confirm email** is on. With it on, a new account receives a
  verification email and the callback creates the session when the link is opened. With it off,
  sign-up returns a session immediately. The app handles both.
- **Google:** optional. It needs a Google Cloud OAuth client with the Supabase callback
  (`https://kdygwbymgpmssuszhski.supabase.co/auth/v1/callback`) as an authorised redirect URI, and
  the resulting client ID/secret entered **in Supabase**, never in this repository.

In **Authentication → Multi-Factor Authentication**: enable **TOTP**. Owner administration requires
aal2, so without an enrolled authenticator the owner cannot perform privileged writes. Enrol at
`/admin/security` after signing in.

Email delivery (verification, recovery) uses Supabase's SMTP settings. See
[EMAIL.md](EMAIL.md) — delivery is **not** proven until a real message arrives in a real mailbox.

## 6. Storage

Migration `0024` creates:

| Bucket | Public | Limit | MIME types | Write access |
|---|---|---|---|---|
| `listing-images` | yes | 5 MiB | JPEG, PNG, WebP | uploader's own folder only |
| `provider-documents` | no | 10 MiB | as declared | uploader, the account owner, or staff with `properties.verify` |

If your SQL editor role cannot write to `storage.buckets`, create the two buckets by hand in
**Storage** with exactly these names and public/private flags, then re-run the policy section of
`0024`. Do not make `provider-documents` public: it will contain identity and ownership evidence.

Verify in **Storage → Policies** that both buckets list the policies from `0024`.

## 7. Server-only environment variables

Set these in Vercel (see [VERCEL_DEPLOYMENT.md](VERCEL_DEPLOYMENT.md)), never in the browser and
never in `.env.example`:

| Variable | Required for | Notes |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | payment callbacks, payouts, analytics writes, notification dispatch | server-only, bypasses RLS — treat as a master key |
| `MPESA_*` | real M-Pesa STK and B2C | all five STK values required before a charge starts |
| `RESEND_API_KEY` | transactional email | Supabase Auth email is configured separately in Supabase SMTP |
| `NOTIFICATION_DISPATCH_SECRET` | `/api/notifications/dispatch` | bearer secret for the scheduler |

The application fails closed: with no credentials, payment routes answer `503` with a plain
"not configured" message, checkout shows payment unavailable, and admin provider settings show the
same denial. Nothing pretends to have charged anyone.

## 8. Verify the schema

Run [`supabase-manual-migration/verify_schema.sql`](../supabase-manual-migration/verify_schema.sql)
in the SQL editor. It is read-only. It returns one row per check:

- **PASS** — the table, function, policy, bucket or setting exists as expected.
- **FAIL** — a migration step did not apply. Re-read the migration that creates that object.
- A **FAIL on `sandbox payments disabled`** is only acceptable on a deliberate sandbox project.

Then confirm the payment posture row at the end: `payment_mode` should be `mock` only on a sandbox
project, `allow_mock_payments` must be `false` anywhere real money is expected, and
`enabled_payment_methods` should be `0` until you configure a provider in `/admin/payments/providers`.

## 9. Test owner, staff and MFA permissions

1. Sign in as an allowlisted owner. Open `/admin`. Without an enrolled authenticator you should be
   denied (the page renders the denial panel, not a session bypass).
2. Enrol TOTP at `/admin/security`, verify the code, then reload `/admin`. Administration should now
   load.
3. In a second browser profile, sign in as an ordinary customer and open `/admin`,
   `/admin/payments/providers` and `/admin/insights`. Every one must deny access. A rendered page is
   not proof: check that no admin data is present in the HTML.
4. Confirm an ordinary user cannot grant themselves a role:

   ```sql
   -- run as the signed-in user, not as postgres; expect an error or zero rows
   insert into public.user_roles (user_id, role) values (auth.uid(), 'owner');
   ```

5. Confirm analytics are not client-writable:

   ```sql
   select p.proname, has_function_privilege('authenticated', p.oid, 'execute') as client_can_execute
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('record_search_event', 'prune_search_events');
   -- expect false for both rows
   ```

## 10. Verify against staging before production

Keep two projects: staging and production. On staging:

1. Apply the full bundle, run `verify_schema.sql`, and fix every FAIL.
2. Configure Auth redirects for the staging URL, enrol an owner authenticator, and walk the flows:
   sign up → confirm email → onboarding → sign in → sign out → forgot password → reset password.
3. Search with real seed listings, then check `/admin/insights` shows the resulting demand rows.
4. Run the live RLS suite against **staging only**
   (`SHILEVI_RLS_ALLOW_LIVE=1 npm run test:rls:live`, see [RLS_NEGATIVE_TESTS.md](RLS_NEGATIVE_TESTS.md)).
   It creates and deletes test accounts; never point it at production.
5. Only then apply the same bundle to production, in the same order, and re-run `verify_schema.sql`.

## 11. What remains unverified after a successful migration

Applying migrations proves the SQL ran. It does **not** prove that Auth redirects, SMTP delivery,
MFA enrolment, storage uploads, payment callbacks, payouts, Resend delivery or RLS behave correctly
on the hosted project. Those are checked by the staging steps above. Record the outcome in
[FINAL_RELEASE_STATUS.md](FINAL_RELEASE_STATUS.md).
