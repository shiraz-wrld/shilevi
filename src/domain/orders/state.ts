export const ORDER_STATUSES = [
  "pending_payment",
  "paid",
  "accepted",
  "preparing",
  "ready",
  "dispatched",
  "delivered",
  "completed",
  "cancelled",
  "refund_requested",
  "refunded",
  "disputed",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];
export type OrderActor = "customer" | "provider" | "rider" | "staff" | "system";

const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending_payment: ["paid", "cancelled"],
  paid: ["accepted", "cancelled", "refund_requested"],
  accepted: ["preparing", "cancelled", "refund_requested"],
  preparing: ["ready", "cancelled", "refund_requested"],
  ready: ["dispatched", "delivered", "cancelled", "refund_requested"],
  dispatched: ["delivered", "disputed"],
  delivered: ["completed", "disputed", "refund_requested"],
  completed: ["disputed", "refund_requested"],
  refund_requested: ["refunded", "disputed", "paid"],
  refunded: [],
  disputed: ["refunded", "completed", "cancelled"],
  cancelled: [],
};

const ACTOR_TRANSITIONS: Record<OrderActor, Partial<Record<OrderStatus, readonly OrderStatus[]>>> = {
  customer: {
    pending_payment: ["cancelled"],
    paid: ["cancelled", "refund_requested"],
    accepted: ["cancelled", "refund_requested"],
    delivered: ["completed", "disputed"],
    completed: ["disputed", "refund_requested"],
  },
  provider: {
    paid: ["accepted"],
    accepted: ["preparing", "cancelled"],
    preparing: ["ready", "cancelled"],
    ready: ["dispatched", "delivered"],
    dispatched: ["delivered"],
  },
  rider: {
    ready: ["dispatched"],
    dispatched: ["delivered"],
  },
  system: {
    pending_payment: ["paid", "cancelled"],
    delivered: ["completed"],
    refund_requested: ["refunded"],
  },
  staff: {},
};

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending_payment: "Awaiting payment",
  paid: "Paid",
  accepted: "Accepted by seller",
  preparing: "Preparing",
  ready: "Ready for pickup",
  dispatched: "Out for delivery",
  delivered: "Delivered",
  completed: "Completed",
  cancelled: "Cancelled",
  refund_requested: "Refund requested",
  refunded: "Refunded",
  disputed: "Disputed",
};

export function isOrderStatus(value: string): value is OrderStatus {
  return (ORDER_STATUSES as readonly string[]).includes(value);
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertOrderTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid order transition: ${from} -> ${to}`);
  }
}

export function canActorTransition(actor: OrderActor, from: OrderStatus, to: OrderStatus): boolean {
  if (!canTransition(from, to)) return false;
  if (actor === "staff") return true;
  const allowed = ACTOR_TRANSITIONS[actor][from];
  return Boolean(allowed?.includes(to));
}

export function assertActorTransition(actor: OrderActor, from: OrderStatus, to: OrderStatus): void {
  if (!canActorTransition(actor, from, to)) {
    throw new Error(`${actor} cannot move an order from ${from} to ${to}`);
  }
}

export function isTerminal(status: OrderStatus): boolean {
  return status === "cancelled" || status === "refunded";
}

export function isPaid(status: OrderStatus): boolean {
  return !["pending_payment", "cancelled", "refunded"].includes(status);
}

export function canCustomerCancel(status: OrderStatus): boolean {
  return status === "pending_payment" || status === "paid" || status === "accepted";
}

export function canRequestRefund(status: OrderStatus): boolean {
  return ["paid", "accepted", "preparing", "ready", "delivered", "completed", "disputed"].includes(
    status,
  );
}

export function nextProviderAction(status: OrderStatus): OrderStatus | null {
  switch (status) {
    case "paid":
      return "accepted";
    case "accepted":
      return "preparing";
    case "preparing":
      return "ready";
    case "ready":
      return "dispatched";
    case "dispatched":
      return "delivered";
    default:
      return null;
  }
}

export function orderProgress(status: OrderStatus): number {
  const sequence: OrderStatus[] = [
    "pending_payment",
    "paid",
    "accepted",
    "preparing",
    "ready",
    "dispatched",
    "delivered",
    "completed",
  ];
  const index = sequence.indexOf(status);
  return index === -1 ? 0 : Math.round((index / (sequence.length - 1)) * 100);
}
