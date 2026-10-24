import "server-only";

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { hasServiceRole, isResendConfigured, serverEnv } from "@/lib/env.server";
import { sendEmail } from "@/lib/email/resend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BATCH = 20;

function authorized(request: Request): boolean {
  const expected = serverEnv.notificationDispatchSecret;
  const provided = request.headers.get("x-dispatch-secret") ?? "";
  if (!expected || !provided) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * POST /api/notifications/dispatch
 *
 * Drains a bounded batch from public.notification_outbox. This is intentionally not callable from
 * the browser: it requires a server-held secret plus the service role. Point a scheduled job at it
 * (Vercel Cron or a Supabase scheduled function) once RESEND_API_KEY and the secret are set.
 */
export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  if (!hasServiceRole()) {
    return NextResponse.json({ error: "Service role is not configured." }, { status: 503 });
  }
  if (!isResendConfigured()) {
    return NextResponse.json({ error: "Resend is not configured. Notifications remain queued." }, { status: 503 });
  }

  const supabase = createSupabaseServiceClient();
  const now = new Date().toISOString();

  const { data: rows, error } = await supabase
    .from("notification_outbox")
    .select("id,recipient,channel,template,payload,attempts,status")
    .in("status", ["queued", "failed"])
    .lte("next_attempt_at", now)
    .order("created_at", { ascending: true })
    .limit(MAX_BATCH);

  if (error) {
    console.error("[notifications] queue read failed", { code: error.code });
    return NextResponse.json({ error: "Queue could not be read." }, { status: 500 });
  }

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of rows ?? []) {
    // Claim the row so two dispatchers cannot send the same message.
    const { data: claimed } = await supabase
      .from("notification_outbox")
      .update({ status: "sending" })
      .eq("id", row.id)
      .in("status", ["queued", "failed"])
      .select("id");

    if (!claimed?.length) continue;

    if (row.channel !== "email" || typeof row.recipient !== "string" || !row.recipient.includes("@")) {
      await supabase
        .from("notification_outbox")
        .update({ status: "skipped", last_error: "No usable email recipient.", attempts: Number(row.attempts) + 1 })
        .eq("id", row.id);
      skipped += 1;
      continue;
    }

    try {
      await sendEmail({
        to: row.recipient,
        template: String(row.template),
        payload: (row.payload ?? {}) as Record<string, unknown>,
      });
      await supabase
        .from("notification_outbox")
        .update({ status: "sent", sent_at: new Date().toISOString(), attempts: Number(row.attempts) + 1, last_error: null })
        .eq("id", row.id);
      sent += 1;
    } catch (cause) {
      const attempts = Number(row.attempts) + 1;
      const delayMinutes = Math.min(2 ** attempts, 60);
      await supabase
        .from("notification_outbox")
        .update({
          status: attempts >= 5 ? "skipped" : "failed",
          attempts,
          last_error: (cause instanceof Error ? cause.message : "Delivery failed").slice(0, 500),
          next_attempt_at: new Date(Date.now() + delayMinutes * 60_000).toISOString(),
        })
        .eq("id", row.id);
      failed += 1;
    }
  }

  return NextResponse.json(
    { processed: sent + failed + skipped, sent, failed, skipped },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}

export function GET() {
  return NextResponse.json({ error: "Use POST." }, { status: 405, headers: { Allow: "POST" } });
}
