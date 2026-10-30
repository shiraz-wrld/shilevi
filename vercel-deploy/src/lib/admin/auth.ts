import "server-only";

import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { readAssurance, type Assurance } from "@/lib/auth/mfa";
import { decideOwnerGate, decideStaffGate, stepUpDestination } from "@/lib/admin/access";
import { OWNER_ADMIN_EMAILS, isOwnerAdminEmail } from "@/lib/admin/allowlist";

/**
 * Server-side authorization for the owner console.
 *
 * Rules this file exists to enforce:
 * 1. Only the two allowlisted, email-verified owner accounts may reach owner pages at all.
 * 2. A privileged page requires aal2. An aal1 owner is sent to the real TOTP challenge, not shown a
 *    denial page and not told to "apply a migration".
 * 3. Everyone else gets `notFound()`. That renders the ordinary 404 with HTTP 404: no "Access
 *    denied", no admin navigation, no hint that the route or an allowlist exists.
 * 4. Staff capabilities remain separate. Being an owner does not create a capability row, and a
 *    capability never grants owner-only settings, payouts or staff administration.
 *
 * The database independently enforces the same allowlist and aal2 inside `is_shilevi_owner_admin()`
 * and `has_staff_capability()`, so hiding a route is never the only protection.
 */

// Server-side configuration of the two designated owners lives in `lib/admin/allowlist.ts`, which
// middleware also imports. Re-exported here so route handlers keep one import site.
export { OWNER_ADMIN_EMAILS, isOwnerAdminEmail };

export type AdminSession = { user: User; mfaLevel: Assurance["currentLevel"] };

/** The path the request was for, supplied by middleware. Used only to resume after a step-up. */
async function currentAdminPath(): Promise<string> {
  const store = await headers();
  return stepUpDestination(store.get("x-shilevi-path"), "/admin");
}

async function continueOrStepUp(
  decision: "allow" | "step-up" | "enroll",
  path: string,
  mfaLevel: Assurance["currentLevel"],
  user: User,
): Promise<AdminSession> {
  if (decision === "step-up") {
    redirect(`/login/mfa?next=${encodeURIComponent(path)}`);
  }
  if (decision === "enroll") {
    // A verified owner with no authenticator can only reach the setup surface at aal1.
    redirect("/admin/security?setup=1");
  }
  return { user, mfaLevel };
}

/**
 * Owner-only surface. Returns the session or terminates the response by concealing the route.
 * Pass `allowAal1` only for the MFA setup page itself, which has to be reachable before a factor
 * exists.
 */
export async function requireOwnerAdmin(options: { allowAal1?: boolean } = {}): Promise<AdminSession> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    notFound();
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) notFound();

  const email = data.user.email?.trim().toLowerCase() ?? null;
  const ownerEmail = isOwnerAdminEmail(email) && Boolean(data.user.email_confirmed_at);
  if (!ownerEmail) notFound();

  const assurance = await readAssurance(supabase);
  const decision = decideOwnerGate({
    hasSession: true,
    emailVerified: true,
    ownerEmail: true,
    currentLevel: assurance.currentLevel,
    hasVerifiedFactor: assurance.hasVerifiedFactor,
    requireAal2: options.allowAal1 !== true,
  });

  if (decision === "conceal") notFound();
  return continueOrStepUp(decision, await currentAdminPath(), assurance.currentLevel, data.user);
}

/**
 * Capability-scoped gate for operational console pages.
 *
 * A non-owner is admitted only when the database confirms the capability for this exact request,
 * which itself requires aal2 and an unrevoked grant. Anything else is concealed.
 */
export async function requireStaffCapability(
  capability: string,
): Promise<AdminSession & { staff: boolean }> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    notFound();
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) notFound();

  const user = data.user;
  const email = user.email?.trim().toLowerCase() ?? null;
  const verified = Boolean(user.email_confirmed_at);
  const ownerEmail = isOwnerAdminEmail(email) && verified;
  const assurance = await readAssurance(supabase);

  if (ownerEmail) {
    const ownerDecision = decideOwnerGate({
      hasSession: true,
      emailVerified: true,
      ownerEmail: true,
      currentLevel: assurance.currentLevel,
      hasVerifiedFactor: assurance.hasVerifiedFactor,
      requireAal2: true,
    });
    if (ownerDecision === "conceal") notFound();
    const session = await continueOrStepUp(
      ownerDecision,
      await currentAdminPath(),
      assurance.currentLevel,
      user,
    );
    return { ...session, staff: false };
  }

  // Read this account's own grants with its own session. The RLS policy permits self rows, so this
  // reveals nothing about other people and needs no service role.
  const { data: grants, error: grantError } = await supabase
    .from("staff_capabilities")
    .select("capability")
    .eq("user_id", user.id)
    .is("revoked_at", null);
  const hasActiveGrant = !grantError && (grants?.length ?? 0) > 0;

  let capabilitySatisfied = false;
  if (hasActiveGrant && assurance.currentLevel === "aal2") {
    const { data: allowed, error: capabilityError } = await supabase.rpc("has_staff_capability", {
      p_capability: capability,
    });
    capabilitySatisfied = !capabilityError && allowed === true;
  }

  const decision = decideStaffGate({
    hasSession: true,
    emailVerified: verified,
    ownerEmail: false,
    currentLevel: assurance.currentLevel,
    hasVerifiedFactor: assurance.hasVerifiedFactor,
    hasActiveGrant,
    capabilitySatisfied,
  });

  if (decision === "conceal") notFound();
  const session = await continueOrStepUp(decision, await currentAdminPath(), assurance.currentLevel, user);
  return { ...session, staff: true };
}
