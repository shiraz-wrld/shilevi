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
  /** VAPID public key for web push. Public by design; the private key never leaves the server. */
  vapidPublicKey: string | null;
};

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export const publicEnv: PublicEnv = {
  supabaseUrl: clean(process.env.NEXT_PUBLIC_SUPABASE_URL),
  supabasePublishableKey: clean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
  siteUrl: clean(process.env.NEXT_PUBLIC_SITE_URL),
  vapidPublicKey: clean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY),
};

/** Push can only be enabled when the browser has a public key to subscribe with. */
export function isPushClientConfigured(): boolean {
  return Boolean(publicEnv.vapidPublicKey);
}

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
