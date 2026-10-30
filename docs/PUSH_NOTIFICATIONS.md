# Web push — configuration and verification

Push is the third notification channel next to the in-app inbox and email. It is implemented in
code, but it is **inert until a VAPID key pair and a scheduler are configured**. Nothing in the
application pretends a push was delivered when it was not: the dispatcher refuses to run without
keys, and rows stay queued.

## What is implemented

| Piece | Where |
|---|---|
| `push_subscriptions` table, own-row RLS, subscribe/revoke/list functions | `supabase/migrations/0038_web_push_subscriptions.sql` |
| One push row per event (`channel = 'push'`) when the recipient has a live subscription | `enqueue_notification()` in the same migration |
| Shared title/body/deep-link rendering used by the inbox **and** push | `render_notification()` |
| Offer and ride-proposal notifications | `delivery_offers_enqueue_notification`, `ride_offers_enqueue_notification` |
| Channel-scoped, lease-based queue claim used by both dispatchers | `supabase/migrations/0039_notification_dispatch_leases.sql` |
| Dispatcher with claim, retry and stale-subscription cleanup | `src/app/api/notifications/push/dispatch/route.ts` |
| Service worker (push + notification click only, no caching) | `public/sw.js` |
| Browser helpers (permission on click, subscribe, unsubscribe) | `src/lib/push/client.ts` |
| Opt-in control on the inbox | `src/components/notifications/PushOptIn.tsx` on `/account/notifications` |

Design notes:

- Permission is requested **only** from the “Enable push notifications” button. It is never
  requested on page load.
- The endpoint is unique and bound to the account that registered it. A second account using the
  same browser is refused, so one device cannot receive another account's jobs.
- A subscription that the browser reports as gone (`404`/`410`) is revoked and never retried.
  Other failures retry with exponential backoff up to five attempts, then stop.
- Rows are claimed through `claim_notification_batch(channel, limit, lease)` (migration `0039`).
  The claim is scoped to one channel, counts the attempt, and leases the row. A dispatcher that is
  killed mid-flight therefore loses its lease instead of the notification: when the lease expires
  (ten minutes) the next run retries the row. Before `0039`, the email drain read the table without
  a channel filter and retired every push row as “no usable email recipient”, and a row left in
  `sending` by a crash was never selected again.
- One queued row is fanned out to every live subscription on the account, so a retry cannot deliver
  the same offer twice to the same device.
- Notification text is generated from a template and known fields only: numbers, statuses, an expiry
  and a deep link. It never contains a customer's address, phone number or a document.
- The service worker caches nothing. An offline cache of authenticated pages could show one
  account's data to the next person using the device.

## Setup

1. Generate a key pair once, and keep the private key server-side:

   ```bash
   npx web-push generate-vapid-keys
   ```

2. Set these environment variables in Vercel (Preview and Production) and in `.env.local`:

   | Variable | Scope | Purpose |
   |---|---|---|
   | `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | public | Browser subscribes with it. Requires a new build. |
   | `VAPID_PRIVATE_KEY` | **server only** | Signs delivery. Never expose or commit it. |
   | `VAPID_SUBJECT` | server only | `mailto:` contact for the push service, e.g. `mailto:support@shilevi.com`. |
   | `NOTIFICATION_DISPATCH_SECRET` | server only | Shared secret for the dispatcher endpoint. |
   | `CRON_SECRET` | server only | Optional: lets a Vercel Cron invocation authenticate with its bearer token. |

3. Apply migrations `0037`–`0039` before the code that calls them; the dispatchers require
   `claim_notification_batch()` to exist. A missing function fails closed (`Queue could not be
   read.`) with rows left queued and reported in the response, never as delivered.

4. Invoke the dispatcher on a schedule. It accepts `POST` (or `GET` for schedulers) with either
   header:

   ```bash
   curl -X POST https://<origin>/api/notifications/push/dispatch \
     -H "x-dispatch-secret: $NOTIFICATION_DISPATCH_SECRET"
   ```

   Any scheduler that can send a header works: GitHub Actions, Supabase `pg_cron` + `pg_net`,
   cron-job.org, or a Vercel Cron job on a plan that allows the frequency (Vercel sets
   `Authorization: Bearer $CRON_SECRET` on cron requests when that variable exists).

   The dispatcher is deliberately not callable from a browser and requires the service role.

4. Redeploy, then sign in on a phone, open `/account/notifications`, and press **Enable push
   notifications**.

## Verification (must be done on a real device)

These checks cannot be simulated locally and are **not** claimed as done:

1. On a supported browser (Chrome/Edge/Firefox on Android or desktop; Safari 16.4+ on iOS requires
   the site to be added to the Home Screen), press the button and accept the permission prompt.
2. Confirm one row appears in `push_subscriptions` for that account with `revoked_at` null.
3. As an owner, approve a deliverer application so a real shipment can be offered, and trigger a
   real offer through `offer_delivery_to_candidates`.
4. Confirm the notification arrives with the tab **closed** and the phone locked, and that tapping it
   opens `/deliver/jobs`.
5. Confirm a second account on the same browser cannot claim the endpoint, and that
   `revoke_push_subscription` stops further deliveries.
6. Confirm the outbox row moves `queued → sending → sent` and that a device returning `410` is
   revoked.

## Known limits

- iOS requires the site to be installed on the Home Screen before web push is available.
- With `VAPID_PRIVATE_KEY` unset, `POST /api/notifications/push/dispatch` returns `503` and leaves
  rows queued — that is the intended failure, not a bug.
- Email delivery additionally requires `RESEND_API_KEY`; without it, messages are recorded in the
  inbox and never mailed.
