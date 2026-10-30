# Implementation status — durable progress ledger

**Updated:** 2026-10-24 — release pass (repository organisation, Vercel packaging, Supabase migration
bundle, security audit).
**Whole-product detail:** `docs/REQUIREMENTS_MATRIX.md`. This file records the current stage so work
can resume safely after an interruption, and so nothing is claimed beyond the evidence.
**Latest release ledger:** `docs/FINAL_RELEASE_STATUS.md` — every command, exit code and blocker for
the current state. Read that first; this file keeps the earlier stage history.

The search/analytics stage below remains accurate: `npm run test:search` still passes 33 checks
against migration 0025. No SQL changed in the 2026-10-24 release pass.

Score labels:

- **IMPLEMENTED AND VERIFIED** — code exists and the named local check actually passed.
- **IMPLEMENTED, LIVE VERIFICATION REQUIRED** — code exists; needs hosted credentials or infrastructure.
- **PARTIALLY IMPLEMENTED** — some of the requirement is genuinely missing.
- **NOT IMPLEMENTED** — nothing exists.
- **BLOCKED** — cannot proceed without an external decision, account or approval.
- **NOT TESTED** — evidence is insufficient, or the check has never run.

Nothing in this file is inferred from a page rendering. Local database tests run real PostgreSQL
(PGlite); they do not prove hosted Supabase, network, storage or provider behaviour.

---

## Stage: delivery coordinates and proximity matching (2026-10-30)

Migration [0042_delivery_coordinates_proximity_matching.sql](shilevi-main/supabase/migrations/0042_delivery_coordinates_proximity_matching.sql).
Design and limits: [DELIVERY_LOCATION.md](shilevi-main/docs/DELIVERY_LOCATION.md).

Before this stage `deliveries` held two free-text addresses and county/service-location ids, so
`match_delivery_candidates()` could only rank by declared routes and `delivery_tracking()` had to
return `destination: null`. Both are now driven by real, sourced coordinates.

| Requirement | Implementation | Verification |
|---|---|---|
| A point has an owner and a source | `pickup_*`/`dropoff_*` columns with `*_point_source` (`none`, `seller_pin`, `customer_pin`, `staff_pin`, `geocoder`) and `*_confirmed_at` | PGlite: stored source and landmark equal what the caller sent; a historical delivery stays `none` |
| A half-point cannot exist | `(lat is null) = (lng is null)` constraints plus range checks on latitude and longitude | PGlite: latitude 91 is refused |
| The customer confirms the destination | `set_delivery_destination(order_id, …)` — own order or owner only | PGlite: customer succeeds; unrelated account refused; after collection refused |
| The seller confirms the pickup | `set_delivery_pickup_point` (seller of an order item or staff) and a reusable `provider_pickup_points` row through `set_my_pickup_point` | PGlite: seller succeeds; non-seller refused; an account with no seller path cannot save a point |
| A saved point pre-fills new work | `deliveries_prefill_pickup_point` trigger copies the seller's own point; the destination is never filled | PGlite: new shipment starts at the saved point with source `seller_pin` and an empty destination |
| Matching uses real distance, safely | `match_delivery_candidates` keeps every 0029 eligibility gate and orders by `position_fresh`, then `rider_distance_km` (great circle), then `rank_score` | PGlite: nearest fresh rider first; a stale fix ranks last with `null` distance; a suspended provider is excluded even when closest |
| No stale position is treated as current | Ten-minute freshness window; a stale row yields no distance at all | PGlite: `position_fresh: false` and `rider_distance_km: null` on the stale row |
| Tracking carries the real points | `delivery_tracking` now returns `pickup_point`, `dropoff_point`, both sources, landmarks and `straight_line_km` with `distance_basis: 'straight_line'` | PGlite: destination and pickup coordinates match what was saved; no `eta`/`road_distance_km` key exists; payload still free of phone/email/licence/proof-code fields |
| Money is untouched | No fee, commission or ledger column is written by either function | PGlite: order totals and the delivery fee split are unchanged after the coordinate work |
| Customer and seller can act on it | Map pin picker (click-to-pin, explicit device fix, address lookup) on checkout, the order page and `/provider/orders`; route map on the rider job page | `tsc`, lint, production build |
| Geocoding fails closed | `POST /api/geocode` is session- and origin-checked, uses one of Nominatim/Mapbox/Google from server env, answers 503 when unconfigured and 404 when an address does not resolve | `tsc`, lint, build; no provider credential exists in this deployment, so a live lookup is **not** verified |

Honest limits (also listed in `DELIVERY_LOCATION.md`): distance is straight-line, never road
distance, and no ETA is produced; positions refresh by polling; dispatch still requires a staff
action; and the pin picker plus rider map have not been exercised on a real device.

---

## Stage: live provider positions and authorized tracking (2026-10-30)

Migration [0041_provider_live_position_tracking.sql](shilevi-main/supabase/migrations/0041_provider_live_position_tracking.sql).
This closes the "there is a map, therefore there is a live network" gap: until now nothing in the
database recorded where an on-duty provider actually was, so any map could only have been decoration.

| Requirement | Implementation | Verification |
|---|---|---|
| A position exists only because a device reported it | `provider_positions` (one row per account) written solely by `publish_provider_position()`. Rows are never seeded, generated or back-filled | PGlite: a row exists only after a publish call; no fixture positions exist anywhere |
| Only an approved provider may publish | `may_publish_provider_position()` accepts an approved `transport_partner` application, the partner role, or an activated activity covering `delivery`/`ride` | PGlite: an account with no approved provider path is refused (`42501`); `verify_schema.sql` asserts the same privilege shape |
| The raw table is not client-writable | `revoke all` + `grant select` only; RLS `provider_positions_select_own`; no insert/update/delete policy exists, so a direct write is impossible | PGlite: another account selects 0 rows; `verify_schema.sql` asserts insert/update/delete are absent for `authenticated` |
| A position is readable only by the person on the job | `delivery_tracking()` / `ride_tracking()` check participation (order customer, assigned rider, delivery staff; ride customer, rider, owner) **and** the live window (`assigned…in_transit`, `agreed…in_progress`) inside one security-definer function | PGlite: the customer sees the live rider; an unrelated account is refused for both a delivery and a ride |
| Tracking payloads carry no private material | The JSON contains a display name, a vehicle description and a coordinate — no phone, email, ID number, licence, document path or proof code | PGlite: the serialized payload matches none of `phone`, `email`, `licence`, `national_id`, `proof_code` |
| Off duty removes the data | `stop_provider_position_sharing()` **deletes** the row instead of flagging it | PGlite: row count 0 afterwards; `my_provider_position()` reports `sharing: false`; the customer is told the rider is not sharing rather than shown a stale pin |
| Staleness is stated, never hidden | 120-second threshold; `age_seconds` and `stale` are computed server-side and repeated in the customer-facing notice | PGlite: a fresh fix is `stale: false`; the interruption notice is asserted |
| A watcher cannot become a write storm | Pings inside 2 seconds are acknowledged with `throttled: true` and are not written | PGlite: the second ping returns the previous coordinate with `throttled: true` |
| The map shows only real coordinates | [MapCanvas.tsx](shilevi-main/src/components/tracking/MapCanvas.tsx) projects server coordinates onto OpenStreetMap raster tiles with the attribution their policy requires. No route, distance or ETA is drawn because no routing provider is configured | `tsc`, lint, production build, 340-check route audit |
| Rider control is explicit | [LivePositionSharing.tsx](shilevi-main/src/components/deliver/LivePositionSharing.tsx) asks for the device fix only after the rider presses the button, explains a refused permission, and states who can see the position | `tsc`, lint, build; device/browser behaviour is **not yet verified** (see below) |
| Customer and driver views | [LiveTrackingCard.tsx](shilevi-main/src/components/tracking/LiveTrackingCard.tsx) renders on the customer order page and on each active passenger trip in the rider workspace | `tsc`, lint, production build |

Honest limits of this stage:

