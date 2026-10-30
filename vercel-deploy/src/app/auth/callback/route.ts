import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { safeNextPath } from "@/lib/auth/redirect";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const requestedNext = requestUrl.searchParams.get("next");
  // One validated allowlist rather than accepting arbitrary relative paths (including backslash tricks).
  const safeNext = safeNextPath(requestedNext, "/account");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key || !code) {
    return NextResponse.redirect(new URL("/login?error=auth_callback", requestUrl.origin));
  }

  const response = NextResponse.redirect(new URL(safeNext, requestUrl.origin));
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() { return request.cookies.getAll(); },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(new URL("/login?error=auth_callback", requestUrl.origin));

  // OAuth and email-link sign-ins are also aal1. If the account has a verified authenticator, send
  // the browser through the same TOTP challenge the password form uses.
  const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.nextLevel === "aal2" && assurance.currentLevel !== "aal2") {
    const stepUp = NextResponse.redirect(
      new URL(`/login/mfa?next=${encodeURIComponent(safeNext)}`, requestUrl.origin),
    );
    for (const cookie of response.cookies.getAll()) stepUp.cookies.set(cookie);
    return stepUp;
  }

  return response;
}
