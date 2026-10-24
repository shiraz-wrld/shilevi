import { NextResponse } from "next/server";
import { isSupabaseConfigured, publicEnv } from "@/lib/env";

/**
 * Liveness and readiness.
 *
 * Deliberately reveals no secrets and no version numbers of dependencies: an unauthenticated
 * endpoint should not help an attacker fingerprint the stack. It reports whether the app can
 * reach the configuration it needs, which is what a deploy check actually cares about.
 */
export const dynamic = "force-dynamic";

export function GET() {
  const configured = isSupabaseConfigured();

  return NextResponse.json(
    {
      status: configured ? "ok" : "degraded",
      checks: {
        application: "ok",
        auth: configured ? "configured" : "missing",
        database: "not-checked",
      },
      // A missing site URL only affects absolute links (sitemap, emails), not serving.
      siteUrlConfigured: Boolean(publicEnv.siteUrl),
      time: new Date().toISOString(),
    },
    {
      status: configured ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    }
  );
}