- **Deliveries still have no destination coordinates.** `deliveries` stores addresses and county/service
  locations only, so delivery tracking shows the rider's real point and nothing else. Returning a
  guessed destination would be fabrication, so `destination` is `null` by design. Distance-ranked
  delivery matching therefore still uses declared routes and service areas (0029), not proximity.
- **No routing or ETA.** Adding a routing provider (or OSRM/Mapbox/Google) would allow a real route,
  remaining distance and arrival estimate. Until then the UI says it does not compute one.
- **No live tracking inside the map for sellers or staff beyond the tracking read-model**, and no
  push-driven map refresh: the card polls every 20 s. Supabase Realtime would be the next step.
- **Device verification outstanding.** Sharing, denial handling, the off-duty delete and the
  customer view have unit-level database coverage, but no real phone or browser session has been
  exercised in this list of work.

---

## Stage: notification dispatch leases, channel scoping (2026-10-29)

Migration [0039_notification_dispatch_leases.sql](shilevi-main/supabase/migrations/0039_notification_dispatch_leases.sql),
applied hosted. Both dispatchers (`/api/notifications/dispatch`, `/api/notifications/push/dispatch`)
now claim through that function instead of reading `notification_outbox` themselves.

| Requirement | Implementation | Verification |
|---|---|---|
| A channel drain never consumes another channel's rows | `claim_notification_batch(p_channel, …)` filters by channel inside one security-definer function. The email route previously selected every channel and marked non-email rows `skipped`, which retired queued push notifications | PGlite: an email claim returns no push row, and the push row stays `queued` with 0 attempts |
| A killed dispatcher loses its lease, not the notification | Claim sets `next_attempt_at = now() + lease`; the next call releases a `sending` row whose lease expired back to `failed` for retry | PGlite: an abandoned `sending` row is re-claimed with attempts 2; a live lease is not |
| Retries are bounded and terminal states are visible | Attempt counted at claim time; `attempts >= 5` is retired as `skipped` with a reason, whether it was queued or abandoned | PGlite: exhausted row → `skipped` with `last_error`; queued row at the ceiling is retired rather than stranded |
| Two dispatchers never send the same row | Batch claim uses `for update skip locked`; a second call during a lease returns nothing | PGlite: second immediate claim returns an empty set |
| The queue is not browser-callable | `revoke all … from public, anon, authenticated; grant execute … to service_role` | PGlite: `authenticated` and `anon` get `permission denied`, `service_role` succeeds; `verify_schema.sql` asserts the same |
| Ordering and batch bounds | `order by created_at, id`, `limit` clamped to 1–100, lease clamped to 30–3600s | PGlite: `limit 2` returns exactly 2; empty/null channel refused |

---

## Stage: activity-specific deliverer onboarding, push channel (2026-10-29)

Migrations [0037_deliverer_activity_requirements.sql](shilevi-main/supabase/migrations/0037_deliverer_activity_requirements.sql)
and [0038_web_push_subscriptions.sql](shilevi-main/supabase/migrations/0038_web_push_subscriptions.sql).
Push configuration and live-test steps: [PUSH_NOTIFICATIONS.md](docs/PUSH_NOTIFICATIONS.md).

| Requirement | Implementation | Verification |
|---|---|---|
| Requirements depend on the activity | `delivery_document_requirements` (doc type × vehicle class × mode). Identity evidence and a photograph for everyone; licence and registration for every class except `bicycle`; business registration for fleets. Insurance and inspection are seeded `is_required = false` because that is a policy decision | PGlite: bicycle list excludes `driving_licence`/`vehicle_registration`; motorbike list includes both |
| No half-written applications | `create_delivery_application()` writes application, fleet, vehicle, document rows and route intent in one transaction after validating identity, licence expiry, ownership and the required document set. `submit_deliverer_application` and `submit_delivery_application_draft` delegate to it, so no path skips validation | PGlite: missing licence document, expired licence, missing licence number, missing ID number, foreign folder and fleet-document-on-individual are all refused; no application row is left behind |
| Server-side validation is authoritative | The direct RPC is revoked from `authenticated`; paths must start with `delivery/<caller-id>/`; the browser only mirrors the rules | PGlite 0037 checks; `verify_schema.sql` privilege assertions |
| Documents can be corrected | `my_delivery_document_checklist()` shows missing/pending/approved/rejected with the reviewer note; `attach_my_delivery_document()` adds a new `pending` row and refuses a duplicate while one is awaiting review | PGlite: rejected → replacement pending; duplicate refused |
| Submission still approves nothing | Application `pending`, vehicle `pending`, documents `pending`; the status-transition trigger still refuses a non-owner update | PGlite: self-approval refused; vehicle `pending` |
| Declared route is publishable after approval | `delivery_application_route_intents` + `publish_my_delivery_route()`. The old form called `add_delivery_route()` before approval, which always failed — that bug is gone | PGlite: refused before approval, published after, republishing does not duplicate |
| Real push channel | `push_subscriptions` (endpoint unique, bound to the account), subscribe/revoke functions, one `channel = 'push'` outbox row per event, dispatcher with claim/retry/`410` revocation, service worker with no cache | PGlite: ownership, hijack refusal, revoke, no rows after revoke; `tsc`, lint, build, route audit |
| One rendering for inbox and push | `render_notification()` is called by `my_notifications()` and by the dispatcher | PGlite: rendered fields equal the inbox item for the same event |
| Offers reach a rider at all | `delivery_offers_enqueue_notification` and `ride_offers_enqueue_notification` | PGlite: offering a matched shipment creates a notification row for that rider |
| Not claimed | Push delivery to a real device, and email delivery, are **not** verified. `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `RESEND_API_KEY` are unset in production | — |

## Stage: in-app notification centre (2026-10-28)

Migration [0036_in_app_notifications.sql](shilevi-main/supabase/migrations/0036_in_app_notifications.sql).
The outbox from migration 0021 already queued every application, ride, payout, order and delivery
update, but **only the owner console could read it**. A rider had no way to learn that a job had been
offered unless email happened to be configured — and `RESEND_API_KEY` / `RESEND_FROM_EMAIL` are still
unset, so nothing was ever delivered.

| Requirement | Implementation | Verification |
|---|---|---|
| A recipient can read their own notifications | `notification_outbox.read_at` plus an own-row `select` policy; the 0021 owner policy is unchanged | PGlite: only the caller's rows are returned; under RLS a client selects zero foreign rows |
| Titles, bodies and links are trustworthy | `my_notifications()` (security definer, `auth.uid()`-scoped) composes them from known template fields. A raw payload is never returned, and an id enters a path only when it matches a strict UUID — `../admin` becomes `/account/orders` | PGlite: no `payload`/`recipient` keys; transport application → `/deliver`; malformed id → `/account/orders` |
| Read state is own-only and minimal | `mark_notification_read` / `mark_all_notifications_read` filter by `user_id`; the grant is column-level `update (read_at)`, so `status`, `recipient`, `payload` and `attempts` stay server-managed | PGlite: another account's id returns false and its row is untouched; mark-all zeroes the unread count |
| The UI reflects the database | `/account/notifications` renders the server feed; the client only reports what the RPC returned (a zero-row update is never shown as read). A header bell shows `unread_notification_count()` and refreshes on navigation, focus and an explicit change event | `tsc`, lint, build (`ƒ /account/notifications`), route audit 331/331 |

Deployed to the existing `shilevi-main` Vercel project: production deployment
`https://shilevi-main-lq3x8k9l8-russhiraz1-maxs-projects.vercel.app`, status **Ready**, aliased to
`https://shilevi-main.vercel.app`. `0036` was the only pending migration; the dry run named it alone
and `migration list --linked` now reports `0001`–`0036`.

Verified this run: `tsc` PASS · lint 0 errors · build PASS · `test:migrations` **245 checks, 0
failures** (`0001`–`0036`) · `test:auth` 43 + 29 · `test:db` PASS · `test:search` PASS ·
`test:rls:selftest` PASS · `verify:routes` **331/331** · `release:verify` PASS (211 deploy files, 36
migrations).

