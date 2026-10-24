# Prompt 02 — Identity, roles, and provider application foundation

Work directly in the existing Shilevi repository. Preserve current work and do not rebuild the project.

## Non-negotiable boundaries
- Do not access, connect to, inspect, or mutate any live Supabase project. Do not run SQL remotely.
- Save all database work as ordered SQL files under `supabase/migrations/`.
- Never commit secrets or put privileged keys in client-side code.
- Do not claim builds, SQL, or security checks passed unless they were actually executed.
- Continue from Prompt 01 and fix any discovered errors before expanding scope.

## Build
1. Create an idempotent, ordered migration for Auth user profile bootstrap, safe `updated_at` triggers, role assignments, provider application integrity, initial category records, and appropriate indexes.
2. Use a tightly scoped `SECURITY DEFINER` profile trigger with an empty/fixed search path and bounded user metadata. Do not trust user metadata for roles or approvals.
3. Make role assignment server-managed. Authenticated users may read only their own assigned roles; clients must not insert, update, or delete roles or grant themselves admin permissions.
4. Implement provider activity applications for product seller, service provider, transport/delivery partner, and property/places provider. One user can apply for multiple activity types; each is independently reviewed.
5. Applicants may create a draft for themselves only. Submission, review, approval, rejection, suspension, and role grants must be handled by trusted server/admin workflows, not client-controlled status changes.
6. Enforce listing creation constraints at the database level: listing owner, provider application owner, approved activity, active category, and division/activity match must all agree. Do not rely on hidden UI controls.
7. Seed the four initial division categories as inactive. Never accidentally expose unreviewed categories for public browsing.
8. Add a responsive provider-application page with activity selection, optional public/business name, bounded introduction, session checks, loading/error/success states, and a clear notice that saving a draft is not approval.
9. Update docs describing migration order, role security, provider review, and what must still be implemented before production.
10. Check every table policy for accidental privilege escalation, RLS recursion, unsafe grants, and status tampering. Avoid using a role stored in user-editable metadata as authorization.
11. If a command execution environment is available, run dependency install, lint, typecheck, build, and SQL parse/test tooling that is actually installed. Otherwise state the limitation honestly.
12. Commit changes with a descriptive message.

## Acceptance criteria
- A profile is created automatically after Auth signup without trusting user role metadata.
- Role grants cannot be self-assigned by ordinary authenticated users.
- Draft provider applications are constrained to the current user.
- Client-side users cannot set their own application to approved.
- Listing inserts require the matching owner, approved application, active category, and correct activity/division.
- All SQL is stored locally in the repository and is not executed against any live database.
- Provider application UI uses consistent Shilevi styles and accessible controls.
- Final report includes files changed, real test results, remaining risks, and manual SQL instructions.

## Manual configuration still required later
The owner will connect the Supabase URL and publishable key through environment variables, configure Auth providers and redirect URLs, review and execute migrations in order, and verify RLS/policies in a non-production project first. Do not request credentials in chat.
