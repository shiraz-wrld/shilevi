import { assertMinor, roundHalfUp, roundToStep } from "./money";

export const DEFAULT_COMMISSION_RATE_BPS = 1_000; // 10.00%

export type CommissionBase = "item_subtotal" | "customer_total" | "provider_earning";
export type CommissionPayer = "provider" | "customer";
export type CommissionRounding = "none" | "nearest_1" | "nearest_5" | "nearest_10";

export type CommissionRule = {
  id: string;
  scope: "global" | "division" | "category" | "activity" | "vehicle" | "town";
  base: CommissionBase;
  rateBps: number;
  minFeeMinor: number;
  maxFeeMinor: number | null;
  rounding: CommissionRounding;
  payer: CommissionPayer;
  effectiveFrom: string;
  effectiveTo?: string | null;
};

export type CommissionInput = {
  itemSubtotalMinor: number;
  deliveryFeeMinor?: number;
  taxMinor?: number;
  discountMinor?: number;
};

export type CommissionResult = {
  ruleId: string;
  rateBps: number;
  baseMinor: number;
  commissionMinor: number;
  providerNetMinor: number;
  customerTotalMinor: number;
  deliveryFeeMinor: number;
  taxMinor: number;
  discountMinor: number;
};

export const DEFAULT_COMMISSION_RULE: CommissionRule = {
  id: "default-10-item-subtotal",
  scope: "global",
  base: "item_subtotal",
  rateBps: DEFAULT_COMMISSION_RATE_BPS,
  minFeeMinor: 0,
  maxFeeMinor: null,
  rounding: "nearest_1",
  payer: "provider",
  effectiveFrom: "2026-01-01T00:00:00.000Z",
  effectiveTo: null,
};

export const DEFAULT_DELIVERY_COMMISSION_RULE: CommissionRule = {
  id: "default-10-delivery-fee",
  scope: "activity",
  base: "item_subtotal",
  rateBps: DEFAULT_COMMISSION_RATE_BPS,
  minFeeMinor: 0,
  maxFeeMinor: null,
  rounding: "nearest_1",
  payer: "provider",
  effectiveFrom: "2026-01-01T00:00:00.000Z",
  effectiveTo: null,
};

function roundingStep(rounding: CommissionRounding): number {
  switch (rounding) {
    case "nearest_1":
      return 100;
    case "nearest_5":
      return 500;
    case "nearest_10":
      return 1_000;
    case "none":
      return 1;
    default:
      return 1;
  }
}

function commissionBase(input: Required<CommissionInput>, rule: CommissionRule): number {
  switch (rule.base) {
    case "item_subtotal":
      return input.itemSubtotalMinor;
    case "customer_total":
      return Math.max(
        0,
        input.itemSubtotalMinor + input.deliveryFeeMinor + input.taxMinor - input.discountMinor,
      );
    case "provider_earning":
      return Math.max(0, input.itemSubtotalMinor - input.discountMinor);
    default:
      return input.itemSubtotalMinor;
  }
}

function clampCommission(value: number, rule: CommissionRule, base: number): number {
  let next = value;
  if (rule.minFeeMinor > 0) next = Math.max(next, rule.minFeeMinor);
  if (rule.maxFeeMinor !== null) next = Math.min(next, rule.maxFeeMinor);
  return Math.max(0, Math.min(next, base));
}

export function calculateCommission(
  input: CommissionInput,
  rule: CommissionRule = DEFAULT_COMMISSION_RULE,
): CommissionResult {
  const normalized: Required<CommissionInput> = {
    itemSubtotalMinor: input.itemSubtotalMinor,
    deliveryFeeMinor: input.deliveryFeeMinor ?? 0,
    taxMinor: input.taxMinor ?? 0,
    discountMinor: input.discountMinor ?? 0,
  };

  assertMinor(normalized.itemSubtotalMinor, "itemSubtotalMinor");
  assertMinor(normalized.deliveryFeeMinor, "deliveryFeeMinor");
  assertMinor(normalized.taxMinor, "taxMinor");
  assertMinor(normalized.discountMinor, "discountMinor");

  if (!Number.isFinite(rule.rateBps) || rule.rateBps < 0 || rule.rateBps > 10_000) {
    throw new Error("Commission rate must be between 0 and 10,000 basis points.");
  }

  const base = commissionBase(normalized, rule);
  const raw = (base * rule.rateBps) / 10_000;
  const rounded =
    rule.rounding === "none" ? roundHalfUp(raw) : roundToStep(raw, roundingStep(rule.rounding));
  const commissionMinor = clampCommission(rounded, rule, base);

  const providerNetMinor =
    rule.payer === "provider"
      ? Math.max(0, normalized.itemSubtotalMinor - commissionMinor)
      : normalized.itemSubtotalMinor;

  const customerTotalMinor = Math.max(
    0,
    normalized.itemSubtotalMinor +
      normalized.deliveryFeeMinor +
      normalized.taxMinor -
      normalized.discountMinor +
      (rule.payer === "customer" ? commissionMinor : 0),
  );

  return {
    ruleId: rule.id,
    rateBps: rule.rateBps,
    baseMinor: base,
    commissionMinor,
    providerNetMinor,
    customerTotalMinor,
    deliveryFeeMinor: normalized.deliveryFeeMinor,
    taxMinor: normalized.taxMinor,
    discountMinor: normalized.discountMinor,
  };
}

export type DeliverySplit = {
  ruleId: string;
  deliveryFeeMinor: number;
  riderNetMinor: number;
  platformFeeMinor: number;
};

/**
 * The delivery fee is split separately from the item commission.
 * Default: 10% of the delivery fee to the platform, 90% to the rider.
 */
export function calculateDeliverySplit(
  deliveryFeeMinor: number,
  rule: CommissionRule = DEFAULT_DELIVERY_COMMISSION_RULE,
): DeliverySplit {
  assertMinor(deliveryFeeMinor, "deliveryFeeMinor");
  const result = calculateCommission(
    { itemSubtotalMinor: deliveryFeeMinor },
    { ...rule, base: "item_subtotal", payer: "provider" },
  );
  return {
    ruleId: result.ruleId,
    deliveryFeeMinor,
    riderNetMinor: result.providerNetMinor,
    platformFeeMinor: result.commissionMinor,
  };
}
