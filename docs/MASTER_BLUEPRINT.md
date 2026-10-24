# XYZ Master System Blueprint — Version 1.0

**Status:** working specification, not final
**Derived from:** founder's v1.0 blueprint (2026-10-20)
**Working name:** XYZ. The repository currently uses **Shilevi**; naming and domain remain open.
**Initial market:** Kenya. **Long-term:** international expansion.
**Related documents:** [TAXONOMY.md](TAXONOMY.md) (catalogue, participants, permission and commission model), [ARCHITECTURE.md](ARCHITECTURE.md), [SECURITY.md](SECURITY.md), [DATA_MODEL.md](DATA_MODEL.md).

This version keeps every confirmed requirement. It tightens language, corrects one structural error, and separates what is decided from what is still open. Requirement changes are listed in Appendix B.

**Reading the labels:** **Confirmed** = decided. **Default** = decided but configurable. **Open** = blocks or shapes build; must be resolved before the named phase.

---

## Part 1 — Vision and product definition

**Confirmed.** XYZ is a Kenya-first universal marketplace connecting people, businesses, products, services, property, rentals, and transport through one platform. It is not a single shop; it is shared infrastructure with specialised workflows.

A customer should be able to find a rental, buy a bed, hire a plumber, order groceries, arrange delivery, or book a photographer in one place. A provider should get a fit-for-purpose workspace, not a generic listing form.

**What makes it one platform:**

- one identity and account system;
- one search entry point with category-scoped search beneath it;
- one order, booking, and delivery record structure;
- one financial ledger;
- one verification and trust layer;
- separate interfaces for customers, providers, transport partners, and staff.

**What it is not:** eight disconnected apps behind one logo, or a directory that simply exposes phone numbers.

**Success at launch is not "every category active."** It is one town where a customer can complete a real transaction end to end, and a provider gets paid correctly.

---

## Part 2 — Participants

**Confirmed.** Four human groups plus the platform's automated systems.

| Group | What they do |
|---|---|
| Customers and buyers | Browse, compare, buy, rent, book, request delivery or a ride, pay, track, review, dispute |
| Sellers and service providers | Apply for activities, publish listings, manage orders and bookings, respond, earn |
| Transport and logistics partners | Accept delivery or passenger jobs within approved vehicle and activity permissions |
| Administration and staff | Verify, moderate, support, reconcile, investigate, configure, audit |
| Platform systems | Search, permission enforcement, matching, notifications, commission calculation, deadline monitoring, risk signals |

