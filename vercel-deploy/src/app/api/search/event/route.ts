import "server-only";

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hasServiceRole } from "@/lib/env.server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { isSameOriginRequest } from "@/lib/security/origin";
import { clientKey, rateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1_024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * POST /api/search/event
 *
 * Records that a visitor opened a listing from a search result. This is the only client-triggered
 * analytics call, so it is deliberately narrow: one listing id, same-origin only, rate limited, and
 * the database refuses any listing that is not published.
 *
 * It is not a conversion, and it is not trusted financial data. Orders, payments and reviews remain
 * the only sources of truth for money; nothing here can mark anything paid, unlocked or complete.
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403, headers: NO_STORE });
  }

  const limit = rateLimit(clientKey(request, "search-event"), 60, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many events." },
      { status: 429, headers: { ...NO_STORE, "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Request is too large." }, { status: 413, headers: NO_STORE });
  }

  let body: { listingId?: unknown };
  try {
    body = JSON.parse(raw) as { listingId?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400, headers: NO_STORE });
  }

  const listingId = typeof body.listingId === "string" ? body.listingId : "";
  if (!UUID.test(listingId)) {
    return NextResponse.json({ error: "A valid listing is required." }, { status: 400, headers: NO_STORE });
  }

  // No service role means no analytics store. Answer truthfully instead of pretending to record.
  if (!hasServiceRole()) {
    return NextResponse.json({ error: "Analytics are not configured." }, { status: 503, headers: NO_STORE });
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data: sessionData } = await supabase.auth.getSession();
    const service = createSupabaseServiceClient();
    const { error } = await service.rpc("record_search_event", {
      p_event_type: "listing_click",
      p_query: null,
      p_division: null,
      p_category_id: null,
      p_county: null,
      p_min_price_minor: null,
      p_max_price_minor: null,
      p_sort: null,
      p_page: null,
      p_result_count: null,
      p_listing_id: listingId,
      p_shown_listing_ids: null,
      p_user_id: sessionData.session?.user.id ?? null,
    });

    if (error) {
      // The RPC refuses unpublished listings with this message; that is a 404 for the client, not a
      // server fault, and it deliberately reveals nothing beyond "not available".
      if (/Listing not found/i.test(error.message)) {
        return NextResponse.json({ error: "That listing is not available." }, { status: 404, headers: NO_STORE });
      }
      console.error("[search-event] write failed", { code: error.code });
      return NextResponse.json({ error: "The event could not be recorded." }, { status: 503, headers: NO_STORE });
    }

    return new NextResponse(null, { status: 204, headers: NO_STORE });
  } catch (error) {
    console.error("[search-event] unexpected failure", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json({ error: "The event could not be recorded." }, { status: 503, headers: NO_STORE });
  }
}

export function GET() {
  return NextResponse.json({ error: "Use POST to record an event." }, { status: 405, headers: { Allow: "POST" } });
}
