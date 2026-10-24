"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_VEHICLE_PROFILES = exports.DELIVERY_STATUS_LABELS = exports.DELIVERY_STATUSES = void 0;
exports.isDeliveryStatus = isDeliveryStatus;
exports.canDeliveryTransition = canDeliveryTransition;
exports.assertDeliveryTransition = assertDeliveryTransition;
exports.canDeliveryActorTransition = canDeliveryActorTransition;
exports.isDeliveryActive = isDeliveryActive;
exports.trackingAllowed = trackingAllowed;
exports.canAssign = canAssign;
exports.nextRiderAction = nextRiderAction;
exports.checkVehicleEligibility = checkVehicleEligibility;
exports.isVehicleEligible = isVehicleEligible;
exports.eligibleVehicleTypes = eligibleVehicleTypes;
exports.assertVehicleEligible = assertVehicleEligible;
exports.DELIVERY_STATUSES = [
    "requested",
    "offered",
    "assigned",
    "to_pickup",
    "collected",
    "in_transit",
    "delivered",
    "failed",
    "cancelled",
    "expired",
];
const TRANSITIONS = {
    requested: ["offered", "assigned", "cancelled", "expired"],
    offered: ["assigned", "requested", "cancelled", "expired"],
    assigned: ["to_pickup", "cancelled", "failed"],
    to_pickup: ["collected", "cancelled", "failed"],
    collected: ["in_transit", "delivered", "failed"],
    in_transit: ["delivered", "failed"],
    delivered: [],
    failed: ["requested", "cancelled"],
    cancelled: [],
    expired: ["requested", "cancelled"],
};
const ACTOR_TRANSITIONS = {
    customer: {
        requested: ["cancelled"],
        offered: ["cancelled"],
        assigned: ["cancelled"],
    },
    provider: {
        requested: ["cancelled"],
        offered: ["cancelled"],
        assigned: ["cancelled"],
    },
    rider: {
        assigned: ["to_pickup", "failed"],
        to_pickup: ["collected", "failed"],
        collected: ["in_transit", "delivered", "failed"],
        in_transit: ["delivered", "failed"],
    },
    system: {
        requested: ["offered", "expired"],
        offered: ["expired", "requested"],
        failed: ["requested"],
    },
    staff: {},
};
exports.DELIVERY_STATUS_LABELS = {
    requested: "Finding a rider",
    offered: "Offer sent",
    assigned: "Rider assigned",
    to_pickup: "Rider on the way to pickup",
    collected: "Package collected",
    in_transit: "In transit",
    delivered: "Delivered",
    failed: "Delivery failed",
    cancelled: "Cancelled",
    expired: "Offer expired",
};
function isDeliveryStatus(value) {
    return exports.DELIVERY_STATUSES.includes(value);
}
function canDeliveryTransition(from, to) {
    return TRANSITIONS[from].includes(to);
}
function assertDeliveryTransition(from, to) {
    if (!canDeliveryTransition(from, to)) {
        throw new Error(`Invalid delivery transition: ${from} -> ${to}`);
    }
}
function canDeliveryActorTransition(actor, from, to) {
    if (!canDeliveryTransition(from, to))
        return false;
    if (actor === "staff")
        return true;
    return Boolean(ACTOR_TRANSITIONS[actor][from]?.includes(to));
}
function isDeliveryActive(status) {
    return ["assigned", "to_pickup", "collected", "in_transit"].includes(status);
}
function trackingAllowed(status) {
    return isDeliveryActive(status);
}
function canAssign(status) {
    return status === "requested" || status === "offered";
}
function nextRiderAction(status) {
    switch (status) {
        case "assigned":
            return "to_pickup";
        case "to_pickup":
            return "collected";
        case "collected":
            return "in_transit";
        case "in_transit":
            return "delivered";
        default:
            return null;
    }
}
exports.DEFAULT_VEHICLE_PROFILES = {
    bicycle: {
        type: "bicycle",
        label: "Bicycle",
        maxWeightKg: 10,
        maxVolumeM3: 0.05,
        maxLengthCm: 40,
        passengerEligible: false,
        maxPassengers: 0,
        refrigerated: false,
        fragileCapable: false,
    },
    motorcycle: {
        type: "motorcycle",
        label: "Motorcycle",
        maxWeightKg: 30,
        maxVolumeM3: 0.12,
        maxLengthCm: 60,
        passengerEligible: true,
        maxPassengers: 1,
        refrigerated: false,
        fragileCapable: true,
    },
    tuktuk: {
        type: "tuktuk",
        label: "Tuk-tuk",
        maxWeightKg: 150,
        maxVolumeM3: 0.6,
        maxLengthCm: 120,
        passengerEligible: true,
        maxPassengers: 3,
        refrigerated: false,
        fragileCapable: false,
    },
    car: {
        type: "car",
        label: "Car",
        maxWeightKg: 120,
        maxVolumeM3: 0.4,
        maxLengthCm: 120,
        passengerEligible: true,
        maxPassengers: 4,
        refrigerated: false,
        fragileCapable: true,
    },
    pickup: {
        type: "pickup",
        label: "Pickup",
        maxWeightKg: 800,
        maxVolumeM3: 3,
        maxLengthCm: 300,
        passengerEligible: false,
        maxPassengers: 0,
        refrigerated: false,
        fragileCapable: true,
    },
    van: {
        type: "van",
        label: "Van",
        maxWeightKg: 1_500,
        maxVolumeM3: 8,
        maxLengthCm: 400,
        passengerEligible: false,
        maxPassengers: 0,
        refrigerated: true,
        fragileCapable: true,
    },
    lorry: {
        type: "lorry",
        label: "Lorry / truck",
        maxWeightKg: 10_000,
        maxVolumeM3: 30,
        maxLengthCm: 1_200,
        passengerEligible: false,
        maxPassengers: 0,
        refrigerated: true,
        fragileCapable: true,
    },
    specialized: {
        type: "specialized",
        label: "Specialized",
        maxWeightKg: 20_000,
        maxVolumeM3: 60,
        maxLengthCm: 2_000,
        passengerEligible: false,
        maxPassengers: 0,
        refrigerated: true,
        fragileCapable: true,
    },
};
function checkVehicleEligibility(profile, requirement) {
    const reasons = [];
    // Passenger transport is about seats and safety eligibility, not cargo capacity.
    if (requirement.isPassenger) {
        if (!profile.passengerEligible)
            reasons.push("passenger");
        const count = requirement.passengerCount ?? 1;
        if (count > profile.maxPassengers)
            reasons.push("passenger_capacity");
        return { eligible: reasons.length === 0, reasons };
    }
    if (requirement.weightKg > profile.maxWeightKg)
        reasons.push("weight");
    if (requirement.volumeM3 > profile.maxVolumeM3)
        reasons.push("volume");
    if (requirement.lengthCm > profile.maxLengthCm)
        reasons.push("length");
    if (requirement.needsRefrigeration && !profile.refrigerated)
        reasons.push("refrigeration");
    if (requirement.needsFragileHandling && !profile.fragileCapable)
        reasons.push("fragile_handling");
    return { eligible: reasons.length === 0, reasons };
}
function isVehicleEligible(profile, requirement) {
    return checkVehicleEligibility(profile, requirement).eligible;
}
function eligibleVehicleTypes(requirement, profiles = exports.DEFAULT_VEHICLE_PROFILES) {
    return Object.keys(profiles).filter((type) => isVehicleEligible(profiles[type], requirement));
}
function assertVehicleEligible(profile, requirement) {
    const result = checkVehicleEligibility(profile, requirement);
    if (!result.eligible) {
        throw new Error(`Vehicle ${profile.type} is not eligible: ${result.reasons.join(", ")}`);
    }
}
