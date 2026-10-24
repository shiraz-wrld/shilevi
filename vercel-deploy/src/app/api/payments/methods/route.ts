import "server-only";

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { usableMethods, type PaymentPurpose } from "@/lib/payments/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PURPOSES: PaymentPurpose[] = ["order", "ride", "property_contact"];

/**
 * GET /api/payments/methods?purpose=order
 *
 * Returns only methods that are both enabled by the owner and genuinely configured on this
 * deployment. Secrets, environment names and setup blockers are never returned here.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const requested = url.searchParams.get("purpose") ?? "order";
  const purpose = PURPOSES.find(item => item === requested);
  if (!purpose) {
    return NextResponse.json({ error: "Unknown payment purpose." }, { status: 400 });
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    return NextResponse.json(
      { error: "Payments are not configured on this deployment.", methods: [], sandbox: false },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const supabase = await createSupabaseServerClient();
  const [settingsResult, methodResult] = await Promise.all([
    supabase.rpc("get_checkout_settings"),
    supabase
      .from("payment_methods")
      .select("provider,purposes,sort_order")
      .eq("enabled", true)
      .order("sort_order", { ascending: true }),
  ]);

  if (methodResult.error) {
    console.error("[payment-methods] could not read payment methods", { code: methodResult.error.code });
    return NextResponse.json(
      { error: "Payment methods are temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const settings = (settingsResult.data ?? {}) as Record<string, unknown>;
  const mode = typeof settings.payment_mode === "string" ? settings.payment_mode : null;
  const allowMock =
    settings.allow_mock_payments === true || settings.allow_mock_payments === "true";
  const mockAllowed = allowMock && mode === "mock";

  const enabled = (methodResult.data ?? [])
    .filter(row => Array.isArray(row.purposes) && row.purposes.includes(purpose))
    .map(row => String(row.provider));

  const methods = usableMethods(enabled, { mockAllowed });

  return NextResponse.json(
    {
      purpose,
      methods,
      sandbox: methods.some(method => method.sandbox),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
