# Prompt 07 — Owner listing moderation

Build from the current repository; do not rebuild or connect to Supabase.

- Add /admin/listings, guarded server-side by the exact two verified owner emails and MFA assurance level 2.
- The page may list only fields needed for moderation, with bounded pagination, filters, loading/error/empty states, and responsive accessible UI.
- Allow changing listing status, active brand association and featured flag. Do not expose editing owner, price, description, or provider-application ID through the moderation screen.
- Publishing must be revalidated by the database: provider application approved and owned by listing owner, category active and matching provider activity, and optional brand active. A browser cannot bypass this trigger.
- Audit each change in a trusted database trigger with PII-minimized metadata. Never expose service role keys.
- Add a narrow RLS select policy for owners to review all listings; the admin helper must require verified email plus JWT MFA assurance level aal2.
- Add this prompt as docs/prompts/PROMPT_07_LISTING_MODERATION.md, update the owner dashboard links and security docs.
- Keep all SQL as a manually reviewed migration; do not execute it against a live project.
- Run lint, typecheck and production build via GitHub Actions and report actual results.
