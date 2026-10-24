# Shilevi

Kenya-first marketplace for products, services, transport & delivery, and property & places.

## Stack
- Next.js 15 App Router + React 19 + TypeScript
- Tailwind CSS 4
- Supabase Auth/Postgres/Storage/RLS (SQL migrations are in `supabase/migrations/`)
- Vercel hosting from the `vercel-deploy/` Root Directory

## Local setup
1. Use Node.js 24.x (the project supports 20.9 and newer).
2. `npm ci` (the lockfile is committed; `npm install` works too)
3. Copy `.env.example` to `.env.local` and fill in the public Supabase URL and publishable key.
4. `npm run dev`

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build (all routes must compile) |
| `npm run lint` | ESLint over `src/` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test:db` | Applies migrations 0015–0024 to an in-process PostgreSQL (PGlite) and drives orders, delivery, refunds, passenger rides, House Hunt contact access, payouts, staff permissions and the sandbox payment switch |
| `npm run test:search` | Applies migration 0025 and asserts search visibility, filters, ranking, pagination, injection resistance, contact secrecy and analytics authorization |
| `npm run test:auth` | Open-redirect and post-login destination guards (34 checks) |
| `npm run test:rls:selftest` | Offline self-test of the live RLS harness (TOTP, config guards, denial classification) |
| `npm run verify:routes` | Runs `scripts/route-audit.mjs` against a running build: routes, canonicals, headers, legal, private redirects, sitemap and internal links |
| `npm run release:sync` | Regenerates `vercel-deploy/` and `supabase-manual-migration/` from the source of truth |
| `npm run release:verify` | Fails if either generated bundle has drifted |
| `npm run secrets:scan` | Fails on committed credentials, key material, JWTs or env files |

## Routes

Public: `/`, `/marketplace/[division]`, `/listing/[id]`, `/brands/[slug]`, `/search`, `/transport`, `/house-hunt`, `/house-hunt/[id]`, `/about`, `/how-it-works`, `/pricing`, `/safety`, `/accessibility`, `/help`, `/support`, `/security`, `/legal` and `/legal/{terms,privacy,cookies,refunds,provider-agreement,acceptable-use}`.

Account and transaction: `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/onboarding`, `/account/*`, `/cart`, `/checkout`.

Provider and rider: `/provider`, `/provider/{apply,listings,orders,requests,properties,transport-details}`, `/rider`, `/rider/{jobs,rides}`, `/rider/jobs/[id]`.

Administration (owner, or staff with an explicit capability; MFA `aal2`): `/admin`, `/admin/{applications,brands,categories,deletion-requests,listings,orders,rides,properties,payments,payments/providers,insights,staff,audit-log,security}`.

Machine endpoints: `/api/search` (GET), `/api/search/event` (POST), `/api/payments/methods` (GET), `/api/health`, `/api/auth/signout` (POST), `/api/security/csp-report` (POST), `/api/payments/mpesa/initiate` (POST, authenticated), `/api/payments/mpesa/callback` (POST, provider), `/api/payments/mpesa/b2c-result` (POST, provider), `/api/payments/payouts/dispatch` (POST, owner), `/api/notifications/dispatch` (POST, secret), `/robots.txt`, `/sitemap.xml`, `/manifest.webmanifest`, `/opengraph-image`.

Private routes are `noindex`, disallowed in `robots.txt`, and marked `private, no-store` by middleware.

## Deployment

The Vercel **Root Directory** is `vercel-deploy/`. It is a generated, self-contained copy of the
application: edit the repository root, then run `npm run release:sync` and commit both. The
Supabase SQL is packaged separately in `supabase-manual-migration/` for manual application — nothing
in this repository runs migrations automatically.

- `docs/VERCEL_DEPLOYMENT.md` — Root Directory, build settings, every environment variable,
  post-deploy checks, rollback and what stays unavailable until configured.
- `docs/SUPABASE_MIGRATION.md` — project confirmation, migration order, Auth/storage setup,
  owner allowlist, schema verification and staging tests.
- `docs/FINAL_RELEASE_STATUS.md` — the release ledger: what is verified, what is partial, what is
  blocked and what you must do.
- `docs/GITHUB_RELEASE.md` — the actual Git state and the exact push steps.

## Verification

```bash
npm run typecheck
npm run lint
npm run build
npm run start -- -p 3100   # separate terminal
BASE_URL=http://127.0.0.1:3100 npm run verify:routes
```

The route audit is a smoke test of the HTTP surface, not a penetration test or an RLS test.
Database authorization is covered by `npm run test:rls:live`, which builds eleven identities — ten
real signed-in accounts plus an anonymous visitor — and attacks the policies through PostgREST and
RPC calls. It has **not run yet**: no hosted Supabase project is configured, so it reports
`BLOCKED — NOT RUN`. Setup is in `docs/RLS_NEGATIVE_TESTS.md`.

## Documentation

- `docs/MASTER_BLUEPRINT.md` — product, roles and flows
- `docs/SEARCH.md` — search ranking, filters, analytics schema, retention and limits
- `docs/IMPLEMENTATION_STATUS.md` — stage-by-stage progress ledger with evidence
- `docs/ARCHITECTURE.md` — system shape and diagrams
- `docs/FILE_STRUCTURE.md` — repository structure and migration path
- `docs/DATA_MODEL.md` — tables, RPCs and invariants
- `docs/SECURITY.md` — security baseline and known gaps
- `docs/SEO.md` — metadata, sitemap, structured data and launch checklist
- `docs/LEGAL.md` — legal documents, placeholders and review checklist
- `docs/TESTING.md` — what runs today and what must run before launch
- `docs/RLS_NEGATIVE_TESTS.md` — live RLS suite: safety model, identities, coverage and status
- `docs/REQUIREMENTS_MATRIX.md` — requirement-by-requirement status, evidence and dependencies
- `docs/PAYMENTS.md` — commission, M-Pesa, payment-method readiness and the sandbox switch
- `docs/STORAGE.md` — buckets, private documents and access policies
- `docs/EMAIL.md` — Resend, Supabase SMTP, domains and notification delivery
- `docs/PLATFORM_AUDIT.md` — evidence-based audit of features, security and payments
- `docs/FINAL_RELEASE_STATUS.md` — final release ledger with executed checks and blockers
- `docs/VERCEL_DEPLOYMENT.md` — deployment guide for `vercel-deploy/`
- `docs/SUPABASE_MIGRATION.md` — manual Supabase migration and verification guide
- `docs/GITHUB_RELEASE.md` — repository state, classification and push instructions
- `docs/FILE_CLASSIFICATION.md` — every file grouped by deployment class

## Important

Do not commit secrets. Never expose a Supabase service-role/secret key in browser code. Set `NEXT_PUBLIC_SITE_URL` before a production build so canonical URLs, the sitemap and Open Graph links are absolute; Next inlines public variables at build time. SQL
migrations are versioned files to review and run in your own Supabase project; this repository has
not connected to or modified any Supabase project. Configure the Supabase Auth Site URL and
redirect allowlist for your local and production origins, including `/auth/callback`.

No payment method is chargeable on a fresh database. Migration `0023` adds the payment-method
registry and an `allow_mock_payments` switch that defaults to **false**, so sandbox settlement
requires both `payment_mode = 'mock'` and that explicit switch. M-Pesa STK and B2C adapters exist and
fail closed without credentials; no live provider test has been performed. Card and Airtel Money
have no adapter and are blocked on a provider decision. Private document storage is defined by
migration `0024`. Search, analytics and demand reporting arrive in migration `0025`. Migrations
`0001`–`0025` are **not yet applied to any Supabase project**; follow `docs/SUPABASE_MIGRATION.md`. See
`docs/PAYMENTS.md`, `docs/STORAGE.md` and `docs/REQUIREMENTS_MATRIX.md` for the honest status of
every area.
