"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { formatMoney } from "@/lib/money";
import {
  DELIVERY_STATUS_LABELS,
  ORDER_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  orderStatusTone,
  paymentStatusTone,
} from "@/lib/order-status";

type OrderItem = { id: string; title_snapshot: string; quantity: number; unit_price_minor: number; line_total_minor: number };
type DeliveryEvent = { status: string; actor_role: string | null; note: string | null; created_at: string };
type Delivery = {
  id: string;
  status: string;
  dropoff_address: string;
  rider_id: string | null;
  rider_fee_minor: number;
  created_at: string;
  assigned_at: string | null;
  picked_up_at: string | null;
  delivered_at: string | null;
  delivery_events: DeliveryEvent[] | null;
};
type History = { id: number | string; from_status: string | null; to_status: string; actor_role: string; note: string | null; created_at: string };
type Order = {
  id: string;
  order_number: string;
  status: string;
  payment_status: string;
  currency: string;
  subtotal_minor: number;
  delivery_fee_minor: number;
  total_minor: number;
  commission_minor: number;
  delivery_method: string;
  delivery_address: string | null;
  contact_phone: string | null;
  notes: string | null;
  payment_reference: string | null;
  paid_at: string | null;
  created_at: string;
  completed_at: string | null;
  order_items: OrderItem[] | null;
  deliveries: Delivery[] | null;
  order_status_history: History[] | null;
};

const methodLabels: Record<string, string> = {
  platform_delivery: "Shilevi delivery",
  seller_delivery: "Seller delivery",
  pickup: "Pickup",
};

