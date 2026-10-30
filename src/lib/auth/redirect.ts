/**
 * One implementation of "where may we send a signed-in user next".
 *
 * The login form, the OAuth callback and the email-confirmation callback all accept a `next`
 * parameter. Only one of them used to validate it, and each kept its own copy of the allowlist,
 * which meant a signed-out visitor opening `/account/settings` was silently dropped on
 * `/onboarding` after signing in. This module is the single source of truth.
 *
 * Rules:
 * 1. The value must be a path on this site, never another origin (`//evil.example`,
 *    `https://evil.example`, `\\evil.example` and encoded control characters are rejected).
 * 2. The value must start with an allowed prefix, so a crafted link cannot use the callback as a
 *    generic redirector.
 * 3. Anything that does not satisfy both rules is replaced by the caller's fallback.
 *
 * The destination is always re-validated by the page that receives it (its own authorization and
 * the database RLS still apply); this helper only prevents open redirects and lost destinations.
 */

// `/deliver` and `/provider/apply` are here because registration sends a new provider-intent
// account to the matching application; without them the destination was silently replaced.
const ALLOWED_PREFIXES = [
  "/account",
  "/admin",
  "/cart",
  "/checkout",
  "/deliver",
  "/house-hunt",
  "/onboarding",
  "/provider",
  "/reset-password",
  "/rider",
  "/search",
  "/listing/",
] as const;

const MAX_LENGTH = 300;
const BASE = "https://shilevi.invalid";

export function isSafeNextPath(value: string | null | undefined): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_LENGTH) return false;
  if (!value.startsWith("/") || value.startsWith("//")) return false;
  if (value.includes("\\")) return false;
  if (/[\u0000-\u001f\u007f]/.test(value)) return false;

  let parsed: URL;
  try {
    parsed = new URL(value, BASE);
  } catch {
    return false;
  }
  if (parsed.origin !== BASE) return false;
  // Reject a path that only looks local after normalisation (e.g. "/account/../../login").
  if (value.split("?")[0].split("#")[0].split("/").includes("..")) return false;

  const pathname = parsed.pathname;
  if (pathname.startsWith("/api/")) return false;

  return ALLOWED_PREFIXES.some(prefix =>
    prefix.endsWith("/") ? pathname.startsWith(prefix) : pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/** Returns the requested internal path when it is safe, otherwise `fallback`. */
export function safeNextPath(value: string | null | undefined, fallback = "/account"): string {
  return isSafeNextPath(value) ? value : fallback;
}
