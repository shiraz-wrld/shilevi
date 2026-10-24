# GitHub release report

**Intended repository:** <https://github.com/shiraz-wrld/shilevi>
**State observed in this workspace:** there was **no Git repository** in `shilevi-main/` before this
release pass. A local repository was created and a checkpoint committed; nothing was pushed.

## What was actually done

| Action | Result |
|---|---|
| `git status` at the start | `fatal: not a git repository` — no history, no recovery point existed |
| `git init` in the project root | Local repository created (`shiraz-wrld/shilevi` is configured as the intended remote, not yet added) |
| Checkpoint commit | `Checkpoint: pre-release state through search and analytics stage` (256 files) |
| Remote reachability | `git ls-remote https://github.com/shiraz-wrld/shilevi` returned **no refs** — the repository exists but appears **empty** |
| GitHub CLI | `gh` is **not installed** in this environment |
| Authentication | No GitHub credential, token or SSH key is available to this session |
| Push | **Not performed.** Pushing needs your credentials, and it must not happen before the audit below |

No existing remote content was overwritten, because none was fetched, cloned or pushed. The
repository has no branches, so no history was rewritten and no force-push is possible from here.

## What the repository must contain

The repository is designed to hold the application **and** the backend/verification assets, because
the Supabase SQL and the test harness are part of the product's audit trail:

| Path | Classification | Ships to Vercel |
|---|---|---|
| `src/`, `package.json`, `package-lock.json`, `next.config.ts`, `tsconfig.json`, `postcss.config.mjs`, `eslint.config.mjs`, `next-env.d.ts` | A — application | yes, via `vercel-deploy/` |
| `vercel-deploy/` | A — generated deployment copy (Root Directory) | yes (it *is* the deployment) |
| `supabase/migrations/`, `supabase/verify_schema.sql` | B — backend assets | no |
| `supabase-manual-migration/` | B — generated manual bundle | no |
| `tests/`, `scripts/`, `tsconfig.domain.json` | C — verification | no |
| `docs/`, `.github/workflows/` | C — documentation and CI | no |
| `.env.example` | A — template, placeholders only | yes |
| `.env`, `.env.local`, `.env.*` (except `.env.example`) | D — secrets | never committed (ignored) |
| `node_modules/`, `.next/`, `.domain-build/`, `reports/`, `*.log` | E — generated | never committed (ignored) |
| `archive/shilevi-foundation-2026-10-20/` | E — superseded scaffold, kept for history | no |

There is no `.env` file in this workspace, and no credential appears in any tracked file — see the
secret scan in [FINAL_RELEASE_STATUS.md](FINAL_RELEASE_STATUS.md).

## Exact steps for you to publish

Run from the project root (`shilevi-main/`). The local commits already exist.

```bash
# 1. Verify what would be published (no secrets, no build output, no node_modules)
git status --short
git ls-files | grep -E '(^|/)\.env($|\.)' | grep -v '\.env\.example$' || echo "no env files tracked"
npm run secrets:scan

# 2. Confirm the bundles match the source
npm run release:verify

# 3. Add the remote (the repository already exists and is empty)
git remote add origin https://github.com/shiraz-wrld/shilevi.git
git remote -v

# 4. Push the default branch
git branch -M main
git push -u origin main
```

If `git push` asks for a password, GitHub requires a **personal access token** (classic with `repo`
scope, or fine-grained with *Contents: read and write*) — not your account password. An SSH remote
(`git@github.com:shiraz-wrld/shilevi.git`) works if your key is loaded.

Because the remote is empty, this is a fast-forward initial push: no `--force` is needed and none
should be used. If GitHub reports that the branch already exists when you retry, fetch and inspect
before doing anything else:

```bash
git fetch origin
git log --oneline origin/main | head   # inspect before merging
```

## After the push

1. In Vercel, import `shiraz-wrld/shilevi` and set **Root Directory** to `vercel-deploy`
   ([VERCEL_DEPLOYMENT.md](VERCEL_DEPLOYMENT.md)).
2. Add the environment variables for Production and Preview before the first build.
3. Apply the migrations manually ([SUPABASE_MIGRATION.md](SUPABASE_MIGRATION.md)); CI never applies
   them.
4. Keep `main` protected once the first deploy is verified: require the **Verify Shilevi** workflow
   and at least one review before merging.

## Rules this repository enforces

- `npm run secrets:scan` fails on committed key material, committed env files and JWTs.
- `npm run release:verify` fails if `vercel-deploy/` or `supabase-manual-migration/` drifts from the
  source of truth, so a reviewer can trust the manifest hashes.
- CI (`.github/workflows/verify.yml`) runs lint, typecheck, the auth redirect suite, database and
  search tests, the RLS harness self-test, the production build, the HTTP route audit, the secret
  scan and the bundle checks. It never applies SQL to any project.
