"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { formatMoney } from "@/lib/money";
import { DELIVERY_STATUS_LABELS, nextRiderAction } from "@/lib/order-status";
import { LiveTrackingCard } from "@/components/tracking/LiveTrackingCard";

type RiderOrder = { order_number: string; status: string; delivery_method: string; contact_phone: string | null; notes: string | null };
type Delivery = {
  id: string;
  order_id: string;
  status: string;
  pickup_address: string | null;
  dropoff_address: string;
  delivery_fee_minor: number;
  rider_fee_minor: number;
  created_at: string;
  assigned_at: string | null;
  picked_up_at: string | null;
  delivered_at: string | null;
  orders: RiderOrder | RiderOrder[] | null;
};

export default function RiderJobDetailPage() {
  const params = useParams<{ id: string }>();
  const id = typeof params.id === "string" ? params.id : "";
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [proofCode, setProofCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    if (!/^[0-9a-f-]{36}$/i.test(id)) { setError("Job not found."); setLoading(false); return; }
    try {
      const db = createSupabaseBrowserClient();
      const auth = await db.auth.getUser();
      if (auth.error) throw auth.error;
      if (!auth.data.user) { window.location.replace("/login?next=%2Frider%2Fjobs"); return; }

      const result = await db.from("deliveries")
        .select("id,order_id,status,pickup_address,dropoff_address,delivery_fee_minor,rider_fee_minor,created_at,assigned_at,picked_up_at,delivered_at,orders(order_number,status,delivery_method,contact_phone,notes)")
        .eq("id", id)
        .maybeSingle();
      if (result.error) throw result.error;
      if (!result.data) { setError("This job is not assigned to you, or it no longer exists."); return; }
      setDelivery(result.data as unknown as Delivery);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "We could not load this job.");
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  async function advance(to: string, label: string) {
    if (!delivery) return;
    if (to === "delivered" && !/^[0-9]{4}$/.test(proofCode.trim())) {
      setError("Ask the customer for the four-digit handover code and enter it exactly.");
      return;
    }
    if (!window.confirm(`${label}?`)) return;
    setBusy(to); setError(""); setMessage("");
    try {
      const db = createSupabaseBrowserClient();

      if (to === "delivered") {
        // Verify in its own call so a wrong guess is counted; see migration 0034.
        const { data: outcome, error: verifyError } = await db.rpc("verify_delivery_proof_code", {
          p_delivery_id: delivery.id,
          p_code: proofCode.trim(),
        });
        if (verifyError) throw verifyError;
        if (outcome !== "verified") {
          setError(
            outcome === "locked"
              ? "Too many incorrect codes. This delivery is locked for 15 minutes; contact support before trying again."
              : outcome === "used"
                ? "This delivery has already been confirmed."
                : "That confirmation code is not correct. Ask the customer to read it again.",
          );
          return;
        }
      }

      const result = await db.rpc("rider_update_delivery", {
        p_delivery_id: delivery.id,
        p_to_status: to,
        p_proof_code: null,
        p_note: to === "delivered" ? "Handover code confirmed with the customer." : label,
      });
      if (result.error) throw result.error;
      setMessage(`${label} recorded.`);
      setProofCode("");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The delivery status could not be updated.");
    } finally { setBusy(""); }
  }

  async function reportProblem() {
    if (!delivery) return;
    if (!window.confirm("Report a problem and stop this delivery? The customer and Shilevi will be able to see the failed delivery record.")) return;
    setBusy("failed"); setError(""); setMessage("");
    try {
      const db = createSupabaseBrowserClient();
      const result = await db.rpc("rider_update_delivery", {
        p_delivery_id: delivery.id,
        p_to_status: "failed",
        p_proof_code: null,
        p_note: "Rider reported a problem with this delivery.",
      });
      if (result.error) throw result.error;
      setMessage("The delivery was marked as failed. Contact support before taking another action.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The problem could not be recorded.");
    } finally { setBusy(""); }
  }

  if (loading) return <main className="min-h-screen bg-slate-50 px-5 py-12"><p role="status" className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 text-slate-600">Loading job…</p></main>;
  if (error && !delivery) return <main className="min-h-screen bg-slate-50 px-5 py-12"><section className="mx-auto max-w-2xl rounded-3xl border border-slate-200 bg-white p-8"><h1 className="text-2xl font-black">Job unavailable</h1><p className="mt-3 leading-7 text-slate-600">{error}</p><Link href="/rider/jobs" className="mt-5 inline-block font-bold text-blue-700">Back to jobs →</Link></section></main>;
  if (!delivery) return null;

  const order = Array.isArray(delivery.orders) ? delivery.orders[0] : delivery.orders;
  const action = nextRiderAction(delivery.status);
  const canReport = ["assigned", "to_pickup", "collected"].includes(delivery.status);

  return <main className="min-h-screen bg-slate-50 text-slate-950">
    <header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-5 py-5"><Link href="/" className="text-2xl font-black text-blue-700">shilevi</Link><Link href="/rider/jobs" className="text-sm font-semibold text-blue-700">← All jobs</Link></div></header>
    <div className="mx-auto max-w-4xl px-5 py-8 sm:py-12">
      <p className="text-sm font-bold uppercase tracking-wide text-blue-700">{order?.order_number ?? "Delivery job"}</p>
      <h1 className="mt-2 text-3xl font-black sm:text-4xl">{DELIVERY_STATUS_LABELS[delivery.status] ?? delivery.status}</h1>
      <p className="mt-3 text-slate-600">Rider fee: <span className="font-bold text-slate-950">{formatMoney(delivery.rider_fee_minor, "KES")}</span></p>

      {message && <p role="status" className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">{message}</p>}
      {error && <p role="alert" className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}

      <div className="mt-7 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <section className="rounded-3xl border border-slate-200 bg-white p-6">
            <h2 className="text-xl font-black">Route</h2>
            <div className="mt-4 space-y-4">
              <div><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Pickup</p><p className="mt-1 whitespace-pre-wrap leading-7 text-slate-800">{delivery.pickup_address || "Pickup details are provided by the seller. Contact support if they are missing."}</p></div>
              <div className="border-t border-slate-100 pt-4"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Drop-off</p><p className="mt-1 whitespace-pre-wrap leading-7 text-slate-800">{delivery.dropoff_address}</p></div>
            </div>
            {order?.contact_phone && <p className="mt-5 rounded-xl bg-slate-50 p-4 text-sm"><span className="font-semibold">Customer phone:</span> {order.contact_phone}</p>}
            {order?.notes && <div className="mt-3 rounded-xl bg-slate-50 p-4 text-sm"><p className="font-semibold">Customer note</p><p className="mt-1 whitespace-pre-wrap leading-6 text-slate-700">{order.notes}</p></div>}
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-6">
            <h2 className="text-xl font-black">Delivery progress</h2>
            <ol className="mt-4 space-y-2 text-sm text-slate-600">
              <li>Assigned {delivery.assigned_at ? new Date(delivery.assigned_at).toLocaleString() : ""}</li>
              <li>Picked up {delivery.picked_up_at ? new Date(delivery.picked_up_at).toLocaleString() : "Not yet"}</li>
              <li>Delivered {delivery.delivered_at ? new Date(delivery.delivered_at).toLocaleString() : "Not yet"}</li>
            </ol>
          </section>
        </div>

        <aside className="h-fit space-y-4">
          <LiveTrackingCard kind="delivery" id={delivery.id} title="Route map" />

          <section className="rounded-3xl border border-slate-200 bg-white p-6">
            <h2 className="text-lg font-black">Next step</h2>
            {action ? <button onClick={() => void advance(action.to, action.label)} disabled={Boolean(busy)} className="mt-4 w-full rounded-xl bg-blue-700 px-5 py-3 font-bold text-white disabled:opacity-50">{busy === action.to ? "Updating…" : action.label}</button> : <p className="mt-4 text-sm leading-6 text-slate-600">{delivery.status === "delivered" ? "This delivery is complete. The customer can confirm receipt in their order." : delivery.status === "failed" ? "This delivery was marked failed. Contact support if you need help." : "No rider action is available for this job right now."}</p>}

            {delivery.status === "in_transit" && <div className="mt-5 border-t border-slate-200 pt-4">
              <label className="block text-sm font-semibold">Customer handover code
                <input inputMode="numeric" pattern="[0-9]{4}" maxLength={4} value={proofCode} onChange={event => setProofCode(event.target.value.replace(/\D/g, "").slice(0, 4))} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-center text-2xl font-black tracking-[0.3em]" placeholder="0000" />
              </label>
              <p className="mt-2 text-xs leading-5 text-slate-500">Ask the customer for this code only when you hand over the item. Do not guess or reuse a code.</p>
              <button onClick={() => void advance("delivered", "Complete delivery")} disabled={Boolean(busy) || proofCode.length !== 4} className="mt-3 w-full rounded-xl bg-emerald-700 px-5 py-3 font-bold text-white disabled:opacity-50">{busy === "delivered" ? "Completing…" : "Complete delivery"}</button>
            </div>}

            {canReport && <button onClick={() => void reportProblem()} disabled={Boolean(busy)} className="mt-4 w-full rounded-xl border border-red-200 px-5 py-3 text-sm font-bold text-red-700 disabled:opacity-50">Report a problem</button>}
          </section>
          <section className="rounded-3xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-950">
            <h2 className="font-black">Safety</h2>
            <p className="mt-2">Do not share the customer&apos;s address, phone number, or handover code outside this job. If you cannot complete the delivery, mark the problem instead of leaving the job open.</p>
          </section>
        </aside>
      </div>
    </div>
  </main>;
}
