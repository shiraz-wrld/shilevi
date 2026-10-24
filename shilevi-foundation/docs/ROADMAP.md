# Build Roadmap

## Phase 1 — Foundation
- Repository, project conventions, documentation, environment examples, baseline home page.
- CI checks for lint, typecheck, build, secret scanning.
- Verify installation and baseline build.

## Phase 2 — Data model and security
- Supabase project and local migrations.
- Identity, profiles, roles/permissions, owner allowlist.
- RLS policies, private storage, audit event model.
- Security review and policy tests.

## Phase 3 — Provider activity model
- Dynamic categories and validated attributes.
- Separate applications, verification requirements and approval per activity.
- Admin review queue and audit trail.

## Phase 4 — Listings and discovery
- Products, services, property/places, availability and inventory.
- Search, filters, service areas and location privacy.
- Listing moderation.

## Phase 5 — Orders and bookings
- Quote/booking workflows, agreed total, status transitions, cancellations and disputes.
- Messaging and notifications.

## Phase 6 — Finance
- Provider payment adapter(s), ledger, commission, refunds, payouts and reconciliation.
- Sandbox, idempotency, failure recovery, legal/compliance review.

## Phase 7 — Delivery
- Rider onboarding, eligibility and service areas.
- Offer matching, atomic assignment, pickup proof, active-job tracking and handover.
- Safety, failed delivery, cancellations and disputes.

## Phase 8 — Admin and operations
- Admin dashboard modules, feature flags, integrations, support, reports, fraud and audit logs.
- Two-owner access restriction and MFA.

## Phase 9 — Launch readiness
- Legal pages and cookie controls, accessibility, responsive UI.
- E2E/security/load tests, monitoring, backup restore, incident runbooks.
- Controlled pilot and staged rollout.

Do not skip phases just to make a demo look complete. Mark each item as not started, in progress, blocked, or verified.
