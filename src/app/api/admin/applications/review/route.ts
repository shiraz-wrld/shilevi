import "server-only";

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isOwnerAdminEmail } from "@/lib/admin/allowlist";
import { isSameOriginRequest } from "@/lib/security/origin";
import { clientKey, rateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/applications/review
 *
 * Approves or rejects one pending provider application.
 *
 * Why this route exists: the screen used to issue a browser-side table UPDATE and report every
 * failure with one hard-coded sentence about migration 0006. A PostgREST error is not an `Error`
 * instance, so the real cause was thrown away and the operator was told to apply a migration that
 * was already installed. Three further problems came with the same design:
 *
 *   1. When row level security filtered the row out, PostgREST returned *zero rows* and no error,
 *      so the screen printed "approved" for a decision that never happened.
 *   2. Self-review was only discovered by the trigger, so the operator saw a generic failure.
 *   3. Nothing distinguished "already decided" from "not permitted" from "MFA too low".
 *
 * Authorization is unchanged and deliberately not duplicated in the browser: the request is made
 * with the owner's own session, so `is_shilevi_owner_admin()` (allowlist + confirmed email + aal2)
 * still decides visibility inside the `provider_applications_admin_review` policy, and
 * `guard_provider_application_transition()` still rejects illegal transitions, self-review and
 * missing rejection reasons. This route only classifies the outcome honestly.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 4_096;

const REVIEWABLE = new Set(["pending", "under_review"]);
const DECISIONS = new Set(["approved", "rejected"]);

type Body = { applicationId?: unknown; decision?: unknown; note?: unknown };

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** Unauthorized callers get exactly what a route that does not exist returns. */
function notFound() {
  return json({ error: "Not found" }, 404);
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return notFound();

  const limit = rateLimit(clientKey(request, "admin-application-review"), 30, 60_000);
  if (!limit.allowed) {
    return json({ error: "Too many review attempts. Wait a minute and try again." }, 429);
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return json({ error: "Request is too large." }, 413);

  let body: Body;
  try {
    body = JSON.parse(raw) as Body;
  } catch {
    return json({ error: "Invalid JSON." }, 400);
  }

  const applicationId = typeof body.applicationId === "string" ? body.applicationId : "";
  const decision = typeof body.decision === "string" ? body.decision : "";
  const note = typeof body.note === "string" ? body.note.trim() : "";

  if (!UUID.test(applicationId) || !DECISIONS.has(decision)) {
    return json({ error: "An application id and a decision of approved or rejected are required." }, 400);
  }
  if (note.length > 1000) {
    return json({ error: "The review note must be 1000 characters or fewer." }, 400);
  }
  if (decision === "rejected" && note.length < 5) {
    return json({ error: "Explain the reason for rejecting an application." }, 400);
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    return json({ error: "Application review is unavailable on this deployment." }, 503);
  }

  const supabase = await createSupabaseServerClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return notFound();

  const user = userData.user;
  const email = user.email?.trim().toLowerCase() ?? null;
  if (!user.email_confirmed_at || !isOwnerAdminEmail(email)) return notFound();

  const { data: assurance, error: assuranceError } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assuranceError || assurance?.currentLevel !== "aal2") {
    return json(
      {
        error:
          "Reviewing an application requires MFA assurance level 2. Verify your authenticator, then try again. Nothing was changed.",
        code: "mfa_required",
      },
      403,
    );
  }

  // Read the current row first so the operator gets the true reason: gone, self-review, already
  // decided, or refused. A missing row here also covers a session the policy no longer admits.
  const { data: current, error: readError } = await supabase
    .from("provider_applications")
    .select("id,user_id,status")
    .eq("id", applicationId)
    .maybeSingle<{ id: string; user_id: string; status: string }>();

  if (readError) {
    const code = readError.code ?? "";
    if (code === "PGRST202" || code === "42P01") {
      return json(
        { error: "The applications table is not available on this database. Nothing was changed." },
        503,
      );
    }
    if (code === "42501" || code === "PGRST301") {
      return notFound();
    }
    console.error("[admin-application-review] read failed", { code });
    return json({ error: "The application could not be read. Nothing was changed." }, 500);
  }

  if (!current) {
    return json({ error: "That application no longer exists, or this session cannot see it." }, 404);
  }
  if (current.user_id === user.id) {
    return json(
      {
        error: "You cannot review your own application. Ask the other owner account to decide it.",
        code: "self_review",
      },
      409,
    );
  }
  if (!REVIEWABLE.has(current.status)) {
    return json(
      {
        error: `This application is already ${current.status.replace("_", " ")}. Reload the queue to see its current state.`,
        code: "already_decided",
        status: current.status,
      },
      409,
    );
  }

  const reviewedAt = new Date().toISOString();
  const { data: updated, error: updateError } = await supabase
    .from("provider_applications")
    .update({
      status: decision,
      reviewed_at: reviewedAt,
      reviewed_by: user.id,
      reviewer_note: note || null,
      rejection_reason: decision === "rejected" ? note : null,
    })
    .eq("id", applicationId)
    .in("status", ["pending", "under_review"])
    .select("id,status");

  if (updateError) {
    const message = updateError.message ?? "";
    const code = updateError.code ?? "";

    if (/own provider application/i.test(message)) {
      return json(
        {
          error: "You cannot review your own application. Ask the other owner account to decide it.",
          code: "self_review",
        },
        409,
      );
    }
    if (/rejection reason is required/i.test(message)) {
      return json({ error: "A rejection reason is required.", code: "note_required" }, 400);
    }
    if (/transition is not permitted|only status and review metadata/i.test(message)) {
      return json(
        {
          error:
            "The database refused this transition. Reload the queue: the application may have changed since it was loaded.",
          code: "invalid_transition",
        },
        409,
      );
    }
    if (/permission denied for (table|column)/i.test(message)) {
      return json(
        {
          error:
            "This session cannot write the review columns. Confirm the owner account and its MFA level, then retry. Nothing was changed.",
          code: "permission",
        },
        403,
      );
    }
    if (code === "42501" || /not authorized|row-level security/i.test(message)) {
      return notFound();
    }
    if (code === "PGRST202" || code === "42P01") {
      return json(
        { error: "The applications table is not available on this database. Nothing was changed." },
        503,
      );
    }

    console.error("[admin-application-review] update failed", { code });
    return json({ error: "The review could not be recorded. Nothing was changed." }, 500);
  }

  if (!updated || updated.length === 0) {
    // Zero rows means the row was filtered out or its status moved between read and write. Never
    // report success here: that is exactly how the previous screen faked a decision.
    return json(
      {
        error:
          "The decision did not apply — another reviewer changed this application, or this session lost permission. Reload the queue.",
        code: "no_rows",
      },
      409,
    );
  }

  return json({ ok: true, id: applicationId, status: decision, reviewedAt, reviewNote: note || null });
}

export function GET() {
  return notFound();
}
