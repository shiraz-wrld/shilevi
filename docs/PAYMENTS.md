# Payments, commission and payouts

## What exists today

| Capability | Status | Evidence |
|---|---|---|
| Order + ride + House Hunt ledger arithmetic | **PASS — VERIFIED** | `npm run test:db` exercises migrations 0015–0021 in PGlite. |
| KSh 50 sale → KSh 5 commission → KSh 45 provider net | **PASS — VERIFIED** | Asserted in `tests/db/orders-flow.test.mjs`. |
| KSh 2,200 ride → KSh 220 commission → KSh 1,980 rider net | **PASS — VERIFIED** | Same test; both parties confirm before release. |
| KSh 20 House Hunt contact fee → platform revenue | **PASS — VERIFIED** | Same test; duplicate unlocks do not charge twice. |
| Sandbox payment (orders, rides, property) | **PASS — VERIFIED** | `confirm_mock_payment`, `confirm_mock_ride_payment`, `confirm_mock_property_unlock`; requires `payment_mode = mock` **and** `allow_mock_payments = true`. |
| Payment-method registry and readiness | **IMPLEMENTED — VERIFIED LOCALLY** | Migration 0023, `payment_methods`, `admin_set_payment_method`, `GET /api/payments/methods`, `/admin/payments/providers`. A method is offered only when enabled **and** configured on the server. |
| Private document storage | **IMPLEMENTED — NOT TESTED HOSTED** | Migration 0024 creates `provider-documents` (private) and `listing-images` (public) with folder-scoped policies. No hosted storage test has run. |
| M-Pesa STK Push initiation | **IMPLEMENTED — NOT TESTED LIVE** | `src/lib/payments/mpesa.ts`, `POST /api/payments/mpesa/initiate`. Requires Daraja credentials and an approved shortcode. |
| M-Pesa callback verification | **IMPLEMENTED — NOT TESTED LIVE** | `POST /api/payments/mpesa/callback` queries Daraja before crediting and matches the amount to the intent. |
| M-Pesa B2C payout dispatch/result | **IMPLEMENTED — NOT TESTED LIVE** | `POST /api/payments/payouts/dispatch`, `POST /api/payments/mpesa/b2c-result`. |
| Card payments | **BLOCKED — PROVIDER DECISION** | No card provider is specified in the repository. Do not invent one; choose a licensed provider first. |
| Real fund custody / split settlement | **BLOCKED — LICENSED PROVIDER** | The ledger records obligations; it does not mean Shilevi holds customer funds. Confirm the licensed settlement model before collecting. |

No live Safaricom, card or bank account was contacted while building this. The code path compiles and fails
closed, but production payment operation is not claimed.

## Payment methods and readiness

Two separate things decide whether a customer can choose a method:

1. **Owner intent** — `payment_methods.enabled`, changed only through
   `admin_set_payment_method(p_provider, p_enabled)` at `/admin/payments/providers` (owner, aal2,
   audited). `mock` is a registry entry like any other.
2. **Deployment readiness** — derived on the server from credentials
   (`src/lib/payments/providers.ts`). No secret is ever stored in the database or returned to a
   browser.

Checkout asks `GET /api/payments/methods?purpose=...`, which returns the intersection of the two.
Enabling an unconfigured provider is therefore harmless: it stays "not chargeable" and is never
offered, and the admin screen states the exact blocker. Nothing falls back from a real provider to
sandbox money.

Current readiness:

| Provider | Code | Credentials | Chargeable today |
|---|---|---|---|
| M-Pesa (STK) | Implemented | `MPESA_*` | No — credentials absent |
| Card | **Not implemented** | none | No — gateway not selected |
| Airtel Money | **Not implemented** | none | No — merchant integration not built |
| Sandbox | Implemented | none (explicit switch) | Only when the switch is on |

### The sandbox switch

`allow_mock_payments` defaults to **false** (migration 0023). Sandbox settlement requires
`payment_mode = 'mock'` **and** `allow_mock_payments = true`, so a deployment that has not been
deliberately configured takes no money and cannot be settled for free. Before launch, set
`allow_mock_payments` back to false, set `payment_mode` to the live provider, and confirm the mock
RPCs refuse (the DB test asserts exactly this).

## Money rules

- All money is integer minor units (`bigint`), currency `KES`. KSh 1 = 100 minor units.
- Commission default is **10%** of the agreed item subtotal or ride fare, configurable in
  `commission_rules` (0–5000 bps) and `platform_settings.commission_rate_bps`.