**Not verified:** reading the inbox with a real signed-in account against hosted data — no customer or
rider session is available here. The rules are proven on PGlite and the page is reachable in
production (307 to sign-in, then the authenticated route).

**Still missing for this phase:** web push. There is no `public/` directory, no service worker and no
`PushManager` subscription, so "notifications while the app is closed" does not exist and must not be
claimed. Email delivery remains blocked by the unset Resend variables.

---

## Stage: personalized customer home, persistent session shell (2026-10-28)

Migration [0035_customer_home_personalization.sql](shilevi-main/supabase/migrations/0035_customer_home_personalization.sql).
A trace of the signed-in experience found three concrete defects, all reproduced before editing:

1. `SiteHeader` rendered a hard-coded **“Log in”** for every visitor, including an authenticated
   customer, because it never asked for the session. Nothing was insecure — every route still
   authorizes on the server — but the marketplace told a signed-in person they were signed out.
2. `/` rendered the marketing page to everybody. A signed-in customer never saw their own orders,
   saved items or recommendations on the home page, and was invited to create an account.
3. Nothing recorded a detail view, and `search_events` was readable only by the owner console, so a
   customer could not see (or clear) their own history and no personalisation was possible.

| Requirement | Implementation | Verification |
|---|---|---|
| The shell knows who is signed in | `AuthProvider` reads the Supabase session, subscribes to `onAuthStateChange` (multi-tab), and exposes roles; `SiteHeader` renders sign-out and an account menu | `tsc`, lint, build, route audit; the links only choose destinations — authorization stays server-side |
| Workspace links match real approval | Approval writes a `provider_applications` row and `provider_activities`, **never** a `user_roles` row, so a role-only check would have hidden every real provider's workspace. `AuthProvider` derives `workspaces.provider` / `workspaces.rider` from those authoritative tables (plus a role fallback) | `tsc`, lint, build; the ride/deliver pages keep their own server-side eligibility gates |
| No login flash and no lost marketing page | `status` starts `unknown` and renders a fixed-width placeholder; the marketing page passes `initialAuthStatus="signed-out"` so it is correct before hydration and without JavaScript | route audit (28 homepage links, 0 broken) |
| `/` is the customer dashboard when signed in | `page.tsx` resolves the session on the server and renders `CustomerHome`; signed-out visitors keep `HomeClient`; the route is `force-dynamic` so one customer's ranking is never cached for another | build output (`ƒ /`), route audit, PGlite ranking tests |
| Sign-in lands on the dashboard | login, signup and the OAuth callback now fall back to `/account` instead of `/onboarding` | `test:auth` — 9 new checks, including a source guard that each form really passes the dashboard fallback |
| Real interaction recording | `record_listing_view` (security definer, `auth.uid()` only, published+active category only, 30-minute dedupe) called from the listing detail page; searches were already recorded by `record_search_event` | PGlite: view recorded, repeat deduplicated, draft listing refused |
| Recommendations from real signals | `customer_home()` ranks published/active listings by recency-weighted (21-day half-life) category affinity from searches, views, saved items and past orders, plus chosen county and browsed price band; excludes the caller's own listings | PGlite: viewed category leads, drafts excluded, cross-county listings stay eligible, price band does not collapse the feed |
| Honest first-time state | `has_history = false` returns newest published listings and says so; no invented “popular” or “trending” claims | PGlite: new account has no history and still gets real listings |
| Privacy and control | `customer_preferences` (area + consent), own-row read policy on `search_events`, `clear_my_marketplace_history()` detaches rows (demand totals survive as anonymous) | PGlite: a second account reads zero foreign rows; clearing removes attribution and the saved area |
| Area-based discovery, no fake GPS | Area picker validated against `service_locations`; “nearby” row is the chosen county's newest listings. Device GPS is deliberately **not** read — listings carry no coordinates and no geocoder is configured, so any distance claim would be fabricated. The UI says exactly that | PGlite: invented county rejected; nearby rows all carry the chosen county |

Hosted status: `0035` applied with `supabase db push` after a dry run naming one file;
`migration list --linked` now reports `0001`–`0035` with no pending row.

Verified this run: `tsc` PASS · lint 0 errors (6 pre-existing warnings) · build PASS ·
`test:migrations` **230 checks, 0 failures** (`0001`–`0035`) · `test:auth` 43 + 29 checks ·
`test:db` PASS · `test:search` PASS · `test:rls:selftest` PASS · `verify:routes` **325/325** ·
`secrets:scan` PASS (570 files) · `release:verify` PASS (207 deploy files, 35 migrations).

Deployed to the existing `shilevi-main` Vercel project twice (the second time after the workspace
fix below): latest production deployment
`https://shilevi-main-1pz0ustcd-russhiraz1-maxs-projects.vercel.app`, status **Ready**, aliased to
`https://shilevi-main.vercel.app`. The first attempt failed with `Error: Not authorized`; the project
lives in the `team_Whojf4GdIYXaAIZK5cR7LPES` team while the CLI's default scope is the personal
account, so the deploy must pass `--scope team_Whojf4GdIYXaAIZK5cR7LPES`.

Production checks after deploy: `/` 200 (marketing, new header present), `/login` 200, `/signup`
200, `/search` 200, `/house-hunt` 200, `/deliver` 200, `/provider` 307 → `/login?next=%2Fprovider`,
`/account` 307 → `/login?next=%2Faccount`, `/account/orders` 307 with the destination preserved,
`/rider/jobs` 307, `/admin` and `/admin/*` 404 (concealed), `/api/health` 200.

**Not verified:** any signed-in render of the new dashboard against hosted data — that needs a real
customer session, which this run does not have. The ranking and privacy rules are proven on PGlite.

## Stage: delivery network Phase 3 — deliverer onboarding (2026-10-26)

Built on the Phase 2 foundation without duplicating any table or flow. `provider_applications`
(`transport_partner`) remains the application record, so `/provider/apply` and the owner console's
Applications queue keep working unchanged.

| Requirement | Implementation | Verification |
|---|---|---|
| Distinct individual and fleet paths | `/deliver/apply` wizard; fleet mode calls `submit_deliverer_application('fleet', …)`, which creates the application **and** the linked `delivery_fleets` row in one transaction | PGlite: application pending, fleet pending |
| Resumable application | `delivery_application_drafts` (one row per account, own-only RLS) + `save_delivery_application_draft` / `submit_delivery_application_draft` | save → resume → submit → draft cleared |
| No duplicate or self-approved applications | One live transport_partner application enforced in the RPC; trigger still refuses applicant transitions | duplicate refused; self-approval refused |
| Vehicle capture before approval | `register_delivery_vehicle` allows an applicant to register a **pending** vehicle with class, payload, dimensions, cargo flags, fleet and assigned driver | fleet registers pending vehicle |
| Configurable document requirements | `delivery_document_types` seeded with seven generic types, all `is_required = false` until the owner decides | catalogue read + registration |
| Private document handling | Files live in the existing private `provider-documents` bucket under `delivery/<user-id>/…`; `delivery_documents` stores the review state; paths outside the caller's folder are rejected | cross-folder path refused; row stays pending |
| Review by authorised staff only | `admin_review_delivery_document`, `admin_review_delivery_fleet`, `admin_review_delivery_fleet_driver` — all gated by `delivery.manage`, audited, rejection requires a note | applicant refused; owner approvals attributed |
| Fleet drivers authorised per vehicle | `transport_vehicles.assigned_driver_id`; matcher and acceptance require an approved fleet **and** approved driver membership | independent driver approval check; `search_path` invariant |
| Matched-only visibility after approval | `list_my_delivery_offers()` now returns nothing without an approved provider or approved fleet-driver membership | pending applicant sees zero offers |
| Admin integration | `/admin/vehicles` gained fleet, driver and document review with short-lived signed links; no new nav entry | build + route audit |
| Account entry point | `/deliver` status dashboard and an account card; no second account is created | build |

