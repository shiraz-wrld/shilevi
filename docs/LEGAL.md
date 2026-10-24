# Legal pages

## Status: drafted, not reviewed

The legal pages under `src/app/legal/` describe how the product actually behaves. They are **not**
legal advice and they have not been reviewed by a Kenyan advocate. Do not remove the "working
draft" notice on each page, and do not present the platform as launch-ready, until counsel has
reviewed them and the placeholders below are filled in.

## Documents

| Route | Purpose | Depends on |
|---|---|---|
| `/legal` | Index of every document with update date and contact routes | Keep in sync with the documents list |
| `/legal/terms` | Customer and general marketplace terms | Entity details, dispute process, liability position |
| `/legal/privacy` | Data Protection Act 2019 notice | ODPC registration, retention schedule, processor list |
| `/legal/cookies` | Storage actually used | Current cookie names; update before adding analytics |
| `/legal/refunds` | Returns, disputes and payout holds | Category-specific return windows |
| `/legal/provider-agreement` | Seller, service, transport and property terms | Commission, payout timing, verification requirements |
| `/legal/acceptable-use` | Prohibited items and behaviour | Category policy for restricted goods |

Supporting public pages: `/support`, `/help`, `/about`, `/security`, `/how-it-works`
(product and provider journey), `/pricing` (commission and fees), `/safety` (address privacy,
handover and reporting) and `/accessibility` (commitment and known gaps). These describe the same
behaviour as the legal documents and must be updated in the same change when a policy moves.

## Placeholders to replace before launch

- **Legal entity.** The pages say "Shilevi" and do not name a registered company. Add the registered
  name, company number and registered address once registration completes.
- **Contact addresses.** `support@`, `privacy@` and `security@` come from `src/lib/site.ts`, which
  reads `NEXT_PUBLIC_SUPPORT_EMAIL`, `NEXT_PUBLIC_PRIVACY_EMAIL` and `NEXT_PUBLIC_SECURITY_EMAIL`.
  Defaults are placeholders — send and receive a test message on each before launch.
- **ODPC registration.** Kenya's Data Protection Act requires registration as a data controller for
  certain processing. Confirm the position with counsel and record the registration number.
- **Payment and fund-holding.** The terms describe funds being held by a licensed provider or its
  partner bank. That is only true once such a provider is contracted. Until then, checkout is
  sandbox and the pages say so.
- **Consumer returns.** The refunds page refers to a window "shown on the order page". The actual
  number must be decided per category and configured, not left implicit.
- **Tax.** The provider agreement puts tax responsibility on the provider. Confirm VAT treatment for
  commission and delivery fees.
- **Insurance.** The provider agreement does not yet require goods-in-transit or liability cover.
  Decide whether it should before transport goes live.

## Rules

1. **Do not describe a sandbox as a live payment.** Checkout, help and the terms all state the
   difference. Keep that true when a provider is connected: the page must read from the configured
   mode, not a hard-coded sentence.
2. **Do not add analytics or advertising without updating `/legal/cookies` first.** The current
   notice says no analytics cookies are set; making that false is a compliance problem, not a copy
   problem.
3. **Every private route stays out of search.** Legal pages are public by design; account, order,
   checkout and admin pages are not.
4. **Deletion is a reviewed request.** The privacy notice says so. If automatic deletion is added,
   update the notice and the account-settings wording in the same change.

## Review checklist

- [ ] Kenyan advocate reviews all six documents.
- [ ] Entity name, number and address inserted.
- [ ] ODPC registration confirmed and recorded.
- [ ] Retention periods agreed with finance (tax) and operations (disputes).
- [ ] Payment provider contract checked against the money and settlement wording.
- [ ] Refund windows configured per category and reflected in `/legal/refunds`.
- [ ] Privacy notice lists the actual processors in use (hosting, database, auth, email, SMS,
      payment, maps, storage).
- [ ] "Working draft" notice removed only after the above.
