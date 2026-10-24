# Prompt 01 — Repair the foundation and implement the complete authentication entry flow

You are the lead engineer working directly in the existing private GitHub repository `russhiraz1-max/shilevi`. Continue from the current codebase; do not rebuild the project from scratch and do not modify unrelated projects such as Zurify.

## Hard boundaries
- Do NOT connect to, inspect, mutate, or run SQL against any live Supabase project. The owner will connect their own Supabase project later.
- Do not ask for or invent Google OAuth client secrets, Supabase service-role keys, payment secrets, or other credentials.
- Never put server secrets in browser code, committed files, or `NEXT_PUBLIC_*` variables. Keep only the Supabase project URL and publishable/anon key in the browser environment.
- Any database work must be written as versioned SQL migration files in this repository for the owner to review and run manually later.
- Do not claim a feature is tested unless you actually run the relevant test/build. Record what was and was not tested.

## Product and stack
Shilevi is a Kenya-first marketplace for Products, Services, Transport & Delivery, and Property & Places. Use the existing Next.js App Router, TypeScript, Tailwind CSS v4, Supabase Auth/Postgres/RLS, GitHub, and Vercel approach. Keep the interface consistent: white/slate surfaces, dark navy text, Shilevi blue accents, accessible contrast, responsive layout, keyboard focus states, and clear loading/error/success states.

## Tasks for this prompt
1. Inspect the existing repository and repair missing or inconsistent app foundation files needed for a coherent Next.js App Router project, including the root layout, global styles, TypeScript path alias, Next.js config, Tailwind/PostCSS config, and the Supabase browser client helper.
2. Implement email/password sign-up and sign-in UI using Supabase Auth. Validate required fields client-side, use sensible input length limits and autocomplete attributes, show safe user-facing errors, prevent duplicate submits, and route successful sessions to the account landing page.
3. Add Google OAuth entry buttons to sign-up and sign-in using Supabase's `signInWithOAuth({ provider: "google" })`. Use the local `/auth/callback` route as the redirect URI and return to an allowlisted local path. Do not hard-code provider secrets. Clearly document that the owner must enable Google in Supabase Auth, set the Google OAuth credentials in Supabase, and allow the local and deployed callback URLs.
4. Implement a server-side App Router auth callback that exchanges the Supabase authorization code for a session, writes session cookies correctly, rejects missing/invalid codes, and prevents open redirects by only allowing safe local relative paths.
5. Implement a forgot-password page using Supabase `resetPasswordForEmail`, with a generic success response that does not disclose whether an email address has an account. Route the reset link through the auth callback and then to a reset-password page.
6. Implement a reset-password page using the authenticated recovery session and `updateUser({ password })`; require confirmation to match, enforce a reasonable minimum password length, display errors, and provide a path back to sign-in.
7. Ensure signup email confirmation redirects through the callback and then to the account page. Explain that email delivery, confirmation requirements, site URL, and redirect allowlists are configured by the owner in Supabase; do not pretend those settings have been activated.
8. Add or update `.env.example` with only safe public configuration placeholders and comments warning against committing secrets. Document local setup and the manual Supabase Auth configuration steps in repository documentation.
9. Review the existing SQL migration only for obvious compatibility with the current app; do not run it. If a SQL change is necessary, add a new ordered migration instead of silently rewriting an already published migration. Do not claim the schema is production-ready just because it parses.
10. Review every changed file for import/path consistency, TypeScript types, accessibility, route behavior, responsive styles, and obvious security issues. Avoid unsafe `next` redirect parameters, user-enumeration responses, logging credentials, and any client-side use of privileged keys.
11. Run install, lint, typecheck, build, and tests if an actual execution environment is available. If it is not, explicitly say which checks remain unrun; never invent successful test results. If using a connected Vercel preview build, verify the deployment logs and report the actual result. Do not deploy to production as part of this prompt.
12. Commit the work to the existing repository with a clear commit message. Preserve existing user work and do not overwrite files without first reading their current contents.

## Acceptance criteria
- The app has all required foundation files and consistent imports/configuration.
- Sign-up, sign-in, Google OAuth initiation, email confirmation callback, forgot-password, and reset-password flows are represented in code.
- Missing Supabase environment variables produce a clear configuration error rather than a cryptic runtime failure.
- No secrets or real credentials are committed.
- The auth callback does not permit external redirect destinations.
- Password-reset success copy does not reveal whether an account exists.
- Branding and styles are consistent across the homepage and auth screens.
- The SQL remains unexecuted against any live project.
- The final report lists committed files, checks actually performed, checks not performed, and manual owner setup still required.

## Required final report
Provide: (a) a concise implementation summary, (b) a file-by-file change list, (c) real test/build results or a clear statement that tests were not run, (d) security findings and remaining risks, and (e) exact Supabase dashboard settings the owner must configure later. Do not mark the work production-ready without end-to-end testing after the owner connects Supabase.
