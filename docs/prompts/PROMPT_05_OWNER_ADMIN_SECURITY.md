# Prompt 05 — Server-side owner admin gate and operational console

Continue the existing Shilevi implementation. Do not rebuild and do not connect to Supabase.

## Required owner authorization
Only these two exact, normalized, email-verified Auth identities may enter the owner control center:
- russhiraz565@gmail.com
- russhiraz1@gmail.com

## Requirements
- Add a server-only Supabase SSR client helper using @supabase/ssr and Next.js cookies.
- Add a server-only requireOwnerAdmin guard. Use supabase.auth.getUser() to verify the signed-in identity, normalize the email, require email_confirmed_at, and fail closed. Do not trust user metadata, request parameters, client state, or a role value supplied by a browser.
- Keep the admin gate out of client bundles. Use a server-rendered admin page that shows denied/configuration states without leaking internal data.
- Add /admin as a protected route. No management mutations in this prompt. Every future admin mutation must use a server action/route handler with authorization checked again inside that action, validation, audit event, and CSRF/origin protections where applicable.
- Keep database allowlist migration as an owner-reviewed SQL layer; do not expose it to anon/authenticated roles. Document that the server gate is the current enforcement layer and database row is not currently queried from the browser.
- Do not put Supabase service role keys in the browser or use one for ordinary reads.
- Add owner/admin security docs and this complete prompt file at docs/prompts/PROMPT_05_OWNER_ADMIN_SECURITY.md.
- Do not claim MFA is configured unless verified; explicitly leave MFA, re-authentication, audit-backed mutation, and authorization tests as requirements before write actions are enabled.
- Run lint, typecheck, build and tests using GitHub Actions and repair actual failures before declaring a green build.
