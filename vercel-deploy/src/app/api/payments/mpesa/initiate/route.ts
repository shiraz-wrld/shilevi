import "server-only";

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isMpesaConfigured } from "@/lib/env.server";
import { initiateStkPush, MpesaError, normalizeKenyanPhone } from "@/lib/payments/mpesa";
import { isSameOriginRequest } from "@/lib/security/origin";
import { clientKey, rateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 4_096;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Body = { purpose?: unknown; targetId?: unknown; phone?: unknown; idempotencyKey?: unknown };

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403 });
  }
  const limit = rateLimit(clientKey(request, "mpesa-initiate"), 10, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many payment attempts. Wait a minute and try again." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds), "Cache-Control": "no-store" } },
    );
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Request is too large." }, { status: 413 });
  }

  let body: Body;
  try {
    body = JSON.parse(raw) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const purpose = typeof body.purpose === "string" ? body.purpose : "";
  const targetId = typeof body.targetId === "string" ? body.targetId : "";
  const phone = typeof body.phone === "string" ? body.phone : "";
  const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.slice(0, 120) : null;

  if (!["order", "ride", "property_contact"].includes(purpose) || !UUID.test(targetId)) {
    return NextResponse.json({ error: "A valid payment target is required." }, { status: 400 });
  }
  if (!normalizeKenyanPhone(phone)) {
    return NextResponse.json({ error: "Enter a valid Safaricom phone number." }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return NextResponse.json({ error: "Sign in to pay." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  const userLimit = rateLimit(`mpesa-initiate:${userData.user.id}`, 6, 60_000);
  if (!userLimit.allowed) {
    return NextResponse.json({ error: "Too many payment attempts." }, { status: 429, headers: { "Retry-After": String(userLimit.retryAfterSeconds) } });
  }

  try {
    let intentId: string;
    let amountMinor: number;
    let provider: string;

    if (purpose === "property_contact") {
      const { data, error } = await supabase.rpc("create_property_payment_intent", { p_listing_id: targetId });
      if (error) throw new MpesaError(error.message, "intent", 400);
      const result = data as { intent_id?: string; amount_minor?: number; provider?: string } | null;
      if (!result?.intent_id || !result.amount_minor) throw new MpesaError("The payment intent could not be created.", "intent", 400);
      intentId = result.intent_id;
      amountMinor = Number(result.amount_minor);
      provider = result.provider ?? "mpesa";
    } else {
      const { data, error } = await supabase.rpc("create_payment_intent", {
        p_purpose: purpose,
        p_target_id: targetId,
        p_idempotency_key: idempotencyKey,
      });
      if (error) throw new MpesaError(error.message, "intent", 400);
      intentId = data as string;

      const { data: intent, error: intentError } = await supabase
        .from("payment_intents")
        .select("id,amount_minor,provider,status,user_id")
        .eq("id", intentId)
        .single();
      if (intentError || !intent || intent.user_id !== userData.user.id) {
        throw new MpesaError("The payment intent could not be read.", "intent", 400);
      }
      amountMinor = Number(intent.amount_minor);
      provider = intent.provider as string;
      if (intent.status === "succeeded") throw new MpesaError("This payment has already been completed.", "already_paid", 409);
    }

    if (provider === "mock") {
      return NextResponse.json(
        { error: "This deployment is in sandbox payment mode. Use the sandbox confirmation instead." },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (!isMpesaConfigured()) {
      return NextResponse.json(
        { error: "M-Pesa is not configured on this deployment yet. No money was requested." },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }

    const push = await initiateStkPush({
      phone,
      amountMinor,
      accountReference: `SHILEVI-${intentId.slice(0, 8).toUpperCase()}`,
      description: purpose === "ride" ? "Shilevi trip" : purpose === "property_contact" ? "Shilevi property contact" : "Shilevi order",
    });

    const { error: attachError } = await supabase.rpc("attach_payment_provider_reference", {
      p_intent_id: intentId,
      p_provider_reference: push.checkoutRequestId,
      p_checkout_request_id: push.checkoutRequestId,
    });
    if (attachError) {
      console.error("[mpesa-initiate] push created but reference not stored", { intentId, code: attachError.code });
      return NextResponse.json(
        { error: "Payment was requested but could not be linked to this order. Do not pay twice; contact support with the reference." },
        { status: 500, headers: { "Cache-Control": "no-store" } },
      );
    }

    return NextResponse.json(
      { intentId, message: push.customerMessage, checkoutRequestId: push.checkoutRequestId },
      { status: 202, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof MpesaError) {
      return NextResponse.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } });
    }
    console.error("[mpesa-initiate] unexpected failure", {
      intent: targetId,
      message: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json({ error: "The payment request could not be started." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

export function GET() {
  return NextResponse.json({ error: "Use POST to start a payment." }, { status: 405, headers: { Allow: "POST" } });
}
