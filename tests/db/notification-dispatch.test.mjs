/**
 * Database test for the notification dispatch claim contract (migration 0039).
 *
 * Two real defects motivated this function, and each one is asserted here:
 *
 *  1. Channel starvation. The email dispatcher selected `notification_outbox` rows without a
 *     channel filter and then marked anything that was not email as `skipped`. Once migration 0038
 *     started queueing `channel = 'push'` rows, the email drain would consume them and mark them
 *     terminal, so a push notification could never be delivered. A claim must be scoped to exactly
 *     one channel and must leave other channels' rows alone.
 *  2. Lost claims. A row was flipped to `sending` before delivery, but nothing ever selected
 *     `sending` again. A request killed mid-flight (deploy, timeout, crash) therefore lost the
 *     notification permanently. A claim now takes a lease, and an expired lease is released for a
 *     bounded retry instead of disappearing.
 *
 * Run with: npm run test:db
 */
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const db = new PGlite();

// The outbox definition from migration 0021, verbatim in shape. Migration 0039 is the only file
// replayed, so its dependency is stubbed rather than re-running the whole chain (that is
// tests/db/migrations-full.test.mjs's job).
await db.exec(`
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;

create table public.notification_outbox (
  id bigserial primary key,
  user_id uuid,
  channel text not null default 'email' check (channel in ('email','sms','push')),
  template text not null,
  recipient text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued','sending','sent','failed','skipped')),
  attempts integer not null default 0 check (attempts between 0 and 20),
  last_error text,
  next_attempt_at timestamptz not null default now(),
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
`);

const migration = fs.readFileSync(
  path.join(repoRoot, "supabase/migrations/0039_notification_dispatch_leases.sql"),
  "utf8",
);
await db.exec(migration);

let checks = 0;
function ok(condition, message) {
  assert.ok(condition, message);
  checks += 1;
}

const claim = async (channel, limit = 20, lease = 900) =>
  (
    await db.query("select * from public.claim_notification_batch($1, $2, $3)", [
      channel,
      limit,
      lease,
    ])
  ).rows;

const enqueue = async (channel, template, options = {}) =>
  (
    await db.query(
      `insert into public.notification_outbox
         (channel, template, recipient, status, attempts, next_attempt_at)
       values ($1, $2, $3, $4, $5, coalesce($6::timestamptz, now()))
       returning id`,
      [
        channel,
        template,
        options.recipient ?? null,
        options.status ?? "queued",
        options.attempts ?? 0,
        options.nextAttemptAt ?? null,
      ],
    )
  ).rows[0].id;

// ---------------------------------------------------------------- channel scoping

const pushOffer = await enqueue("push", "delivery.offer");
const emailReceipt = await enqueue("email", "order.paid", { recipient: "a@example.com" });

const firstPush = await claim("push");
ok(firstPush.length === 1, "a push claim returns exactly the push row");
ok(firstPush[0].id === Number(pushOffer), "the push row is the one that was queued");
ok(firstPush[0].channel === "push", "a push claim never returns another channel");
ok(firstPush[0].status === "sending", "a claimed row is marked sending");
ok(Number(firstPush[0].attempts) === 1, "a claim counts the attempt it just took");

const emailUntouched = await db.query(
  "select status, attempts from public.notification_outbox where id = $1",
  [emailReceipt],
);
ok(emailUntouched.rows[0].status === "queued", "a push claim leaves queued email rows untouched");
ok(Number(emailUntouched.rows[0].attempts) === 0, "a push claim does not consume email attempts");

const secondPush = await claim("push");
ok(secondPush.length === 0, "a row under an active lease is never claimed twice");

const firstEmail = await claim("email");
ok(firstEmail.length === 1 && firstEmail[0].id === Number(emailReceipt), "the email claim takes only the email row");
ok(firstEmail[0].recipient === "a@example.com", "the claimed row carries its recipient for delivery");

// ---------------------------------------------------------------- due dates and ordering

const future = await enqueue("push", "ride.proposal", {
  nextAttemptAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
});
const due = await enqueue("push", "job.assigned");
const dueRows = await claim("push");
ok(dueRows.length === 1 && dueRows[0].id === Number(due), "a claim skips rows whose next attempt is in the future");

