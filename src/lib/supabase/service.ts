import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { hasServiceRole, serverEnv } from "@/lib/env.server";

/**
 * Service-role client for trusted server work only: provider callbacks, payout settlement and the
 * notification dispatcher. It bypasses RLS, so every call site must have independently verified
 * the actor and the amount. Never import it into a client component or return it from a route.
 */
export function createSupabaseServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url || !hasServiceRole()) {
    throw new Error("Supabase service role is not configured.");
  }
  return createClient(url, serverEnv.supabaseServiceRoleKey as string, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { "X-Client-Info": "shilevi-server" } },
  });
}
