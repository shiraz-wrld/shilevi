# Shilevi — Proposed Architecture

## Approach
Use a modular monolith first, with clear domain boundaries. Avoid premature microservices. Use Next.js App Router for the web application, Supabase PostgreSQL/Auth/Storage for backend primitives, and Vercel for deployment. Background jobs or external services can be added when measured requirements justify them.

## Domain modules
- Identity and account lifecycle
- Authorization and owner allowlist
- Provider applications and verification
- Categories and dynamic attributes
- Listings, inventory, availability, search
- Quotes, orders, bookings
- Delivery matching, assignment, tracking, proof of handover
- Payments, ledger, commission, refunds, payouts, reconciliation
- Messaging and notifications
- Reviews, disputes, reports, moderation
- Admin settings, integrations, feature flags
- Analytics, audit, security events

## Trust boundaries
- Browser: public/publishable keys only; assume all input can be manipulated.
- Server routes/actions: authenticate the actor, authorize the specific operation and resource, validate input, rate-limit, and write audit events for sensitive actions.
- Database: Row Level Security on every exposed table; policies use ownership and role/permission checks, not merely authenticated status.
- Provider webhooks: verify signatures, enforce idempotency, and store provider event IDs before applying financial changes.
- Secrets: server-side environment/secret store only. Never send private credentials to client code or return them in admin API responses.
- Integrations: adapter interface per provider, explicit enabled/disabled/needs-credentials/unavailable status, health check, timeout/retry policy, and structured logs with secrets/PII redacted.

## Data design principles
- Use UUID identifiers, UTC timestamps, explicit currency and amount fields, and integer minor units for money.
- Use append-only ledger entries for financial events; do not calculate balances from untrusted browser values.
- Store category definitions as validated schemas with an allowlist of field types, bounds, and allowed filters.
- Model provider activity approvals independently.
- Record status transitions and who/what caused them.
- Use private storage buckets for identity documents and sensitive delivery evidence; signed URLs should be short-lived and authorization checked.

## Delivery and payments
- Atomic assignment prevents two riders being assigned the same delivery.
- Track delivery status transitions as events; location collection is limited to active jobs and authorized viewers.
- A rating is never a prerequisite for transaction completion.
- Confirm the payment provider's marketplace/connected-account/settlement capabilities and legal requirements before designing any hold-and-release flow. Do not claim escrow unless legally and contractually supported.

## Reliability
- Use database constraints and transactions for inventory, booking slots, delivery assignment, ledger and payout invariants.
- Idempotency keys for payment/order mutations and webhooks.
- Retry transient provider errors with bounded backoff; send exhausted jobs to an inspectable dead-letter/recovery path.
- Backups, monitoring, alerting, reconciliation, and recovery runbooks are launch requirements.
