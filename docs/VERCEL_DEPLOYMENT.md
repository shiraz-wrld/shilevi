# Vercel deployment guide

**Repository:** `shiraz-wrld/shilevi` · **Root Directory:** `vercel-deploy` · **Framework:** Next.js
(App Router, Next 15) · **Node.js:** 24 (minimum supported by the project: 20.9) · **Package
manager:** npm with the committed `package-lock.json`.

`vercel-deploy/` is a **generated, self-contained copy** of the application. The repository root is
the source of truth; never edit files in `vercel-deploy/` by hand. After any source change run:

```bash
npm run release:sync      # rewrites vercel-deploy/ and supabase-manual-migration/
npm run release:verify    # fails if either bundle has drifted
```

and commit both the source change and the regenerated bundles. `docs/DEPLOY_MANIFEST.json` records
the SHA-256 of every shipped file, so a reviewer can see exactly what Vercel will build.

## 1. What ships and what does not

| Ships in `vercel-deploy/` | Stays in the repository only |
|---|---|
| `src/` (pages, route handlers, components, domain logic, middleware) | `supabase/migrations/` and the manual migration bundle |
| `package.json`, `package-lock.json`, `tsconfig.json` | `tests/` (database, search, auth, RLS harness) |
| `next.config.ts`, `postcss.config.mjs`, `eslint.config.mjs` | `scripts/` (route audit, packaging, secret scan) |
| `next-env.d.ts`, `.env.example`, `.gitignore` | `docs/`, `.github/workflows/` |
| `README.md`, optional `public/` assets | `archive/` (superseded scaffold), `reports/`, `.next/` |

API route handlers **are** application code and ship: the browser calls `/api/search`,
`/api/payments/methods`, `/api/auth/signout`, `/api/health` and the payment callbacks on the same
deployment. Their secrets live in environment variables, not in the bundle.

## 2. First deployment

1. Push the repository (see [GITHUB_RELEASE.md](GITHUB_RELEASE.md)) and open
   <https://vercel.com/new>, importing `shiraz-wrld/shilevi`.
2. Set **Root Directory** to `vercel-deploy`. If you leave it at the repository root, Vercel will
   find no Next.js app and the build will fail — this is the single most important setting.
3. Framework preset: **Next.js** (detected). Leave Build Command `npm run build`, Output Directory
   `.next`, Install Command `npm ci` (set it explicitly if the preset offers `npm install`).
4. Set **Node.js Version** to **24.x** in Project → Settings → General. Node 22 also works
   (the app requires 20.9 or newer); do not go below 20.9.
5. Add the environment variables in §3 **for Production and Preview** before the first build.
   `NEXT_PUBLIC_*` values are inlined at build time — adding them afterwards requires a redeploy.
6. Apply the database migrations first ([SUPABASE_MIGRATION.md](SUPABASE_MIGRATION.md)); a frontend
   deployed against an empty database renders honest "nothing here yet" states, not a working
   marketplace.
7. Deploy, then work through §5.

## 3. Environment variables

Set these in **Project → Settings → Environment Variables**. Use the Production scope for the live
site and the Preview scope for branch deployments; do not share a production service-role key with
preview builds unless you accept that preview can read and write production data.

### Required for a functioning site

| Variable | Scope | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | all | Supabase project URL, e.g. `https://kdygwbymgpmssuszhski.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | all | publishable/anon key; safe in the browser, enforced by RLS |
| `NEXT_PUBLIC_SITE_URL` | all | canonical origin, e.g. `https://shilevi.app`; wrong value breaks canonicals, sitemap and email links |

Without the first two, the app renders its configuration states and refuses to pretend it is
working. Without `NEXT_PUBLIC_SITE_URL`, Vercel's own deployment URL is used.

### Required before taking money

| Variable | Purpose |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | verified M-Pesa callbacks, payouts, trusted analytics writes, notification dispatch. Server-only; bypasses RLS. |
| `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_SHORTCODE`, `MPESA_PASSKEY`, `MPESA_CALLBACK_URL` | STK push. All five must be present or the route answers 503. |
| `MPESA_ENV` | `sandbox` or `production`; anything else is treated as sandbox. |
| `MPESA_TRANSACTION_TYPE` | optional, defaults to `CustomerPayBillOnline`. |
| `MPESA_VERIFY_CALLBACK` | optional; set to `false` only if Safaricom cannot reach your verification endpoint. |
| `MPESA_B2C_*` | B2C payouts; optional, withdrawals stay pending without them. |

### Optional

| Variable | Purpose |
|---|---|
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | transactional email from the notification outbox |
| `NOTIFICATION_DISPATCH_SECRET` | bearer secret for `POST /api/notifications/dispatch` |
| `NEXT_PUBLIC_SUPPORT_EMAIL`, `NEXT_PUBLIC_PRIVACY_EMAIL`, `NEXT_PUBLIC_SECURITY_EMAIL` | addresses shown on support and legal pages |

### Never

- The service-role key, Daraja secrets, Resend key or dispatch secret in any `NEXT_PUBLIC_*`
  variable, in `.env.example`, in source, in a commit, or in a log line.
- Supabase's **secret** key where the publishable key belongs. If a secret key ever appears in the
  browser bundle, rotate it immediately in Supabase.
- Real values in `.env.example`. It must contain placeholders only; the secret scan
  (`npm run secrets:scan`) fails the build if real key material is committed.

## 4. Supabase Auth settings that must match the deployment

