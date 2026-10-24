import "server-only";

import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { hasServiceRole, isMpesaConfigured, serverEnv } from "@/lib/env.server";
import { MpesaError, parseStkCallback, queryStkStatus } from "@/lib/payments/mpesa";
import { clientKey, rateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 65_536;

function accepted() {
  // Daraja retries any non-200 response. We only return 200 once the event is recorded or rejected
  // deterministically; transient failures return 500 so the provider retries.
  return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" }, { status: 200, headers: { "Cache-Control": "no-store" } });
}

/**
 * POST /api/payments/mpesa/callback
 *
 * Security model:
 *   1. The callback body is untrusted. It is size-limited and rate-limited.
 *   2. The CheckoutRequestID must exist as a payment intent created by an authenticated user.
 *   3. By default the handler queries Daraja for the authoritative status and requires it to be
 *      successful. A forged POST cannot turn a pending payment into a paid one.
 *   4. The amount must equal the intent amount. The confirmation RPC is idempotent and service-role
 *      only, so duplicate callbacks cannot double-credit.
 */
export async function POST(request: Request) {
  const limit = rateLimit(clientKey(request, "mpesa-callback"), 120, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ ResultCode: 1, ResultDesc: "Rate limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ ResultCode: 1, ResultDesc: "Too large" }, { status: 413 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ResultCode: 1, ResultDesc: "Invalid JSON" }, { status: 400 });
  }

  const callback = parseStkCallback(parsed);
  if (!callback) {
    return NextResponse.json({ ResultCode: 1, ResultDesc: "Malformed callback" }, { status: 400 });
  }

  if (!hasServiceRole()) {
    console.error("[mpesa-callback] SUPABASE_SERVICE_ROLE_KEY is not configured; payment not recorded");
    return NextResponse.json({ ResultCode: 1, ResultDesc: "Not configured" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  const supabase = createSupabaseServiceClient();

  // Failed or cancelled payment: record the failure, never credit.
  if (callback.resultCode !== "0") {
    const { error } = await supabase
      .from("payment_intents")
      .update({ status: "failed", metadata: { result_code: callback.resultCode, result_desc: callback.resultDescription.slice(0, 200) } })
      .eq("provider", "mpesa")
      .eq("provider_reference", callback.checkoutRequestId)
      .in("status", ["created", "pending"]);

    if (error) {
      console.error("[mpesa-callback] failed to persist failure", { code: error.code });
      return NextResponse.json({ ResultCode: 1, ResultDesc: "Retry" }, { status: 500 });
    }
    console.warn("[mpesa-callback] payment not successful", { resultCode: callback.resultCode });
    return accepted();
  }

  if (callback.amountMinor === null) {
    console.error("[mpesa-callback] successful callback had no amount");
    return NextResponse.json({ ResultCode: 1, ResultDesc: "Missing amount" }, { status: 400 });
  }

  // Authoritative verification. Without it, a forged callback would be enough to release goods.
  if (serverEnv.mpesa.verifyCallback) {
    if (!isMpesaConfigured()) {
      console.error("[mpesa-callback] callback verification requested but Daraja is not configured");
      return NextResponse.json({ ResultCode: 1, ResultDesc: "Verification unavailable" }, { status: 503 });
    }
    try {
      const status = await queryStkStatus(callback.checkoutRequestId);
      if (!status.success) {
        console.warn("[mpesa-callback] Daraja query did not confirm success", { resultCode: status.resultCode });
        return accepted();
      }
    } catch (error) {
      const message = error instanceof MpesaError ? error.message : "query failed";
      console.error("[mpesa-callback] verification failed; will retry", { message });
      return NextResponse.json({ ResultCode: 1, ResultDesc: "Retry" }, { status: 500 });
    }
  }

  const { error } = await supabase.rpc("confirm_provider_payment", {
    p_provider: "mpesa",
    p_provider_reference: callback.checkoutRequestId,
    p_amount_minor: callback.amountMinor,
    p_payload: {
      receipt: callback.receipt,
      merchant_request_id: callback.merchantRequestId,
      verified_at: new Date().toISOString(),
    },
  });

  if (error) {
    // Unknown reference is not retryable; anything else may be transient.
    const unknownReference = /Unknown payment reference/i.test(error.message);
    console.error("[mpesa-callback] confirmation failed", { code: error.code, unknownReference });
    return unknownReference
      ? NextResponse.json({ ResultCode: 1, ResultDesc: "Unknown reference" }, { status: 404 })
      : NextResponse.json({ ResultCode: 1, ResultDesc: "Retry" }, { status: 500 });
  }

  return accepted();
}

export function GET() {
  return NextResponse.json({ error: "Use POST." }, { status: 405, headers: { Allow: "POST" } });
}
