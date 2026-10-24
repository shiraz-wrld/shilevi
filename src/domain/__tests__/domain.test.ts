import assert from "node:assert/strict";

import { calculateCommission, calculateDeliverySplit, DEFAULT_COMMISSION_RULE } from "../commission";
import {
  DEFAULT_VEHICLE_PROFILES,
  checkVehicleEligibility,
  isVehicleEligible,
} from "../delivery/state";
import { canDeliveryActorTransition, canDeliveryTransition } from "../delivery/state";
import { canPublish, checkCanPublish } from "../eligibility";
import { parseMajorToMinor, roundToStep } from "../money";
import { canActorTransition, canTransition } from "../orders/state";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

check("parses major amounts into minor units", () => {
  assert.equal(parseMajorToMinor("1,500.50"), 150_050);
  assert.equal(parseMajorToMinor("99"), 9_900);
  assert.equal(parseMajorToMinor("10.999"), null);
  assert.equal(parseMajorToMinor("-1"), null);
});

check("rounds to a configured step", () => {
  assert.equal(roundToStep(1_999, 100), 2_000);
  assert.equal(roundToStep(2_049, 100), 2_000);
  assert.equal(roundToStep(2_050, 100), 2_100);
});

check("10% commission uses the item subtotal, not delivery", () => {
  const result = calculateCommission(
    { itemSubtotalMinor: 100_000, deliveryFeeMinor: 10_000 },
    DEFAULT_COMMISSION_RULE,
  );
  assert.equal(result.baseMinor, 100_000);
  assert.equal(result.commissionMinor, 10_000);
  assert.equal(result.providerNetMinor, 90_000);
  assert.equal(result.customerTotalMinor, 110_000);
});

check("commission rounds to the nearest shilling", () => {
  const result = calculateCommission(
    { itemSubtotalMinor: 1_999 },
    { ...DEFAULT_COMMISSION_RULE, rounding: "nearest_1" },
  );
  assert.equal(result.commissionMinor, 200);
});

check("commission respects min and max", () => {
  const high = calculateCommission(
    { itemSubtotalMinor: 10_000 },
    { ...DEFAULT_COMMISSION_RULE, maxFeeMinor: 500 },
  );
  assert.equal(high.commissionMinor, 500);
  const low = calculateCommission(
    { itemSubtotalMinor: 1_000 },
    { ...DEFAULT_COMMISSION_RULE, minFeeMinor: 300 },
  );
  assert.equal(low.commissionMinor, 300);
});

check("customer-paid commission is added to the total", () => {
  const result = calculateCommission(
    { itemSubtotalMinor: 10_000 },
    { ...DEFAULT_COMMISSION_RULE, payer: "customer" },
  );
  assert.equal(result.commissionMinor, 1_000);
  assert.equal(result.providerNetMinor, 10_000);
  assert.equal(result.customerTotalMinor, 11_000);
});

check("delivery fee splits 10% platform / 90% rider", () => {
  const result = calculateDeliverySplit(10_000);
  assert.equal(result.platformFeeMinor, 1_000);
  assert.equal(result.riderNetMinor, 9_000);
  assert.equal(result.deliveryFeeMinor, 10_000);
});

check("order transitions follow the lifecycle", () => {
  assert.equal(canTransition("pending_payment", "paid"), true);
  assert.equal(canTransition("paid", "accepted"), true);
  assert.equal(canTransition("preparing", "ready"), true);
  assert.equal(canTransition("delivered", "completed"), true);
  assert.equal(canTransition("cancelled", "paid"), false);
  assert.equal(canTransition("completed", "accepted"), false);
});

check("actors cannot perform another actor's transition", () => {
  assert.equal(canActorTransition("provider", "paid", "accepted"), true);
  assert.equal(canActorTransition("customer", "paid", "accepted"), false);
  assert.equal(canActorTransition("customer", "delivered", "completed"), true);
  assert.equal(canActorTransition("rider", "dispatched", "delivered"), true);
});

check("delivery transitions follow the lifecycle", () => {
  assert.equal(canDeliveryTransition("requested", "assigned"), true);
  assert.equal(canDeliveryTransition("assigned", "to_pickup"), true);
  assert.equal(canDeliveryTransition("to_pickup", "collected"), true);
  assert.equal(canDeliveryTransition("in_transit", "delivered"), true);
  assert.equal(canDeliveryTransition("delivered", "in_transit"), false);
  assert.equal(canDeliveryActorTransition("rider", "assigned", "to_pickup"), true);
  assert.equal(canDeliveryActorTransition("customer", "assigned", "to_pickup"), false);
});

check("vehicle eligibility rejects a motorcycle for a bed", () => {
  const bed = {
    weightKg: 200,
    volumeM3: 2,
    lengthCm: 200,
    needsFragileHandling: false,
    isPassenger: false,
  };
  const motorcycle = checkVehicleEligibility(DEFAULT_VEHICLE_PROFILES.motorcycle, bed);
  assert.equal(motorcycle.eligible, false);
  assert.ok(motorcycle.reasons.includes("weight"));
  assert.equal(isVehicleEligible(DEFAULT_VEHICLE_PROFILES.pickup, bed), true);
});

check("passenger eligibility is separate from goods eligibility", () => {
  const passenger = {
    weightKg: 80,
    volumeM3: 0.2,
    lengthCm: 60,
    isPassenger: true,
    passengerCount: 1,
  };
  assert.equal(isVehicleEligible(DEFAULT_VEHICLE_PROFILES.motorcycle, passenger), true);
  assert.equal(isVehicleEligible(DEFAULT_VEHICLE_PROFILES.pickup, passenger), false);
});

check("activity permission must match category and transaction type", () => {
  const activity = {
    id: "activity-1",
    categoryIds: ["food-groceries"],
    transactionTypes: ["sale"] as const,
    status: "approved" as const,
    verificationTier: 2 as const,
  };
  assert.equal(
    canPublish({
      activity,
      categoryId: "food-groceries",
      transactionType: "sale",
      categoryActive: true,
      divisionActive: true,
    }),
    true,
  );
  const wrongCategory = checkCanPublish({
    activity,
    categoryId: "houses-rent",
    transactionType: "sale",
    categoryActive: true,
    divisionActive: true,
  });
  assert.equal(wrongCategory.ok, false);
  assert.ok(wrongCategory.reasons.includes("category_not_granted"));
  const wrongTransaction = checkCanPublish({
    activity,
    categoryId: "food-groceries",
    transactionType: "rent",
    categoryActive: true,
    divisionActive: true,
  });
  assert.equal(wrongTransaction.ok, false);
  assert.ok(wrongTransaction.reasons.includes("transaction_type_not_granted"));
});

console.log(`\n${passed} domain checks passed.`);
