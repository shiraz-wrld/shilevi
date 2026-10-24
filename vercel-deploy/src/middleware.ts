import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

/**
 * Request-time session handling.
 *
 * 1. Refresh the Supabase auth cookie so Server Components see a valid session.
 * 2. Send signed-out visitors away from private areas early (convenience only — every page and
 *    route handler still authorizes on the server, and the database enforces RLS).
 * 3. Mark private responses `no-store` so a shared cache never serves one person's account page
 *    to another.
 */

const PRIVATE_PREFIXES = ["/account", "/checkout", "/provider", "/rider", "/admin", "/onboarding"];

function isPrivate(pathname: string) {
  return PRIVATE_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const privateRoute = isPrivate(pathname);
  const response = NextResponse.next({ request });

  if (privateRoute) response.headers.set("Cache-Control", "private, no-store, max-age=0");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  // Without configuration the app renders a setup message; there is no session to refresh.
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  const { data } = await supabase.auth.getUser();

  if (privateRoute && !data.user) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = `?next=${encodeURIComponent(pathname + search)}`;
    const redirect = NextResponse.redirect(loginUrl);
    redirect.headers.set("Cache-Control", "private, no-store, max-age=0");
    return redirect;
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Skip static assets, the image optimizer, favicon and files with an extension.
     * Auth is only relevant to document and API requests.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml|webmanifest|woff2?)$).*)",
  ],
};
