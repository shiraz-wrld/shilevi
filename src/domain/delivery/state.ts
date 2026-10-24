export const DELIVERY_STATUSES = [
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
] as const;

export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];
export type DeliveryActor = "customer" | "provider" | "rider" | "staff" | "system";

const TRANSITIONS: Record<DeliveryStatus, readonly DeliveryStatus[]> = {
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

const ACTOR_TRANSITIONS: Record<
  DeliveryActor,
  Partial<Record<DeliveryStatus, readonly DeliveryStatus[]>>
> = {
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

export const DELIVERY_STATUS_LABELS: Record<DeliveryStatus, string> = {
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

export function isDeliveryStatus(value: string): value is DeliveryStatus {
  return (DELIVERY_STATUSES as readonly string[]).includes(value);
}

export function canDeliveryTransition(from: DeliveryStatus, to: DeliveryStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertDeliveryTransition(from: DeliveryStatus, to: DeliveryStatus): void {
  if (!canDeliveryTransition(from, to)) {
    throw new Error(`Invalid delivery transition: ${from} -> ${to}`);
  }
}

export function canDeliveryActorTransition(
  actor: DeliveryActor,
  from: DeliveryStatus,
  to: DeliveryStatus,
): boolean {
  if (!canDeliveryTransition(from, to)) return false;
  if (actor === "staff") return true;
  return Boolean(ACTOR_TRANSITIONS[actor][from]?.includes(to));
}

export function isDeliveryActive(status: DeliveryStatus): boolean {
  return ["assigned", "to_pickup", "collected", "in_transit"].includes(status);
}

export function trackingAllowed(status: DeliveryStatus): boolean {
  return isDeliveryActive(status);
}

export function canAssign(status: DeliveryStatus): boolean {
  return status === "requested" || status === "offered";
}

export function nextRiderAction(status: DeliveryStatus): DeliveryStatus | null {
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

export type VehicleType =
  | "bicycle"
  | "motorcycle"
  | "tuktuk"
  | "car"
  | "pickup"
  | "van"
  | "lorry"
  | "specialized";

export type VehicleProfile = {
  type: VehicleType;
  label: string;
  maxWeightKg: number;
  maxVolumeM3: number;
  maxLengthCm: number;
  passengerEligible: boolean;
  maxPassengers: number;
  refrigerated: boolean;
  fragileCapable: boolean;
};

export const DEFAULT_VEHICLE_PROFILES: Record<VehicleType, VehicleProfile> = {
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

export type DeliveryRequirement = {
  weightKg: number;
  volumeM3: number;
  lengthCm: number;
  needsRefrigeration?: boolean;
  needsFragileHandling?: boolean;
  isPassenger?: boolean;
  passengerCount?: number;
};

export type VehicleEligibility = {
  eligible: boolean;
  reasons: string[];
};

export function checkVehicleEligibility(
  profile: VehicleProfile,
  requirement: DeliveryRequirement,
): VehicleEligibility {
  const reasons: string[] = [];

  // Passenger transport is about seats and safety eligibility, not cargo capacity.
  if (requirement.isPassenger) {
    if (!profile.passengerEligible) reasons.push("passenger");
    const count = requirement.passengerCount ?? 1;
    if (count > profile.maxPassengers) reasons.push("passenger_capacity");
    return { eligible: reasons.length === 0, reasons };
  }

  if (requirement.weightKg > profile.maxWeightKg) reasons.push("weight");
  if (requirement.volumeM3 > profile.maxVolumeM3) reasons.push("volume");
  if (requirement.lengthCm > profile.maxLengthCm) reasons.push("length");
  if (requirement.needsRefrigeration && !profile.refrigerated) reasons.push("refrigeration");
  if (requirement.needsFragileHandling && !profile.fragileCapable) reasons.push("fragile_handling");
  return { eligible: reasons.length === 0, reasons };
}

export function isVehicleEligible(
  profile: VehicleProfile,
  requirement: DeliveryRequirement,
): boolean {
  return checkVehicleEligibility(profile, requirement).eligible;
}

export function eligibleVehicleTypes(
  requirement: DeliveryRequirement,
  profiles: Record<VehicleType, VehicleProfile> = DEFAULT_VEHICLE_PROFILES,
): VehicleType[] {
  return (Object.keys(profiles) as VehicleType[]).filter((type) =>
    isVehicleEligible(profiles[type], requirement),
  );
}

export function assertVehicleEligible(
  profile: VehicleProfile,
  requirement: DeliveryRequirement,
): void {
  const result = checkVehicleEligibility(profile, requirement);
  if (!result.eligible) {
    throw new Error(`Vehicle ${profile.type} is not eligible: ${result.reasons.join(", ")}`);
  }
}