await db.query("update public.notification_outbox set next_attempt_at = now() where id = $1", [future]);
const afterDue = await claim("push");
ok(afterDue.length === 1 && afterDue[0].id === Number(future), "a row becomes claimable when it falls due");

// ---------------------------------------------------------------- lease expiry (the lost-claim fix)

const abandoned = await enqueue("push", "job.assigned", { status: "sending", attempts: 1 });
// The dispatcher that took this lease is gone, and the lease it took has run out.
await db.query(
  "update public.notification_outbox set next_attempt_at = now() - interval '1 minute' where id = $1",
  [abandoned],
);

const reclaimed = await claim("push");
const reclaimedRow = reclaimed.find(row => row.id === Number(abandoned));
ok(reclaimedRow !== undefined, "a claim releases a row whose dispatcher died mid-flight");
ok(Number(reclaimedRow.attempts) === 2, "the released row is retried with its attempt count advanced");
ok(reclaimedRow.status === "sending", "the released row is claimed again rather than left terminal");

const leaseHeld = await claim("push");
ok(!leaseHeld.some(row => row.id === Number(abandoned)), "a reclaimed row is not handed to a second dispatcher");

const stillSending = await db.query(
  "select status from public.notification_outbox where id = $1",
  [abandoned],
);
ok(stillSending.rows[0].status === "sending", "a live lease is not released");

// ---------------------------------------------------------------- bounded retries

const exhausted = await enqueue("push", "job.assigned", { status: "sending", attempts: 5 });
await db.query(
  "update public.notification_outbox set next_attempt_at = now() - interval '1 minute' where id = $1",
  [exhausted],
);
await claim("push");

const exhaustedRow = await db.query(
  "select status, last_error, attempts from public.notification_outbox where id = $1",
  [exhausted],
);
ok(exhaustedRow.rows[0].status === "skipped", "a row out of attempts is retired instead of retried forever");
ok(
  typeof exhaustedRow.rows[0].last_error === "string" && exhaustedRow.rows[0].last_error.length > 0,
  "the retired row records why it stopped",
);
ok(Number(exhaustedRow.rows[0].attempts) === 5, "retiring a row does not inflate its attempt count");

const capped = await claim("push");
ok(!capped.some(row => row.id === Number(exhausted)), "an exhausted row is never claimed again");

const exhaustedQueued = await enqueue("push", "job.assigned", { attempts: 5 });
const noFifthAttempt = await claim("push");
ok(
  !noFifthAttempt.some(row => row.id === Number(exhaustedQueued)),
  "a queued row already at the attempt ceiling is not claimed",
);
const retiredQueued = await db.query(
  "select status from public.notification_outbox where id = $1",
  [exhaustedQueued],
);
ok(
  retiredQueued.rows[0].status === "skipped",
  "a queued row at the attempt ceiling is retired rather than left queued for ever",
);

// ---------------------------------------------------------------- batch limits and validation

for (let i = 0; i < 5; i += 1) await enqueue("push", "job.assigned");
const bounded = await claim("push", 2);
ok(bounded.length === 2, "a claim never exceeds the requested batch size");

await assert.rejects(
  db.query("select * from public.claim_notification_batch('', 20, 900)"),
  /A channel is required/,
  "an empty channel is rejected rather than matching every channel",
);
await assert.rejects(
  db.query("select * from public.claim_notification_batch(null, 20, 900)"),
  /A channel is required/,
  "a null channel is rejected",
);

// ---------------------------------------------------------------- authorization

await db.exec("set role authenticated");
await assert.rejects(
  db.query("select * from public.claim_notification_batch('push', 20, 900)"),
  /permission denied/,
  "an authenticated browser session cannot claim the queue",
);
await db.exec("reset role");

await db.exec("set role anon");
await assert.rejects(
  db.query("select * from public.claim_notification_batch('push', 20, 900)"),
  /permission denied/,
  "an anonymous visitor cannot claim the queue",
);
await db.exec("reset role");

await db.exec("set role service_role");
const asService = await claim("push", 1);
ok(asService.length === 1, "the server-side dispatcher role can claim the queue");
await db.exec("reset role");

console.log("notifications: one channel per claim, no cross-channel starvation, leases released, retries bounded, queue not callable from a browser");
console.log(`notification dispatch checks passed (${checks} assertions)`);
