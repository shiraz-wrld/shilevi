# Security Baseline

## Identity and admin
- HTTPS, secure session/cookie defaults, verified email, strong Auth settings and MFA for owners.
- The only intended owner admin emails are `russhiraz565@gmail.com` and `russhiraz1@gmail.com`. Migration 0003 stores them in a table with no anon/authenticated grants. Server-side guards validate the authenticated user via Supabase Auth, normalize the verified email, check allowlist membership on the server, and fail closed. Never authorize with a client-side email check, URL parameter, user metadata, or user-editable role.
- `/admin`, `/admin/categories`, `/admin/brands`, `/admin/audit-log` and `/admin/orders` have server-rendered gates that verify the Auth user, normalize the email, require a verified email, and allow only the two owner addresses.
- Category and brand writes are enforced by RLS in migration 0005; database write authorization also requires Auth MFA assurance level `aal2`. No service-role key is used in the browser.
- Listing moderation uses the same owner/MFA gate with narrow column grants and a publication validation trigger. Provider-application review uses the same gate with guarded transitions (migration 0006).
- Migration 0019 adds owner-only SELECT policies for `audit_events`, `orders` and `order_items`. Audit rows stay append-only (no client insert/update/delete grant). The admin pages select bounded columns and never display addresses, notes or contact details.
- MFA is enforced for category, brand, listing, provider, audit and order-database reads. Owner enrollment must still be completed in Auth; `/admin/security` documents it.

## Response hardening
- Every response carries HSTS, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, a restrictive `Permissions-Policy`, `Cross-Origin-Opener-Policy` and `X-DNS-Prefetch-Control: off` (see `src/lib/security/headers.ts` and `next.config.ts`).
- A report-only Content-Security-Policy is shipped with `report-uri /api/security/csp-report`. Reports are rate-limited, size-limited, reduced to four bounded fields and logged with query strings stripped. Nothing is persisted.
- Private areas (`/account`, `/admin`, `/provider`, `/rider`, `/checkout`, `/cart`, `/onboarding`) are `noindex` in metadata, disallowed in `robots.txt` **and** sent `X-Robots-Tag: noindex, nofollow, noarchive` as response headers. API responses are `no-store` and `noindex`.
- `next.config.ts` disables the `X-Powered-By` header and the app never renders raw user HTML.

## Onboarding privacy
- Collect only what a feature needs. Customer phone and county/town remain optional at the initial onboarding step.
- Never request live GPS as a signup condition. Service area is a broad county/town selection, not a precise location.
- Transport verification/review state is server-owned. Identity and licence documents belong in private Storage with owner/reviewer policies, signed access and retention rules; they must not go in public buckets.
- Never expose exact addresses or continuous rider location through public listing queries.

## Database owner authorization
- Migration 0005 defines `public.is_shilevi_owner_admin()` as a no-argument SECURITY DEFINER helper with an empty search path. It checks `auth.uid()`, a verified Auth email, the private allowlist and MFA assurance level `aal2`. It has execute permission only for authenticated users.
- RLS is authoritative: browser-side email checks are never sufficient. Category/brand writes and narrow listing/provider moderation grants are limited to verified owners with MFA. A database trigger rejects publishing unless the provider application is approved, belongs to the listing owner, matches an active category division, and any linked brand is active.
- Migration 0005 adds trusted database triggers that write an allowlisted, PII-minimized audit record for category/brand changes and listing/provider review transitions. Migration 0019 exposes those rows to the owner read-only.
- Keep payment secrets and role assignment out of client-side admin operations.

## Marketplace data and inputs
- Active categories and brands only are public; public listings must be published and must not be tied to an inactive brand.
- Ordinary clients cannot publish or feature listings, approve providers, change application status, edit role grants, or manage brand/category records.
- Use Supabase query builders or parameterized SQL, validated enums/slugs/UUIDs, bounded pagination, input length limits and server-side authorization. Never concatenate user input into SQL or render user text as raw HTML.
- Validate external URLs and uploaded files, constrain MIME/type/size, redact PII, rate-limit sensitive endpoints and protect against CSRF where relevant. Cookie-authenticated mutations check `Origin`/`Referer` (`src/lib/security/origin.ts`); sign-out is POST-only.
- Keep rider precise location private; expose only approximate pickup information to eligible riders before assignment, and precise details only to the assigned rider when operationally necessary.

## Payments and operations
- Verify webhook signatures, enforce idempotency, reconcile provider events and prevent double assignment/double spending with transactions and constraints.
- Store money as integer minor units with explicit currency. Do not assume escrow, split payments or holding funds is legally/provider-permitted without verification.
- Test cross-account access, privilege escalation, SQL injection, XSS, CSRF, duplicate webhooks, concurrent rider assignment, private documents and location leakage.
- Production launch is blocked until critical/high findings are fixed, backups/recovery are tested and migrations 0001–0019 are reviewed and applied. Never claim security is “tight” until independent testing and configuration review have happened.

## Verification
- `npm run verify:routes` runs `scripts/route-audit.mjs` against a built server. It checks status codes, canonical paths, robots directives, security headers, legal coverage, private-area redirects and headers, CSP report handling, sign-out origin enforcement, sitemap/robots/manifest, the custom 404 and internal links. It is a smoke test, not a penetration test or an RLS test.
- Database authorization still requires negative tests per policy on a staging Supabase project. No RLS test has been run against a live database in this repository.
