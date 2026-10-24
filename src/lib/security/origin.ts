import "server-only";

/**
 * CSRF defence for cookie-authenticated route handlers.
 *
 * A browser sends the Origin header on cross-site POST/PUT/PATCH/DELETE requests. Rejecting a
 * mismatched Origin stops the classic form-post CSRF attack. This is a defence-in-depth check:
 * authorization must still be performed on the server for the exact resource.
 */
export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");

  const allowed = new Set<string>();
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) {
    try {
      allowed.add(new URL(configured).origin);
    } catch {
      // Ignore a malformed configured URL; the host check below still applies.
    }
  }

  try {
    allowed.add(new URL(request.url).origin);
  } catch {
    return false;
  }

  const candidate = origin ?? (referer ? new URL(referer).origin : null);
  if (!candidate) return false;
  return allowed.has(candidate);
}
