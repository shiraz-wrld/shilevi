import "server-only";

import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Keep authorization server-only. Never duplicate this decision in a client component.
export const OWNER_ADMIN_EMAILS = new Set([
  "russhiraz565@gmail.com",
  "russhiraz1@gmail.com",
]);

/** Verified owner email check. The database enforces the same allowlist. */
export function isOwnerAdminEmail(email: string | null | undefined): boolean {
  return Boolean(email && OWNER_ADMIN_EMAILS.has(email.trim().toLowerCase()));
}

export type StaffAuthResult =
  | { authorized: true; user: User; mfaLevel: string; staff: boolean }
  | { authorized: false; reason: "configuration" | "forbidden" };

/**
 * Capability-scoped staff gate for the operational admin pages.
 *
 * A verified owner is admitted (the database still enforces MFA on every write). A non-owner is
 * admitted only when `has_staff_capability` returns true, which requires a confirmed email, MFA
 * assurance level 2 and an unrevoked grant. Hiding navigation is never treated as authorization.
 */
export async function requireStaffCapability(capability: string): Promise<StaffAuthResult> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    return { authorized: false, reason: "configuration" };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) redirect(`/login?next=${encodeURIComponent("/admin")}`);

  const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const mfaLevel = assurance?.currentLevel ?? "aal1";
  const owner = isOwnerAdminEmail(data.user.email) && Boolean(data.user.email_confirmed_at);

  if (!owner) {
    const { data: allowed, error: capabilityError } = await supabase.rpc("has_staff_capability", {
      p_capability: capability,
    });
    if (capabilityError || allowed !== true) {
      return { authorized: false, reason: "forbidden" };
    }
  }

  return { authorized: true, user: data.user, mfaLevel, staff: !owner };
}

export async function requireOwnerAdmin() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    return { authorized: false as const, reason: "configuration" as const };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) redirect("/login?next=%2Fadmin");

  const email = data.user.email?.trim().toLowerCase();
  const verified = Boolean(data.user.email_confirmed_at);
  if (!verified || !isOwnerAdminEmail(email)) {
    return { authorized: false as const, reason: "forbidden" as const };
  }

  const { data: assurance, error: assuranceError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const mfaLevel = assuranceError ? "aal1" : assurance.currentLevel;
  return { authorized: true as const, user: data.user, mfaLevel };
}
