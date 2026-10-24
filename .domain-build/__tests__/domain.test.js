"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const commission_1 = require("../commission");
const state_1 = require("../delivery/state");
const state_2 = require("../delivery/state");
const eligibility_1 = require("../eligibility");
const money_1 = require("../money");
const state_3 = require("../orders/state");
let passed = 0;
function check(name, fn) {
    fn();
    passed += 1;
    console.log(`ok ${passed} - ${name}`);
}
check("parses major amounts into minor units", () => {
    strict_1.default.equal((0, money_1.parseMajorToMinor)("1,500.50"), 150_050);
    strict_1.default.equal((0, money_1.parseMajorToMinor)("99"), 9_900);
    strict_1.default.equal((0, money_1.parseMajorToMinor)("10.999"), null);
    strict_1.default.equal((0, money_1.parseMajorToMinor)("-1"), null);
});
check("rounds to a configured step", () => {
    strict_1.default.equal((0, money_1.roundToStep)(1_999, 100), 2_000);
    strict_1.default.equal((0, money_1.roundToStep)(2_049, 100), 2_000);
    strict_1.default.equal((0, money_1.roundToStep)(2_050, 100), 2_100);
});
check("10% commission uses the item subtotal, not delivery", () => {
    const result = (0, commission_1.calculateCommission)({ itemSubtotalMinor: 100_000, deliveryFeeMinor: 10_000 }, commission_1.DEFAULT_COMMISSION_RULE);
    strict_1.default.equal(result.baseMinor, 100_000);
    strict_1.default.equal(result.commissionMinor, 10_000);
    strict_1.default.equal(result.providerNetMinor, 90_000);
    strict_1.default.equal(result.customerTotalMinor, 110_000);
});
check("commission rounds to the nearest shilling", () => {
    const result = (0, commission_1.calculateCommission)({ itemSubtotalMinor: 1_999 }, { ...commission_1.DEFAULT_COMMISSION_RULE, rounding: "nearest_1" });
    strict_1.default.equal(result.commissionMinor, 200);
});
check("commission respects min and max", () => {
    const high = (0, commission_1.calculateCommission)({ itemSubtotalMinor: 10_000 }, { ...commission_1.DEFAULT_COMMISSION_RULE, maxFeeMinor: 500 });
    strict_1.default.equal(high.commissionMinor, 500);
    const low = (0, commission_1.calculateCommission)({ itemSubtotalMinor: 1_000 }, { ...commission_1.DEFAULT_COMMISSION_RULE, minFeeMinor: 300 });
    strict_1.default.equal(low.commissionMinor, 300);
});
check("customer-paid commission is added to the total", () => {
    const result = (0, commission_1.calculateCommission)({ itemSubtotalMinor: 10_000 }, { ...commission_1.DEFAULT_COMMISSION_RULE, payer: "customer" });
    strict_1.default.equal(result.commissionMinor, 1_000);
    strict_1.default.equal(result.providerNetMinor, 10_000);
    strict_1.default.equal(result.customerTotalMinor, 11_000);
});
check("delivery fee splits 10% platform / 90% rider", () => {
    const result = (0, commission_1.calculateDeliverySplit)(10_000);
    strict_1.default.equal(result.platformFeeMinor, 1_000);
    strict_1.default.equal(result.riderNetMinor, 9_000);
    strict_1.default.equal(result.deliveryFeeMinor, 10_000);
});
check("order transitions follow the lifecycle", () => {
    strict_1.default.equal((0, state_3.canTransition)("pending_payment", "paid"), true);
    strict_1.default.equal((0, state_3.canTransition)("paid", "accepted"), true);
    strict_1.default.equal((0, state_3.canTransition)("preparing", "ready"), true);
    strict_1.default.equal((0, state_3.canTransition)("delivered", "completed"), true);
    strict_1.default.equal((0, state_3.canTransition)("cancelled", "paid"), false);
    strict_1.default.equal((0, state_3.canTransition)("completed", "accepted"), false);
});
check("actors cannot perform another actor's transition", () => {
    strict_1.default.equal((0, state_3.canActorTransition)("provider", "paid", "accepted"), true);
    strict_1.default.equal((0, state_3.canActorTransition)("customer", "paid", "accepted"), false);
    strict_1.default.equal((0, state_3.canActorTransition)("customer", "delivered", "completed"), true);
    strict_1.default.equal((0, state_3.canActorTransition)("rider", "dispatched", "delivered"), true);
});
check("delivery transitions follow the lifecycle", () => {
    strict_1.default.equal((0, state_2.canDeliveryTransition)("requested", "assigned"), true);
    strict_1.default.equal((0, state_2.canDeliveryTransition)("assigned", "to_pickup"), true);
    strict_1.default.equal((0, state_2.canDeliveryTransition)("to_pickup", "collected"), true);
    strict_1.default.equal((0, state_2.canDeliveryTransition)("in_transit", "delivered"), true);
    strict_1.default.equal((0, state_2.canDeliveryTransition)("delivered", "in_transit"), false);
    strict_1.default.equal((0, state_2.canDeliveryActorTransition)("rider", "assigned", "to_pickup"), true);
    strict_1.default.equal((0, state_2.canDeliveryActorTransition)("customer", "assigned", "to_pickup"), false);
});
check("vehicle eligibility rejects a motorcycle for a bed", () => {
    const bed = {
        weightKg: 200,
        volumeM3: 2,
        lengthCm: 200,
        needsFragileHandling: false,
        isPassenger: false,
    };
    const motorcycle = (0, state_1.checkVehicleEligibility)(state_1.DEFAULT_VEHICLE_PROFILES.motorcycle, bed);
    strict_1.default.equal(motorcycle.eligible, false);
    strict_1.default.ok(motorcycle.reasons.includes("weight"));
    strict_1.default.equal((0, state_1.isVehicleEligible)(state_1.DEFAULT_VEHICLE_PROFILES.pickup, bed), true);
});
check("passenger eligibility is separate from goods eligibility", () => {
    const passenger = {
        weightKg: 80,
        volumeM3: 0.2,
        lengthCm: 60,
        isPassenger: true,
        passengerCount: 1,
    };
    strict_1.default.equal((0, state_1.isVehicleEligible)(state_1.DEFAULT_VEHICLE_PROFILES.motorcycle, passenger), true);
    strict_1.default.equal((0, state_1.isVehicleEligible)(state_1.DEFAULT_VEHICLE_PROFILES.pickup, passenger), false);
});
check("activity permission must match category and transaction type", () => {
    const activity = {
        id: "activity-1",
        categoryIds: ["food-groceries"],
        transactionTypes: ["sale"],
        status: "approved",
        verificationTier: 2,
    };
    strict_1.default.equal((0, eligibility_1.canPublish)({
        activity,
        categoryId: "food-groceries",
        transactionType: "sale",
        categoryActive: true,
        divisionActive: true,
    }), true);
    const wrongCategory = (0, eligibility_1.checkCanPublish)({
        activity,
        categoryId: "houses-rent",
        transactionType: "sale",
        categoryActive: true,
        divisionActive: true,
    });
    strict_1.default.equal(wrongCategory.ok, false);
    strict_1.default.ok(wrongCategory.reasons.includes("category_not_granted"));
    const wrongTransaction = (0, eligibility_1.checkCanPublish)({
        activity,
        categoryId: "food-groceries",
        transactionType: "rent",
        categoryActive: true,
        divisionActive: true,
    });
    strict_1.default.equal(wrongTransaction.ok, false);
    strict_1.default.ok(wrongTransaction.reasons.includes("transaction_type_not_granted"));
});
console.log(`\n${passed} domain checks passed.`);
