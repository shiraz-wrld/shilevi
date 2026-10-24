# Prompt 06 — Database-enforced admin policies and category/brand operations

Continue in the existing Shilevi repository. Do not rebuild. Do not connect to Supabase or execute SQL.

## Security model
- Only authenticated, email-verified Auth identities matching the two rows in public.owner_admin_allowlist may administer Shilevi: russhiraz565@gmail.com and russhiraz1@gmail.com.
- Use a no-argument SECURITY DEFINER helper with an empty search_path, explicit schema-qualified names, no user-controlled dynamic SQL, and execute granted only to authenticated. The helper must check auth.uid(), auth.users.email_confirmed_at, and the allowlist table.
- RLS is the authoritative database boundary. UI checks are only UX and never replace RLS.
- Category and brand writes are owner-only. Listings allow owners to moderate status, is_featured, and brand_id only; do not grant content/owner/price updates as part of moderation. Provider review fields are owner-only.
- Do not create client-accessible audit writes or enable payment/role/secret management in this prompt.
- Save migration in supabase/migrations/0005_admin_database_policies.sql for manual owner review.

## UI
- Add protected /admin/categories and /admin/brands screens.
- Categories: list active/inactive rows, create/edit name, slug, division, description, active state and sort order; validate lengths/slug/division before submit; confirm destructive actions and prevent deletion when referenced.
- Brands: create/edit name, slug, description, logo URL, website URL, active/featured status, sort order; HTTPS URLs only; make clear that creating a brand record does not prove a partnership. Never seed fake brands.
- UI must handle loading, empty, validation, database error, and success states, with accessible labels and responsive Shilevi styling.
- Use Supabase query builder APIs, never raw SQL concatenation or dangerouslySetInnerHTML.
- The server-side /admin gate stays in place. Database policies are the final write boundary. If RLS rejects a request, fail closed.
- Update security/data model docs and save this full prompt as docs/prompts/PROMPT_06_ADMIN_CATEGORIES_BRANDS.md.
- Run lint, typecheck and production build in GitHub Actions; repair actual failures before reporting status.
