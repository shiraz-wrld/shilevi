import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

const ALLOWED_NEXT_PATHS = new Set(["/account", "/account/settings", "/account/orders", "/cart", "/checkout", "/onboarding", "/reset-password", "/admin", "/admin/categories", "/admin/brands", "/provider/orders", "/rider/jobs"]);

function isSafeNextPath(value: string) {
  if (ALLOWED_NEXT_PATHS.has(value)) return true;
  return /^\/account\/orders\/[0-9a-f-]{36}$/i.test(value)
    || /^\/rider\/jobs\/[0-9a-f-]{36}$/i.test(value)
    || /^\/listing\/[0-9a-f-]{36}$/i.test(value);
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const requestedNext = requestUrl.searchParams.get("next");
  // Use an exact allowlist rather than accepting arbitrary relative paths (including backslash tricks).
  const safeNext = requestedNext && isSafeNextPath(requestedNext) ? requestedNext : "/account";

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
  return response;
}
