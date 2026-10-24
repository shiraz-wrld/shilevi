import { createBrowserClient } from "@supabase/ssr";

let browserClient: ReturnType<typeof createBrowserClient> | undefined;

/**
 * Creates a browser-safe Supabase client.
 * Only the project URL and publishable/anon key may be used here.
 * Never place a service-role key or payment secret in NEXT_PUBLIC_* variables.
 */
export function createSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Supabase is not configured yet. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to .env.local, then restart the development server."
    );
  }

  if (!browserClient) browserClient = createBrowserClient(url, key);
  return browserClient;
}
