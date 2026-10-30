import "server-only";

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isOwnerAdminEmail } from "@/lib/admin/auth";
import { isSameOriginRequest } from "@/lib/security/origin";
import { clientKey, rateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/refunds/decide
 *
 * Owner-only refund decision, the missing half of the customer refund journey. The browser never
 * calls `admin_decide_refund` directly: this route performs the CSRF and rate-limit checks, then
 * the database re-checks the owner allowlist and MFA assurance level 2 inside the function.
 *
 * The session client (not the service role) issues the call on purpose — `auth.uid()` must be the
 * owner for the function's own guard to hold. See migration 0026, which corrects migration 0017's
 * service-role-only grant that made every decision fail closed with "Not authorized."
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 4_096;

type Body = { refundId?: unknown; approve?: unknown; note?: unknown };

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * Unauthorized callers get the same answer as a route that does not exist. A 401 or 403 that names
 * the owner allowlist would confirm this endpoint and its audience to anyone who guesses the path.
 */
function notFound() {
  return json({ error: "Not found" }, 404);
}

export async function POST(request: Request) {
  // The CSRF check comes first, but its failure must not confirm that this route exists.
  if (!isSameOriginRequest(request)) return notFound();

  const limit = rateLimit(clientKey(request, "admin-refund"), 20, 60_000);
  if (!limit.allowed) {
    return json({ error: "Too many decisions. Wait a minute and try again." }, 429);
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return json({ error: "Request is too large." }, 413);

  let body: Body;
  try {
    body = JSON.parse(raw) as Body;
  } catch {
    return json({ error: "Invalid JSON." }, 400);
  }

  const refundId = typeof body.refundId === "string" ? body.refundId : "";
  const approve = body.approve;
  const note = typeof body.note === "string" ? body.note.trim() : "";

  if (!UUID.test(refundId) || typeof approve !== "boolean") {
    return json({ error: "A refund id and an approve or reject decision are required." }, 400);
  }
  if (note.length > 1000) {
    return json({ error: "The decision note must be 1000 characters or fewer." }, 400);
  }
  if (!approve && note.length < 5) {
    return json({ error: "Explain the reason for rejecting a refund." }, 400);
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    return json({ error: "Refund decisions are unavailable on this deployment." }, 503);
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return notFound();

  const email = data.user.email?.trim().toLowerCase() ?? null;
  if (!data.user.email_confirmed_at || !isOwnerAdminEmail(email)) return notFound();

  const { data: assurance, error: assuranceError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assuranceError || assurance?.currentLevel !== "aal2") {
    return json(
      {
        error: "Refund decisions require MFA assurance level 2. Verify your authenticator and try again. Nothing was changed.",
        code: "mfa_required",
      },
      403,
    );
  }

  try {
    const { error: rpcError } = await supabase.rpc("admin_decide_refund", {
      p_refund_id: refundId,
      p_approve: approve,
      p_note: note || null,
    });

    if (rpcError) {
      const message = rpcError.message || "";
      const code = rpcError.code || "";
      if (/already been decided/i.test(message)) {
        return json({ error: "This refund has already been decided. Reload to see its current state." }, 409);
      }
      if (/not found/i.test(message)) {
        return json({ error: "That refund no longer exists." }, 404);
      }
      if (/not authorized/i.test(message) || code === "42501") {
        return json(
          {
            error: "The database refused this decision for this session. Verify your authenticator and retry. Nothing was changed.",
            code: "mfa_required",
          },
          403,
        );
      }
      if (code === "PGRST202" || code === "42883" || /could not find the function/i.test(message)) {
        return json(
          {
            error: "Refund decisions are not enabled on this database: the decision function is not installed. Nothing was changed.",
          },
          503,
        );
      }
      console.error("[admin-refund] decision failed", { code });
      return json({ error: "The refund decision could not be recorded. Nothing was changed." }, 500);
    }

    return json({ ok: true, status: approve ? "processed" : "rejected" });
  } catch (caught) {
    console.error("[admin-refund] unexpected failure", {
      message: caught instanceof Error ? caught.message : "unknown",
    });
    return json({ error: "The refund decision could not be recorded. Nothing was changed." }, 500);
  }
}

export function GET() {
  return notFound();
}
