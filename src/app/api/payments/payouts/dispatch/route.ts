import "server-only";

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isOwnerAdminEmail } from "@/lib/admin/auth";
import { isMpesaB2cConfigured } from "@/lib/env.server";
import { initiateB2cPayout, MpesaError } from "@/lib/payments/mpesa";
import { isSameOriginRequest } from "@/lib/security/origin";
import { clientKey, rateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * POST /api/payments/payouts/dispatch
 *
 * Owner-only, MFA-gated B2C payout dispatch. Safaricom accepting the request is not proof of
 * payment: the payout moves to `processing` and is only marked `paid` by the verified result
 * callback. A payout that is already processing is never re-sent.
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403 });
  }
  const limit = rateLimit(clientKey(request, "payout-dispatch"), 20, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many attempts." }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  }

  const supabase = await createSupabaseServerClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  if (!userData.user.email_confirmed_at || !isOwnerAdminEmail(userData.user.email)) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") {
    return NextResponse.json({ error: "MFA assurance level 2 is required." }, { status: 403 });
  }

  if (!isMpesaB2cConfigured()) {
    return NextResponse.json(
      { error: "M-Pesa B2C payouts are not configured. The payout remains pending; no money was sent." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const raw = await request.text();
  if (raw.length > 2_048) return NextResponse.json({ error: "Request is too large." }, { status: 413 });

  let payoutId: string | null = null;
  if (raw.trim()) {
    try {
      const body = JSON.parse(raw) as { payoutId?: unknown };
      payoutId = typeof body.payoutId === "string" && UUID.test(body.payoutId) ? body.payoutId : null;
      if (!payoutId) return NextResponse.json({ error: "A valid payout id is required." }, { status: 400 });
    } catch {
      return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
    }
  }

  let query = supabase
    .from("payouts")
    .select("id,payee_id,amount_minor,currency,status,destination_phone,reference")
    .eq("status", "pending")
    .limit(1);
  if (payoutId) query = query.eq("id", payoutId);

  const { data: payouts, error: payoutError } = await query;
  if (payoutError) {
    return NextResponse.json({ error: "The payout queue could not be read." }, { status: 500 });
  }
  const payout = payouts?.[0];
  if (!payout) {
    return NextResponse.json({ error: "No pending payout is ready to send." }, { status: 404 });
  }
  if (!payout.destination_phone) {
    return NextResponse.json({ error: "This payout has no destination phone. Ask the rider to request it again." }, { status: 400 });
  }

  try {
    const result = await initiateB2cPayout({
      phone: payout.destination_phone,
      amountMinor: Number(payout.amount_minor),
      remarks: "Shilevi payout",
      occasion: payout.id,
    });

    const { error: updateError } = await supabase.rpc("admin_update_payout", {
      p_payout_id: payout.id,
      p_status: "processing",
      p_reference: result.conversationId,
      p_failure_reason: null,
    });

    if (updateError) {
      console.error("[payout-dispatch] B2C accepted but local state failed", { payoutId: payout.id, code: updateError.code });
      return NextResponse.json(
        { error: "Safaricom accepted the payout but the local state could not be recorded. Do not resend; reconcile manually." },
        { status: 500 },
      );
    }

    return NextResponse.json(
      { payoutId: payout.id, status: "processing", message: "Payout submitted. It is only marked paid after Safaricom's verified result." },
      { status: 202, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof MpesaError) {
      return NextResponse.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } });
    }
    console.error("[payout-dispatch] unexpected failure", { payoutId: payout.id });
    return NextResponse.json({ error: "The payout could not be dispatched." }, { status: 500 });
  }
}

export function GET() {
  return NextResponse.json({ error: "Use POST." }, { status: 405, headers: { Allow: "POST" } });
}