In Supabase → Authentication → URL Configuration:

- **Site URL:** your production origin, exactly as `NEXT_PUBLIC_SITE_URL`.
- **Redirect allow list:** `https://<production-domain>/auth/callback`,
  `https://<vercel-preview-domain>/auth/callback`, and `http://localhost:3000/auth/callback` for
  local development.

The app sends confirmation and recovery links through `/auth/callback` and validates the `next`
parameter against a single allowlist before redirecting. If the callback origin is not allowed, the
link fails with `error=auth_callback` — that is a Supabase allowlist problem, not an app bug.

Google sign-in additionally needs the Google provider enabled in Supabase with the Supabase auth
callback URL registered in Google Cloud. The app never holds Google client secrets.

## 5. Post-deployment verification

Work through this list on the real deployment; a successful build proves none of it.

1. **Homepage** — `GET /` returns 200 and the Shilevi hero ("One place for what you need."), the four
   divisions, and usable links. It must not redirect to `/search`, `/login` or a starter page.
2. **Discovery** — `/search?q=<term>` returns real published listings; try a term with no matches
   (expect an honest zero-result state), an invalid filter value (expect a 400 from `/api/search`),
   and a second page of results.
3. **Registration and login** — create an account, confirm the email, land on `/onboarding`, save a
   profile, sign out, sign back in. Refresh a protected page and confirm the session persists.
4. **Password recovery** — request a reset, open the emailed link, set a new password, sign in.
5. **Protected routes** — open `/account`, `/provider`, `/rider/jobs`, `/admin`, `/checkout` while
   signed out; each must redirect to `/login` and back to the original destination after sign-in.
6. **Administration** — sign in as an allowlisted owner, enrol TOTP at `/admin/security`, confirm
   `/admin` loads only at aal2, and confirm an ordinary account is denied.
7. **Search analytics** — after a few searches, `/admin/insights` shows counts. If it says analytics
   are unavailable, `SUPABASE_SERVICE_ROLE_KEY` is missing; the app will not fabricate numbers.
8. **Payments** — `/checkout` must show payment unavailable until a provider is configured. Nothing
   may claim a charge succeeded without a verified callback.
9. **Headers** — `curl -sI https://<domain>/api/health` shows `cache-control: no-store` and
   `x-robots-tag: noindex`; private areas return `X-Robots-Tag` and never cache.
10. **Console** — no 500s, no "missing environment variable" errors in the browser console, no
    secret in any response body.

`BASE_URL=https://<domain> npm run verify:routes` runs the automated HTTP/SEO/security audit against
the live deployment (the script lives outside `vercel-deploy/` and needs Node locally).

## 6. Reading logs without leaking secrets

Use **Deployments → Functions → Logs** and the build log. The application only logs:

- a payment intent id and an error **code** for a failed provider call,
- generic messages with no request body, headers, phone numbers or keys.

If a log line appears to contain a credential, treat it as an incident: rotate the credential with
the provider, then fix the log statement. Never paste a full environment dump or `.env.local` into
an issue or a support request.

## 7. Rollback and recovery

- **Instant rollback:** Vercel → Deployments → previous successful deployment → **Promote to
  Production**. This reverts the application, not the database.
- **Database:** migrations are forward-only. Never restore by dropping tables that hold ledger,
  order or audit rows. Write a new corrective migration, or restore a Supabase backup into a new
  project and point the environment at it deliberately.
- **Bad environment variable:** fix it in Settings and redeploy; `NEXT_PUBLIC_*` changes need a new
  build because they are inlined.
- **Compromised key:** rotate in Supabase / Safaricom / Resend first, update Vercel, redeploy, then
  review `/admin/audit-log`.

## 8. Features that stay unavailable until configured

These are implemented in code and **fail closed**. They are not deployment bugs:

| Feature | Missing prerequisite |
|---|---|
| Card payments | no gateway was selected or contracted; no adapter exists |
| Airtel Money | no merchant account or adapter exists |
| Real M-Pesa charges | Daraja credentials, a public HTTPS callback URL, `SUPABASE_SERVICE_ROLE_KEY` |
| M-Pesa B2C payouts | B2C credentials and an approved payout shortcode |
| Transactional email | verified Resend domain, SPF/DKIM/DMARC, `RESEND_API_KEY` |
| Auth email (verification, recovery) | SMTP configured in Supabase, verified sender domain |
| Analytics in `/admin/insights` | `SUPABASE_SERVICE_ROLE_KEY` (writes) and real traffic |
| Provider verification document review | migrations applied; a real document upload workflow and reviewer |
| Private House Hunt contact reveal | a configured, enabled payment method; otherwise the unlock is unavailable |

## 9. Vercel-specific notes

- **Do not** set a custom Output Directory or a static export. The app uses middleware, server
  route handlers and server components; `output: "export"` would remove required behaviour.
- `next.config.ts` sets security headers, private-area `X-Robots-Tag` and remote image patterns for
  `*.supabase.co`. These run on Vercel's Node runtime without extra configuration.
- The in-memory rate limiter is per serverless instance. It blunts casual abuse but is not a
  distributed limiter; put Vercel's firewall or an edge rate-limit rule in front of `/api/*` before
  high-traffic launch.
- Cron-style work (payout dispatch, notification dispatch, `prune_search_events`) needs a Vercel
  Cron Job or an external scheduler calling the authenticated endpoints. None is configured yet.
- No deployment is "verified" until §5 has been completed against the real origin.