- Two distinct commission events are recorded, never merged (migration 0031):
  1. **Client payment commission** — 10% of the marketplace commissionable base, already snapshotted
     on `orders.commission_minor` / paid rides and written as the `commission` ledger pair when the
     payment is confirmed.
  2. **Deliverer payout commission** — 10% of the payout amount, written by
     `apply_payout_commission(payout_id)` as a `commission` ledger pair that references `payout_id`
     (debit `rider_payable`, credit `platform_commission`). `payouts.commission_minor`,
     `commission_rate_bps` and the generated `net_minor` record the same figures. Retries write
     nothing (unique index); a failed payout is corrected with `admin_reverse_payout_commission`,
     which posts an `adjustment` pair instead of editing history.
- Rate resolution is central: `public.commission_rate_bps(transaction_type)` reads the active
  `commission_rules` row (`client_payment`, `deliverer_payout`) and only falls back to the platform
  setting. `public.commission_split(base_minor, transaction_type)` is the single rounding
  implementation (whole currency unit, never above the base). No page hard-codes 10%.
- Ride commission uses `floor(fare × rate_bps / 10000)`, snapshotted on the paid ride.
- The commission rate is snapshotted onto the order/ride. A later rule change never rewrites a
  paid transaction.
- Delivery prices are **never** invented. `quote_delivery(...)` prices a shipment only from an
  active owner-configured `delivery_pricing_rules` row that matches the route and vehicle class; with
  no matching rule it raises instead of returning a number. The quote is stored in `delivery_quotes`
  with the rule id and version, its components, expiry and the
  `delivery_fee = rider_fee + platform_fee` split. `attach_delivery_quote_to_order` moves that
  snapshot onto the unpaid order and shipment exactly once (a consumed quote is refused), so
  `mark_order_paid` still books the same split afterwards.
- Delivery has its own split (`delivery_fee = rider_fee + platform_fee`).
- The House Hunt KSh 20 is **platform revenue**, not landlord income.
- Ledger entries are double-entry: every transaction balances, settlement nets to zero, and each
  row has exactly one subject (order, ride, property unlock or payout).
- Provider/rider payouts debit `rider_payable` and credit `platform_cash` when the provider confirms
  the payout. A payout is never marked paid from a browser action.
- Available rider balance = `rider_payable` credits minus paid/processing withdrawals. Pending
  withdrawals are reserved immediately.

### Commission decision

The rate is **10%** on client payment transactions and **10%** on deliverer payout transactions
(owner decision; `DEFAULT_COMMISSION_RATE_BPS = 1000`, seeded `client-payment-commission` and
`deliverer-payout-commission`). 20% is no longer the default anywhere in code. Per-category and
per-division overrides are possible through `commission_rules` without touching code, and any
change is audited through the owner console rather than edited in a page.

## Flow: customer pays with M-Pesa

1. The customer is authenticated and has an unpaid order, agreed ride, or eligible property.
2. `POST /api/payments/mpesa/initiate` validates same-origin, rate limits, and creates a
   `payment_intents` row through a database RPC. The amount comes from the database, never the body.
3. The server obtains a Daraja OAuth token and sends STK Push to the customer's phone.
4. `CheckoutRequestID` is stored as `payment_intents.provider_reference`.
5. Safaricom calls `POST /api/payments/mpesa/callback`.
6. The handler parses the callback, then **queries Daraja** (`stkpushquery`) and requires
   `ResultCode = 0`. A forged POST alone cannot credit a payment.
7. The amount must equal the intent amount.
8. The service-role RPC `confirm_provider_payment` marks the intent succeeded and calls the same
   domain function the sandbox uses (`mark_ride_paid`, `complete_property_unlock`, `mark_order_paid`).
9. Duplicate callbacks are idempotent: an already-succeeded intent returns without a second charge
   or ledger entry.

If callbacks cannot be verified because Daraja is unreachable, the route returns 500 so Safaricom
retries. It never guesses success.

## Flow: rider withdrawal

1. Rider requests a payout (`request_rider_payout`), minimum KSh 100, against the ledger balance.
2. A `payouts` row is created `pending`; the balance is reserved.
3. Owner (with MFA) dispatches `POST /api/payments/payouts/dispatch`.
4. Daraja B2C returns `ConversationID`; the payout is stored `processing` with that reference.
   Already-processing payouts are never re-sent.
5. Safaricom posts the result to `/api/payments/mpesa/b2c-result`.
6. The service-role `confirm_provider_payout` marks the payout `paid` and writes the ledger only on
   a successful result. A failure marks it `failed` and releases the reserve.

## Environment variables

Set these in Vercel → Project → Settings → Environment Variables (Production/Preview as
appropriate). Never prefix them with `NEXT_PUBLIC_`.

```text
SUPABASE_SERVICE_ROLE_KEY=

MPESA_ENV=sandbox                 # switch to production only after approval
MPESA_CONSUMER_KEY=
MPESA_CONSUMER_SECRET=
MPESA_SHORTCODE=
MPESA_PASSKEY=
MPESA_CALLBACK_URL=https://shilevi.app/api/payments/mpesa/callback
MPESA_TRANSACTION_TYPE=CustomerPayBillOnline
MPESA_VERIFY_CALLBACK=true

MPESA_B2C_INITIATOR=
MPESA_B2C_SECURITY_CREDENTIAL=
MPESA_B2C_SHORTCODE=
MPESA_B2C_RESULT_URL=https://shilevi.app/api/payments/mpesa/b2c-result
MPESA_B2C_TIMEOUT_URL=https://shilevi.app/api/payments/mpesa/b2c-result
```

