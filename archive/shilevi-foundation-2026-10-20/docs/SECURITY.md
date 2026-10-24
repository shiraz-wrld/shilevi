# Security Baseline

## Non-negotiable controls
- HTTPS in production and secure cookie/session defaults.
- Supabase Row Level Security on all exposed tables and private Storage policies.
- Server-side authorization for every sensitive operation; no trust in hidden buttons, route obscurity, user-editable metadata, or client-supplied roles.
- Two-owner-email allowlist checked on the server and in database policies/RPCs as applicable. Owner emails must be supplied and verified before owner access is enabled.
- Strong authentication and MFA for privileged accounts; step-up authentication for sensitive changes.
- Least-privilege staff roles and auditable permission changes.
- Schema validation, parameterized SQL, output encoding, CSRF protections where applicable, secure redirects, upload type/size scanning, rate limiting, abuse detection.
- Never expose Supabase service-role/secret keys or payment/webhook secrets in browser bundles, logs, Git history, screenshots, or API responses.
- Verify webhook signatures and use idempotency keys for financial operations.
- Append-only financial/audit records with reconciliation.
- Redact PII and credentials from logs; retention and deletion rules documented.
- Dependency and secret scanning; lockfile committed.
- Backups, restore test, incident response process, and monitoring before production launch.

## Test cases required
- Anonymous user cannot read private profiles, identity documents, orders, messages, or precise delivery locations.
- User cannot change own role, approval state, owner allowlist, payment status, commission, or another user's resource.
- Provider cannot publish in an activity that has not been approved.
- Staff cannot perform owner-only operations.
- Two owner emails are the only permitted owners; all other accounts are denied by server-side checks.
- Replayed webhooks do not double-charge, double-credit, or duplicate payout.
- Concurrent rider acceptance results in one assignment only.
- User location is not exposed to unassigned riders; live tracking stops after job completion.
- No cross-account access through manipulated IDs (BOLA/IDOR tests).

## Launch gate
No production launch until critical/high findings are fixed, advisors and security tests reviewed, payment flows reconciled in sandbox and test environment, and access controls independently verified.