Local verification: `npm run test:migrations` **PASS — 136 checks, 0 failures**, `npm run test:db`
**PASS**, production build includes `/deliver`, `/deliver/apply` and the extended vehicle page.

Not implemented yet (later phases): fleet-driver invitation UI (drivers can be added through the
schema and reviewed, but there is no owner-facing invite screen yet), document-requirement
configuration UI, pricing, checkout cargo capture, deliverer job dashboard/map, and courier APIs.

## Stage: delivery pricing + the 10% commissions (2026-10-26)

Migration [0031_delivery_pricing_and_payout_commission.sql](shilevi-main/supabase/migrations/0031_delivery_pricing_and_payout_commission.sql). This is the financial core of the delivery
network, not a UI slice: it makes a delivery price impossible to invent and the two commissions
impossible to hard-code or double-charge.

| Requirement | Implementation | Verification |
|---|---|---|
| No invented delivery prices | `delivery_pricing_rules` (owner-configured base, per-kg, per-package, handling surcharges, min/max, platform fee bps, route and vehicle-class scope, version); `quote_delivery(...)` raises when no active rule matches | PGlite: unpriced route refused; over-payload cargo refused |
| Auditable quote snapshots | `delivery_quotes` stores inputs, rule id + version, components, split, currency, expiry; consumed quotes are refused again | quote arithmetic + version stored; reuse refused |
| Correct totals before payment | `attach_delivery_quote_to_order` revalidates customer/expiry/unpaid state, writes the quote onto the order and shipment, and keeps `delivery_fee = rider_fee + platform_fee` so `mark_order_paid` books the same split | order repriced 110000 → 131000 with cargo on the shipment |
| 10% client payment commission | `commission_rules` rows `client-payment-commission` and `deliverer-payout-commission`; `commission_rate_bps(txn)` + `commission_split(base, txn)` are the only rate/rounding code | 10% of KSh 1,000 = 10000, net 90000 |
| 10% deliverer payout commission | `apply_payout_commission` writes a `commission` ledger pair against `payout_id`, sets `commission_rate_bps`/`commission_minor`/generated `net_minor` | KSh 5,000 → KSh 500 commission, KSh 4,500 net |
| Idempotent and reversible money | unique ledger index per payout+entry+account; retries write nothing; `admin_reverse_payout_commission` posts an `adjustment` pair and requires a reason | duplicate apply, missing reason, reversal and post-reversal reconciliation |
| Owner-only commercial control | `admin_upsert_delivery_pricing_rule` / `admin_retire_delivery_pricing_rule` require `is_shilevi_owner_admin()` and write `audit_events`; rules readable only by owner/finance | customer refused; owner succeeded |
| Reconciliation | `admin_payout_reconciliation(limit)` (function, not a view, so RLS is not bypassed) compares payout gross/commission/net to ledger totals | finance-only refusal + matching totals |

Verified this run: `test:migrations` **167 checks, 0 failures** (`0001`–`0031`), `test:db` PASS,
`verify_schema.sql` no FAIL, `secrets:scan` PASS, `release:sync`/`verify` PASS.

Not done in this stage, and still required: checkout UI for cargo capture and choosing a quoted
delivery option (the RPCs exist and are tested), the owner pricing screen, customer shipment
tracking, merchant handover, fleet-driver invitations, admin incident resolution, maps, and the
customer-facing display of commission before a payout is requested.

## Stage: staff access, MFA step-up and owner-console concealment (2026-10-26)

No migration was added. The reported "apply migration 21" warning was **not** a missing migration:
`npx supabase migration list --linked` against `kdygwbymgpmssuszhski` shows `0001` through `0031`
present locally and remotely. The real cause was that every console read runs at MFA assurance
level 1. `is_shilevi_owner_admin()` requires the JWT `aal` claim to be `aal2` (migration `0005`), so
`admin_list_staff()` raised `Not authorized.`; the page then printed a hard-coded sentence blaming
migration `0021`. The owner had a verified authenticator, but the login form never challenged it,
so sign-out/sign-in could never fix the session.

| Requirement | Implementation | Verification |
|---|---|---|
| Real AAL1 → AAL2 challenge | `/login/mfa` asks Supabase Auth for a challenge, verifies the real TOTP code, refreshes the session and requires `currentLevel = aal2` before leaving. The password form and `/auth/callback` both route a verified-factor session there. | `tsc`, lint, build, `/login/mfa` **200**; live TOTP not exercised (no account) |
| Honest enrolment states | `/admin/security` distinguishes no factor, enrolment started but unverified, verified factor on an aal1 session, and aal2. An unfinished factor is discarded rather than reported as saved. | unit tests for the decision table; screen is owner-only (live check blocked) |
| Owner console concealed | Middleware rewrites every `/admin*` request that is not an allowlisted, confirmed owner to the app's not-found route. Signed-in accounts with no grant are concealed too. The page gates (`requireOwnerAdmin`, `requireStaffCapability`) call `notFound()` and never render a denial. | route audit: `/admin`, `/admin/insights`, `/admin/staff`, `/admin/security`, `/admin/system-health`, `/admin/ledger` all **404** with no admin surface in the body |
| Privileged APIs non-revealing | Refund decisions and payout dispatch return `404 {error:"Not found"}` for anonymous, unconfirmed, non-owner, missing-grant and rejected-Origin callers; an authorized owner at aal1 gets `403 {code:"mfa_required"}`. | route audit probes both endpoints: **404**, body names no audience |
| Accurate diagnostics | `lib/admin/errors.ts` classifies the PostgREST failure (missing function/table, MFA, permission, session, network) and the console states the actual cause instead of always claiming a migration. | `npm run test:auth` — 10 classifier checks |
| Staff boundary preserved | Capability-scoped screens remain reachable only for accounts with an unrevoked grant; the page still calls `has_staff_capability`, which requires aal2. Owner-only paths are listed in `lib/admin/routes.ts`. | pure gate tests; DB-level aal2 refusal already covered by `test:migrations` |

Verified this run: `tsc --noEmit` **PASS** · `npm run lint` **0 errors** (7 pre-existing warnings) ·
`npm run build` **PASS** · `test:auth` **63 checks** · `test:migrations` **167 checks, 0 failures** ·
`test:db` **PASS** · `test:search` **PASS** · `test:rls:selftest` **PASS** · `verify:routes` **325/325** ·
`secrets:scan` **PASS (538 files)** · `release:verify` **PASS (196 deploy files, 31 migrations)**.

Not verified: a real TOTP enrolment/challenge, an authorized owner rendering a console page, and
hosted RLS/MFA behaviour. All of those need a real account with an authenticator; none is claimed.

## Stage: provider review repair, trust & safety and financial visibility (2026-10-27)

Migration [0032_admin_application_detail.sql](shilevi-main/supabase/migrations/0032_admin_application_detail.sql).
The reported approval error had **two** causes, and neither was an unapplied migration `0006`:

1. `provider_applications` never had a reviewer `SELECT` policy. Its only read policy is self-only
   (migration `0001`), so an owner could see nothing but **their own** application — which the
   trigger then correctly refused to let them approve. The screen's single hard-coded fallback
   sentence blamed `0006`.
2. A PostgREST error object is not an `Error` instance, so `cause instanceof Error ? cause.message :
   "…apply migration 0006…"` discarded every real message and always printed the fallback. Worse,
   when RLS filtered a row out of an `UPDATE`, PostgREST returned **zero rows and no error**, and the
   screen reported "Application approved." for a decision that never happened.