`MPESA_B2C_SECURITY_CREDENTIAL` is the RSA-encrypted initiator credential generated against the
Safaricom certificate for the selected environment. It is not the consumer secret and must not be
generated in the browser.

## Activation checklist

1. Apply migrations `0001`–`0024` in order in Supabase. `0022` restricts rider balance reads, `0023`
   adds the sandbox switch and the payment-method registry, and `0024` adds storage buckets.
2. Decide the sandbox switch deliberately. On a fresh database `allow_mock_payments` is false, so no
   method is chargeable until a real provider is configured. For a staging demo, set
   `payment_mode = 'mock'` and `allow_mock_payments = 'true'` in `platform_settings`; before launch,
   set `allow_mock_payments` back to false and `payment_mode` to the live provider. Then enable the
   provider in `/admin/payments/providers`.
3. Obtain a Daraja app with the correct shortcode/product (PayBill or Till), passkey and callback
   URL. Sandbox credentials cannot charge real money.
4. Set all five STK variables. Call `POST /api/payments/mpesa/initiate` in staging:
   - unauthenticated → 401
   - mock mode → 409
   - missing config → 503
5. Run a sandbox STK test with a Safaricom test number. Confirm:
   - the intent moves `created → pending → succeeded`;
   - the ride/order unlocks only after the verified callback;
   - replaying the same callback does not create another ledger entry;
   - a wrong amount is rejected.
6. For B2C, obtain the initiator name, encrypted credential and B2C shortcode. Dispatch a test payout
   and confirm the result callback writes exactly one debit.
7. Switch `MPESA_ENV=production` only with production credentials and an approved go-live. Run one
   controlled live transaction, reconcile it against the M-Pesa statement, and record the result.
8. Do not mark the platform "payments live" until step 7 succeeds.

## Database functions

- `create_payment_intent(p_purpose, p_target_id, p_idempotency_key)` — order/ride intent from the
  database amount, idempotent per key.
- `create_property_payment_intent(p_listing_id)` — reuses a live unlock intent; refuses if already
  unlocked.
- `attach_payment_provider_reference(...)` — owner-only; records the Daraja checkout id.
- `confirm_provider_payment(p_provider, p_provider_reference, p_amount_minor, p_payload)` — service
  role only; amount-checked and idempotent.
- `mark_ride_paid`, `mark_order_paid`, `complete_property_unlock` — internal settlement.
- `request_rider_payout`, `rider_available_balance` — rider-scoped.
- `admin_update_payout`, `confirm_provider_payout` — owner / service-role settlement.

## Card and Airtel Money (not implemented)

No card provider is named in the specification, and the integration catalog returned no gateway
matching the requirement (Visa/Mastercard hosted checkout, mobile money, webhooks, refunds, Kenya),
so no adapter was written. Inventing an API contract would produce code that looks integrated and
is not.

Both providers are registered in `payment_methods` with a permanent, explicit blocker, and both are
unreachable at checkout because readiness is false. To activate either one:

1. Choose a licensed gateway or PSP that supports Kenyan merchants, hosted/tokenised checkout, signed
   webhooks, refunds and the settlement model Shilevi intends. Confirm PCI scope in writing.
2. Record the decision, merchant account, callback URLs and refund policy in this document.
3. Implement the adapter behind `src/lib/payments/providers.ts` and an `initiate`/`verify` route that
   follows the same lifecycle as M-Pesa: intent first, amount from the database, authoritative
   verification, idempotent confirmation, server-only settlement.
4. Extend `confirm_provider_payment` if a new provider value is needed (the `payment_intents.provider`
   constraint already accepts `airtel_money`), then run the RLS suite and a low-value live test.

Never store raw card numbers, CVVs or wallet PINs. Use the provider's hosted or tokenised flow only.

## Known limitations

- In-memory rate limiting is per instance, not distributed.
- No daily automated reconciliation job exists yet; the admin payments page is a manual view over
  the last 2,000 ledger rows.
- Ride refunds/disputes after payment are marked `refund_pending` and need an owner process; there
  is no dedicated ride refund RPC yet (order refunds already exist).
- Test coverage is local PostgreSQL (PGlite). No live Daraja test has been run.
- The sandbox switch, payment-method registry and storage policies are covered only by local tests;
  hosted storage and hosted RLS remain unverified until a staging project exists.
- Card and Airtel Money have no adapter, by explicit decision, and are blocked at checkout.
