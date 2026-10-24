export const ORDER_STATUS_LABELS: Record<string, string> = {
  pending_payment: "Awaiting payment",
  paid: "Paid — seller notified",
  accepted: "Accepted by seller",
  preparing: "Being prepared",
  ready: "Ready for handover",
  dispatched: "On the way",
  delivered: "Delivered",
  completed: "Completed",
  cancelled: "Cancelled",
  refund_requested: "Refund requested",
  refunded: "Refunded",
  failed: "Failed",
};

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  unpaid: "Unpaid",
  paid: "Paid",
  refund_pending: "Refund pending",
  refunded: "Refunded",
  failed: "Payment failed",
};

export const DELIVERY_STATUS_LABELS: Record<string, string> = {
  requested: "Looking for a rider",
  assigned: "Rider assigned",
  to_pickup: "Rider heading to pickup",
  collected: "Picked up",
  in_transit: "On the way to you",
  delivered: "Delivered",
  failed: "Delivery failed",
  cancelled: "Delivery cancelled",
};

export function orderStatusTone(status: string) {
  if (status === "completed" || status === "delivered") return "bg-emerald-50 text-emerald-800 border-emerald-200";
  if (status === "cancelled" || status === "failed") return "bg-red-50 text-red-800 border-red-200";
  if (status === "refund_requested" || status === "refunded") return "bg-amber-50 text-amber-900 border-amber-200";
  if (status === "pending_payment") return "bg-slate-100 text-slate-700 border-slate-200";
  return "bg-blue-50 text-blue-800 border-blue-200";
}

export function paymentStatusTone(status: string) {
  if (status === "paid") return "bg-emerald-50 text-emerald-800 border-emerald-200";
  if (status === "refunded") return "bg-amber-50 text-amber-900 border-amber-200";
  if (status === "failed") return "bg-red-50 text-red-800 border-red-200";
  return "bg-slate-100 text-slate-700 border-slate-200";
}

export function nextProviderAction(status: string): { to: string; label: string } | null {
  switch (status) {
    case "paid":
      return { to: "accepted", label: "Accept order" };
    case "accepted":
      return { to: "preparing", label: "Start preparing" };
    case "preparing":
      return { to: "ready", label: "Mark ready" };
    case "ready":
      return { to: "dispatched", label: "Hand over / dispatch" };
    case "dispatched":
      return { to: "delivered", label: "Mark delivered" };
    default:
      return null;
  }
}

export function nextRiderAction(status: string): { to: string; label: string } | null {
  switch (status) {
    case "assigned":
      return { to: "to_pickup", label: "Start heading to pickup" };
    case "to_pickup":
      return { to: "collected", label: "Confirm pickup" };
    case "collected":
      return { to: "in_transit", label: "Start delivery" };
    case "in_transit":
      return { to: "delivered", label: "Complete delivery" };
    default:
      return null;
  }
}
