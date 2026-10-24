# Prompt 08 — Secure provider application submission and owner review

Continue in the existing Shilevi repository. Do not rebuild, access a live Supabase project, execute SQL, or add real secrets.

## Goal
Turn the current draft-only provider application into a complete, auditable submission and owner review workflow for product sellers, service providers, transport/delivery partners, and property/places providers.

## Applicant workflow
- Applicants can create and read only their own applications.
- Allow an applicant to submit their own draft application. The only client-controlled transition is `draft -> pending`; submitted applications are immutable to the applicant.
- Derive the authenticated user ID from the Supabase session. Never trust a client-supplied user ID for authorization.
- Show application reference, activity, submitted date, status, and clear guidance for rejected or approved applications.
- Prevent duplicate submissions for the same user/activity and handle unique constraint errors clearly.
- Never allow the applicant to set reviewer, review timestamp, reviewer note, or approved/rejected status.
- Validate and bound all input; do not ask for national ID numbers, bank credentials, or secrets in free-text fields.

## Owner review
- Add an owner-only /admin/applications page protected by the exact two verified owner emails.
- Require MFA assurance level `aal2` for review actions, and enforce the same rule in database RLS/policies.
- Show bounded/paginated application data and only the fields needed for review.
- Allow approve/reject with a bounded reviewer note. Reviewers must not approve an application belonging to themselves.
- Ensure only `pending -> approved|rejected` review transitions are allowed, review metadata is server-owned, and every transition is written to trusted audit logs.
- Do not use a service-role key in the browser. If secure server-side admin actions cannot be implemented safely with the current stack, document the limitation and leave the action disabled rather than weakening RLS.

## Database and delivery
- Add a new migration after 0005. Include narrow grants, explicit RLS policies, database transition guards, and PII-minimized audit triggers.
- Keep all SQL as reviewed repository files; never execute it against Supabase.
- Update provider lifecycle/security docs and add this prompt as `docs/prompts/PROMPT_08_PROVIDER_APPLICATION_SUBMISSION_REVIEW.md`.
- Run GitHub Actions lint, typecheck and production build; fix failures before reporting completion.
- Do not claim live database or end-to-end validation without actually running it in an authorized environment.
