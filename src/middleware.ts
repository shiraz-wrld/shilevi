import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { isOwnerAdminEmail } from "@/lib/admin/allowlist";
import { isOwnerOnlyAdminPath } from "@/lib/admin/routes";

/**
 * Request-time session handling.
 *
 * 1. Refresh the Supabase auth cookie so Server Components see a valid session.
 * 2. Send signed-out visitors away from private account areas early (convenience only — every page
 *    and route handler still authorizes on the server, and the database enforces RLS).
 * 3. Never redirect `/admin`. A redirect to an admin-specific login would confirm that the route
 *    exists; the owner console conceals itself with a real 404 instead.
 * 4. Mark private responses `no-store` so a shared cache never serves one person's account page to
 *    another.
 * 5. Stamp the request path on a trusted header so the server gate can resume the same page after a
 *    successful MFA step-up.
 */

const PRIVATE_PREFIXES = ["/account", "/checkout", "/provider", "/rider", "/admin", "/onboarding"];

function isPrivate(pathname: string) {
  return PRIVATE_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** `/admin` must look absent to callers that are not authorized, including signed-out ones. */
function isOwnerConsole(pathname: string) {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

/**
 * Serve the ordinary 404 for the requested `/admin` URL.
 *
 * A rewrite keeps the address bar unchanged while the response is produced by the app's own
 * not-found route, which returns HTTP 404. Returning this before rendering is what makes the status
 * real: calling `notFound()` inside a streamed server component can leave the response at 200.
 */
function conceal(request: NextRequest) {
  const hidden = NextResponse.rewrite(new URL("/not-found", request.url));
  hidden.headers.set("Cache-Control", "private, no-store, max-age=0");
  hidden.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  return hidden;
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const privateRoute = isPrivate(pathname);
  const ownerConsole = isOwnerConsole(pathname);

  // Server Components read this with `headers()`. It is set from the parsed pathname, never from a
  // user-supplied header, so it cannot be used to redirect somewhere else.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-shilevi-path", pathname);

  const response = NextResponse.next({ request: { headers: requestHeaders } });

  if (privateRoute) response.headers.set("Cache-Control", "private, no-store, max-age=0");
  if (ownerConsole) response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  // Without configuration there is no session to verify, so the console cannot authorize anyone
  // and must look absent rather than render "not configured".
  if (!url || !key) return ownerConsole ? conceal(request) : response;

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

  if (ownerConsole) {
    const owner = Boolean(
      data.user?.email_confirmed_at && isOwnerAdminEmail(data.user.email),
    );
    // Signed out or unconfirmed email: the console does not exist for them.
    if (!owner) {
      if (!data.user || !data.user.email_confirmed_at) return conceal(request);
      // Owner-only surfaces are absent to every other account. Capability-scoped screens stay
      // reachable for an account that actually holds a grant; the page checks the exact capability.
      if (isOwnerOnlyAdminPath(pathname)) return conceal(request);
      const { data: grants } = await supabase
        .from("staff_capabilities")
        .select("capability")
        .eq("user_id", data.user.id)
        .is("revoked_at", null);
      if (!grants || grants.length === 0) return conceal(request);
    }
  }

  if (privateRoute && !ownerConsole && !data.user) {
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