export default function CustomerOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const id = typeof params.id === "string" ? params.id : "";
  const [order, setOrder] = useState<Order | null>(null);
  const [proofCode, setProofCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [justPlaced, setJustPlaced] = useState(false);
  const [showRefund, setShowRefund] = useState(false);
  const [refundReason, setRefundReason] = useState("");

  const load = useCallback(async () => {
    if (!/^[0-9a-f-]{36}$/i.test(id)) { setError("Order not found."); setLoading(false); return; }
    try {
      const db = createSupabaseBrowserClient();
      const auth = await db.auth.getUser();
      if (auth.error) throw auth.error;
      if (!auth.data.user) { window.location.replace(`/login?next=${encodeURIComponent(`/account/orders/${id}`)}`); return; }

      const result = await db.from("orders")
        .select("id,order_number,status,payment_status,currency,subtotal_minor,delivery_fee_minor,total_minor,commission_minor,delivery_method,delivery_address,contact_phone,notes,payment_reference,paid_at,created_at,completed_at,order_items(id,title_snapshot,quantity,unit_price_minor,line_total_minor),deliveries(id,status,dropoff_address,rider_id,rider_fee_minor,created_at,assigned_at,picked_up_at,delivered_at,delivery_events(status,actor_role,note,created_at)),order_status_history(id,from_status,to_status,actor_role,note,created_at)")
        .eq("id", id)
        .maybeSingle();
      if (result.error) throw result.error;
      if (!result.data) { setError("This order was not found, or it does not belong to your account."); return; }

      const row = result.data as unknown as Order;
      setOrder(row);
      const delivery = row.deliveries?.[0];
      if (delivery && ["assigned", "to_pickup", "collected", "in_transit", "delivered"].includes(delivery.status)) {
        const proof = await db.rpc("get_delivery_proof_code", { p_order_id: row.id });
        if (!proof.error) setProofCode((proof.data as string | null) ?? "");
      } else {
        setProofCode("");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "We could not load this order. Confirm migrations 0016-0017 have been applied.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    setJustPlaced(new URLSearchParams(window.location.search).get("placed") === "1");
    void load();
  }, [load]);

  async function payNow() {
    if (!order) return;
    setBusy("pay"); setError(""); setMessage("");
    try {
      const db = createSupabaseBrowserClient();
      const result = await db.rpc("confirm_mock_payment", {
        p_order_id: order.id,
        p_reference: `MOCK-${order.order_number}-${Date.now()}`.slice(0, 120),
      });
      if (result.error) throw result.error;
      setMessage("Sandbox payment recorded. The seller can now see the paid order.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The sandbox payment could not be recorded.");
    } finally { setBusy(""); }
  }

  async function cancelOrder() {
    if (!order) return;
    if (!window.confirm("Cancel this unpaid order? This cannot be undone.")) return;
    setBusy("cancel"); setError(""); setMessage("");
    try {
      const db = createSupabaseBrowserClient();
      const result = await db.rpc("customer_cancel_order", { p_order_id: order.id, p_reason: "Customer cancelled before payment." });
      if (result.error) throw result.error;
      setMessage("Order cancelled.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The order could not be cancelled.");
    } finally { setBusy(""); }
  }

  async function confirmOrder() {
    if (!order) return;
    if (!window.confirm("Confirm that you received this order? This completes the order.")) return;
    setBusy("confirm"); setError(""); setMessage("");
    try {
      const db = createSupabaseBrowserClient();
      const result = await db.rpc("customer_confirm_order", { p_order_id: order.id });
      if (result.error) throw result.error;
      setMessage("Order completed. Thank you for confirming.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The order could not be completed.");
    } finally { setBusy(""); }
  }

  async function requestRefund(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!order) return;
    if (refundReason.trim().length < 5) { setError("Describe the problem in at least five characters."); return; }
    setBusy("refund"); setError(""); setMessage("");
    try {
      const db = createSupabaseBrowserClient();
      const result = await db.rpc("request_order_refund", { p_order_id: order.id, p_reason: refundReason.trim() });
      if (result.error) throw result.error;
      setShowRefund(false); setRefundReason("");
      setMessage("Refund request submitted. Shilevi will review it before any money is returned.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The refund request could not be submitted.");
    } finally { setBusy(""); }
  }

  if (loading) return <main className="min-h-screen bg-slate-50 px-5 py-12"><p role="status" className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 text-slate-600">Loading order…</p></main>;

  if (error && !order) return <main className="min-h-screen bg-slate-50 px-5 py-12"><section className="mx-auto max-w-2xl rounded-3xl border border-slate-200 bg-white p-8"><h1 className="text-2xl font-black">Order unavailable</h1><p className="mt-3 leading-7 text-slate-600">{error}</p><Link href="/account/orders" className="mt-5 inline-block font-bold text-blue-700">Back to order history →</Link></section></main>;

  if (!order) return null;

  const delivery = order.deliveries?.[0] ?? null;
  const items = order.order_items ?? [];
  const history = [...(order.order_status_history ?? [])].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const isSandbox = order.payment_reference?.startsWith("MOCK-");
  const canPay = order.status === "pending_payment" && order.payment_status === "unpaid";
  const canCancel = order.status === "pending_payment";
  const canConfirm = order.status === "delivered";
  const canRefund = ["paid", "accepted", "preparing", "ready", "dispatched", "delivered", "completed"].includes(order.status) && order.payment_status === "paid";

  return <main className="min-h-screen bg-slate-50 text-slate-950">
    <header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-5 py-5"><Link href="/" className="text-2xl font-black text-blue-700">shilevi</Link><Link href="/account/orders" className="text-sm font-semibold text-blue-700">← All orders</Link></div></header>
    <div className="mx-auto max-w-5xl px-5 py-8 sm:py-12">
      {justPlaced && <div className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-900"><strong>Order placed.</strong> A sandbox payment was recorded. No real money moved. The seller can now see the order.</div>}
      {message && <div role="status" className="mb-5 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-blue-900">{message}</div>}
      {error && <div role="alert" className="mb-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-800">{error}</div>}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-sm font-bold uppercase tracking-wide text-blue-700">{order.order_number}</p><h1 className="mt-2 text-3xl font-black sm:text-4xl">Your order</h1><p className="mt-2 text-sm text-slate-500">Placed {new Date(order.created_at).toLocaleString()}</p></div>
        <div className="flex flex-wrap gap-2"><span className={`rounded-full border px-3 py-1 text-xs font-bold ${orderStatusTone(order.status)}`}>{ORDER_STATUS_LABELS[order.status] ?? order.status}</span><span className={`rounded-full border px-3 py-1 text-xs font-bold ${paymentStatusTone(order.payment_status)}`}>{PAYMENT_STATUS_LABELS[order.payment_status] ?? order.payment_status}</span></div>
      </div>

      <div className="mt-7 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <section className="rounded-3xl border border-slate-200 bg-white p-6">
            <h2 className="text-xl font-black">Items</h2>
            <ul className="mt-4 divide-y divide-slate-100">
              {items.map(item => <li key={item.id} className="flex flex-wrap items-baseline justify-between gap-3 py-4 first:pt-0 last:pb-0"><div><p className="font-bold">{item.title_snapshot}</p><p className="mt-1 text-sm text-slate-500">{formatMoney(item.unit_price_minor, order.currency)} × {item.quantity}</p></div><p className="font-black">{formatMoney(item.line_total_minor, order.currency)}</p></li>)}
            </ul>
            <dl className="mt-5 space-y-2 border-t border-slate-200 pt-4 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-slate-600">Subtotal</dt><dd>{formatMoney(order.subtotal_minor, order.currency)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-600">Delivery</dt><dd>{formatMoney(order.delivery_fee_minor, order.currency)}</dd></div>
              <div className="flex justify-between gap-3 text-base font-black"><dt>Total</dt><dd>{formatMoney(order.total_minor, order.currency)}</dd></div>
            </dl>
            {isSandbox && <p className="mt-4 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-950">Sandbox payment reference: <span className="font-mono">{order.payment_reference}</span>. This was simulated; no real funds moved.</p>}
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-6">
            <h2 className="text-xl font-black">Delivery</h2>
            <p className="mt-2 text-sm font-semibold text-slate-700">{methodLabels[order.delivery_method] ?? order.delivery_method}</p>
            {order.delivery_address && <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">{order.delivery_address}</p>}
            {order.contact_phone && <p className="mt-1 text-sm text-slate-600">Contact: {order.contact_phone}</p>}
            {order.delivery_method === "platform_delivery" && delivery ? <div className="mt-5 rounded-2xl bg-slate-50 p-4">
              <p className="text-sm font-bold">{DELIVERY_STATUS_LABELS[delivery.status] ?? delivery.status}</p>
              <p className="mt-1 text-sm leading-6 text-slate-600">{delivery.rider_id ? "A rider has accepted this delivery." : "We are looking for an available rider. You will see the status change here."}</p>
              {proofCode && <div className="mt-4 rounded-xl border border-blue-200 bg-white p-4"><p className="text-xs font-bold uppercase tracking-wide text-blue-700">Handover code</p><p className="mt-2 text-3xl font-black tracking-[0.3em]">{proofCode}</p><p className="mt-2 text-xs leading-5 text-slate-600">Share this code with your rider only when you receive the item. The rider must enter it to complete the delivery.</p></div>}
              {delivery.delivery_events?.length ? <ol className="mt-4 space-y-2 text-sm text-slate-600">{delivery.delivery_events.map((entry, index) => <li key={`${entry.created_at}-${index}`} className="flex justify-between gap-3"><span>{DELIVERY_STATUS_LABELS[entry.status] ?? entry.status}</span><span className="whitespace-nowrap text-xs text-slate-400">{new Date(entry.created_at).toLocaleString()}</span></li>)}</ol> : null}
            </div> : order.delivery_method === "seller_delivery" ? <p className="mt-4 rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-600">The seller arranges delivery. Use the order contact details to coordinate; Shilevi does not assign a rider to this order.</p> : <p className="mt-4 rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-600">Collect this order from the seller. Keep your order number available at handover.</p>}
            {order.notes && <div className="mt-4"><h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Your note</h3><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">{order.notes}</p></div>}
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-6">
            <h2 className="text-xl font-black">Progress</h2>
            <ol className="mt-4 space-y-3">
              {history.map(entry => <li key={entry.id} className="rounded-xl border border-slate-100 p-3"><div className="flex flex-wrap justify-between gap-2"><p className="font-semibold">{ORDER_STATUS_LABELS[entry.to_status] ?? entry.to_status}</p><p className="text-xs text-slate-400">{new Date(entry.created_at).toLocaleString()}</p></div><p className="mt-1 text-xs uppercase tracking-wide text-slate-500">{entry.actor_role}{entry.note ? ` · ${entry.note}` : ""}</p></li>)}
            </ol>
          </section>
        </div>

        <aside className="h-fit space-y-4">
          <section className="rounded-3xl border border-slate-200 bg-white p-6">
            <h2 className="text-lg font-black">Actions</h2>
            {canPay && <button onClick={() => void payNow()} disabled={Boolean(busy)} className="mt-4 w-full rounded-xl bg-blue-700 px-5 py-3 font-bold text-white disabled:opacity-50">{busy === "pay" ? "Recording payment…" : "Pay now (sandbox)"}</button>}
            {canConfirm && <button onClick={() => void confirmOrder()} disabled={Boolean(busy)} className="mt-4 w-full rounded-xl bg-emerald-700 px-5 py-3 font-bold text-white disabled:opacity-50">{busy === "confirm" ? "Completing…" : "Confirm I received it"}</button>}
            {canCancel && <button onClick={() => void cancelOrder()} disabled={Boolean(busy)} className="mt-3 w-full rounded-xl border border-red-200 px-5 py-3 font-bold text-red-700 disabled:opacity-50">{busy === "cancel" ? "Cancelling…" : "Cancel unpaid order"}</button>}
            {canRefund && <button onClick={() => setShowRefund(current => !current)} className="mt-3 w-full rounded-xl border border-slate-300 px-5 py-3 font-bold">Request a refund</button>}
            {order.status === "refund_requested" && <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm leading-6 text-amber-950">Your refund request is under review. The order will not progress while it is reviewed.</p>}
            {!canPay && !canConfirm && !canCancel && !canRefund && order.status !== "refund_requested" && <p className="mt-4 text-sm leading-6 text-slate-600">There are no actions available for this order right now.</p>}
            {showRefund && <form onSubmit={requestRefund} className="mt-4 border-t border-slate-200 pt-4">
              <label className="block text-sm font-semibold">What went wrong?<textarea required minLength={5} maxLength={1000} rows={4} value={refundReason} onChange={event => setRefundReason(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-3 font-normal" placeholder="Describe the problem. Do not include passwords or financial credentials." /></label>
              <button disabled={Boolean(busy)} className="mt-3 w-full rounded-xl bg-red-700 px-4 py-3 text-sm font-bold text-white disabled:opacity-50">{busy === "refund" ? "Submitting…" : "Submit refund request"}</button>
            </form>}
          </section>
          <section className="rounded-3xl border border-slate-200 bg-white p-6 text-sm leading-6 text-slate-600">
            <h2 className="text-lg font-black text-slate-950">Need help?</h2>
            <p className="mt-2">If the seller or rider does not respond, open a refund request and explain what happened. Keep the order number available.</p>
            <Link href="/support" className="mt-3 inline-block font-bold text-blue-700">Contact support →</Link>
          </section>
        </aside>
      </div>
    </div>
  </main>;
}
