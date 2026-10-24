# Prompt 03 — Category management, listings discovery, brand storefronts

Continue in the existing Shilevi repository. Do not rebuild the app.

## Hard boundaries
- Do not access, connect to, inspect, or mutate a live Supabase project. Never execute SQL remotely.
- Save database changes as ordered SQL migrations under supabase/migrations/.
- Never add service-role keys, payment secrets, OAuth secrets, or other credentials to Git.
- Do not fabricate partnerships, products, reviews, sales, popularity, or live activity.
- Do not claim lint/typecheck/build/security tests passed unless actually run.
- Preserve the current blue/slate Shilevi design system and make pages responsive/accessibly labeled.

## Deliverables
1. Add a reviewed migration for public brand storefront metadata, listing-to-brand linkage, featured/recent listing query indexes, publication timestamps, and owner admin email allowlist.
2. Only active brands and published listings may be public. Brand writes and feature/publish decisions must be reserved for future trusted server/admin actions. Do not grant ordinary users the ability to publish or feature content.
3. Seed exactly these two owner admin emails, normalized lowercase: russhiraz565@gmail.com and russhiraz1@gmail.com. Store allowlist server-side only; no anon/authenticated select policy. Future server code must compare the verified Auth user's normalized email and fail closed. Never authorize based on client input, user metadata, or a browser-side email check alone. Require verified email and MFA/re-authentication for sensitive admin actions when available.
4. Build the homepage as a credible marketplace discovery experience: Products, Services, Transport & Delivery, Property & Places; active categories; newest published listings; featured listings; active featured brands; clear empty states while the database is empty. Do not show fake “trending”, “most purchased”, ratings, brand partnerships, or sale counts. Only label something “popular” or “best-selling” after a trustworthy event/order aggregation exists.
5. Brand cards must link to a brand storefront showing that brand's active published listings, with a safe empty state. Support slug-based routing and handle missing/inactive brands without leaking data.
6. Add listing discovery pages for divisions/categories with safe query parameter parsing, bounded page sizes, and explicit allowlisted filters. Use Supabase query builder or parameterized SQL, never string-concatenate user input into SQL. Validate slugs and IDs; render user content as text, never raw HTML.
7. Include accessible loading/error/empty states and mobile layouts. Avoid remote image URL injection; only render validated HTTPS URLs or trusted storage paths, and include alt text.
8. Update architecture/data-model/security docs and save this entire prompt at docs/prompts/PROMPT_03_CATEGORIES_LISTINGS_BRANDS.md.
9. Add tests for slug/query validation and security-sensitive visibility logic where the repository test setup supports them. If no test runner exists, add a lightweight test setup only if it does not destabilize the build.
10. Before committing, inspect migrations 0001/0002 for actual schema compatibility. Keep all migrations ordered, repeat-safe where practical, and documented for manual owner review.
11. Run npm install, lint, typecheck, build, and tests only if an execution environment is actually available. Report the real result and limitations.

## Acceptance criteria
- Brand records can be created by a trusted future admin workflow and public visitors see only active brands.
- A brand page lists only its published listings.
- Homepage shows real data or honest empty states; no invented metrics or partnerships.
- Public content cannot be published/featured by an ordinary account.
- The two owner emails are stored in a server-only allowlist and no other email is implicitly admin.
- All SQL remains committed as files and is not run against Supabase.
