import "server-only";

/**
 * Server-only environment contract.
 *
 * Never import this module from a client component. Values here must never be serialized to the
 * browser, logged, or returned in an API response. `isMpesaConfigured()` and `isResendConfigured()`
 * exist so routes can fail closed with an honest "not configured" message instead of pretending an
 * integration is live.
 */

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

const mpesaEnv = clean(process.env.MPESA_ENV) === "production" ? "production" : "sandbox";

const mpesa = {
  env: mpesaEnv,
  consumerKey: clean(process.env.MPESA_CONSUMER_KEY),
  consumerSecret: clean(process.env.MPESA_CONSUMER_SECRET),
  shortcode: clean(process.env.MPESA_SHORTCODE),
  passkey: clean(process.env.MPESA_PASSKEY),
  callbackUrl: clean(process.env.MPESA_CALLBACK_URL),
  transactionType: clean(process.env.MPESA_TRANSACTION_TYPE) ?? "CustomerPayBillOnline",
  verifyCallback: clean(process.env.MPESA_VERIFY_CALLBACK) !== "false",
  b2c: {
    initiator: clean(process.env.MPESA_B2C_INITIATOR),
    securityCredential: clean(process.env.MPESA_B2C_SECURITY_CREDENTIAL),
    shortcode: clean(process.env.MPESA_B2C_SHORTCODE),
    resultUrl: clean(process.env.MPESA_B2C_RESULT_URL),
    timeoutUrl: clean(process.env.MPESA_B2C_TIMEOUT_URL),
  },
};

const geocoder = {
  // One of: nominatim, mapbox, google. Empty means no provider is configured.
  provider: (clean(process.env.GEOCODE_PROVIDER) ?? "").toLowerCase(),
  mapboxToken: clean(process.env.MAPBOX_TOKEN),
  googleKey: clean(process.env.GOOGLE_MAPS_API_KEY),
  baseUrl: clean(process.env.GEOCODE_BASE_URL),
  contact: clean(process.env.GEOCODE_CONTACT),
};

export const serverEnv = {
  supabaseServiceRoleKey: clean(process.env.SUPABASE_SERVICE_ROLE_KEY),
  mpesa,
  resendApiKey: clean(process.env.RESEND_API_KEY),
  resendFrom: clean(process.env.RESEND_FROM_EMAIL) ?? "Shilevi <no-reply@shilevi.com>",
  notificationDispatchSecret: clean(process.env.NOTIFICATION_DISPATCH_SECRET),
  cronSecret: clean(process.env.CRON_SECRET),
  vapidPublicKey: clean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY),
  vapidPrivateKey: clean(process.env.VAPID_PRIVATE_KEY),
  vapidSubject: clean(process.env.VAPID_SUBJECT) ?? "mailto:support@shilevi.com",
  geocoder,
} as const;

export function isMpesaConfigured(): boolean {
  return Boolean(
    mpesa.consumerKey &&
      mpesa.consumerSecret &&
      mpesa.shortcode &&
      mpesa.passkey &&
      mpesa.callbackUrl,
  );
}

export function isMpesaB2cConfigured(): boolean {
  return Boolean(
    isMpesaConfigured() &&
      mpesa.b2c.initiator &&
      mpesa.b2c.securityCredential &&
      mpesa.b2c.shortcode &&
      mpesa.b2c.resultUrl &&
      mpesa.b2c.timeoutUrl,
  );
}

export function isResendConfigured(): boolean {
  return Boolean(serverEnv.resendApiKey);
}

/**
 * Web push needs a VAPID key pair. Both halves are required: the public key is what the browser
 * subscribes with, the private key signs the delivery. Without them the dispatcher refuses to run
 * rather than reporting a delivery it did not make.
 */
export function isPushConfigured(): boolean {
  return Boolean(serverEnv.vapidPublicKey && serverEnv.vapidPrivateKey);
}

/**
 * Address lookup needs a provider and its credential. Without both, the app must say so instead of
 * pretending an address resolved.
 */
export function isGeocodeConfigured(): boolean {
  if (geocoder.provider === "nominatim") return Boolean(geocoder.contact || geocoder.baseUrl);
  if (geocoder.provider === "mapbox") return Boolean(geocoder.mapboxToken);
  if (geocoder.provider === "google") return Boolean(geocoder.googleKey);
  return false;
}

export function hasServiceRole(): boolean {
  return Boolean(serverEnv.supabaseServiceRoleKey);
}

/** Daraja base URL. Sandbox and production are distinct; never silently fall back to production. */
export function mpesaBaseUrl(): string {
  return mpesa.env === "production" ? "https://api.safaricom.co.ke" : "https://sandbox.safaricom.co.ke";
}
