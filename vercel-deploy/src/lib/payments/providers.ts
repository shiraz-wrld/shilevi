import "server-only";

import { isMpesaB2cConfigured, isMpesaConfigured } from "@/lib/env.server";

/**
 * Payment provider readiness.
 *
 * The database records the owner's *intent* (`payment_methods.enabled`). This module records whether
 * the deployment can actually charge with that provider, derived only from server-side credentials.
 * A method is offered at checkout only when both agree. That way an owner cannot make an
 * unconfigured provider look operational by flipping a toggle, and enabling a provider never
 * silently falls back to sandbox money.
 */

export type PaymentProviderId = "mpesa" | "card" | "airtel_money" | "mock";
export type PaymentPurpose = "order" | "ride" | "property_contact";

export const PROVIDER_LABELS: Record<PaymentProviderId, string> = {
  mpesa: "M-Pesa",
  card: "Card (Visa or Mastercard)",
  airtel_money: "Airtel Money",
  mock: "Sandbox payment",
};

export type ProviderReadiness = {
  provider: PaymentProviderId;
  label: string;
  /** True only when the server holds everything needed to start a real charge. */
  configured: boolean;
  /** Plain-language reason the provider cannot be used yet, or null when it can. */
  blocker: string | null;
  /** What the provider is allowed to pay for once implemented. */
  purposes: PaymentPurpose[];
  /** Whether the integration can move real money. */
  live: boolean;
  /** True for the sandbox path, which never touches a provider. */
  sandbox: boolean;
};

const PURPOSES: PaymentPurpose[] = ["order", "ride", "property_contact"];

type ReadinessOptions = {
  /** True only when payment_mode = "mock" AND allow_mock_payments = true. */
  mockAllowed: boolean;
};

export function providerReadiness(
  provider: PaymentProviderId,
  options: ReadinessOptions,
): ProviderReadiness {
  const base = {
    provider,
    label: PROVIDER_LABELS[provider],
    purposes: PURPOSES,
    live: provider !== "mock",
    sandbox: provider === "mock",
  };

  switch (provider) {
    case "mpesa":
      return {
        ...base,
        configured: isMpesaConfigured(),
        blocker: isMpesaConfigured()
          ? null
          : "Daraja is not configured. Set MPESA_ENV, MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET, MPESA_SHORTCODE, MPESA_PASSKEY and MPESA_CALLBACK_URL.",
      };
    case "card":
      return {
        ...base,
        configured: false,
        blocker:
          "No card gateway has been selected. Choosing a licensed gateway and its hosted, tokenised checkout is an owner decision; no card data may be stored by Shilevi.",
      };
    case "airtel_money":
      return {
        ...base,
        configured: false,
        blocker:
          "The Airtel Money merchant integration is not implemented. It needs a merchant account, client credentials and the provider's documented callback contract.",
      };
    case "mock":
      return {
        ...base,
        configured: options.mockAllowed,
        blocker: options.mockAllowed
          ? null
          : "Sandbox money is off. It requires payment_mode = mock and allow_mock_payments = true, and must never be enabled on a deployment that is taking real payments.",
      };
  }
}

/**
 * Used by the owner configuration screen. Includes blockers, so it is owner-only.
 */
export function providerReadinessReport(options: ReadinessOptions): ProviderReadiness[] {
  return (Object.keys(PROVIDER_LABELS) as PaymentProviderId[]).map(provider =>
    providerReadiness(provider, options),
  );
}

/**
 * Used by checkout. Never returns blockers or environment detail, only usable methods.
 */
export function usableMethods(
  providers: string[],
  options: ReadinessOptions,
): { provider: PaymentProviderId; label: string; sandbox: boolean }[] {
  return providers
    .filter((provider): provider is PaymentProviderId => provider in PROVIDER_LABELS)
    .map(provider => providerReadiness(provider, options))
    .filter(status => status.configured)
    .map(status => ({ provider: status.provider, label: status.label, sandbox: status.sandbox }));
}

/** B2C readiness is reported separately because payouts are a different Daraja product. */
export function payoutReadiness(): { configured: boolean; blocker: string | null } {
  return isMpesaB2cConfigured()
    ? { configured: true, blocker: null }
    : {
        configured: false,
        blocker:
          "M-Pesa B2C is not configured. Withdrawals stay pending until MPESA_B2C_* credentials are set and approved.",
      };
}
