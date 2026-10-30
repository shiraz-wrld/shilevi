"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { formatMoney } from "@/lib/money";
import { ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS, orderStatusTone, paymentStatusTone, nextProviderAction } from "@/lib/order-status";
import { MapPinPicker, type PickedPoint } from "@/components/tracking/MapPinPicker";

type ProviderShipment = {
  id: string;
  status: string;
  pickup_lat: number | null;
  pickup_lng: number | null;
  pickup_landmark: string | null;
  pickup_point_source: string | null;
};
type ProviderOrder = {
  id: string;
  order_number: string;
  status: string;
  payment_status: string;
  currency: string;
  total_minor: number;
  delivery_method: string;
  delivery_address: string | null;
  contact_phone: string | null;
  notes: string | null;
  created_at: string;
  deliveries?: ProviderShipment[] | null;
};
type ItemRow = {
  order_id: string;
  title_snapshot: string;
  quantity: number;
  line_total_minor: number;
  orders: ProviderOrder | ProviderOrder[] | null;
};
type Group = { order: ProviderOrder; items: ItemRow[] };

const methodLabels: Record<string, string> = {
  platform_delivery: "Shilevi delivery",
  seller_delivery: "Seller delivery",
  pickup: "Customer pickup",
};

export default function ProviderOrdersPage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [savedPoint, setSavedPoint] = useState<{ latitude: number; longitude: number; landmark: string | null } | null>(null);
  const [pointDraft, setPointDraft] = useState<PickedPoint | null>(null);
  const [pointLandmark, setPointLandmark] = useState("");
  const [pickupFor, setPickupFor] = useState("");
  const [pickupDraft, setPickupDraft] = useState<PickedPoint | null>(null);
  const [pickupLandmark, setPickupLandmark] = useState("");

  const load = useCallback(async () => {
    try {
      const db = createSupabaseBrowserClient();
      const auth = await db.auth.getUser();
      if (auth.error) throw auth.error;
      if (!auth.data.user) { window.location.replace("/login?next=%2Fprovider%2Forders"); return; }

      const result = await db.from("order_items")
        .select("order_id,title_snapshot,quantity,line_total_minor,orders(id,order_number,status,payment_status,currency,total_minor,delivery_method,delivery_address,contact_phone,notes,created_at,deliveries(id,status,pickup_lat,pickup_lng,pickup_landmark,pickup_point_source))")
        .eq("owner_id", auth.data.user.id)
        .order("created_at", { ascending: false })
        .limit(100);
      if (result.error) throw result.error;

      const rows = (result.data ?? []) as unknown as ItemRow[];
      const byOrder = new Map<string, Group>();
      for (const row of rows) {
        const order = Array.isArray(row.orders) ? row.orders[0] : row.orders;
        if (!order) continue;
        const existing = byOrder.get(order.id);
        if (existing) existing.items.push(row);
        else byOrder.set(order.id, { order, items: [row] });
      }
      setGroups([...byOrder.values()].sort((a, b) => new Date(b.order.created_at).getTime() - new Date(a.order.created_at).getTime()));

      const saved = await db.from("provider_pickup_points").select("latitude,longitude,landmark").eq("user_id", auth.data.user.id).maybeSingle();
      if (!saved.error && saved.data) {
        setSavedPoint({ latitude: Number(saved.data.latitude), longitude: Number(saved.data.longitude), landmark: saved.data.landmark ?? null });
        setPointLandmark(saved.data.landmark ?? "");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "We could not load provider orders. Confirm migrations 0016-0017 have been applied.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function savePoint() {
    if (!pointDraft) { setError("Tap the map to place your collection point first."); return; }
    setBusy("point"); setError(""); setMessage("");
    try {
      const db = createSupabaseBrowserClient();
      const result = await db.rpc("set_my_pickup_point", {
        p_lat: pointDraft.latitude,
        p_lng: pointDraft.longitude,
        p_accuracy_m: pointDraft.accuracy_m,
        p_landmark: pointLandmark.trim() || null,
      });
      if (result.error) throw result.error;
      setSavedPoint({ latitude: pointDraft.latitude, longitude: pointDraft.longitude, landmark: pointLandmark.trim() || null });
      setMessage("Collection point saved. New Shilevi deliveries for your listings start from this exact point.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The collection point could not be saved.");
    } finally { setBusy(""); }
  }

  async function savePickupPoint(deliveryId: string) {
    if (!pickupDraft) { setError("Tap the map to place the collection point first."); return; }
    setBusy(deliveryId); setError(""); setMessage("");
    try {
      const db = createSupabaseBrowserClient();
      const result = await db.rpc("set_delivery_pickup_point", {
        p_delivery_id: deliveryId,
        p_lat: pickupDraft.latitude,
        p_lng: pickupDraft.longitude,
        p_accuracy_m: pickupDraft.accuracy_m,
        p_landmark: pickupLandmark.trim() || null,
      });
      if (result.error) throw result.error;
      setPickupFor("");
      setPickupDraft(null);
      setPickupLandmark("");
      setMessage("Collection point confirmed for this order. The rider sees it only after taking the job.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The order's collection point could not be saved.");
    } finally { setBusy(""); }
  }

  async function advance(order: ProviderOrder, to: string, label: string) {
    if (!window.confirm(`${label} for ${order.order_number}?`)) return;
    setBusy(order.id); setError(""); setMessage("");
    try {
      const db = createSupabaseBrowserClient();
      const result = await db.rpc("provider_update_order_status", { p_order_id: order.id, p_to_status: to, p_note: label });
      if (result.error) throw result.error;
      setMessage(`${order.order_number}: ${label.toLowerCase()} recorded.`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The order status could not be updated.");
    } finally { setBusy(""); }
  }

  return <main className="min-h-screen bg-slate-50 text-slate-950">
    <header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-5 py-5"><Link href="/" className="text-2xl font-black text-blue-700">shilevi</Link><div className="flex gap-4 text-sm font-semibold text-blue-700"><Link href="/provider/listings">Listings</Link><Link href="/provider/requests">Enquiries</Link><Link href="/account">Account</Link></div></div></header>
    <div className="mx-auto max-w-5xl px-5 py-8 sm:py-12">
      <p className="text-sm font-bold uppercase tracking-wide text-blue-700">Provider workspace</p>
      <h1 className="mt-2 text-3xl font-black sm:text-4xl">Orders to fulfil</h1>
      <p className="mt-3 max-w-2xl leading-7 text-slate-600">Only paid orders appear with an action. Move an order through acceptance, preparation, handover, and delivery as the work actually happens.</p>

      <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-black">Your collection point</h2>
            <p className="mt-1 max-w-xl text-sm leading-6 text-slate-600">The exact spot a rider collects from. New Shilevi deliveries for your listings start from it. It is never guessed from your business address, and a rider sees it only after taking the job.</p>
          </div>
          <span className={`rounded-full border px-3 py-1 text-xs font-bold ${savedPoint ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-slate-300 text-slate-700"}`}>{savedPoint ? "Saved" : "Not set"}</span>
        </div>
        {savedPoint && <p className="mt-3 rounded-xl bg-slate-50 p-3 text-sm leading-6 text-slate-700">Pinned at {savedPoint.latitude.toFixed(5)}, {savedPoint.longitude.toFixed(5)}{savedPoint.landmark ? ` · ${savedPoint.landmark}` : ""}.</p>}
        <div className="mt-4">
          <MapPinPicker
            value={pointDraft ?? (savedPoint ? { latitude: savedPoint.latitude, longitude: savedPoint.longitude, accuracy_m: null, source: "map" } : null)}
            onChange={setPointDraft}
            landmark={pointLandmark}
            onLandmarkChange={setPointLandmark}
            landmarkLabel="Collection instructions for the rider"
          />
        </div>
        <button onClick={() => void savePoint()} disabled={busy === "point"} className="mt-3 rounded-xl bg-blue-700 px-5 py-3 font-bold text-white disabled:opacity-50">{busy === "point" ? "Saving…" : "Save collection point"}</button>
      </section>

      {message && <p role="status" className="mt-5 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">{message}</p>}
      {error && <p role="alert" className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}

      {loading ? <p role="status" className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 text-slate-600">Loading orders…</p> : groups.length === 0 ? <section className="mt-8 rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-center"><h2 className="text-2xl font-black">No orders yet</h2><p className="mx-auto mt-3 max-w-md leading-7 text-slate-600">When a customer pays for one of your published listings, the order will appear here.</p><Link href="/provider/listings" className="mt-6 inline-flex rounded-xl bg-blue-700 px-5 py-3 font-bold text-white">Manage listings →</Link></section> : <div className="mt-8 space-y-4">
        {groups.map(({ order, items }) => {
          const action = nextProviderAction(order.status);
          return <article key={order.id} className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><p className="text-xs font-bold uppercase tracking-wide text-slate-500">{order.order_number}</p><p className="mt-1 text-sm text-slate-500">Paid {order.created_at ? new Date(order.created_at).toLocaleString() : ""}</p></div>
              <div className="flex flex-wrap gap-2"><span className={`rounded-full border px-3 py-1 text-xs font-bold ${orderStatusTone(order.status)}`}>{ORDER_STATUS_LABELS[order.status] ?? order.status}</span><span className={`rounded-full border px-3 py-1 text-xs font-bold ${paymentStatusTone(order.payment_status)}`}>{PAYMENT_STATUS_LABELS[order.payment_status] ?? order.payment_status}</span></div>
            </div>
            <ul className="mt-4 divide-y divide-slate-100">{items.map(item => <li key={`${order.id}-${item.title_snapshot}`} className="flex justify-between gap-3 py-2 text-sm"><span>{item.title_snapshot} × {item.quantity}</span><span className="font-semibold">{formatMoney(item.line_total_minor, order.currency)}</span></li>)}</ul>
            <div className="mt-4 grid gap-3 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-2">
              <p><span className="font-semibold">Fulfilment:</span> {methodLabels[order.delivery_method] ?? order.delivery_method}</p>
              <p><span className="font-semibold">Total:</span> {formatMoney(order.total_minor, order.currency)}</p>
              {order.contact_phone && <p><span className="font-semibold">Customer phone:</span> {order.contact_phone}</p>}
              {order.delivery_address && <p className="sm:col-span-2"><span className="font-semibold">Address:</span> {order.delivery_address}</p>}
              {order.notes && <p className="sm:col-span-2"><span className="font-semibold">Customer note:</span> {order.notes}</p>}
            </div>
            {(() => {
              const shipment = order.deliveries?.[0] ?? null;
              if (order.delivery_method !== "platform_delivery" || !shipment) return null;
              const editable = ["requested", "assigned", "to_pickup"].includes(shipment.status);
              const hasPoint = shipment.pickup_lat !== null && shipment.pickup_lng !== null;
              return <div className="mt-3 rounded-xl border border-slate-200 p-4">
                <p className="text-sm font-bold">Collection point for this order</p>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  {hasPoint
                    ? `Pinned at ${Number(shipment.pickup_lat).toFixed(5)}, ${Number(shipment.pickup_lng).toFixed(5)}${shipment.pickup_landmark ? ` · ${shipment.pickup_landmark}` : ""}.`
                    : "No exact collection point yet. Without one, distance-based rider matching cannot use this shipment."}
                </p>
                {editable ? (pickupFor === shipment.id ? <div className="mt-3">
                  <MapPinPicker
                    value={pickupDraft}
                    onChange={setPickupDraft}
                    landmark={pickupLandmark}
                    onLandmarkChange={setPickupLandmark}
                    landmarkLabel="Collection instructions for the rider"
                  />
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button onClick={() => void savePickupPoint(shipment.id)} disabled={busy === shipment.id} className="rounded-xl bg-blue-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{busy === shipment.id ? "Saving…" : "Confirm collection point"}</button>
                    <button onClick={() => { setPickupFor(""); setPickupDraft(null); }} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold">Cancel</button>
                  </div>
                </div> : <button onClick={() => { setPickupFor(shipment.id); setPickupDraft(hasPoint ? { latitude: Number(shipment.pickup_lat), longitude: Number(shipment.pickup_lng), accuracy_m: null, source: "map" } : null); setPickupLandmark(shipment.pickup_landmark ?? ""); }} className="mt-2 rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold">{hasPoint ? "Adjust collection point" : "Set collection point"}</button>) : <p className="mt-1 text-xs leading-5 text-slate-500">The rider has already collected this parcel, so the collection point is fixed.</p>}
              </div>;
            })()}
            <div className="mt-4 flex flex-wrap gap-3">
              {action && order.payment_status === "paid" ? <button onClick={() => void advance(order, action.to, action.label)} disabled={busy === order.id} className="rounded-xl bg-blue-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{busy === order.id ? "Updating…" : action.label}</button> : <p className="text-sm text-slate-500">{order.payment_status === "paid" ? "No action is required from you at this stage." : "Wait for payment before fulfilling this order."}</p>}
            </div>
          </article>;
        })}
      </div>}
    </div>
  </main>;
}
