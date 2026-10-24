export const TRANSACTION_TYPES = [
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
] as const;

export type TransactionType = (typeof TRANSACTION_TYPES)[number];
export type ActivityStatus = "pending" | "approved" | "suspended" | "expired";
export type VerificationTier = 0 | 1 | 2 | 3;

export type ActivityPermission = {
  id: string;
  categoryIds: readonly string[];
  transactionTypes: readonly TransactionType[];
  status: ActivityStatus;
  verificationTier: VerificationTier;
};

export type PublishCheckInput = {
  activity: ActivityPermission;
  categoryId: string;
  transactionType: TransactionType;
  categoryActive: boolean;
  divisionActive: boolean;
  categoryTransactionTypes?: readonly TransactionType[];
  requiredTier?: VerificationTier;
};

export type PublishCheck = {
  ok: boolean;
  reasons: string[];
};

export function checkCanPublish(input: PublishCheckInput): PublishCheck {
  const reasons: string[] = [];

  if (input.activity.status !== "approved") reasons.push("activity_not_approved");
  if (!input.categoryActive) reasons.push("category_inactive");
  if (!input.divisionActive) reasons.push("division_inactive");
  if (!input.activity.categoryIds.includes(input.categoryId)) reasons.push("category_not_granted");
  if (!input.activity.transactionTypes.includes(input.transactionType)) {
    reasons.push("transaction_type_not_granted");
  }
  if (
    input.categoryTransactionTypes &&
    !input.categoryTransactionTypes.includes(input.transactionType)
  ) {
    reasons.push("transaction_type_not_supported_by_category");
  }
  if (
    input.requiredTier !== undefined &&
    input.activity.verificationTier < input.requiredTier
  ) {
    reasons.push("verification_tier_too_low");
  }

  return { ok: reasons.length === 0, reasons };
}

export function canPublish(input: PublishCheckInput): boolean {
  return checkCanPublish(input).ok;
}

export function assertCanPublish(input: PublishCheckInput): void {
  const result = checkCanPublish(input);
  if (!result.ok) {
    throw new Error(`Listing not permitted: ${result.reasons.join(", ")}`);
  }
}

export function canOfferTransaction(
  activity: ActivityPermission,
  transactionType: TransactionType,
): boolean {
  return activity.status === "approved" && activity.transactionTypes.includes(transactionType);
}

export function isCategoryInScope(activity: ActivityPermission, categoryId: string): boolean {
  return activity.categoryIds.includes(categoryId);
}
