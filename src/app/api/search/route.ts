import "server-only";

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hasServiceRole } from "@/lib/env.server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { clientKey, rateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DIVISIONS = new Set(["products", "services", "transport_delivery", "property_places"]);
const SORTS = new Set(["relevance", "newest", "price_low", "price_high", "title"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COUNTY = /^[\p{L}][\p{L} '.\-]{0,79}$/u;
const MAX_PRICE_MINOR = 10_000_000_000;

const NO_STORE = { "Cache-Control": "no-store" } as const;

type Item = { id: string };

type SearchPayload = {
  total: number;
  page: number;
  page_size: number;
  pages: number;
  query: string | null;
  sort: string;
  items: Item[];
};

function parseInteger(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  if (!/^\d{1,12}$/.test(value.trim())) return null;
  return Number(value.trim());
}

/**
 * GET /api/search
 *
 * The single read path for marketplace discovery. The database decides visibility (published
 * listings in active categories), applies taxonomy scope, filters, ranking and pagination, and
 * returns an exact total. This route only validates the request, never re-implements those rules,
 * and never returns protected contact data — the RPC's payload is already whitelisted.
 *
 * Analytics are written from the database's own answer, with the service role, so a browser cannot
 * inflate impressions or claim a conversion. A recording failure is logged and never breaks search.
 */
export async function GET(request: Request) {
  const limit = rateLimit(clientKey(request, "search"), 60, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many searches. Wait a moment and try again." },
      { status: 429, headers: { ...NO_STORE, "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const url = new URL(request.url);
  const params = url.searchParams;

  const rawQuery = (params.get("q") ?? "").trim();
  if (rawQuery.length > 120) {
    return NextResponse.json({ error: "Search terms must be 120 characters or fewer." }, { status: 400, headers: NO_STORE });
  }
  const query = rawQuery === "" ? null : rawQuery;

  const divisionParam = (params.get("division") ?? "").trim();
  if (divisionParam !== "" && !DIVISIONS.has(divisionParam)) {
    return NextResponse.json({ error: "Unknown marketplace section." }, { status: 400, headers: NO_STORE });
  }
  const division = divisionParam === "" ? null : divisionParam;

  const categoryParam = (params.get("category") ?? "").trim();
  if (categoryParam !== "" && !UUID.test(categoryParam)) {
    return NextResponse.json({ error: "Unknown category." }, { status: 400, headers: NO_STORE });
  }
  const categoryId = categoryParam === "" ? null : categoryParam;

  const countyParam = (params.get("county") ?? "").trim();
  if (countyParam !== "" && !COUNTY.test(countyParam)) {
    return NextResponse.json({ error: "Enter a county name using letters only." }, { status: 400, headers: NO_STORE });
  }
  const county = countyParam === "" ? null : countyParam;

  const minRaw = params.get("minPriceMinor");
  const maxRaw = params.get("maxPriceMinor");
  const minPrice = parseInteger(minRaw);
  const maxPrice = parseInteger(maxRaw);
  if (minRaw !== null && minRaw.trim() !== "" && minPrice === null) {
    return NextResponse.json({ error: "The minimum price is not a valid amount." }, { status: 400, headers: NO_STORE });
  }
  if (maxRaw !== null && maxRaw.trim() !== "" && maxPrice === null) {
    return NextResponse.json({ error: "The maximum price is not a valid amount." }, { status: 400, headers: NO_STORE });
  }
  if ((minPrice ?? 0) > MAX_PRICE_MINOR || (maxPrice ?? 0) > MAX_PRICE_MINOR) {
    return NextResponse.json({ error: "That price is outside the supported range." }, { status: 400, headers: NO_STORE });
  }
  if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) {
    return NextResponse.json({ error: "The minimum price cannot exceed the maximum price." }, { status: 400, headers: NO_STORE });
  }

  const sortParam = (params.get("sort") ?? "").trim();
  if (sortParam !== "" && !SORTS.has(sortParam)) {
    return NextResponse.json({ error: "Unknown sort order." }, { status: 400, headers: NO_STORE });
  }
  const sort = sortParam === "" ? "relevance" : sortParam;

  const pageParam = parseInteger(params.get("page"));
  const page = pageParam === null ? 1 : Math.min(Math.max(pageParam, 1), 10_000);

  const sizeParam = parseInteger(params.get("pageSize"));
  const pageSize = sizeParam === null ? 24 : Math.min(Math.max(sizeParam, 1), 48);

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    return NextResponse.json(
      { error: "Search is not available on this deployment yet." },
      { status: 503, headers: NO_STORE },
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("search_marketplace", {
    p_query: query,
    p_division: division,
    p_category_id: categoryId,
    p_county: county,
    p_min_price_minor: minPrice,
    p_max_price_minor: maxPrice,
    p_sort: sort,
    p_page: page,
    p_page_size: pageSize,
  });

  if (error) {
    console.error("[search] query failed", { code: error.code, message: error.message });
    return NextResponse.json(
      { error: "Search is temporarily unavailable. Try again in a moment." },
      { status: 503, headers: NO_STORE },
    );
  }

  const payload = data as SearchPayload | null;
  if (!payload || !Array.isArray(payload.items)) {
    console.error("[search] unexpected payload shape");
    return NextResponse.json(
      { error: "Search returned an unexpected response. Try again." },
      { status: 502, headers: NO_STORE },
    );
  }

  // Demand analytics. Best effort by design: a logging outage must not take discovery down, and a
  // deployment without the service role simply records nothing rather than failing the request.
  if (hasServiceRole()) {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const service = createSupabaseServiceClient();
      await service.rpc("record_search_event", {
        p_event_type: "search",
        p_query: query,
        p_division: division,
        p_category_id: categoryId,
        p_county: county,
        p_min_price_minor: minPrice,
        p_max_price_minor: maxPrice,
        p_sort: sort,
        p_page: payload.page,
        p_result_count: Number(payload.total),
        p_listing_id: null,
        p_shown_listing_ids: payload.items.slice(0, 24).map(item => item.id),
        p_user_id: sessionData.session?.user.id ?? null,
      });
    } catch (recordError) {
      console.error("[search] analytics write skipped", {
        message: recordError instanceof Error ? recordError.message : "unknown",
      });
    }
  }

  return NextResponse.json(
    {
      total: Number(payload.total),
      page: payload.page,
      page_size: payload.page_size,
      pages: payload.pages,
      query: payload.query,
      sort: payload.sort,
      items: payload.items,
    },
    { headers: NO_STORE },
  );
}

export function POST() {
  return NextResponse.json({ error: "Use GET to search." }, { status: 405, headers: { Allow: "GET" } });
}
