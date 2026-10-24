import "server-only";

import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { hasServiceRole } from "@/lib/env.server";
import { clientKey, rateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 65_536;

type B2cBody = {
  Result?: {
    ResultCode?: number | string;
    ResultDesc?: string;
    ConversationID?: string;
    OriginatorConversationID?: string;
    TransactionID?: string;
    ResultParameters?: { ResultParameter?: Array<{ Key?: string; Value?: unknown }> };
  };
};

/**
 * POST /api/payments/mpesa/b2c-result
 *
 * Safaricom's asynchronous B2C result. The payout is located by the ConversationID stored at
 * dispatch time, so an unsolicited body cannot settle an unrelated payout. A timeout callback can
 * point at this same URL; its non-zero result marks the payout failed, not paid.
 */
export async function POST(request: Request) {
  const limit = rateLimit(clientKey(request, "mpesa-b2c-result"), 120, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ ResultCode: 1, ResultDesc: "Rate limited" }, { status: 429 });
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ ResultCode: 1, ResultDesc: "Too large" }, { status: 413 });
  }

  let body: B2cBody;
  try {
    body = JSON.parse(raw) as B2cBody;
  } catch {
    return NextResponse.json({ ResultCode: 1, ResultDesc: "Invalid JSON" }, { status: 400 });
  }

  const result = body.Result;
  const conversationId = typeof result?.ConversationID === "string" ? result.ConversationID : "";
  if (!result || !conversationId) {
    return NextResponse.json({ ResultCode: 1, ResultDesc: "Missing result" }, { status: 400 });
  }

  if (!hasServiceRole()) {
    console.error("[mpesa-b2c-result] SUPABASE_SERVICE_ROLE_KEY is not configured");
    return NextResponse.json({ ResultCode: 1, ResultDesc: "Not configured" }, { status: 503 });
  }

  const supabase = createSupabaseServiceClient();
  const { data: payouts, error: lookupError } = await supabase
    .from("payouts")
    .select("id,status,amount_minor")
    .eq("reference", conversationId)
    .limit(1);

  if (lookupError) {
    console.error("[mpesa-b2c-result] payout lookup failed", { code: lookupError.code });
    return NextResponse.json({ ResultCode: 1, ResultDesc: "Retry" }, { status: 500 });
  }
  const payout = payouts?.[0];
  if (!payout) {
    // Not one of our dispatches, or already reconciled after a manual reference change.
    console.warn("[mpesa-b2c-result] unknown conversation reference");
    return NextResponse.json({ ResultCode: 0, ResultDesc: "Ignored" }, { status: 200 });
  }

  const success = String(result.ResultCode ?? "") === "0";
  const parameters = result.ResultParameters?.ResultParameter ?? [];
  const receipt = parameters.find(item => item.Key === "TransactionReceipt")?.Value;
  const failure = result.ResultDesc ? result.ResultDesc.slice(0, 500) : "Safaricom reported a failed payout.";

  const { error } = await supabase.rpc("confirm_provider_payout", {
    p_payout_id: payout.id,
    p_status: success ? "paid" : "failed",
    p_reference: success && typeof receipt === "string" ? receipt : conversationId,
    p_failure_reason: success ? null : failure,
  });

  if (error) {
    console.error("[mpesa-b2c-result] settlement failed", { payoutId: payout.id, code: error.code });
    return NextResponse.json({ ResultCode: 1, ResultDesc: "Retry" }, { status: 500 });
  }

  return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" }, { status: 200, headers: { "Cache-Control": "no-store" } });
}

export function GET() {
  return NextResponse.json({ error: "Use POST." }, { status: 405, headers: { Allow: "POST" } });
}
