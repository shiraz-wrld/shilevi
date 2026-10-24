import { NextResponse } from "next/server";
import { clientKey, rateLimit } from "@/lib/security/rate-limit";

/**
 * POST /api/security/csp-report
 *
 * Receives Content-Security-Policy violation reports while the policy is in report-only mode.
 *
 * Reports are untrusted input: they are size-limited, rate-limited, and reduced to four bounded
 * fields before being written to the server log. Query strings are stripped because they can carry
 * search terms or tokens, and cookies are never read. Nothing is persisted to the database.
 */

const MAX_BODY_BYTES = 16_384;
const MAX_FIELD_LENGTH = 500;

function bounded(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.slice(0, MAX_FIELD_LENGTH);
}

function withoutQuery(value: unknown): string {
  const raw = bounded(value);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname}`;
  } catch {
    // Not an absolute URL (for example "inline" or "eval"); keep the bounded literal.
    return raw.split("?")[0];
  }
}

export async function POST(request: Request) {
  const limit = rateLimit(clientKey(request, "csp-report"), 60, 60_000);
  if (!limit.allowed) {
    return new NextResponse(null, {
      status: 429,
      headers: { "Retry-After": String(limit.retryAfterSeconds), "Cache-Control": "no-store" },
    });
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json") && !contentType.includes("application/csp-report")) {
    return NextResponse.json({ error: "Expected a JSON CSP report." }, { status: 415 });
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Report too large." }, { status: 413 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const envelope = (parsed ?? {}) as Record<string, unknown>;
  const report = (envelope["csp-report"] ?? envelope) as Record<string, unknown>;

  const safeReport = {
    directive: bounded(report["violated-directive"] ?? report["effective-directive"]),
    blocked: withoutQuery(report["blocked-uri"]),
    document: withoutQuery(report["document-uri"]),
    disposition: bounded(report["disposition"]),
  };

  // Server log only: no cookies, no query strings, no persistence.
  console.warn("[csp-report]", JSON.stringify(safeReport));

  return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

export function GET() {
  return NextResponse.json({ error: "Use POST to submit a CSP report." }, { status: 405, headers: { Allow: "POST" } });
}