Staff are not one role. Capabilities are separated by function: verification, support, finance, trust and safety, moderation, marketing, data protection. See [TAXONOMY.md](TAXONOMY.md#participants).

**Open:** staff headcount and which roles exist at launch. Recommendation: one founder-super-admin, one verification/support role, one finance role. Do not give every early hire full access.

---

## Part 3 — Account, activity, listing

**Confirmed.** Three distinct concepts, and the separation is the core security model.

1. **Account** — who the person or organisation is.
2. **Activity** — what the account is authorised to offer: a category (or subtree), allowed transaction types, verification tier, status.
3. **Listing** — the specific product, service, property, or transport offering.

A person can hold several activities under one account. Approval for one never implies another.

**Enforcement stack.** Every check must exist at all four layers:

1. Interface hides unauthorized options.
2. API validates the request.
3. Row-level security scopes rows to the account.
4. A database trigger or policy verifies the activity, category, and transaction type on insert and on publication.

Hiding a button is not security. A direct PostgREST call must fail.

**Correction to v1.0:** the hierarchy is **Division → Category → Subcategory → Listing**. "Activity" is not a level between subcategory and listing; it is a permission record that references a category and a set of transaction types. Otherwise "Wigs" appears twice — once as a subcategory, once as an activity — and the two drift apart.

**Account states:** pending verification, active, restricted, suspended, deactivated, closed.
**Activity states:** pending, approved, suspended, expired. These are independent: a suspended property activity must not block the same person from buying as a customer.

---

## Part 4 — Dynamic category engine

**Confirmed.** Categories, subcategories, ordering, visibility, listing fields, and filters are managed from the administration dashboard, not hardcoded.

**Administrators can:** create, rename, reorder, re-parent (safely), add levels, set icons and descriptions, define listing fields, define required fields, define search filters, set verification requirements, activate/deactivate, and inspect usage.

**Administrators cannot:** execute arbitrary code, add unsupported field types, or delete a category that is referenced by listings or transactions.

**Category field registry.** Each field must be a validated type: short text, long text, number, money (integer minor units + currency), boolean, single select, multi select, date, date range, media, location, or relation. Each field declares required/optional, max length, min/max, and whether it is filterable.

A free-text "attributes" JSON blob is not enough on its own: filterable fields need indexed columns or expression indexes, or category search will scan and slow down.

**Safe changes.** Slugs keep a history and redirect. Deactivation pauses new publication but preserves existing listings, orders, and financial records. Moving a category requires an explicit listing-migration step and an audit entry.

**Search.** Universal search across all permitted published listings, plus category-scoped search that includes descendants. At launch, PostgreSQL full-text and trigram search are sufficient; do not add a separate search engine before volume justifies it. Swahili and Sheng synonyms are a later ranking improvement, not a launch blocker.

---

## Part 5 — Category catalogue

**Confirmed.** The initial catalogue is in [TAXONOMY.md](TAXONOMY.md): 126 categories across four divisions (39 products, 46 services, 21 transport, 20 property), each with representative subcategories, allowed transaction types, and a verification tier.

**Restricted categories** — alcohol, tobacco, prescription medicines, weapons, wildlife products, counterfeit or stolen goods, gambling, adult services, hazardous chemicals, unlicensed medical devices, and any activity requiring a licence the platform has not verified — are admin-approved only and legally reviewed before activation. `other-*` categories exist for the admin team, not as a user-selectable loophole.

---

## Part 6 — Provider applications and verification

**Confirmed.** One application dossier per account; one or more activity requests under it. The dossier collects identity and business evidence once. Each activity is reviewed on its own.

**Stages:** account → select activities → activity-specific forms → documents and consent → submit → completeness check → staff review → additional checks if justified → approve/reject/request more → activate permissions → ongoing monitoring.

**Statuses:** draft, submitted, under review, additional information required, approved, rejected, suspended, withdrawn.

**Tiers** (from [TAXONOMY.md](TAXONOMY.md)): T0 phone/email, T1 ID + selfie, T2 business registration or property ownership/authority, T3 category licence/vehicle/insurance/professional registration.

Verification is risk-based. A perfume seller does not submit the same dossier as a passenger-transport operator. Property requires evidence of ownership **or lawful authority** per listing, not only per account. Transport requires vehicle, licence, and insurance checks. Regulated services require current licences and periodic re-checks.

**External checks.** Design only around access you actually have: public business-name search, KRA PIN validation, and licensed identity-verification vendors. Do not assume direct KRA or DCI database access. A terms clause is not a lawful basis under the Data Protection Act; collect consent where required, limit purpose, restrict access, set retention, and log document views.

**Staff review tools:** queue, evidence viewer with least-privilege access, request-more-information, decision with reason, activity-level activation, escalation, and full audit trail.

---

## Part 7 — Listings

**Confirmed.** A listing can only be created under an approved, active activity and a permitted category.

**States:** draft, pending review, published, paused, out of stock/unavailable, rejected, removed, archived.

**Every listing has:** id, owner account, activity reference, category reference, transaction type, status, price (integer minor units + currency), attributes, media, location scope, timestamps.

**Publication checks:** owner matches, activity approved and active, category matches activity, transaction type allowed, category and division active, category-specific requirements satisfied, any brand/location constraints satisfied.

**Moderation:** user reports, duplicate detection, suspicious-price and prohibited-content signals, category rules, review queue, takedown and appeal. Do not rely only on complaints.

**Risk-tiered publishing:** low-risk verified sellers auto-publish and are monitored; property, health, transport, and high-value listings review before publication; regulated categories re-check licences periodically. Reviewing every listing manually will not scale beyond one town.

---

## Part 8 — Customer experience

**Confirmed.** Public browsing without an account. Contact, ordering, booking, messaging, and reviews require an account.

**Public surface:** home, universal search, category navigation, product/service/property listings, transport information, public provider profiles, help, sign-in/sign-up.

**Home:** location selector, search, four divisions, trending/nearby, popular services, property, transport availability, promotions, recently viewed. Recommendations must reflect real listings; never invent popularity or availability.

**Account:** profile, addresses, favourites, orders, bookings, deliveries, messages, reviews, notifications, payment methods through the provider's secure flow, disputes, privacy and security.

**Communication:** in-app messages tied to an order, booking, viewing, quote, or delivery. Masked calling for property and rides where needed. Contact details are private by default. If messaging is unreliable, providers will route customers off-platform and commission disappears.

---

## Part 9 — Provider dashboard

**Confirmed.** A dedicated business workspace whose modules depend on approved activities: overview, products, services, properties, rentals, orders, bookings, enquiries, delivery requests, inventory, availability, earnings, payouts, reviews, verification, promotions, support, settings.

A multi-activity provider switches workspaces without creating another account. The interface must not show tools the account is not authorised to use.

**Earnings display needs ledger states:** pending (order placed), eligible (delivered and return window closed), paid (payout sent), reversed (refund or dispute). A single "earnings" number without states creates support tickets and distrust.

---

## Part 10 — Transport and delivery

**Confirmed.** Separate permissions for goods and passengers. Vehicle classes: motorcycle, bicycle, car, tuk-tuk, pickup, van, lorry/truck, specialised. Each class declares capacity, dimensions, weight, handling, and passenger eligibility.

**Partner registration:** identity, vehicle and registration, capacity, operating locations, licence, insurance, task-specific requirements, payout details.

**Availability:** offline, online, busy, restricted. Availability must reflect real eligibility, not a toggle colour.

**Matching considers:** task eligibility, vehicle suitability, capacity, distance and ETA, service area, availability, reliability and completion history, rating (recency-weighted), and expected earnings. Prevent double assignment with a single atomic claim (row lock or conditional update), not a read-then-write check.

**Delivery states:** requested → matching → assigned → travelling to pickup → collected → in transit → delivered → completed or disputed.

**Passenger states:** requested → assigned → approaching → picked up → in progress → completed.

**Proof of completion:** recipient confirmation, delivery PIN, timestamp, location evidence, or photograph where justified. A button press alone is not proof for high-value goods.

**Inter-town:** last-mile by local partner; line-haul by partner courier or matatu parcel operators. Do not build a national fleet. Model a handoff event with its own custody and proof.

**Open:** delivery pricing (fixed by distance, zone-based, or partner bidding), goods-in-transit insurance, and loss/damage liability. These must be decided before Phase 6.

---

## Part 11 — Orders, bookings, and quotations

**Confirmed.** Not every transaction uses the same workflow. One order spine, per-vertical state machines.

| Vertical | Core flow |
|---|---|
| Product | select → confirm price/availability → pay → seller prepares → deliver/collect → confirm → return window → complete |
| Service | enquire or book → quote/confirm → schedule → perform → confirm → review/dispute |
| Property rental | enquire → verify listing → viewing → application/agreement → reservation/deposit → move-in |
| Short stay | check availability → book dates → pay → check-in → check-out |
| Delivery | request → match → assign → collect → deliver → prove → settle |
| Ride | request → match → assign → pickup → complete → settle |

**Negotiation:** optional per category. Offers, counteroffers, and accepted prices are recorded. Food and rides are fixed-price. Used goods, property, custom work, construction, and bulk purchases may negotiate. An accepted offer is binding and snapshotted.

**Idempotency:** client retries and duplicate submissions must not create duplicate orders or ledger entries. Use an idempotency key per mutation.

**Property is not a normal checkout.** High-value rentals and sales need a distinct reservation/deposit workflow and should launch as enquiry-only until the payment and agreement model is legally reviewed.

---

## Part 12 — Financial system and commission

**Confirmed default:** 10% of the applicable commission base, configurable per category and transaction type through the admin dashboard.

**Open and blocking: the base, the payer, and the rounding.**

"10% of the applicable base" is not a complete rule. Every rule must state:

1. **Base** — item subtotal, service price, delivery fee, or provider earning. Exclude tax and payment-provider fees.
2. **Payer** — deducted from the provider or added to the customer.
3. **Rounding** — nearest whole shilling, nearest 5, ceil, and what happens below the minimum.
4. **Minimum and maximum** — per transaction and per category.
5. **Timing** — when the commission is earned and when it becomes payable.

**Recommended default for launch:** 10% of the item or service subtotal, excluding delivery, tax, and payment fees; deducted from the provider's payout; rounded to the nearest whole shilling; snapshotted onto the order at confirmation. Delivery carries its own rule (for example 10% of the delivery fee) because its economics differ.

**Low-ticket warning.** 10% of KSh 50 is KSh 5. After payment-provider fees and support time, that transaction is likely negative. A minimum commission, a minimum basket, or a customer-paid convenience fee is required. Decide before Phase 5.

**Ledger.** Every transaction produces balanced entries: customer charge, payment-provider fee, commission, provider payable, delivery payable, refund, adjustment. Store money as integer minor units with an explicit currency. Use idempotency keys on payment events. Reconcile daily against the provider; put exceptions in a queue.

**Settlement.** Collection is easy; split settlement and payouts are the hard part. Use a licensed provider that supports the model, or launch enquiry-only. Never commingle customer funds in an ordinary company account. Confirm licensing and tax treatment before collecting.

**Payouts:** KYC before first payout, payout batches, failure retries, negative-balance handling, and a reserve for refunds after payout. If a seller is paid and the buyer later wins a dispute, the platform needs a funded reserve or a recoverable balance.

**Commission changes:** versioned, effective-dated, audited, with a preview simulator and a maximum-rate guardrail. A change never rewrites a completed order.

---

## Part 13 — Refunds and disputes

**Confirmed.** Category-specific fulfilment deadlines and a structured dispute process.

**Windows:** food in minutes/hours; local delivery by the agreed slot; standard products by the seller's stated handling time plus a post-delivery return window; custom goods by the agreed production date; services by the booked appointment; property by the reservation terms.

**States:** not dispatched, in transit past deadline, delivered not as described, service not performed, damaged, unauthorized transaction.

**Process:** customer opens a dispute with reason and evidence; provider responds; support reviews order, messages, payment events, delivery proof, and policy; decision recorded with reason; appeal path for significant outcomes.

**Who bears the loss** must be explicit: platform, seller, transport partner, or insurer. Without this, every dispute becomes a judgment call and support costs explode.

---

## Part 14 — Ratings and reputation

**Confirmed.** Ratings tied to genuine transactions; reputation considers more than average stars.

**Signals:** verified completion, recency-weighted rating, cancellation and non-delivery rate, response time, confirmed complaints, policy violations, fraud findings, verification level.

**Rules:** only completed transactions can review; one review per transaction; provider response allowed; moderation and appeal; retaliation and fake-review detection; reputation separated by activity where possible.

**Ranking:** suitability first (distance, availability, eligibility), then reliability and rating. Give new providers a bounded opportunity to build a record. Never let a single review suspend an account.

---

## Part 15 — Administration control centre

**Confirmed.** Private, separate, server-authorised.

**Modules:** overview; users and accounts; applications and verification; categories and listings; orders and bookings; transport operations; finance; support; trust and safety; promotions; service areas; platform settings.

**Staff capabilities** (not job titles): review applications; view documents; moderate listings; view orders; issue refunds up to a limit; release payouts; suspend accounts; configure categories; configure commissions; export reports; manage feature flags.

**Security:** MFA for all staff, least privilege, session management, audit logging, break-glass access for sensitive documents, no secrets in the browser, dual control for high-risk financial or security changes.

The existing repository already implements owner-email gating with MFA for categories, brands, listings, applications, and deletion requests. That is a seed, not a complete staff permission system.

---

## Part 16 — Location, coverage, and expansion

**Confirmed.** Multiple towns, eventually multiple countries.

**Model:** country → region/county → town/city → neighbourhood → service area/delivery zone. Providers declare operating locations. Customers select a location or grant permission per transaction; no continuous tracking for browsing.

**Category activation** (from [TAXONOMY.md](TAXONOMY.md)): `unavailable`, `enquiry_only`, `limited`, `active`, per category per location. The catalogue can be national; transactability is local. Show the difference honestly.

**Expansion readiness:** store `country_code`, `currency`, `timezone`, and locale on the relevant records from day one. Retrofitting multi-country into a single-currency schema is expensive.

---

## Part 17 — Notifications and communication

**Events:** application submitted/approved/more-info; listing approved/rejected; new order; booking confirmed; payment confirmed; partner assigned; delivery status; overdue order; refund; payout; new message; dispute update; security alert.

**Channels:** in-app, email, SMS, push. Respect preferences and consent. Do not put sensitive identity or financial details in notifications.

**Reliability:** queue with retries and dead-letter handling. Payment and assignment notifications must not depend on a single best-effort send.

**Rider alerts:** Android can support a high-priority, full-screen, repeating alert via a foreground service, subject to Play Store policy. iOS cannot guarantee overriding silent mode without a critical-alert entitlement. Design a fallback and do not promise universal behaviour.

---

## Part 18 — Security, privacy, and fraud

**Baseline:**

- RLS on every exposed table; no table readable by default.
- Server-side authorization on every mutation; never trust a client-supplied user id, role, price, or status.
- MFA for staff; step-up verification for sensitive actions.
- Secrets only in server-side environment configuration or a secret manager.
- Uploaded files: type/size limits, private storage, signed access, malware scanning where available.
- Rate limiting on auth, messaging, applications, and payment endpoints.
- Parameterized queries only; no raw SQL from user input; no raw HTML rendering.
- Audit logs for administrative and financial actions; append-only.

**Privacy (Kenya DPA 2019):** lawful basis, purpose limitation, data minimisation, retention schedule, access/correction/deletion handling, breach process, consent records, and vendor agreements. Identity documents are the highest-risk data: restrict access, log views, delete when no longer needed. Confirm whether ODPC registration applies.

**Fraud controls:** fake listings, property impersonation, payment-screenshot fraud, non-delivery, duplicate listings, fake reviews, account takeover, collusive refunds. Combine prevention, monitoring, reporting, investigation, and proportionate enforcement.

**Open:** insurance (goods in transit, rider/passenger liability), incident response, backup/restore targets, and independent security testing before launch.

---

## Part 19 — Data architecture

**Confirmed conceptual entities.** The final schema must add relationships, constraints, indexes, RLS policies, and transaction boundaries.

| Entity | Purpose |
|---|---|
| accounts, profiles | identity and profile |
| roles, staff_capabilities | access control |
| provider_applications | application dossier |
| provider_activities | approved category permissions + transaction types + tier |
| verification_documents, verification_events | evidence, decisions, retention |
| categories, category_fields, category_activation | dynamic catalogue and local availability |
| listings, listing_media, listing_availability | offerings, media, calendars |
| inventory | stock where relevant |
| orders, order_items | purchase spine |
| bookings | appointments and reservations |
| quotations, offers | negotiated terms |
| deliveries, delivery_assignments, delivery_events | goods movement and proof |
| rides, ride_events | passenger movement |
| payment_events, payments | provider events and reconciliation |
| ledger_entries | balanced double-entry records |
| payouts, payout_items | provider settlement |
| refunds, disputes, dispute_evidence | money reversal and case management |
| messages, threads | communication |
| notifications, notification_deliveries | outbound events and retries |
| reviews | verified feedback |
| reports, moderation_cases | trust and safety |
| service_areas | coverage |
| commission_rules, commission_tiers | versioned pricing rules |
| order_financial_snapshots | immutable terms at confirmation |
| audit_events | who did what, when |
| consent_records | privacy consent and purpose |
| idempotency_keys | safe retries |
| webhook_events | replay-safe provider callbacks |

**Rules:** money as integer minor units plus currency; no floating point; immutable financial snapshots; every delivery references its order when one exists; every payout references the ledger entries it settles.

---

## Part 20 — Technical architecture principles

**Confirmed principles, stack still open.**

- **Modular monolith first.** One deployable backend with clear module boundaries: identity, catalogue, applications, orders, delivery, payments, messaging, trust, admin. Do not start with microservices.
- **PostgreSQL as the source of truth.** RLS is the last line of defence, not the only one.
- **Background jobs** for notifications, overdue checks, reconciliation, payout retries, and scheduled category changes. Use a durable queue or an outbox table.
- **Idempotency everywhere** that money or assignment is involved.
- **One API contract** shared by web, PWA, and future native apps.
- **Observability** from day one: structured logs, error tracking, payment reconciliation alerts, assignment failure alerts.

**Open:** hosting, framework specifics, file storage, SMS/email/push providers, KYC vendor, maps. Select against actual requirements, not popularity.

---

## Part 21 — Performance, reliability, accessibility

**Targets for launch:**

- usable on a low-end Android phone over a slow connection;
- responsive layouts, no layout shift from unoptimised images;
- compressed, responsive images; lazy loading below the fold;
- pagination or cursor loading; no unbounded queries;
- clear loading, empty, and error states;
- accessible forms, labels, focus states, and keyboard navigation;
- safe retry behaviour when the network drops mid-request;
- no duplicate order or ledger entry on retry.

**Open:** concrete budgets (LCP, JS weight, API p95). Set them before build, measure on a representative device.

---

## Part 22 — Analytics

**Marketplace:** active listings, active providers, new customers, searches, zero-result searches, conversion, orders, bookings.
**Operations:** application review time, delivery completion, delays, cancellations, unfulfilled requests, dispute time.
**Finance:** GMV, commission revenue, refunds, payout obligations, payment failures, reconciliation differences.
**Trust:** reports, confirmed violations, repeat complaints, fraud cases, appeals.

Always separate **GMV** from **platform revenue** and **profit**. A high transaction volume is not a business result.

---

## Part 23 — Mobile strategy

**Confirmed:** responsive website first; mobile apps later.

- **Phase 1:** responsive web + PWA. Installable, push where supported, no app-store friction.
- **Phase 2:** customer app if retention justifies it.
- **Phase 3:** transport-partner app when background location, reliable push, and the repeating alert genuinely require native capabilities.
- Provider dashboard can remain web-first; providers often work from a phone browser.

All clients use the same backend rules. No client is trusted.

---

## Part 24 — Testing and acceptance

**Required before launch:**

- **Permissions:** a food seller cannot publish property; a motorcycle cannot accept a truck job; a suspended activity cannot publish; a direct API call bypasses no check.
- **Category engine:** admin can create a category and field schema; the form renders; category search excludes unrelated listings; deactivation preserves history.
- **Applications:** activity-specific forms; second activity without a second account; rejection blocks restricted publishing; document access is audited.
- **Money:** 10% calculation at boundaries; rounding; minimum/maximum; duplicate webhooks do not double-credit; commission changes do not rewrite completed orders; refunds and payouts reconcile; negative balances handled.
- **Delivery:** one assignment only under concurrent accepts; declined jobs reassign; exact location is not exposed before acceptance; proof-of-handover rules enforced; inter-town handoff preserves custody.
- **Admin:** staff cannot exceed capabilities; sensitive actions are audited; suspensions and appeals work.
- **Security:** RLS negative tests per table; cross-account reads/writes; IDOR/BOLA; upload abuse; rate limits; session expiry.
- **Reliability:** retry storms, provider downtime, queue backlog, restore from backup, load on search and checkout.

**Open:** test tooling and CI. The repository currently has no tests, no lockfile, and CI only runs lint/typecheck/build.

---

## Part 25 — Roadmap and gates

The nine phases in v1.0 are sound. Add four gates so the project does not become waterfall.

| Gate | Exit criteria |
|---|---|
| G1. Requirements | Taxonomy, permission model, commission base, verification tiers, refund policy approved |
| G2. Architecture | Schema, state machines, payment model, hosting selected; threat model reviewed |
| G3. Thin slice | One town, products + local delivery + sandbox payment, end to end with a real seller and rider |
| G4. Pilot | Repeat usage, reconciliation clean, disputes handled, unit economics measured |

Phases 1–2 map to G1–G2. Phase 4 (foundation) plus a narrow part of Phases 5–6 maps to G3. Phases 7–8 map to G4. Phase 9 expands only after G4.

**Do not build all 126 category forms before G3.** Build the framework and three listing schemas: product, service, property. Transport jobs use their own schema.

---

## Part 26 — Decision register

| Decision | Position |
|---|---|
| Platform model | Universal multi-category marketplace, Kenya first |
| Divisions | Products, Services, Transport & Delivery, Property & Places |
| Category management | Dynamic, admin-configurable |
| Category-specific and universal search | Required |
| One account, multiple activities | Confirmed |
| Activity-scoped listing permissions | Confirmed, server-enforced |
| Provider verification | Risk-based, activity-specific |
| Contact privacy | Private by default; in-app communication |
| Commission default | 10%, configurable |
| Commission base, payer, rounding | **Open — blocking** |
| Payment provider and settlement model | **Open — blocking** |
| Refund windows and loss allocation | **Open — blocking** |
| Delivery pricing, insurance, liability | **Open — blocking before Phase 6** |
| First town and launch categories | **Open — blocking before G3** |
| Technical stack and hosting | Open — Phase 2 |
| Name and domain | Open — before public launch |
| Legal/regulatory review | Required before payments, transport, property, health |

---

## Part 27 — Next deliverable: system architecture

The architecture document should show, with real relationships:

1. customer web/PWA → API;
2. provider dashboard → API;
3. transport-partner client → API;
4. admin centre → API;
5. identity and authorization;
6. catalogue and category engine;
7. applications and verification;
8. orders, bookings, and quotes;
9. delivery matching and tracking;
10. payments, ledger, payouts, refunds;
11. PostgreSQL, object storage, queue;
12. notification and KYC integrations;
13. hosting, monitoring, backups, secrets.

Distinguish interfaces, services, data stores, external providers, and infrastructure. Do not put a technology in the diagram because it is popular.

---

## Appendix A — Open decisions that block build

| # | Decision | Recommendation | Needed by |
|---|---|---|---|
| 1 | Commission base, payer, rounding | 10% of item/service subtotal excluding delivery/tax/payment fees; deducted from provider; round to nearest KSh 1; snapshot at order | G1 |
| 2 | Low-ticket economics | Minimum commission (e.g. KSh 5), minimum basket, or customer-paid fee; model at KSh 50/100/300 | G1 |
| 3 | Payment provider and settlement | Licensed Kenyan provider with split settlement and delayed payout; if unavailable, launch enquiry-only | G2 |
| 4 | Refund windows and loss allocation | Per-category table; platform reserve for post-payout disputes | G1 |
| 5 | Delivery pricing and insurance | Zone/distance pricing; goods-in-transit cover; liability rule | Before Phase 6 |
| 6 | First town and categories | One county town; products + local delivery + services enquiries; property enquiry-only | G3 |
| 7 | Verification evidence matrix | Per activity: required documents, tier, re-check interval | G1 |
| 8 | Legal | ODPC, PSP licensing, NTSA, county, consumer, tax/VAT review | Before payments |
| 9 | Name and domain | Shortlist and verify trademarks, domains, handles | Before public launch |

---

## Appendix B — Changes from the founder's v1.0

No confirmed requirement was removed. These are structural corrections and additions:

1. **Category hierarchy corrected.** Activity is a permission record, not a level between subcategory and listing. This prevents duplicate taxonomy and makes enforcement possible.
2. **Commission base called out.** "10%" is retained, but the base, payer, rounding, minimum, and timing are now explicit open decisions. The blueprint previously said the base "must be defined" without defining it.
3. **Low-ticket warning added.** 10% of KSh 50 is likely below cost; the model needs a floor.
4. **Payout reserve added.** Refunds after payout need funded handling.
5. **Risk-tiered publishing added.** Manual review of every listing will not scale.
6. **Country/currency/timezone from day one** for the stated international ambition.
7. **Testing expanded** with RLS, webhook replay, concurrent assignment, restore, and load scenarios.
8. **Four delivery gates added** to the phase plan, with a thin slice before full build.
9. **Restricted category list added** to keep `other-*` from becoming a loophole.
10. **Staff capability model clarified**; admin is not one role.