| Requirement | Implementation | Verification |
|---|---|---|
| Reviewer can see the queue | `provider_applications_read_reviewer` policy gated by `has_staff_capability('applications.review')` (true for an allowlisted aal2 owner, false for applicants) | PGlite: aal2 owner reads another account's application; aal1 owner and applicants read none |
| Evidence for a lawful decision | `admin_application_detail(uuid)` returns confirmed email, display name, phone, roles, account age, last sign-in, declared fields, private-document metadata, vehicles, fleets, service areas and audit history; it never returns factors, tokens or storage URLs | read model returns the applicant email and confirmed flag; a customer is refused |
| Honest review endpoint | `POST /api/admin/applications/review` re-checks origin, session, allowlist and aal2, reads the row first, and distinguishes `self_review`, `already_decided`, `note_required`, `invalid_transition`, `permission`, `mfa_required`, `no_rows` and success. A zero-row update is never reported as success. | live: anonymous, GET and foreign-Origin callers get `404 {error:"Not found"}`; PGlite: an owner still cannot approve their own application |
| Screen rebuilt around it | Server page with Awaiting/Approved/Rejected filters, per-application cards, confirmation before approval, disabled self-review with an explanation, and a truthful message when `0032` is absent | build + route audit; owner console remains concealed (404) for everyone else |
| Configurable document requirements | `/admin/document-requirements` edits `delivery_document_types` (scope, mandatory, visibility, order). Every type still ships optional: legality is the owner's decision | owner-only RLS on the table; page reads and writes through it |
| Incident resolution | `/admin/incidents` lists `delivery_incidents` with order, delivery state and county, and records investigating/resolved/dismissed with a written note and resolver; it never moves money | `delivery_incidents_resolve_staff` policy requires `delivery.manage`; column grants limit writes to resolution fields |
| Commission traceability | `/admin/payouts/reconciliation` reads `admin_payout_reconciliation`, totals gross/claimed/posted/reversed/net and flags any payout whose claimed commission disagrees with the ledger | finance-only function; PGlite already asserts the read model matches the ledger after reversal |
| Console reached from the overview | Incidents added to the attention queues; reconciliation, incidents and document requirements added to navigation and to the owner-only path list in `lib/admin/routes.ts` | route audit: the three new paths return **404** anonymously |

Verified this run: `tsc --noEmit` **PASS** · `npm run lint` **0 errors** (6 warnings) · `npm run build`
**PASS** · `test:migrations` **177 checks, 0 failures** (`0001`–`0032`) · `test:auth` **63 checks** ·
`test:db` **PASS** · `test:search` **PASS** · `test:rls:selftest` **PASS** · `verify:routes` **325/325** ·
`secrets:scan` **PASS (552 files)** · `release:verify` **PASS (202 deploy files, 32 migrations)**.

Not done, and not claimed: `0032` is **not applied** to the hosted project yet, so the hosted review
queue is still self-only. A live approval by an owner, live incident resolution and hosted RLS remain
unverified and are listed as manual steps in [SUPABASE_MIGRATION.md](SUPABASE_MIGRATION.md).

## Stage: hosted apply, production release and provider category activation (2026-10-27)

Migration [0033_provider_activity_activation.sql](shilevi-main/supabase/migrations/0033_provider_activity_activation.sql).
The whole-platform audit found one shared, structural gap behind several “approved provider but
nothing works” reports: **`provider_activities` could never be written**. Migration `0015` granted
`grant_provider_activity` to `service_role` only, no route, job or edge function called it, and no
console screen existed for it — so approval produced an application badge and zero category
permissions. `can_publish_with_activity()` therefore always returned false and the admin Providers
screen always counted zero activities.

| Requirement | Implementation | Verification |
|---|---|---|
| Approval is not activation | `0033` deliberately does **not** auto-activate on approval. `admin_grant_provider_activity` requires the owner to name one active category and its transaction types | PGlite: approving another account's application leaves `provider_activities` empty |
| Activation is reachable and audited | The existing owner-checked `grant_provider_activity` is granted to `authenticated`; the new wrapper re-checks the owner allowlist, aal2, the approved application and the category division, then writes `provider_activity.grant` to `audit_events` | owner can activate; provider cannot activate for themselves; unapproved application refused; cross-division category refused |
| Least privilege between activities | Division must match the application's `activity_type`, mirroring `set_listing_published_at()` | cross-division activation refused |
| Console can do it | `/admin/applications` shows an activation panel on every approved application with the real active categories in that division, transaction-type checkboxes, and honest errors when `0033` is absent | build, lint, typecheck |
| Provider sees the truth | `/provider` lists activated categories with status and transaction types, or states that none is activated yet and why | typecheck/build; hosted read is owner-session gated |

Hosted status: `0032` **and** `0033` were applied to `kdygwbymgpmssuszhski` with `supabase db push`
after a dry run naming exactly one file each; `migration list --linked` now reports `0001`–`0033`
with no pending row. Production was redeployed to the existing `shilevi-main` Vercel project:
deployment `dpl_95WGZLUhDCyh5ZMkXW5tvtkYut9M`, status **Ready**, aliased to
`https://shilevi-main.vercel.app`.

Verified this run: `tsc` PASS · lint 0 errors · build PASS · `test:migrations` **185 checks, 0
failures** (`0001`–`0033`) · `test:auth` 63 · `test:db` PASS · `test:search` PASS ·
`test:rls:selftest` PASS · `verify:routes` **325/325** · `secrets:scan` PASS (556 files) ·
`release:verify` PASS (203 deploy files, 33 migrations).

Not verified: any authenticated flow against production. The owner session at aal2 is required to
grant an activation, decide an application or resolve an incident, and it is not available to this
run; the two owner accounts must perform those steps themselves.

## Stage: delivery confirmation code hardening (2026-10-27)

Migration [0034_delivery_proof_code_vault.sql](shilevi-main/supabase/migrations/0034_delivery_proof_code_vault.sql).
A trace of one order found a real hole in proof of delivery: the four-digit customer code lived in
`deliveries.proof_code`, on a row the assigned rider can read for the address and fee, and the rider
job screen selected that column. `rider_update_delivery()` compared the submitted value with the same
column and counted nothing, so the party who must not know the code could read it, or guess it in a
few thousand attempts, and mark their own delivery verified.

| Requirement | Implementation | Verification |
|---|---|---|
| Provider cannot read the code | `delivery_proof_codes` holds it: RLS enabled, no policy, no `authenticated` grant. A trigger vaults codes written by the existing `place_order` and nulls `deliveries.proof_code`, including on existing rows | PGlite: the delivery row holds no code; a signed-in client cannot select the vault; the customer can still read it |
| Wrong guesses are counted | `verify_delivery_proof_code()` returns `verified`/`invalid`/`locked`/`used` instead of raising, because a raised exception would roll the attempt counter back. Five failures lock the delivery for 15 minutes | wrong guess increments the committed counter; five wrong attempts lock; a locked delivery rejects the correct code |
| Completion needs a real verification | `rider_update_delivery` no longer compares codes; it requires `verified_at` within ten minutes, then consumes the code | completion before verification refused; replay and reuse refused |
| UI follows the rule | `/deliver/jobs` and `/rider/jobs/[id]` verify first and show locked/invalid/used messages; the rider's job query no longer selects the code | build, lint, typecheck |

Hosted status: `0034` applied with `supabase db push` after a dry run naming one file;
`migration list --linked` now reports `0001`–`0034`. Production redeployed: deployment
`dpl_BrhtFU2abXLEiavpmopYY8D3XNTC`, **Ready**, aliased to `https://shilevi-main.vercel.app`
(`/` 200, `/login` 200, `/deliver` 200, `/provider` 307, `/admin` 404, `/api/health` 200).

Verified this run: `tsc` PASS · lint 0 errors · build PASS · `test:migrations` **204 checks, 0
failures** (`0001`–`0034`) · `test:auth` 63 · `test:db` PASS · `test:search` PASS ·
`test:rls:selftest` PASS · `verify:routes` **325/325** · `secrets:scan` PASS (560 files) ·
`release:verify` PASS (203 deploy files, 34 migrations).

Still not verified: a real rider completing a delivery against production, a real payment callback,
and live GPS tracking (none exists — `deliveries` has no position columns).

## Stage: deliverer job workspace — delivery Phase 4 slice (2026-10-26)

New file only: `src/app/deliver/jobs/page.tsx`. Linked from `/deliver`. No schema change — every
mutation uses an RPC or table that already exists and is already authorized.

