# Shilevi — File Structure and Build Boundaries

This document answers one question: **what should the repository look like while the platform is being built?**

The target architecture from the blueprint is a monorepo with separate interfaces. That is the right long-term shape. It is the wrong thing to create on day one. The current repository is a working Next.js application with Supabase, 14 migrations, authentication, marketplace discovery, provider applications, listings, saved items, and enquiries. Moving all of that into seven apps and a separate NestJS API before the first real transaction works would be a rewrite, not progress.

**Rule: one deployable until a boundary is proven.** Add a second deployable only when it solves a real problem (security isolation, background processing, or a genuinely different client).

---

## 1. Immediate structure (next phase)

Keep the current Next.js app. Reorganise it into vertical feature slices and a pure domain layer. This is where customer checkout, orders, delivery, and payments will live.

```
shilevi/
├── src/
│   ├── app/
│   │   ├── (public)/              # home, search, categories, listing detail, brands
│   │   ├── (customer)/            # account, saved, requests, orders, checkout
│   │   ├── (provider)/            # apply, dashboard, listings, orders, earnings
│   │   ├── (admin)/               # gated staff control centre
│   │   ├── auth/                  # callback and session routes
│   │   └── api/                   # route handlers: payments, webhooks, maps, health
│   ├── features/
│   │   ├── catalog/               # search, filters, listing cards
│   │   ├── applications/          # provider applications and verification
│   │   ├── listings/              # create, edit, media, publication states
│   │   ├── cart/
│   │   ├── checkout/
│   │   ├── orders/                # order history, status, cancellation
│   │   ├── delivery/              # request, assignment, tracking, proof
│   │   ├── payments/              # provider adapters, status, receipts
│   │   ├── disputes/              # refunds, evidence, resolution
│   │   ├── reviews/
│   │   └── admin/                 # queues, moderation, configuration
│   ├── domain/                    # pure rules, no React, no Supabase, no HTTP
│   │   ├── commission/
│   │   ├── pricing/
│   │   ├── eligibility/
│   │   ├── orders/
│   │   ├── delivery/
│   │   └── money/
│   ├── lib/
│   │   ├── supabase/              # browser and server clients
│   │   ├── auth/                  # session and owner guards
│   │   ├── permissions/           # capabilities, not role strings
│   │   └── validation/            # shared schemas
│   └── components/                # design system and shared UI
├── supabase/
│   ├── migrations/                # numbered, reviewed, never auto-run
│   └── tests/                     # RLS and constraint tests
├── tests/
│   ├── e2e/
│   ├── integration/
│   └── fixtures/
├── docs/
├── infrastructure/
│   ├── deployment/
│   ├── monitoring/
│   └── backups/
├── .github/workflows/
├── .env.example
├── package.json
└── README.md
```

### Feature slice anatomy

Each `features/<name>/` folder owns its UI, server actions, queries, schemas, and tests. Do not create a global `services/` or `utils/` dump.

```
features/checkout/
├── components/          # checkout form, totals, address picker
├── server/              # create-order action, price validation, idempotency
├── schema.ts            # input validation
├── types.ts
├── index.ts             # public surface of the feature
└── __tests__/
```

### Domain layer

`src/domain/` contains pure functions and types:

- commission calculation and rounding;
- order, delivery, and refund state transitions;
- eligibility checks (vehicle vs job, category vs activity);
- money arithmetic in integer minor units.

No database calls, no `fetch`, no React. This is what makes the rules testable and portable if the API later moves out of Next.js.

---

## 2. Target structure (only when justified)

This is the long-term monorepo from the blueprint, adjusted.

```
shilevi/
├── apps/
│   ├── web/               # public + customer + provider routes
│   ├── admin/             # separate deploy when staff > 1 or isolation requires it
│   ├── rider/             # PWA first; native later
│   ├── api/               # only if route handlers outgrow the web app
│   └── worker/            # payments, notifications, matching, reconciliation
├── packages/
│   ├── domain/            # moved from src/domain
│   ├── permissions/
│   ├── types/
│   ├── validation/
│   ├── ui/
│   ├── api-client/
│   ├── config/
│   ├── logging/
│   └── testing/
├── database/
│   ├── migrations/
│   ├── seeds/
│   ├── policies/
│   └── tests/
├── infrastructure/
├── tests/
├── docs/
└── tooling/
```

### What changed from the proposed structure

| Proposed | Recommendation | Why |
|---|---|---|
| `apps/web` + `apps/customer` | One `apps/web` with `(customer)` routes | Customer and public share auth, layout, and search. Splitting doubles work for no user benefit. |
| `apps/provider` as a separate app | `(provider)` route group first | Separate deploy later if provider load or permissions require it. |
| `apps/admin` immediately separate | `(admin)` route group with server gates first | The current server-side owner/MFA gate is adequate at launch. Split when staff grows. |
| `apps/api` NestJS | Next.js route handlers + `packages/domain` | The domain layer is portable; a separate API is a deployment decision, not a starting requirement. |
| `apps/worker` | Add when the first payment webhook or notification queue exists | A worker with no jobs is empty ceremony. |
| `apps/rider` | PWA route first, native later | Background location and push are the only strong reasons for native. |
| Redis + S3 from day one | Supabase Postgres/Storage first; add Redis when locks/queues demand it | Do not duplicate capabilities you already pay for. |
| Dozens of empty folders | Create folders as features land | Empty structure is not architecture. |

---

## 3. Migration path

1. **Extract `src/domain/`** — commission, pricing, state machines, eligibility. Add unit tests. No schema change.
2. **Add `provider_activities`** — per-category permissions and transaction types. This is the security fix.
3. **Add order, delivery, payment, and ledger tables** — one spine, per-vertical states.
4. **Add `apps/worker`** — payment events, notifications, overdue checks, reconciliation.
5. **Split `apps/admin`** — when more than one staff member or a compliance boundary exists.
6. **Add `apps/rider`** — PWA first, native only when background location is proven necessary.
7. **Move to `packages/*`** — only when a second app needs to import the domain, permissions, or types.

Each step is reversible. None requires a big-bang rewrite.

---

## 4. Conventions

- **TypeScript strict.** No `any` in domain or server code.
- **Server-only modules** import `server-only`; no service-role key in browser code.
- **Migrations are numbered and reviewed.** Never auto-run from the app or CI.
- **Every exposed table has RLS.** Tests must include a negative case for a different user.
- **Money is integer minor units plus currency.** No floating point.
- **Mutations are idempotent** where money, orders, or assignments are involved.
- **Validation schemas are shared** between client and server; the server re-validates.
- **Feature folders are vertical slices**, not layer-only folders.
- **No business rules inside React components.** Components render; domain functions decide.
- **No secrets in the database or the browser.** Provider credentials live in environment/secret storage; the admin panel stores only configuration metadata and an enabled flag.

---

## 5. Anti-patterns to avoid

- Creating seven apps before one transaction works.
- A global `services/` folder with 40 unrelated files.
- Hiding authorization in the UI instead of enforcing it in policies and triggers.
- Putting commission math in a React component or a SQL trigger only.
- Storing payment provider secrets in an admin settings table.
- Making every business rule configurable. Configure **parameters** (rates, windows, zones, limits), not **workflows** (state machines, invariants, required checks).
- Duplicating the database with a second source of truth.
- Adding a queue, cache, or search engine before there is a measured need.
