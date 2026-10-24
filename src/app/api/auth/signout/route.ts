import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { isSameOriginRequest } from "@/lib/security/origin";

/**
 * POST /api/auth/signout
 *
 * Signs the current session out server-side so the refresh token is revoked, then redirects home.
 * Sign-out is a state change, so it is POST-only and origin-checked; GET would be triggerable by
 * any image tag on another site.
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.redirect(new URL("/", request.url), { status: 303 });
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) {
    return NextResponse.json({ error: "Sign out failed. Try again." }, { status: 500 });
  }

  const response = NextResponse.redirect(new URL("/", request.url), { status: 303 });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export function GET() {
  return NextResponse.json({ error: "Use POST to sign out." }, { status: 405, headers: { Allow: "POST" } });
}
