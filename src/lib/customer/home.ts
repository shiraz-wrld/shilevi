import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";

/**
 * Server loader for the signed-in customer home.
 *
 * All ranking happens inside `customer_home()` (migration 0035), scoped to `auth.uid()` in the
 * database. This module only shapes the answer and reports a truthful failure, so the page can say
 * "recommendations are unavailable" instead of rendering an empty grid that looks like a considered
 * result.
 */

export type HomeListing = {
  id: string;
  title: string;
  description: string;
  price_minor: number | null;
  currency: string;
  category_id?: string;
  category_name: string;
  division?: string;
  county: string | null;
  published_at: string | null;
  is_featured?: boolean;
  cover_image_url: string | null;
};

export type HomeSearch = {
  query: string | null;
  query_normalized: string | null;
  division: string | null;
  category_id: string | null;
  category_name: string | null;
  county: string | null;
  min_price_minor: number | null;
  max_price_minor: number | null;
};

export type HomeOrder = {
  id: string;
  order_number: string;
  status: string;
  payment_status: string;
  total_minor: number;
  currency: string;
  created_at: string;
  item_count: number;
};

export type HomeAction = {
  kind: "pay" | "confirm";
  order_id: string;
  order_number: string;
  label: string;
};

export type CustomerHomeData = {
  has_history: boolean;
  personalization_enabled: boolean;
  area: string | null;
  average_price_minor: number | null;
  recommendations: HomeListing[];
  nearby: HomeListing[];
  interests: { category_id: string; category_name: string; division: string; weight: number }[];
  recent_searches: HomeSearch[];
  recently_viewed: (Pick<HomeListing, "id" | "title" | "price_minor" | "currency" | "category_name">)[];
  saved: (Pick<HomeListing, "id" | "title" | "price_minor" | "currency" | "category_name">)[];
  orders: HomeOrder[];
  pending_actions: HomeAction[];
};

export type CustomerHomeResult =
  | { ok: true; data: CustomerHomeData }
  | { ok: false; error: string };

export async function loadCustomerHome(limit = 8): Promise<CustomerHomeResult> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "The marketplace database is not configured, so your dashboard cannot load." };
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("customer_home", { p_county: null, p_limit: limit });
    if (error) {
      console.error("[customer-home] read failed", { code: error.code });
      return { ok: false, error: "Your dashboard could not be loaded right now. Try again in a moment." };
    }
    return { ok: true, data: data as CustomerHomeData };
  } catch (error) {
    console.error("[customer-home] unexpected failure", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return { ok: false, error: "Your dashboard could not be loaded right now. Try again in a moment." };
  }
}

/** Counties the platform actually knows about, used by the area picker. */
export async function loadCounties(): Promise<string[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("service_locations")
      .select("county")
      .eq("is_active", true)
      .order("sort_order")
      .limit(60);
    if (error) return [];
    return Array.from(new Set(((data ?? []) as { county: string }[]).map(row => row.county))).sort((a, b) =>
      a.localeCompare(b),
    );
  } catch {
    return [];
  }
}

/** Turns a stored search back into a working search URL. */
export function searchHref(search: HomeSearch): string {
  const params = new URLSearchParams();
  if (search.query) params.set("q", search.query);
  if (search.category_id) params.set("category", search.category_id);
  if (search.division) params.set("division", search.division);
  if (search.county) params.set("county", search.county);
  if (search.min_price_minor !== null) params.set("min", String(search.min_price_minor / 100));
  if (search.max_price_minor !== null) params.set("max", String(search.max_price_minor / 100));
  const query = params.toString();
  return query ? `/search?${query}` : "/search";
}
