/**
 * Response security headers.
 *
 * Enforced headers are safe for this stack today. The Content-Security-Policy is shipped in
 * report-only mode because Next.js injects inline bootstrap scripts and a nonce-based policy
 * needs request-scoped middleware; enforcing it prematurely would break navigation. Move it to
 * `Content-Security-Policy` only after a report-only soak on staging shows no legitimate breakage.
 * Violations are collected at /api/security/csp-report.
 */

const supabaseOrigin = (() => {
  try {
    const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
    return raw ? new URL(raw).origin : "";
  } catch {
    return "";
  }
})();

const cspDirectives = [
  "default-src 'self'",
  // Next.js runtime and the Supabase browser client. 'unsafe-inline' is required by Next's
  // bootstrap script until a nonce strategy is wired through middleware.
  [`script-src 'self' 'unsafe-inline' 'unsafe-eval'`, supabaseOrigin].filter(Boolean).join(" "),
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  ["connect-src 'self'", supabaseOrigin, "https://*.supabase.co"].filter(Boolean).join(" "),
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
  // Collect violations while the policy is report-only. The endpoint strips query strings and
  // never persists reports; see src/app/api/security/csp-report/route.ts.
  "report-uri /api/security/csp-report",
];

export const SECURITY_HEADERS: { key: string; value: string }[] = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self), payment=(self)" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "Content-Security-Policy-Report-Only", value: cspDirectives.join("; ") },
];
