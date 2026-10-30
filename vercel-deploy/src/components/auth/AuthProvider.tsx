"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/env";

/**
 * One client-side answer to "who is signed in?".
 *
 * Before this, every public page rendered a hard-coded "Log in" button even for a signed-in
 * customer, because the header never asked. That is not an authorization bug — every page and
 * route still authorizes on the server — but it made a signed-in person feel signed out on the
 * marketplace, property pages and search.
 *
 * The session is read from Supabase's own cookie-backed client (never from a hand-rolled token),
 * and `onAuthStateChange` keeps every tab in step: signing out in one tab updates the others.
 *
 * `status` starts as "unknown" so a shell can render a placeholder instead of flashing "Log in"
 * before the session is known. Roles come from the `user_roles` table under its own-row policy;
 * they only decide which workspace links are offered, never what the server allows.
 */

export type ShellUser = {
  id: string;
  email: string | null;
  displayName: string | null;
  roles: string[];
  /**
   * Whether this account has an approved provider activity or application, and whether that
   * includes transport. Derived from the tables that actually grant the work — approval writes a
   * `provider_applications` row and `provider_activities`, never a `user_roles` row, so role names
   * alone would hide the workspace of every real approved provider.
   */
  workspaces: { provider: boolean; rider: boolean };
};

type AuthContextValue = {
  status: "unknown" | "signed-out" | "signed-in";
  user: ShellUser | null;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthContextValue["status"]>("unknown");
  const [user, setUser] = useState<ShellUser | null>(null);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setUser(null);
      setStatus("signed-out");
      return;
    }

    try {
      const supabase = createSupabaseBrowserClient();
      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user) {
        setUser(null);
        setStatus("signed-out");
        return;
      }

      // Roles, profile and workspace eligibility are best-effort: a failure here must not make a
      // signed-in person look signed out, and none of it grants anything — the routes, RPCs and RLS
      // still decide. They only decide which shortcuts are offered.
      const [roleRows, profile, applications, activities] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", data.user.id),
        supabase.from("profiles").select("display_name").eq("id", data.user.id).maybeSingle(),
        supabase
          .from("provider_applications")
          .select("activity_type,status")
          .eq("user_id", data.user.id)
          .eq("status", "approved")
          .limit(20),
        supabase
          .from("provider_activities")
          .select("id")
          .eq("user_id", data.user.id)
          .eq("status", "approved")
          .limit(1),
      ]);

      const roles = (roleRows.data ?? [])
        .map(row => (row as { role?: unknown }).role)
        .filter((role): role is string => typeof role === "string");
      const approved = (applications.data ?? []) as { activity_type?: string }[];
      const hasActivity = (activities.data ?? []).length > 0;
      const rider = approved.some(row => row.activity_type === "transport_partner") || roles.includes("rider");
      const provider = hasActivity || approved.length > 0 || roles.includes("provider");

      setUser({
        id: data.user.id,
        email: data.user.email ?? null,
        displayName: (profile.data as { display_name?: string | null } | null)?.display_name ?? null,
        roles,
        workspaces: { provider, rider },
      });
      setStatus("signed-in");
    } catch {
      setUser(null);
      setStatus("signed-out");
    }
  }, []);

  useEffect(() => {
    void load();
    if (!isSupabaseConfigured()) return;

    const supabase = createSupabaseBrowserClient();
    const { data } = supabase.auth.onAuthStateChange(event => {
      // Token refreshes and multi-tab sign-outs both arrive here.
      if (event === "SIGNED_OUT") {
        setUser(null);
        setStatus("signed-out");
        return;
      }
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") void load();
    });

    return () => data.subscription.unsubscribe();
  }, [load]);

  const signOut = useCallback(async () => {
    // Sign out on the server so the refresh token is revoked, not just forgotten in this tab.
    await fetch("/api/auth/signout", { method: "POST", credentials: "same-origin" });
    setUser(null);
    setStatus("signed-out");
    window.location.assign("/");
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, refresh: load, signOut }),
    [status, user, load, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider.");
  return value;
}
