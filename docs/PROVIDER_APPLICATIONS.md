# Provider applications

Shilevi allows a single account to apply for multiple activities independently: product seller, service provider, transport/delivery partner, and property/places provider.

## Lifecycle
- `draft`: applicant-owned draft; not publicly visible and not permission to publish.
- `pending` / `under_review`: submitted applications awaiting owner review. Migration 0006 allows only the applicant-owned `draft -> pending` transition; submitted applications are read-only to applicants.
- `approved`: set only by authorized server/admin operations after verification.
- `rejected`, `suspended`, `withdrawn`: controlled transitions requiring auditability and clear user messaging.

The application page supports saving drafts and submitting them for review. Migration 0006 uses narrow column grants, an applicant-owned RLS policy, and a database transition guard to keep review fields server/admin-owned. An MFA-gated owner review queue now supports approve/reject actions. Manual migration review and staging validation remain outstanding; the UI is not proof that the database policies are installed.

## Security requirements
- The authenticated user ID must be derived from the verified session on the server for any trusted submission action; never trust a client-supplied user ID.
- RLS must scope draft inserts and reads to the owner.
- Role assignment must be server-managed; user metadata is not an authorization source.
- Listings require an approved application matching both owner and category division.
- Collect only information needed at the current stage. Never put passwords, national ID numbers, bank details, or provider secrets into the free-text introduction.
- Provider approval does not imply payment-provider, identity-verification, licensing, or regulatory checks have been completed.