| Requirement | Implementation | Verification |
|---|---|---|
| Matched offers only | `list_my_delivery_offers()` (approved provider / fleet driver only) | `tsc`, build, route audit. RPC denial paths covered by 0029/0030 PGlite checks |
| Accept / decline | `accept_delivery_offer` / `decline_delivery_offer`; race safety and re-validation stay in the RPC | build; concurrency covered by `test:migrations` |
| Milestones | One legal next step per status (`assigned → to_pickup → collected → in_transit → delivered`); anything else is not rendered and the RPC rejects it anyway | `tsc`, build |
| Proof of delivery | 4-digit recipient code field (schema enforces `^[0-9]{4}$`); `rider_update_delivery` compares it when the delivery has one and stores the note as `proof_note` | build; code check asserted in `test:db` delivery flow |
| Failed delivery | Explicit action, allowed only from `assigned`/`to_pickup`/`collected`, requires a written note, never converts to delivered | build |
| Incidents | `delivery_incidents` insert with the schema's category list and a 10–2000 character description; RLS `delivery_incidents_insert_participant` requires `opened_by = auth.uid()` and an actual participant | schema/RLS read; not exercised live |
| Privacy | Customer address renders only for rows the deliverer can already see as `rider_id`; offers carry counties, cargo and fee, never the address | code read |
| Earnings honesty | Fee shown is `rider_fee_minor` from the delivery row, explicitly labelled as not a payout | code read |

Verified this run: `tsc --noEmit` PASS · `npm run build` PASS · `/deliver`, `/deliver/apply`,
`/deliver/jobs`, `/admin/vehicles` all **200** on `next start` · `verify:routes` **311/311** ·
`test:migrations` **136 checks, 0 failures** · `test:db` PASS · `secrets:scan` PASS (519 files) ·
`release:sync` + `release:verify` PASS (30 migrations, 188 deploy files).

Not verified: nothing here has been exercised against hosted Supabase — no account, no real
assignment, no storage upload, no live RLS run. Not built yet: fleet-driver invitation UI, document
requirement configuration, the pricing engine, checkout cargo capture and delivery options, customer
tracking, any map/GPS, merchant handover controls, admin incident resolution, and courier APIs.
Those remain the honest gap between this slice and the full delivery network.

## Stage: intelligent delivery network — Phase 2 foundation (2026-10-26)

Phase 1 (inspection) found an existing delivery spine that this module extends rather than replaces:
`deliveries` (order-linked job, statuses `requested`→`assigned`→`to_pickup`→`collected`→`in_transit`→
`delivered`, plus `failed`/`cancelled`), `delivery_events`, `transport_vehicles`, `provider_applications`
(`transport_partner`), `provider_service_areas`, the 47-county `service_locations`, the
ledger-backed delivery fee split, the notification outbox, and the private `provider-documents` bucket.
The previous job model was an open board: every approved transport partner could list every
unclaimed delivery and first-come claimed it. It had no cargo, vehicle, route, offer or suspension
model.

Phase 2 (`0029_delivery_network_foundation.sql`) adds the minimum data and enforcement needed before
any interface is exposed:

| Requirement | Implementation | Verified by |
|---|---|---|
| Configurable vehicle classes | `delivery_vehicle_classes`, seeded with seven defaults (bicycle → lorry), owner-editable | chain replay + matcher tests |
| Fleet accounts | `delivery_fleets` (draft/pending/under_review/approved/rejected/suspended), `delivery_fleet_drivers` | chain replay, RLS enabled |
| Vehicle capability | nullable class, payload and dimension columns plus covered/fragile/temperature flags and document expiry on `transport_vehicles` | matcher tests |
| Route coverage | `delivery_provider_routes` (origin/destination service location), alongside existing service areas | matcher tests |
| Shipment record | additive columns on `deliveries`: `shipment_number`, pickup/dropoff service locations and county, package count, weight, dimensions, cargo flags, required class, assigned vehicle, assignment status, quote snapshot, proof type/path, return status | chain replay + flow tests |
| Matched offers | `delivery_offers` (rank score, explainable reasons, expiry, one per provider per shipment) | offer/accept tests |
| Incidents | `delivery_incidents` with participant insert and staff resolution policies | chain replay |
| Matching engine | `match_delivery_candidates()` — hard eligibility first, then a 0–100 score; no match when the route cannot be verified | capacity, route and approval tests |
| Offer/assignment | `offer_delivery_to_candidates()`, `list_my_delivery_offers()`, `accept_delivery_offer()`, `decline_delivery_offer()` | matched-only payload and race tests |
| Vehicle and route self-service | `set_delivery_vehicle_profile()`, `add_delivery_route()`, `delete_delivery_route()` | chain replay (interfaces Phase 3+) |
| Provider suspension (previously impossible) | owner-only `approved ↔ suspended` branch added to `guard_provider_application_transition()`, requiring a recorded reason; every other transition unchanged | suspend / reinstate / refusal tests |

Security properties held by this phase:

- Every new table has RLS enabled; no client write grant exists on offers, deliveries or fleets beyond
  the explicitly scoped draft/fleet-driver insert.
- The matching and assignment functions are `SECURITY DEFINER` with an empty `search_path`, gated by
  `has_staff_capability('delivery.manage')` (owner allowlist + AAL2) or by the deliverer's own offer.
- A deliverer can only see offers addressed to them, and the offer payload carries counties and cargo
  facts — never the street address, phone number or customer identity.
- Acceptance locks the delivery row, re-checks approval, vehicle status, document expiry, capacity and
  cargo flags, and expires the competing offers. A suspended provider is refused and the shipment stays
  unassigned.
- Deliverer documents reuse the existing **private** `provider-documents` bucket under
  `delivery/<user-id>/…`; read access is limited to the uploader, the owner and staff holding
  `delivery.manage`.

Local verification: `npm run test:migrations` **PASS — 109 checks, 0 failures** (including 17 delivery
checks), `npm run test:db` **PASS**. Not verified: hosted RLS, storage uploads, or any real courier API —
none is configured, and none is claimed.

Not yet implemented (later phases): deliverer/fleet application UI, customer checkout integration for
cargo capture and quotes, deliverer dashboard, admin delivery operations **including the requested
map**, pricing rules, incident workflow UI, and any external provider integration.

## Stage: full admin control center — 35 working sections (2026-10-26)

The owner console now covers every operational domain the schema supports. Navigation grew from 18 to
35 destinations in six groups, and every destination resolves to a real page with a real backend.
Nothing on this list is a placeholder card, a mock table or a disabled button.

| Group | Section | Backend |
|---|---|---|
| Operations | Overview | head-count queues, latest orders, payment posture |
| Operations | Applications | `provider_applications` + migration 0006 transition guards |
| Operations | Listings | `listings` publication controls |
| Operations | Orders | `orders` read via staff/owner policy |
| Operations | Deliveries (new) | `admin_list_deliveries()` (0028) |
| Operations | Refunds | `admin_decide_refund` + `POST /api/admin/refunds/decide` |
| Operations | Customer enquiries (new) | `admin_list_listing_requests()` (0028) |
| Mobility | Passenger trips | `rides` + staff rides capability |
| Mobility | Vehicle approval (new) | `admin_review_transport_vehicle` (moved out of the trips page) |
| Mobility | Riders (new) | `admin_list_riders()` (0028) — ledger-derived balances |
| Mobility | Service coverage (new) | `admin_service_area_coverage()` (0028) |
| Mobility | House Hunt review | `admin_verify_property` + document review |
| Mobility | Contact unlocks (new) | `property_contact_unlocks` under `properties.verify` |
| Catalogue | Categories | taxonomy CRUD under owner RLS |
| Catalogue | Brands | create/edit/feature via `marketplace_brands` owner policies |
| Catalogue | Commission rules (new) | `commission_rules` / `commission_tiers` (read-only by design) |
| Catalogue | Providers (new) | `admin_list_providers()` (0028) |
| Catalogue | Customers (new) | `admin_list_customers()` (0028) with server-side search |
| Money | Payments & payouts | ledger reconciliation and withdrawal dispatch |
| Money | Payment intents (new) | `payment_intents` |
| Money | Payment events (new) | `payment_events` — payload keys only |
| Money | Ledger (new) | `ledger_entries` with debit/credit balance check |
| Money | Payouts (new) | `payouts` + owner-only `PayoutDispatch` |
| Money | Payment methods | `payment_methods` + `admin_set_payment_method` |
| Money | Fees & settings | `admin_update_setting` (0027) |
| Demand | Search insights | `admin_search_insights` (0025) |
| Demand | Trip reviews (new) | `admin_list_ride_reviews()` (0028) |
| Demand | Notifications | `notification_outbox` |
| Demand | Onboarding (new) | `admin_onboarding_overview()` (0028) |
| Governance | Role assignments (new) | `admin_list_role_assignments()` (0028) |
| Governance | Staff access | `admin_list_staff` / `admin_grant_staff_capability` |
| Governance | Deletions | deletion request review workflow |
| Governance | Audit log | `audit_events` |
| Governance | Security | owner MFA enrolment and assurance |
| Governance | System health (new) | migration probes + credential presence (booleans only) |

