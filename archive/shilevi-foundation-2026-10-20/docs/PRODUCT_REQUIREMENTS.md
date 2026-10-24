# Shilevi — Product Requirements

## Product goal
Build a Kenya-first, globally extensible marketplace that connects customers with approved sellers, service providers, transport partners, property owners, and venue/accommodation providers.

## Main divisions
1. Products
2. Services
3. Transport & Delivery
4. Property & Places

## Account and provider model
- A person can have one customer account and apply for multiple provider activities.
- Each activity (for example, selling fashion, providing plumbing services, or listing property) has its own application, verification requirements, and approval status.
- Approval for one activity never grants automatic approval for another.
- Public browsing is allowed where safe; private contact details and sensitive location information must not be publicly exposed.
- Staff permissions must be least-privilege and distinct from owner/admin permissions.

## Customer journeys
- Browse/search/filter listings by category and supported location.
- Review a listing, seller/provider profile, pricing, availability, delivery options, and relevant terms.
- Request a quote or booking when the category requires it.
- Confirm the exact total and itemized charges before payment.
- Follow order/booking status, communicate through the platform, report issues, and raise a dispute.
- Confirm delivery/completion using an appropriate method; reviews are optional and must not block completion.

## Seller and service-provider journeys
- Apply for each activity independently and submit only necessary verification data.
- Wait for approval before publishing restricted listings.
- Create and manage listings with category-specific, validated attributes.
- Respond to quote/booking requests and clearly disclose price, delivery, availability, cancellation and refund terms.
- Track orders, earnings, refunds, and payout status.

## Delivery flow
1. Seller/customer agree to exact product price, delivery fee, and total before proceeding.
2. Eligible nearby riders receive a limited offer with approximate pickup area, parcel details, and delivery fee.
3. Seller selects from eligible interested riders; assignment is atomic so only one rider gets the job.
4. Precise pickup/destination details are disclosed only to the assigned rider when needed.
5. Rider records pickup, starts location sharing for the active delivery, and completes handover with a PIN or suitable proof.
6. Customer confirms receipt; completion and settlement follow the published transaction policy.
7. Rating is optional and does not gate completion or payout.
8. Include cancellation, failed delivery, no-show, customer unavailable, safety escalation, and dispute flows.

## Commercial model
- Initial standard Shilevi commission target: 10% of a clearly defined, disclosed commission base.
- Commission rules must be configurable, versioned with effective dates, and audited.
- Never retroactively change the agreed fee for a confirmed transaction.
- Separate product/service price, delivery fee, platform commission, taxes/other charges, refunds, provider proceeds, and rider proceeds in the financial ledger.
- Do not represent ordinary company-account funds as regulated escrow. Use provider-supported marketplace settlement and obtain Kenyan legal/payment compliance advice.

## Admin requirements
Admin modules should include overview; users and sessions; roles/permissions; staff; provider applications and verification; categories and dynamic attributes; listings and moderation; orders/bookings; delivery and rider operations; payments and reconciliation; commissions; refunds and payouts; disputes/reviews/reports; promotions; service areas; integrations and feature flags; support; analytics; security/fraud; audit logs.
- Owner-only access is restricted server-side to two explicitly configured owner emails (not yet supplied).
- High-risk actions require re-authentication where appropriate and produce immutable or append-only audit records.
- Category creation/editing should not require source-code changes but must use validated field types and constraints; never execute user-supplied code.

## Legal and trust
Prepare Terms of Service, Privacy Policy, cookie preferences, cancellation/refund/dispute policy, seller/provider terms, delivery/rider safety rules, prohibited listings and moderation policy, fee disclosures, support/complaints contact, and accessible consent flows. Legal text must be reviewed for Kenyan law and target markets before launch.

## Quality gates
- Automated unit, integration, and end-to-end tests.
- Authorization and tenant-isolation tests for every role and sensitive operation.
- Payment webhook signature, idempotency, and reconciliation tests.
- No duplicate rider assignment; precise-location privacy tests.
- Responsive/mobile accessibility and performance tests.
- Security scan, dependency review, backup/restore rehearsal, and documented incident process before launch.
