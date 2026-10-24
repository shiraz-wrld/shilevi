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

export const serverEnv = {
  supabaseServiceRoleKey: clean(process.env.SUPABASE_SERVICE_ROLE_KEY),
  mpesa,
  resendApiKey: clean(process.env.RESEND_API_KEY),
  resendFrom: clean(process.env.RESEND_FROM_EMAIL) ?? "Shilevi <no-reply@shilevi.com>",
  notificationDispatchSecret: clean(process.env.NOTIFICATION_DISPATCH_SECRET),
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

export function hasServiceRole(): boolean {
  return Boolean(serverEnv.supabaseServiceRoleKey);
}

/** Daraja base URL. Sandbox and production are distinct; never silently fall back to production. */
export function mpesaBaseUrl(): string {
  return mpesa.env === "production" ? "https://api.safaricom.co.ke" : "https://sandbox.safaricom.co.ke";
}
