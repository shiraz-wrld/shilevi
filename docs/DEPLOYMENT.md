# Deployment (summary)

The complete, maintained instructions live in:

- [VERCEL_DEPLOYMENT.md](VERCEL_DEPLOYMENT.md) — Root Directory `vercel-deploy`, build settings,
  every environment variable, post-deploy checks, logs, rollback and unavailable features.
- [SUPABASE_MIGRATION.md](SUPABASE_MIGRATION.md) — manual migration, Auth/storage setup, owner
  allowlist, schema verification and staging tests.
- [GITHUB_RELEASE.md](GITHUB_RELEASE.md) — repository state and exact push steps.
- [FINAL_RELEASE_STATUS.md](FINAL_RELEASE_STATUS.md) — what is verified, partial or blocked.

## The short version

1. **Node.js** 24.x (project minimum 20.9). Install with `npm ci` from the committed lockfile.
2. **Vercel Root Directory** is `vercel-deploy/`. It is generated: edit the repository root, then
   `npm run release:sync` and commit. `npm run release:verify` fails on drift.
3. **Environment:** public Supabase URL, publishable key and `NEXT_PUBLIC_SITE_URL` before the first
   build (public variables are inlined at build time). Server secrets (service role, M-Pesa, Resend,
   dispatch secret) belong in Vercel server-side settings only.
4. **Database:** review and apply migrations `0001`–`0025` in order in your own Supabase project,
   then run `supabase-manual-migration/verify_schema.sql`. Migrations are never applied by the app,
   by CI or by the deployment.
5. **Auth:** Supabase Site URL and the `/auth/callback` redirect for every origin you use (local,
   preview, production). Enable TOTP MFA — owner administration requires aal2.
6. **Preview smoke test** against a built server:

   ```bash
   npm run build
   npm run start -- -p 3100
   BASE_URL=http://127.0.0.1:3100 npm run verify:routes
   ```

   The audit checks routes, canonicals, security headers, legal pages, private redirects,
   `robots.txt`, the sitemap, the manifest, the custom 404 and internal links. It does not create
   accounts and does not test RLS.
7. **Before promoting:** run the live RLS suite against a **separate staging project** with the
   migrations applied, `SHILEVI_RLS_ALLOW_LIVE=1` and TOTP enabled. It must exit 0 with no
   unexplained BLOCKED entries; exit 2 means it did not run and proves nothing. Never point it at
   production — it creates and deletes test accounts.

## Rollback

Keep the previous deployment available. Database migrations are forward-only: write a new migration
to reverse a change rather than editing an applied file. Never drop audit records or ledger entries
to “clean up” a failed deploy.

No deployment or Supabase project is considered connected until it is verified on its real origin.
