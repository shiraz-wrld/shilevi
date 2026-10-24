import "server-only";

import { isMpesaB2cConfigured, isMpesaConfigured, mpesaBaseUrl, serverEnv } from "@/lib/env.server";

/**
 * Safaricom Daraja client.
 *
 * Scope of this module:
 *   * OAuth token acquisition.
 *   * STK Push initiation (customer pays).
 *   * STK Push status query, used to verify a callback before money is credited.
 *   * B2C payout initiation (platform pays a rider or provider).
 *
 * It never marks a payment successful by itself. Only the callback route, after verifying the
 * provider response and amount, calls the database's service-role confirmation function.
 */

const TIMEOUT_MS = 15_000;

export class MpesaError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 502,
  ) {
    super(message);
    this.name = "MpesaError";
  }
}

function requireConfig() {
  if (!isMpesaConfigured()) {
    throw new MpesaError("M-Pesa is not configured on this deployment.", "not_configured", 503);
  }
  return serverEnv.mpesa;
}

function darajaTimestamp(date = new Date()): string {
  // Daraja expects local Nairobi time (UTC+3) in YYYYMMDDHHmmss form, regardless of server TZ.
  const nairobi = new Date(date.getTime() + 3 * 60 * 60 * 1000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${nairobi.getUTCFullYear()}${pad(nairobi.getUTCMonth() + 1)}${pad(nairobi.getUTCDate())}` +
    `${pad(nairobi.getUTCHours())}${pad(nairobi.getUTCMinutes())}${pad(nairobi.getUTCSeconds())}`
  );
}

function password(shortcode: string, passkey: string, timestamp: string): string {
  return Buffer.from(`${shortcode}${passkey}${timestamp}`, "utf8").toString("base64");
}

/** Accepts 07xx, 01xx, +2547xx, 2547xx and returns the 2547xxxxxxxx form. */
export function normalizeKenyanPhone(input: string): string | null {
  const digits = input.replace(/[^0-9]/g, "");
  if (/^254(7|1)\d{8}$/.test(digits)) return digits;
  if (/^0(7|1)\d{8}$/.test(digits)) return `254${digits.slice(1)}`;
  if (/^(7|1)\d{8}$/.test(digits)) return `254${digits}`;
  return null;
}

async function fetchDaraja(pathname: string, init: RequestInit, token?: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${mpesaBaseUrl()}${pathname}`, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });
  } catch (error) {
    throw new MpesaError(
      error instanceof Error && error.name === "AbortError"
        ? "The M-Pesa provider timed out."
        : "The M-Pesa provider could not be reached.",
      "network",
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function accessToken(): Promise<string> {
  const config = requireConfig();
  const credentials = Buffer.from(`${config.consumerKey}:${config.consumerSecret}`, "utf8").toString("base64");
  const response = await fetchDaraja("/oauth/v1/generate?grant_type=client_credentials", {
    method: "GET",
    headers: { Authorization: `Basic ${credentials}` },
  });

  if (!response.ok) {
    throw new MpesaError("M-Pesa authentication failed. Check the consumer key and secret.", "auth");
  }

  const body = (await response.json()) as { access_token?: string; expires_in?: string };
  if (!body.access_token) {
    throw new MpesaError("M-Pesa authentication returned no token.", "auth");
  }
  return body.access_token;
}

export type StkPushResult = {
  merchantRequestId: string;
  checkoutRequestId: string;
  customerMessage: string;
};

export async function initiateStkPush(input: {
  phone: string;
  amountMinor: number;
  accountReference: string;
  description: string;
}): Promise<StkPushResult> {
  const config = requireConfig();
  const phone = normalizeKenyanPhone(input.phone);
  if (!phone) {
    throw new MpesaError("Enter a valid Safaricom number, for example 0712 345 678.", "invalid_phone", 400);
  }
  if (!Number.isInteger(input.amountMinor) || input.amountMinor < 100) {
    throw new MpesaError("The amount is below the minimum M-Pesa charge.", "invalid_amount", 400);
  }

  const amount = Math.round(input.amountMinor / 100);
  if (amount < 1) {
    throw new MpesaError("The amount must be at least KSh 1.", "invalid_amount", 400);
  }

  const timestamp = darajaTimestamp();
  const token = await accessToken();

  const response = await fetchDaraja("/mpesa/stkpush/v1/processrequest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      BusinessShortCode: config.shortcode,
      Password: password(config.shortcode!, config.passkey!, timestamp),
      Timestamp: timestamp,
      TransactionType: config.transactionType,
      Amount: amount,
      PartyA: phone,
      PartyB: config.shortcode,
      PhoneNumber: phone,
      CallBackURL: config.callbackUrl,
      AccountReference: input.accountReference.slice(0, 12),
      TransactionDesc: input.description.slice(0, 120),
    }),
  }, token);

  const body = (await response.json().catch(() => ({}))) as {
    MerchantRequestID?: string;
    CheckoutRequestID?: string;
    CustomerMessage?: string;
    errorMessage?: string;
    ResponseCode?: string;
  };

  if (!response.ok || !body.CheckoutRequestID) {
    throw new MpesaError(body.errorMessage ?? "M-Pesa rejected the payment request.", body.ResponseCode ?? "stk_rejected");
  }

  return {
    merchantRequestId: body.MerchantRequestID ?? "",
    checkoutRequestId: body.CheckoutRequestID,
    customerMessage: body.CustomerMessage ?? "Check your phone and enter your M-Pesa PIN.",
  };
}

