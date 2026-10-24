# Prompt 04 — Customer onboarding and activity-specific provider profiles

Continue from the current repository and previous prompts; do not rebuild.

## Non-negotiable safety
- Do not connect to or mutate any live Supabase project. SQL remains ordered files in supabase/migrations and is for owner-run manual review.
- Never commit credentials, secret keys, identity documents, or real personal data.
- The only intended owner admin emails remain russhiraz565@gmail.com and russhiraz1@gmail.com. This does not grant admin rights until server-side guards are implemented and tested.
- Do not collect precise GPS location at registration. Ask for county/town/service area only when relevant. Live GPS must be opt-in and used only for an active delivery with clear disclosure.
- Do not mark a provider, rider, identity, or driver's license as verified based on a client checkbox or user metadata.

## Build
1. Create migration 0004 for customer onboarding and transport-provider details, including owner-only RLS, field constraints, grants restricted by column, and server-managed verification/review fields.
2. Add a post-auth onboarding page that asks for full name, phone (optional until a feature needs it), country, county and town (optional), and whether the user intends to shop/book as a customer or apply as a provider. Existing account creation remains customer-first; provider activity approvals remain separate.
3. Use clear labels, validation, loading/error/success states, keyboard access, mobile layouts, and privacy explanations. Do not ask customers for unnecessary personal information.
4. Build a transport-provider profile step only for users with a draft transport_partner provider application. Ask vehicle type, service counties/towns, and vehicle registration only when applicable. Keep license/ID document upload for a separately designed private Storage and verification workflow.
5. Never ask riders to share live GPS as a signup requirement. Do not expose exact rider/customer addresses in public listings. Service area is not the same as live location.
6. Do not let the browser set approval, license verification, reviewer notes, roles, or completed verification states. Use server-owned transitions for review. If client-write policies cannot enforce a field invariant safely, restrict the write and defer to a server action.
7. Ensure forms use typed/validated values and safe Supabase query builders. Avoid raw SQL string interpolation, unbounded arrays, unbounded text, raw HTML, and URL trust.
8. Save this entire prompt as docs/prompts/PROMPT_04_CUSTOMER_PROVIDER_ONBOARDING.md and update data model/security/roadmap docs.
9. Add tests for form validation and RLS-sensitive state assumptions if the configured test setup supports them.
10. Run lint, typecheck, build and tests only if an execution environment is available. Report real outcomes. Never say end-to-end testing passed without actually running it.

## Acceptance criteria
- Customer signup remains simple and does not require rider-only information.
- A transport partner can provide service area and vehicle type without sharing live GPS at signup.
- Draft profile data belongs to the authenticated user and is linked to their own draft transport application.
- Client users cannot mark a license or provider as verified/approved.
- No precise address or live location leaks through public marketplace discovery.
