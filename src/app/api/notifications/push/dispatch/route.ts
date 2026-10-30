import "server-only";

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import webpush from "web-push";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { hasServiceRole, isPushConfigured, serverEnv } from "@/lib/env.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BATCH = 20;
const TTL_SECONDS = 600;
/** How long a claimed batch belongs to this invocation before another dispatcher may retry it. */
const LEASE_SECONDS = 600;
const MAX_ATTEMPTS = 5;

function matches(provided: string, expected: string | null): boolean {
  if (!expected || !provided) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * A scheduler may authenticate with either the dispatch secret or, on Vercel, the `CRON_SECRET`
 * bearer token that the platform sets automatically on cron invocations.
 */
function authorized(request: Request): boolean {
  const headerSecret = request.headers.get("x-dispatch-secret") ?? "";
  if (matches(headerSecret, serverEnv.notificationDispatchSecret)) return true;
  const bearer = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  return matches(bearer, serverEnv.cronSecret);
}

type PushSubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  failure_count: number;
};

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * POST /api/notifications/push/dispatch
 *
 * Drains a bounded batch of `channel = 'push'` rows from `notification_outbox`. Like the email
 * dispatcher it is not callable from a browser: it needs the server-held dispatch secret and the
 * service role. The title, body and deep link come from `render_notification()`, the same function
 * the in-app inbox uses, so the two channels cannot drift.
 *
 * Rows are claimed through `claim_notification_batch()` (migration 0039), which scopes the batch to
 * this channel, counts the attempt, and leases each row. That is what makes a killed invocation safe:
 * the lease expires and the row is retried instead of being stuck in `sending` for ever.
 *
 * One queued row is fanned out to every live subscription on the account. A browser that reports
 * 404/410 is revoked and never retried; any other failure is retried with exponential backoff up to
 * five attempts. A row is only marked `sent` when at least one device accepted it.
 */
async function run(request: Request) {
  if (!authorized(request)) return noStore({ error: "Not authorized." }, 401);
  if (!hasServiceRole()) return noStore({ error: "Service role is not configured." }, 503);
  if (!isPushConfigured()) {
    console.error("[push] dispatch refused: VAPID keys are not configured");
    return noStore(
      { error: "Push is not configured. Set NEXT_PUBLIC_VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY. Rows stay queued." },
      503,
    );
  }

  webpush.setVapidDetails(serverEnv.vapidSubject, serverEnv.vapidPublicKey as string, serverEnv.vapidPrivateKey as string);

  const supabase = createSupabaseServiceClient();
  const now = new Date().toISOString();

  const { data: rows, error } = await supabase.rpc("claim_notification_batch", {
    p_channel: "push",
    p_limit: MAX_BATCH,
    p_lease_seconds: LEASE_SECONDS,
  });

  if (error) {
    console.error("[push] queue claim failed", { code: error.code });
    return noStore({ error: "Queue could not be read." }, 500);
  }

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of (rows ?? []) as {
    id: number;
    user_id: string | null;
    template: string;
    payload: Record<string, unknown> | null;
    attempts: number;
  }[]) {
    // The claim already counted this attempt.
    const attempts = Number(row.attempts ?? 1);

    if (!row.user_id) {
      await supabase
        .from("notification_outbox")
        .update({ status: "skipped", attempts, last_error: "No recipient." })
        .eq("id", row.id);
      skipped += 1;
      continue;
    }

    const { data: subscriptions } = await supabase
      .from("push_subscriptions")
      .select("id,endpoint,p256dh,auth,failure_count")
      .eq("user_id", row.user_id)
      .is("revoked_at", null);

    const targets = (subscriptions ?? []) as PushSubscriptionRow[];
    if (targets.length === 0) {
      await supabase
        .from("notification_outbox")
        .update({ status: "skipped", attempts, last_error: "No live push subscription." })
        .eq("id", row.id);
      skipped += 1;
      continue;
    }

    const { data: rendered, error: renderError } = await supabase.rpc("render_notification", {
      p_template: row.template,
      p_payload: row.payload ?? {},
      p_uid: row.user_id,
    });

    if (renderError || !rendered) {
      console.error("[push] render failed", { code: renderError?.code });
      await supabase
        .from("notification_outbox")
        .update({
          status: attempts >= MAX_ATTEMPTS ? "skipped" : "failed",
          attempts,
          last_error: "Notification could not be rendered.",
          next_attempt_at: new Date(Date.now() + Math.min(2 ** attempts, 60) * 60_000).toISOString(),
        })
        .eq("id", row.id);
      failed += 1;
      continue;
    }

    const message = JSON.stringify({
      title: rendered.title,
      body: rendered.body,
      url: rendered.link,
      tag: `shilevi-${row.id}`,
    });

    let delivered = 0;
    let lastError = "";

    for (const subscription of targets) {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          message,
          { TTL: TTL_SECONDS },
        );
        delivered += 1;
        await supabase
          .from("push_subscriptions")
          .update({ failure_count: 0, last_success_at: now, last_seen_at: now })
          .eq("id", subscription.id);
      } catch (cause) {
        const statusCode = (cause as { statusCode?: number }).statusCode;
        lastError = (cause instanceof Error ? cause.message : "Delivery failed").slice(0, 300);

        if (statusCode === 404 || statusCode === 410) {
          // The browser has dropped this subscription. Revoke it so it is never retried.
          await supabase
            .from("push_subscriptions")
            .update({
              revoked_at: now,
              last_failure_at: now,
              failure_count: Number(subscription.failure_count ?? 0) + 1,
            })
            .eq("id", subscription.id);
        } else {
          await supabase
            .from("push_subscriptions")
            .update({
              last_failure_at: now,
              failure_count: Number(subscription.failure_count ?? 0) + 1,
            })
            .eq("id", subscription.id);
        }
      }
    }

    if (delivered > 0) {
      await supabase
        .from("notification_outbox")
        .update({ status: "sent", sent_at: new Date().toISOString(), attempts, last_error: null })
        .eq("id", row.id);
      sent += 1;
    } else {
      await supabase
        .from("notification_outbox")
        .update({
          status: attempts >= MAX_ATTEMPTS ? "skipped" : "failed",
          attempts,
          last_error: lastError || "No device accepted the message.",
          next_attempt_at: new Date(Date.now() + Math.min(2 ** attempts, 60) * 60_000).toISOString(),
        })
        .eq("id", row.id);
      failed += 1;
    }
  }

  return noStore({ processed: sent + failed + skipped, sent, failed, skipped });
}

export async function POST(request: Request) {
  return run(request);
}

/**
 * Schedulers such as Vercel Cron issue GET requests. The same secret is required, and each row is
 * claimed before it is sent, so a repeated invocation cannot deliver the same offer twice.
 */
export async function GET(request: Request) {
  return run(request);
}
