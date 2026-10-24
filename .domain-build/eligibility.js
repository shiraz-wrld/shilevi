"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TRANSACTION_TYPES = void 0;
exports.checkCanPublish = checkCanPublish;
exports.canPublish = canPublish;
exports.assertCanPublish = assertCanPublish;
exports.canOfferTransaction = canOfferTransaction;
exports.isCategoryInScope = isCategoryInScope;
exports.TRANSACTION_TYPES = [
    "sale",
    "rent",
    "short_stay",
    "booking",
    "quote",
    "viewing",
    "delivery",
    "ride",
    "hire",
    "lease",
];
function checkCanPublish(input) {
    const reasons = [];
    if (input.activity.status !== "approved")
        reasons.push("activity_not_approved");
    if (!input.categoryActive)
        reasons.push("category_inactive");
    if (!input.divisionActive)
        reasons.push("division_inactive");
    if (!input.activity.categoryIds.includes(input.categoryId))
        reasons.push("category_not_granted");
    if (!input.activity.transactionTypes.includes(input.transactionType)) {
        reasons.push("transaction_type_not_granted");
    }
    if (input.categoryTransactionTypes &&
        !input.categoryTransactionTypes.includes(input.transactionType)) {
        reasons.push("transaction_type_not_supported_by_category");
    }
    if (input.requiredTier !== undefined &&
        input.activity.verificationTier < input.requiredTier) {
        reasons.push("verification_tier_too_low");
    }
    return { ok: reasons.length === 0, reasons };
}
function canPublish(input) {
    return checkCanPublish(input).ok;
}
function assertCanPublish(input) {
    const result = checkCanPublish(input);
    if (!result.ok) {
        throw new Error(`Listing not permitted: ${result.reasons.join(", ")}`);
    }
}
function canOfferTransaction(activity, transactionType) {
    return activity.status === "approved" && activity.transactionTypes.includes(transactionType);
}
function isCategoryInScope(activity, categoryId) {
    return activity.categoryIds.includes(categoryId);
}
