import "server-only";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { capabilitiesFor, isRole, type Capability, type Role } from "@/lib/permissions/capabilities";

/**
 * Server-side session and capability guards.
 *
 * Every protected page, route handler and server action must call one of these. A redirect in the
 * browser is convenience, never authorization: database policies and security-definer functions
 * must reject the same request independently.
 */

export type AuthUser = {
  id: string;
  email: string | null;
  emailVerified: boolean;
  roles: Role[];
  capabilities: Set<Capability>;
};

/** Returns the signed-in user with roles, or null. Never throws for a signed-out visitor. */
export async function getAuthUser(): Promise<AuthUser | null> {
  if (!isSupabaseConfigured()) return null;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;

  const { data: roleRows } = await supabase.from("user_roles").select("role").eq("user_id", data.user.id);
  const roles: Role[] = [];
  for (const row of roleRows ?? []) {
    const role = (row as { role?: unknown }).role;
    if (isRole(role) && !roles.includes(role)) roles.push(role);
  }
  if (!roles.includes("customer")) roles.unshift("customer");

  return {
    id: data.user.id,
    email: data.user.email ?? null,
    emailVerified: Boolean(data.user.email_confirmed_at),
    roles,
    capabilities: capabilitiesFor(roles),
  };
}

/** Redirects signed-out visitors to login and remembers where they were going. */
export async function requireUser(nextPath = "/account"): Promise<AuthUser> {
  const user = await getAuthUser();
  if (!user) {
    const safeNext = nextPath.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/account";
    redirect(`/login?next=${encodeURIComponent(safeNext)}`);
  }
  return user;
}

/** Requires an authenticated, email-verified account holding the capability. */
export async function requireCapability(capability: Capability, nextPath = "/admin"): Promise<AuthUser> {
  const user = await requireUser(nextPath);
  if (!user.emailVerified || !user.capabilities.has(capability)) {
    redirect("/account?error=not-authorized");
  }
  return user;
}

/** Owner-only surface: two allowlisted, email-verified staff accounts with MFA. See lib/admin/auth. */
export { requireOwnerAdmin } from "@/lib/admin/auth";
