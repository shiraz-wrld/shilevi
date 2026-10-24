# Architecture

Diagrams: [system-architecture.html](diagrams/system-architecture.html) (open in a browser) and [system-architecture.png](diagrams/system-architecture.png) — admin control centre, logical backend, money/settlement path, and the transaction + trust loop.

Use a modular monolith: Next.js App Router + TypeScript; Supabase PostgreSQL/Auth/Storage/RLS; Vercel deployment. Domains: identity/permissions; provider applications; categories; listings/search; quotes/orders/bookings; delivery; payments/ledger/commission/refunds/payouts; messaging/notifications; disputes/moderation; admin/configuration; analytics/audit.

Browser is untrusted and receives public keys only. Server handlers must authenticate, authorize the exact resource/action, validate inputs, rate-limit and audit sensitive operations. All exposed tables need RLS. Webhooks require signature validation and idempotency. Store money in integer minor units with explicit currency. Use transactions/constraints for inventory, bookings, assignments and ledger invariants. Do not assume escrow or payment split capabilities without provider and legal confirmation.

## Implemented shape (2026-10-20)

One Next.js deployable. Pure money and status rules in `src/lib/money.ts` and `src/lib/order-status.ts`; cart state in `src/components/cart/CartProvider.tsx`; order, delivery, commission and ledger logic enforced by `security definer` RPCs in migrations 0016–0018. Customer, provider and rider surfaces read the same order spine. Payment is sandbox-only (`payment_mode = mock`) until a licensed provider is integrated and activated by an owner.

Commission defaults to 10% (1000 bps) and is snapshotted onto each order at creation, so changing the rate never rewrites a past sale. The ledger is double-entry in integer minor units; customer funds sit in the `settlement` account until payout or refund, and the platform operating account receives commission and its delivery share only.