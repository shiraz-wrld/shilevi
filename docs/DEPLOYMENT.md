# Deployment

1. Use a supported Node.js LTS version. The project declares Node.js 24 and uses it for Vercel.
2. Install dependencies with the committed lockfile.
3. Configure the Vercel project and link it to the Shilevi repository.
4. Set the public Supabase URL and publishable key **and** `NEXT_PUBLIC_SITE_URL` (for example
   `https://shilevi.app`) before the production build. Public variables are inlined at build time;
   missing `NEXT_PUBLIC_SITE_URL` produces `http://localhost:3000` canonicals and sitemap URLs.
5. Keep server-only credentials in Vercel server-side environment variables; never commit them.
6. Review migrations 0001–0024 in order, RLS and storage policies, then apply them manually in the
   owner's Supabase project. Migrations are never auto-run by the app or CI. `0020` adds passenger
   transport, `0021` adds House Hunt, payment intents, staff capabilities and notifications, `0022`
   restricts rider balance reads, `0023` adds the payment-method registry and the fail-closed
   `allow_mock_payments` switch, and `0024` creates the storage buckets and object policies.
7. Configure the server-only integrations you are actually activating:
   - M-Pesa STK/B2C variables from `docs/PAYMENTS.md`;
   - `SUPABASE_SERVICE_ROLE_KEY` for verified callbacks and payouts;
   - Resend/Supabase SMTP from `docs/EMAIL.md`;
   - `NOTIFICATION_DISPATCH_SECRET` plus a scheduled dispatcher call.
   Leave `allow_mock_payments = false` on any deployment that takes real money. Sandbox settlement
   needs both `payment_mode = 'mock'` and that switch, so a fresh database fails closed. Enable a
   provider in `/admin/payments/providers` only after its credentials are set (`docs/PAYMENTS.md`).
8. Deploy a preview. Run `npm run verify:routes` against the preview build (CI runs it on every
   push after the production build).
9. Before promoting, run `npm run test:rls:live` against a **separate staging project** with the
   migrations applied, `SHILEVI_RLS_ALLOW_LIVE=1` and TOTP MFA enabled in Auth. It must exit 0 with
   no unexplained BLOCKED entries; exit 2 means it did not run and proves nothing. Setup and the
   coverage matrix are in `docs/RLS_NEGATIVE_TESTS.md`. Never point this suite at production: it
   creates and deletes test accounts.
10. Promote only after smoke tests, security review and an approved migration log.

## Preview smoke test

```bash
BASE_URL=https://<preview-host> npm run verify:routes
```

The audit expects a built server. It checks public routes (including `/transport` and
`/house-hunt`), legal documents, canonicals, private redirects and `X-Robots-Tag`, security
headers, the CSP report endpoint, sign-out origin checks, `robots.txt`, `sitemap.xml`, the manifest,
the custom 404 and internal links. The verified local run passed **302/302** checks. It does not
create accounts or test RLS; a missing Supabase configuration yields the app's setup states, not a
pass for database-backed flows.

## Rollback

Keep the previous deployment available. Database migrations are forward-only in this repository;
write a new migration to reverse a change rather than editing an applied file. Never drop audit
records or ledger entries to “clean up” a failed deploy.

No deployment or Supabase project is considered connected until verified.
