import "server-only";

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSameOriginRequest } from "@/lib/security/origin";
import { isGeocodeConfigured, serverEnv } from "@/lib/env.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/geocode  { query: "Kimathi Street, Nairobi" }
 *
 * Turns a written address into a candidate coordinate. This route is a convenience on top of the map
 * pin, never a replacement for it: the customer still confirms the point, and an address that does
 * not resolve returns 404 instead of snapping to a county centre or a nearby street.
 *
 * Provider support is explicit per deployment, and the credential never leaves the server:
 *   GEOCODE_PROVIDER=nominatim (needs GEOCODE_CONTACT), mapbox (needs MAPBOX_TOKEN),
 *   or google (needs GOOGLE_MAPS_API_KEY).
 * With no provider configured the route answers 503 and says so.
 */

const TIMEOUT_MS = 6000;

type Candidate = { latitude: number; longitude: number; label: string };

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function fetchJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json", ...headers },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function geocode(query: string): Promise<Candidate | null> {
  const { provider, mapboxToken, googleKey, baseUrl, contact } = serverEnv.geocoder;

  if (provider === "nominatim") {
    const root = baseUrl ?? "https://nominatim.openstreetmap.org";
    const url = `${root.replace(/\/$/, "")}/search?format=jsonv2&limit=1&countrycodes=ke&q=${encodeURIComponent(query)}`;
    const payload = await fetchJson(url, {
      // Nominatim's usage policy requires an identifying agent with a contact address.
      "User-Agent": `Shilevi/1.0 (${contact ?? "support@shilevi.com"})`,
    });
    if (!Array.isArray(payload) || payload.length === 0) return null;
    const first = payload[0] as { lat?: string; lon?: string; display_name?: string };
    const latitude = finite(first?.lat);
    const longitude = finite(first?.lon);
    if (latitude === null || longitude === null) return null;
    return { latitude, longitude, label: String(first?.display_name ?? query).slice(0, 200) };
  }

  if (provider === "mapbox" && mapboxToken) {
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?limit=1&country=ke&access_token=${encodeURIComponent(mapboxToken)}`;
    const payload = await fetchJson(url) as { features?: { center?: number[]; place_name?: string }[] } | null;
    const feature = payload?.features?.[0];
    if (!feature?.center || feature.center.length < 2) return null;
    const longitude = finite(feature.center[0]);
    const latitude = finite(feature.center[1]);
    if (latitude === null || longitude === null) return null;
    return { latitude, longitude, label: String(feature.place_name ?? query).slice(0, 200) };
  }

  if (provider === "google" && googleKey) {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?region=ke&address=${encodeURIComponent(query)}&key=${encodeURIComponent(googleKey)}`;
    const payload = await fetchJson(url) as {
      status?: string;
      results?: { geometry?: { location?: { lat?: number; lng?: number } }; formatted_address?: string }[];
    } | null;
    if (payload?.status !== "OK") return null;
    const first = payload.results?.[0];
    const latitude = finite(first?.geometry?.location?.lat);
    const longitude = finite(first?.geometry?.location?.lng);
    if (latitude === null || longitude === null) return null;
    return { latitude, longitude, label: String(first?.formatted_address ?? query).slice(0, 200) };
  }

  return null;
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Request rejected." }, { status: 403 });
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    return NextResponse.json({ error: "Address lookup is unavailable on this deployment." }, { status: 503 });
  }

  const supabase = await createSupabaseServerClient();
  const auth = await supabase.auth.getUser();
  if (!auth.data.user) {
    return NextResponse.json({ error: "Sign in to look up an address." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { query?: unknown } | null;
  const query = typeof body?.query === "string" ? body.query.trim() : "";
  if (query.length < 5 || query.length > 200) {
    return NextResponse.json({ error: "Enter an address between 5 and 200 characters." }, { status: 400 });
  }

  if (!isGeocodeConfigured()) {
    return NextResponse.json(
      {
        error:
          "Address lookup is not configured on this deployment. Place the point on the map instead — that is the exact coordinate Shilevi uses.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const candidate = await geocode(query);
  if (!candidate) {
    return NextResponse.json(
      { error: "That address did not resolve to a location. Place the point on the map instead." },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    { ...candidate, source: "geocoder", note: "Confirm or adjust this point before relying on it." },
    { headers: { "Cache-Control": "no-store" } },
  );
}
