# Decisions and Open Questions

## Confirmed direction
- Product name: Shilevi.
- Separate from Zurify.
- Start in Kenya, with architecture ready for future expansion.
- Web app first; mobile-first UX.
- Preferred hosting: Vercel.
- Preferred backend/database/auth/storage: Supabase.
- Four main divisions: Products; Services; Transport & Delivery; Property & Places.
- One account may apply for multiple provider activities, each approved independently.
- Target standard commission: 10% on a disclosed, defined base; configurable and versioned.
- Admin access restricted to exactly two owner email addresses.
- Integrations should use adapters and safe server-side credential management.

## Required before production
- Two owner email addresses and MFA setup.
- Supabase organization/project, region and billing approval.
- Official payment provider choice, supported marketplace settlement model, fee schedule and legal review.
- Exact business/legal entity, support contacts and policy review.
- Map/geocoding provider and usage budget.
- Email/SMS providers and sender/domain verification.
- Initial service areas, supported currencies and languages.
- Cancellation/refund/dispute rules, delivery safety and payout timelines.
- Provider verification requirements by activity.
- Confirm data retention, deletion and cross-border data handling.

## Non-assumptions
- Do not assume a regulated escrow arrangement is permitted.
- Do not assume all payment providers support marketplace split settlement or delayed release.
- Do not assume KRA/identity verification APIs are public or that access is approved.
- Do not enable real payments or production provider access before test and compliance review.
