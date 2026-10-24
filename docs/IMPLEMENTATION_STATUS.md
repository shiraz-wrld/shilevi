# Implementation status — durable progress ledger

**Updated:** 2026-10-24 — release pass (repository organisation, Vercel packaging, Supabase migration
bundle, security audit).
**Whole-product detail:** `docs/REQUIREMENTS_MATRIX.md`. This file records the current stage so work
can resume safely after an interruption, and so nothing is claimed beyond the evidence.
**Latest release ledger:** `docs/FINAL_RELEASE_STATUS.md` — every command, exit code and blocker for
the current state. Read that first; this file keeps the earlier stage history.

The search/analytics stage below remains accurate: `npm run test:search` still passes 33 checks
against migration 0025. No SQL changed in the 2026-10-24 release pass.

Score labels:

- **IMPLEMENTED AND VERIFIED** — code exists and the named local check actually passed.
- **IMPLEMENTED, LIVE VERIFICATION REQUIRED** — code exists; needs hosted credentials or infrastructure.
- **PARTIALLY IMPLEMENTED** — some of the requirement is genuinely missing.
- **NOT IMPLEMENTED** — nothing exists.
- **BLOCKED** — cannot proceed without an external decision, account or approval.
- **NOT TESTED** — evidence is insufficient, or the check has never run.

Nothing in this file is inferred from a page rendering. Local database tests run real PostgreSQL
(PGlite); they do not prove hosted Supabase, network, storage or provider behaviour.

---

## Stage: real discovery, search and intelligent matching

| # | Requirement | Status | Evidence | Remaining |
|---|---|---|---|---|
| S1 | Database-backed search over published listings, active categories only | IMPLEMENTED AND VERIFIED | `0025`; `tests/search/search.test.mjs` — drafts, paused, inactive-category listings excluded | — |
| S2 | Full-text matching on title **and** description | IMPLEMENTED AND VERIFIED | `search_vector` generated column + GIN; test “description text is searchable” | — |
| S3 | Relevance ranking, plus newest / price / title sorts | IMPLEMENTED AND VERIFIED | `ts_rank_cd`, featured tiebreak, stable `id` last; sort tests | No fuzzy/semantic matching (documented, not claimed) |
| S4 | Taxonomy-aware category filter (parent includes children) | IMPLEMENTED AND VERIFIED | Recursive `category_scope` CTE; test “a parent category includes its children” | — |
| S5 | Division, county and price filters, combinable | IMPLEMENTED AND VERIFIED | `division`, `county` (property county or listing attribute), `price_minor`/`rent_minor` | County is the finest location the schema stores |
| S6 | Stable pagination with an exact total | IMPLEMENTED AND VERIFIED | `total`, `pages`, disjoint-page test; size clamped 1–48 | — |
| S7 | Input validation and clamping on both layers | IMPLEMENTED AND VERIFIED | Route allowlists + RPC exceptions; oversized query/page tests | — |
| S8 | Injection and wildcard abuse resistance | IMPLEMENTED AND VERIFIED | Parameterised calls; LIKE escaping; `%` and `'; drop table…` return zero rows and change nothing | — |
| S9 | House Hunt private contact never exposed by search | IMPLEMENTED AND VERIFIED | `property_contacts` not joined; payload whitelist; test asserts address, phone and contact name absent | Live RLS suite still unrun (see `docs/RLS_NEGATIVE_TESTS.md`) |
| S10 | Real search UI: filters, pagination, empty/loading/error states, keyboard access | IMPLEMENTED AND VERIFIED (local) | `src/app/search/page.tsx` on `/api/search`; route audit passes `/search` | No assisted browser session against a hosted project |
| S11 | Analytics events recorded server-side, not client-trusted | IMPLEMENTED AND VERIFIED | `record_search_event` granted to `service_role` only; `result_count`/`shown_listing_ids` from the RPC answer | — |
| S12 | Privacy-minimal analytics schema | IMPLEMENTED AND VERIFIED | No IP/UA/session/referrer columns; query capped 120; shown ids capped 24 | Retention job not scheduled yet |
| S13 | Click engagement for published listings only | IMPLEMENTED AND VERIFIED | `/api/search/event` (same-origin, rate-limited); RPC refuses non-published listing | — |
| S14 | Owner demand intelligence from real events | IMPLEMENTED AND VERIFIED (RPC) | `admin_search_insights`; non-owner refusal, empty-window `has_data=false` tests; `/admin/insights` page | Page not exercised against a hosted project |
| S15 | Retention is explicit and scheduled | PARTIALLY IMPLEMENTED | `prune_search_events` (service role only, 180-day default) tested | No cron/schedule configured |
| S16 | “Intelligent matching” beyond deterministic signals | NOT IMPLEMENTED | — | Requires a real signal source: permitted interaction history, recommendations, or an LLM/vector provider with credentials. Not labelled as AI today. |

### Files changed in this stage

- `supabase/migrations/0025_marketplace_search_and_demand_intelligence.sql` (new)
- `tests/search/search.test.mjs` (new), `package.json` (`test:search`)
- `src/app/api/search/route.ts` (new), `src/app/api/search/event/route.ts` (new)
- `src/app/search/page.tsx` (rewritten on the API)
- `src/app/admin/insights/page.tsx` (new), `src/components/admin/AdminShell.tsx` (nav entry)
- `docs/SEARCH.md` (new), `docs/IMPLEMENTATION_STATUS.md` (this file),
  `docs/REQUIREMENTS_MATRIX.md`, `docs/TESTING.md`, `README.md`

### Preserved from earlier stages

`0022` rider-balance authorization, `0023` double-gated sandbox and payment-method readiness,
`0024` storage buckets and policies, the live-RLS harness and its fail-closed behaviour. No
permission was relaxed, no test disabled, no financial arithmetic changed, and the sandbox stays off
by default.

---

## Verification for this stage

| Command | Result |
|---|---|
| `npm run test:search` | PASS — 33 checks |
| `npm run test:db` | PASS — migrations 0015–0024 |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS — 0 errors |
| `npm run build` | PASS |
| `BASE_URL=… npm run verify:routes` | PASS — 311/311 |
| `node tests/rls/selftest.mjs` | PASS |
| `npm run test:rls:live` | BLOCKED — exit 2, no hosted project |

Exact command output for the current run is recorded in the stage report; re-run the commands rather
than trusting this table after further edits.

---

## Where to resume

1. **Recommended next stage:** verify this stage against a hosted staging project (search, analytics
   writes, owner reporting, live RLS), then schedule `prune_search_events`.
2. **Then:** provider onboarding and workspace completion, which is the largest remaining gap.
3. **Blocked, needs an owner decision:** card gateway, Airtel Money merchant account, commission rate
   (10% vs 20%), settlement/custody model.
4. **Do not** start the visual redesign, card payments or Airtel integration inside a search stage.
