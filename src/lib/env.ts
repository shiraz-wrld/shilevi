/**
 * Environment contract.
 *
 * Two rules:
 * 1. Public values are read only through `publicEnv` and must start with NEXT_PUBLIC_.
 * 2. Server secrets are read only inside server code and never passed to a client component.
 *
 * `isSupabaseConfigured()` lets pages render a setup message instead of crashing before the
 * project has been connected.
 */

export type PublicEnv = {
  supabaseUrl: string | null;
  supabasePublishableKey: string | null;
  siteUrl: string | null;
};

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export const publicEnv: PublicEnv = {
  supabaseUrl: clean(process.env.NEXT_PUBLIC_SUPABASE_URL),
  supabasePublishableKey: clean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
  siteUrl: clean(process.env.NEXT_PUBLIC_SITE_URL),
};

export function isSupabaseConfigured(): boolean {
  return Boolean(publicEnv.supabaseUrl && publicEnv.supabasePublishableKey);
}

/** Fails fast in server code that cannot work without a database. */
export function requireSupabaseConfig() {
  if (!isSupabaseConfigured()) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY."
    );
  }
  return {
    url: publicEnv.supabaseUrl as string,
    key: publicEnv.supabasePublishableKey as string,
  };
}