export type StkStatus = { success: boolean; resultCode: string; description: string };

/**
 * Ask Daraja what actually happened. A browser or third party can POST to a callback URL; this
 * query is what makes the callback trustworthy. If it cannot be verified, the payment is not
 * credited.
 */
export async function queryStkStatus(checkoutRequestId: string): Promise<StkStatus> {
  const config = requireConfig();
  const timestamp = darajaTimestamp();
  const token = await accessToken();

  const response = await fetchDaraja("/mpesa/stkpushquery/v1/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      BusinessShortCode: config.shortcode,
      Password: password(config.shortcode!, config.passkey!, timestamp),
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId,
    }),
  }, token);

  const body = (await response.json().catch(() => ({}))) as {
    ResultCode?: string | number;
    ResultDesc?: string;
    errorMessage?: string;
  };

  const code = String(body.ResultCode ?? "");
  return {
    success: response.ok && code === "0",
    resultCode: code || "unknown",
    description: body.ResultDesc ?? body.errorMessage ?? "No status returned.",
  };
}

export type ParsedStkCallback = {
  checkoutRequestId: string;
  merchantRequestId: string;
  resultCode: string;
  resultDescription: string;
  amountMinor: number | null;
  receipt: string | null;
};

/** Parses the StkCallback envelope without trusting any field as proof of payment. */
export function parseStkCallback(payload: unknown): ParsedStkCallback | null {
  if (!payload || typeof payload !== "object") return null;
  const body = (payload as Record<string, unknown>).Body;
  if (!body || typeof body !== "object") return null;
  const callback = (body as Record<string, unknown>).stkCallback;
  if (!callback || typeof callback !== "object") return null;

  const record = callback as Record<string, unknown>;
  const checkoutRequestId = typeof record.CheckoutRequestID === "string" ? record.CheckoutRequestID : "";
  if (!checkoutRequestId) return null;

  const metadata = record.CallbackMetadata as { Item?: Array<{ Name?: string; Value?: unknown }> } | undefined;
  const items = Array.isArray(metadata?.Item) ? metadata.Item : [];
  const value = (name: string) => items.find(item => item?.Name === name)?.Value;

  const rawAmount = value("Amount");
  const amount = typeof rawAmount === "number" ? rawAmount : Number(rawAmount);
  const receipt = value("MpesaReceiptNumber");

  return {
    checkoutRequestId,
    merchantRequestId: typeof record.MerchantRequestID === "string" ? record.MerchantRequestID : "",
    resultCode: String(record.ResultCode ?? ""),
    resultDescription: typeof record.ResultDesc === "string" ? record.ResultDesc : "",
    amountMinor: Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : null,
    receipt: typeof receipt === "string" ? receipt.slice(0, 40) : null,
  };
}

export type B2cResult = { conversationId: string; originatorConversationId: string };

/**
 * Sends money from the platform's B2C shortcode to a rider/provider phone. A successful HTTP
 * response only means Safaricom accepted the request; the final result arrives asynchronously at
 * the result URL and must be verified there.
 */
export async function initiateB2cPayout(input: {
  phone: string;
  amountMinor: number;
  remarks: string;
  occasion: string;
}): Promise<B2cResult> {
  if (!isMpesaB2cConfigured()) {
    throw new MpesaError("M-Pesa B2C payouts are not configured on this deployment.", "not_configured", 503);
  }
  requireConfig();
  const phone = normalizeKenyanPhone(input.phone);
  if (!phone) {
    throw new MpesaError("The payout phone number is not a valid Safaricom number.", "invalid_phone", 400);
  }
  if (!Number.isInteger(input.amountMinor) || input.amountMinor < 100) {
    throw new MpesaError("The payout amount is too small.", "invalid_amount", 400);
  }

  const token = await accessToken();
  const response = await fetchDaraja("/mpesa/b2c/v1/paymentrequest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      InitiatorName: serverEnv.mpesa.b2c.initiator,
      SecurityCredential: serverEnv.mpesa.b2c.securityCredential,
      CommandID: "BusinessPayment",
      Amount: Math.round(input.amountMinor / 100),
      PartyA: serverEnv.mpesa.b2c.shortcode,
      PartyB: phone,
      Remarks: input.remarks.slice(0, 100),
      QueueTimeOutURL: serverEnv.mpesa.b2c.timeoutUrl,
      ResultURL: serverEnv.mpesa.b2c.resultUrl,
      Occasion: input.occasion.slice(0, 100),
    }),
  }, token);

  const body = (await response.json().catch(() => ({}))) as {
    ConversationID?: string;
    OriginatorConversationID?: string;
    ResponseCode?: string;
    errorMessage?: string;
  };

  if (!response.ok || body.ResponseCode !== "0" || !body.ConversationID) {
    throw new MpesaError(body.errorMessage ?? "Safaricom rejected the payout request.", body.ResponseCode ?? "b2c_rejected");
  }

  return {
    conversationId: body.ConversationID,
    originatorConversationId: body.OriginatorConversationID ?? "",
  };
}