New owner-only read models live in `supabase/migrations/0028_owner_console_read_models.sql`. Each is
`SECURITY DEFINER` with an empty `search_path`, gated by `is_shilevi_owner_admin()` (allowlist +
email confirmed + AAL2), granted to `authenticated` only, and read-only. PII is minimised: no street
addresses, message bodies, phone numbers, payment references or verification documents.

Verification for this stage (all run locally, on the current tree):

- `npm run test:migrations` **PASS — 82 checks, 0 failures**, including functional calls to every 0028
  read model as a seeded AAL2 owner, and refusals for AAL1 and for a signed-in non-owner.
- `npm run test:db` **PASS**, `npm run test:search` **PASS**, `npm run test:auth` **PASS (34)**, 
  `npm run test:rls:selftest` **PASS**.
- `npx tsc --noEmit` **PASS**, `npx eslint src` **0 errors** (5 pre-existing warnings).
- `npm run build` **PASS**; all 35 admin routes built and return **HTTP 200** on `next start`.
- `npm run verify:routes` **PASS — 311/311**; `npm run secrets:scan` **PASS** (507 files);
  `npm run release:sync` + `release:verify` **PASS** (184 files, 28 migrations).

Not verified: rendering any admin table against a hosted Supabase project. This workstation has no
owner session, so every page renders its configuration/denial state. The database functions were
exercised in PGlite, not over PostgREST.

## Stage: admin control center completion (2026-10-25)

The owner panel is now one consistent control center rather than a set of pages with different
frames. Every navigation entry resolves to a page with a real backend; nothing is a screenshot or a
coming-soon card.

| # | Requirement | Status | Evidence | Remaining |
|---|---|---|---|---|
| A1 | One admin shell with grouped navigation | IMPLEMENTED AND VERIFIED (render) | `src/components/admin/AdminShell.tsx`: sticky sidebar, 18 destinations in 6 groups, active state, mobile disclosure with Escape, MFA badge, sign-out, own-account email | Visual review needs a hosted owner session |
| A2 | Every admin page uses the shell | IMPLEMENTED AND VERIFIED | Brands, categories, listings, applications and deletion requests converted; overview rewritten; the other nine already used it | — |
| A3 | Live overview dashboard | IMPLEMENTED AND VERIFIED (typecheck/build) | Real head-counts for applications, refunds, listings, properties, vehicles, open rides, deletions, failed notifications; latest orders; payment posture; a failed read renders “—” not 0 | Counts need a hosted database to display |
| A4 | Brand create/edit/feature | IMPLEMENTED AND VERIFIED (code path) | `AdminBrandsClient`: insert/update with slug, HTTPS URL and range validation; activate/deactivate and feature toggles | Not exercised against a hosted project |
| A5 | Category create/edit/visibility | IMPLEMENTED AND VERIFIED (code path) | `AdminCategoriesClient` | Same |
| A6 | Fees & settings page | IMPLEMENTED, LIVE VERIFICATION REQUIRED | `/admin/settings` + `0027` (owner reachability and range validation) + `test:db` assertions for valid/invalid/non-owner writes | Needs an owner session at AAL2 |
| A7 | Notification outbox view | IMPLEMENTED, LIVE VERIFICATION REQUIRED | `/admin/notifications` reads owner-visible outbox rows; explicitly cannot reveal provider keys | Needs applied 0021 and data |
| A8 | Refunds | IMPLEMENTED, LIVE VERIFICATION REQUIRED | `/admin/refunds` + `POST /api/admin/refunds/decide` + `0026` | Needs a real refund request |
| A9 | Payments, payouts, methods | IMPLEMENTED, LIVE VERIFICATION REQUIRED | `/admin/payments` (ledger reconciliation, withdrawal dispatch), `/admin/payments/providers` | Provider credentials and B2C approval are external |
| A10 | Staff, audit log, security | IMPLEMENTED, LIVE VERIFICATION REQUIRED | Existing pages on the shared shell; capabilities enforced by `has_staff_capability` | Hosted MFA session required to prove |

Verification for this stage: `npm run typecheck` **PASS**, `npm run lint` **PASS** (0 errors),
`npm run build` **PASS**, all 18 admin routes return **HTTP 200** on a production build with the
configuration guard rendering, `npm run test:db` **PASS** (including the new settings authorization
and range tests), `npm run test:migrations` **PASS** — 60 checks, `npm run verify:routes` **PASS** —
311/311.

## Stage: migration recovery, refund decisions, premium design system (2026-10-25)

Context: the owner's first `supabase db push` stopped at `0005_admin_database_policies.sql` with
`SQLSTATE 42601` (`syntax error at or near "$"`). The remote project `kdygwbymgpmssuszhski` may
therefore hold only `0001`–`0004`; that state could not be inspected from this workstation (no
database password / linked dry-run), so recovery is described rather than executed.

| # | Requirement | Status | Evidence | Remaining |
|---|---|---|---|---|
| M1 | Repair the `0005` dollar-quote syntax error | IMPLEMENTED AND VERIFIED | Both `as $` / `$;` delimiters corrected to `$$` in `set_listing_published_at()` and `audit_marketplace_admin_change()`; `npm run test:migrations` applies the whole chain | Remote re-push is the owner's action |
| M2 | Audit all migrations for the same defect | IMPLEMENTED AND VERIFIED | Delimiter scan over `0001`–`0026`; full chain applies cleanly in PGlite (56 checks) | — |
| M3 | Duplicate / stray migration sets | IMPLEMENTED AND VERIFIED | Single canonical `supabase/migrations/`; `npm run migrations:sync` regenerates the 26-file manual bundle; accidental nested CLI folders removed | — |
| M4 | Determine the real remote migration state | **BLOCKED** | No database password or management token available; `supabase migration list` needs a live connection | Owner must run it, or supply credentials |
| M5 | Refund decisions were impossible (`admin_decide_refund` granted to `service_role` only, whose calls have no `auth.uid()`) | IMPLEMENTED AND VERIFIED | `0026_refund_decision_execution.sql` grants EXECUTE to `authenticated`, keeps `public`/`anon` revoked; function still enforces owner allowlist + AAL2; `tests/db/migrations-full.test.mjs` asserts both grants | Live MFA owner decision not run (no hosted session) |
| M6 | Owner refund review UI + API | IMPLEMENTED, LIVE VERIFICATION REQUIRED | `src/app/admin/refunds/page.tsx`, `RefundDecision.tsx`, `POST /api/admin/refunds/decide` (same-origin, rate limit, 401/403/409/503, confirmation step); customer sees real status in `src/app/account/orders/[id]/page.tsx` | Needs a hosted owner session at AAL2 and a real refund request |
| M7 | Developer-facing errors in customer flows | IMPLEMENTED AND VERIFIED | House Hunt, account, provider and order messages no longer print migration numbers or raw database errors; details go to the server/browser console | Some admin-only screens still name the migration, by design |
| M8 | Premium visual system | IMPLEMENTED AND VERIFIED (rendering) | Token palette + component layer in `src/app/globals.css`; shared `SiteHeader`/`SiteFooter`; rebuilt homepage, auth shell and auth pages, search and listing headers | Only the highest-traffic surfaces are converted so far |
| M9 | Layered-depth / 3D-inspired hero background | IMPLEMENTED AND VERIFIED | CSS-only `.hero-atmosphere` + `.glow-orb` (no WebGL, no new dependency), decorative `aria-hidden`, `pointer-events: none`, static fallback under `prefers-reduced-motion` | No interactive 3D scene exists and none is claimed |
| M10 | Responsive + accessible shell | IMPLEMENTED AND VERIFIED (DOM) | 390/768/1440 checks: no horizontal overflow, 50px form targets, mobile disclosure with `aria-expanded`/Escape, reduced-motion rules, visible focus ring | Tablet screenshots not captured (visual review pending) |

