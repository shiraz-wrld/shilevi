"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_DELIVERY_COMMISSION_RULE = exports.DEFAULT_COMMISSION_RULE = exports.DEFAULT_COMMISSION_RATE_BPS = void 0;
exports.calculateCommission = calculateCommission;
exports.calculateDeliverySplit = calculateDeliverySplit;
const money_1 = require("./money");
exports.DEFAULT_COMMISSION_RATE_BPS = 1_000; // 10.00%
exports.DEFAULT_COMMISSION_RULE = {
    id: "default-10-item-subtotal",
    scope: "global",
    base: "item_subtotal",
    rateBps: exports.DEFAULT_COMMISSION_RATE_BPS,
    minFeeMinor: 0,
    maxFeeMinor: null,
    rounding: "nearest_1",
    payer: "provider",
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    effectiveTo: null,
};
exports.DEFAULT_DELIVERY_COMMISSION_RULE = {
    id: "default-10-delivery-fee",
    scope: "activity",
    base: "item_subtotal",
    rateBps: exports.DEFAULT_COMMISSION_RATE_BPS,
    minFeeMinor: 0,
    maxFeeMinor: null,
    rounding: "nearest_1",
    payer: "provider",
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    effectiveTo: null,
};
function roundingStep(rounding) {
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
function commissionBase(input, rule) {
    switch (rule.base) {
        case "item_subtotal":
            return input.itemSubtotalMinor;
        case "customer_total":
            return Math.max(0, input.itemSubtotalMinor + input.deliveryFeeMinor + input.taxMinor - input.discountMinor);
        case "provider_earning":
            return Math.max(0, input.itemSubtotalMinor - input.discountMinor);
        default:
            return input.itemSubtotalMinor;
    }
}
function clampCommission(value, rule, base) {
    let next = value;
    if (rule.minFeeMinor > 0)
        next = Math.max(next, rule.minFeeMinor);
    if (rule.maxFeeMinor !== null)
        next = Math.min(next, rule.maxFeeMinor);
    return Math.max(0, Math.min(next, base));
}
function calculateCommission(input, rule = exports.DEFAULT_COMMISSION_RULE) {
    const normalized = {
        itemSubtotalMinor: input.itemSubtotalMinor,
        deliveryFeeMinor: input.deliveryFeeMinor ?? 0,
        taxMinor: input.taxMinor ?? 0,
        discountMinor: input.discountMinor ?? 0,
    };
    (0, money_1.assertMinor)(normalized.itemSubtotalMinor, "itemSubtotalMinor");
    (0, money_1.assertMinor)(normalized.deliveryFeeMinor, "deliveryFeeMinor");
    (0, money_1.assertMinor)(normalized.taxMinor, "taxMinor");
    (0, money_1.assertMinor)(normalized.discountMinor, "discountMinor");
    if (!Number.isFinite(rule.rateBps) || rule.rateBps < 0 || rule.rateBps > 10_000) {
        throw new Error("Commission rate must be between 0 and 10,000 basis points.");
    }
    const base = commissionBase(normalized, rule);
    const raw = (base * rule.rateBps) / 10_000;
    const rounded = rule.rounding === "none" ? (0, money_1.roundHalfUp)(raw) : (0, money_1.roundToStep)(raw, roundingStep(rule.rounding));
    const commissionMinor = clampCommission(rounded, rule, base);
    const providerNetMinor = rule.payer === "provider"
        ? Math.max(0, normalized.itemSubtotalMinor - commissionMinor)
        : normalized.itemSubtotalMinor;
    const customerTotalMinor = Math.max(0, normalized.itemSubtotalMinor +
        normalized.deliveryFeeMinor +
        normalized.taxMinor -
        normalized.discountMinor +
        (rule.payer === "customer" ? commissionMinor : 0));
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
/**
 * The delivery fee is split separately from the item commission.
 * Default: 10% of the delivery fee to the platform, 90% to the rider.
 */
function calculateDeliverySplit(deliveryFeeMinor, rule = exports.DEFAULT_DELIVERY_COMMISSION_RULE) {
    (0, money_1.assertMinor)(deliveryFeeMinor, "deliveryFeeMinor");
    const result = calculateCommission({ itemSubtotalMinor: deliveryFeeMinor }, { ...rule, base: "item_subtotal", payer: "provider" });
    return {
        ruleId: result.ruleId,
        deliveryFeeMinor,
        riderNetMinor: result.providerNetMinor,
        platformFeeMinor: result.commissionMinor,
    };
}