### Verification for this stage

| Command | Result |
|---|---|
| `npm run test:migrations` | **PASS** — 56 checks, `0001`–`0026` apply cleanly, `verify_schema.sql` no FAIL |
| `npm run test:db` | **PASS** — orders, refunds, rides, House Hunt, staff |
| `npm run test:search` | **PASS** — 33 checks |
| `npm run test:auth` | **PASS** — 34 checks |
| `npm run test:rls:selftest` | **PASS** |
| `npm run typecheck` / `npm run lint` | **PASS** — 0 errors |
| `npm run build` | **PASS** |
| `BASE_URL=… npm run verify:routes` | **PASS** — 311/311 |
| `npm run secrets:scan` | **PASS** — 475 files, no findings |
| `npm run release:sync` + `release:verify` | **PASS** — 164 deploy files, 26 migrations |
| `supabase db push --dry-run` | **BLOCKED — NOT RUN** (no DB password / authenticated DB access) |
| `supabase/verify_schema.sql` on hosted | **BLOCKED — NOT RUN** (same) |
| `npm run test:rls:live` | **BLOCKED — NOT RUN** (no hosted credentials) |

### Where this leaves the product

The refund journey no longer dead-ends: a customer request can be approved or rejected by an
MFA-verified owner, and the customer sees the real outcome. Discovery, order, ride and House Hunt
behaviour is unchanged. What remains unproven is anything that needs the hosted project: the
remote migration state, schema verification, RLS, storage, MFA and payment callbacks.

---

## Stage: real discovery, search and intelligent matching

| # | Requirement | Status | Evidence | Remaining |
|---|---|---|---|---|
| S1 | Database-backed search over published listings, active categories only | IMPLEMENTED AND VERIFIED | `0025`; `tests/search/search.test.mjs` — drafts, paused, inactive-category listings excluded | — |
| S2 | Full-text matching on title **and** description | IMPLEMENTED AND VERIFIED | `search_vector` generated column + GIN; test “description text is searchable” | — |
| S3 | Relevance ranking, plus newest / price / title sorts | IMPLEMENTED AND VERIFIED | `ts_rank_cd`, featured tiebreak, stable `id` last; sort tests | No fuzzy/semantic matching (documented, not claimed) |
| S4 | Taxonomy-aware category filter (parent includes children) | IMPLEMENTED AND VERIFIED | Recursive `category_scope` CTE; test “a parent category includes its children” | — |
| S5 | Division, county and price filters, combinable | IMPLEMENTED AND VERIFIED | `division`, `county` (property county or listing attribute), `price_minor`/`rent_minor` | County is the finest location the schema stores |
| S6 | Stable pagination with an exact total | IMPLEMENTED AND VERIFIED | `total`, `pages`, disjoint-page test; size clamped 1–48 | — |
| S7 | Input validation and clamping on both layers | IMPLEMENTED AND VERIFIED | Route allowlists + RPC exceptions; oversized query/page tests | — |
| S8 | Injection and wildcard abuse resistance | IMPLEMENTED AND VERIFIED | Parameterised calls; LIKE escaping; `%` and `'; drop table…` return zero rows and change nothing | — |
| S9 | House Hunt private contact never exposed by search | IMPLEMENTED AND VERIFIED | `property_contacts` not joined; payload whitelist; test asserts address, phone and contact name absent | Live RLS suite still unrun (see `docs/RLS_NEGATIVE_TESTS.md`) |
| S10 | Real search UI: filters, pagination, empty/loading/error states, keyboard access | IMPLEMENTED AND VERIFIED (local) | `src/app/search/page.tsx` on `/api/search`; route audit passes `/search` | No assisted browser session against a hosted project |
| S11 | Analytics events recorded server-side, not client-trusted | IMPLEMENTED AND VERIFIED | `record_search_event` granted to `service_role` only; `result_count`/`shown_listing_ids` from the RPC answer | — |
| S12 | Privacy-minimal analytics schema | IMPLEMENTED AND VERIFIED | No IP/UA/session/referrer columns; query capped 120; shown ids capped 24 | Retention job not scheduled yet |
| S13 | Click engagement for published listings only | IMPLEMENTED AND VERIFIED | `/api/search/event` (same-origin, rate-limited); RPC refuses non-published listing | — |
| S14 | Owner demand intelligence from real events | IMPLEMENTED AND VERIFIED (RPC) | `admin_search_insights`; non-owner refusal, empty-window `has_data=false` tests; `/admin/insights` page | Page not exercised against a hosted project |
| S15 | Retention is explicit and scheduled | PARTIALLY IMPLEMENTED | `prune_search_events` (service role only, 180-day default) tested | No cron/schedule configured |
| S16 | “Intelligent matching” beyond deterministic signals | NOT IMPLEMENTED | — | Requires a real signal source: permitted interaction history, recommendations, or an LLM/vector provider with credentials. Not labelled as AI today. |

### Files changed in this stage

- `supabase/migrations/0025_marketplace_search_and_demand_intelligence.sql` (new)
- `tests/search/search.test.mjs` (new), `package.json` (`test:search`)
- `src/app/api/search/route.ts` (new), `src/app/api/search/event/route.ts` (new)
- `src/app/search/page.tsx` (rewritten on the API)
- `src/app/admin/insights/page.tsx` (new), `src/components/admin/AdminShell.tsx` (nav entry)
- `docs/SEARCH.md` (new), `docs/IMPLEMENTATION_STATUS.md` (this file),
  `docs/REQUIREMENTS_MATRIX.md`, `docs/TESTING.md`, `README.md`

### Preserved from earlier stages

`0022` rider-balance authorization, `0023` double-gated sandbox and payment-method readiness,
`0024` storage buckets and policies, the live-RLS harness and its fail-closed behaviour. No
permission was relaxed, no test disabled, no financial arithmetic changed, and the sandbox stays off
by default.

---

## Verification for this stage

| Command | Result |
|---|---|
| `npm run test:search` | PASS — 33 checks |
| `npm run test:db` | PASS — migrations 0015–0024 |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS — 0 errors |
| `npm run build` | PASS |
| `BASE_URL=… npm run verify:routes` | PASS — 311/311 |
| `node tests/rls/selftest.mjs` | PASS |
| `npm run test:rls:live` | BLOCKED — exit 2, no hosted project |

Exact command output for the current run is recorded in the stage report; re-run the commands rather
than trusting this table after further edits.

---

## Where to resume

1. **Recommended next stage:** verify this stage against a hosted staging project (search, analytics
   writes, owner reporting, live RLS), then schedule `prune_search_events`.
2. **Then:** provider onboarding and workspace completion, which is the largest remaining gap.
3. **Blocked, needs an owner decision:** card gateway, Airtel Money merchant account, commission rate
   (10% vs 20%), settlement/custody model.
4. **Do not** start the visual redesign, card payments or Airtel integration inside a search stage.
