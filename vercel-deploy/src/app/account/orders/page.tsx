"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { formatMoney } from "@/lib/money";
import { ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS, orderStatusTone, paymentStatusTone } from "@/lib/order-status";

type OrderItem = { title_snapshot: string; quantity: number; line_total_minor: number };
type OrderRow = {
  id: string;
  order_number: string;
  status: string;
  payment_status: string;
  currency: string;
  total_minor: number;
  delivery_method: string;
  created_at: string;
  order_items: OrderItem[] | null;
};

export default function CustomerOrdersPage() {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const db = createSupabaseBrowserClient();
        const auth = await db.auth.getUser();
        if (auth.error) throw auth.error;
        if (!auth.data.user) { window.location.replace("/login?next=%2Faccount%2Forders"); return; }
        const result = await db.from("orders")
          .select("id,order_number,status,payment_status,currency,total_minor,delivery_method,created_at,order_items(title_snapshot,quantity,line_total_minor)")
          .order("created_at", { ascending: false })
          .limit(50);
        if (result.error) throw result.error;
        if (alive) setOrders((result.data ?? []) as OrderRow[]);
      } catch (caught) {
        if (alive) setError(caught instanceof Error ? caught.message : "We could not load your orders right now. Please try again in a moment.");
      } finally {
        if (alive) setLoading(false);
      }
    }
    void load();
    return () => { alive = false; };
  }, []);

  return <main className="min-h-screen bg-slate-50 text-slate-950">
    <header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-5 py-5"><Link href="/" className="text-2xl font-black text-blue-700">shilevi</Link><Link href="/account" className="text-sm font-semibold text-blue-700">← Account</Link></div></header>
    <div className="mx-auto max-w-5xl px-5 py-8 sm:py-12">
      <p className="text-sm font-bold uppercase tracking-wide text-blue-700">Your purchases</p>
      <h1 className="mt-2 text-3xl font-black sm:text-4xl">Order history</h1>
      <p className="mt-3 max-w-2xl leading-7 text-slate-600">Track payment, seller progress, delivery, completion, and refunds for every Shilevi order.</p>

      {loading ? <p role="status" className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 text-slate-600">Loading your orders…</p> : error ? <p role="alert" className="mt-8 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm leading-6 text-red-800">{error}</p> : orders.length === 0 ? <section className="mt-8 rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-center"><h2 className="text-2xl font-black">No orders yet</h2><p className="mx-auto mt-3 max-w-md leading-7 text-slate-600">When you place an order, it will appear here with its payment and delivery status.</p><Link href="/marketplace/products" className="mt-6 inline-flex rounded-xl bg-blue-700 px-5 py-3 font-bold text-white">Browse products →</Link></section> : <div className="mt-8 space-y-4">
        {orders.map(order => {
          const itemCount = order.order_items?.reduce((total, item) => total + item.quantity, 0) ?? 0;
          const firstTitle = order.order_items?.[0]?.title_snapshot ?? "Order items";
          return <article key={order.id} className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{order.order_number}</p>
                <h2 className="mt-1 text-lg font-bold">{firstTitle}{itemCount > 1 ? ` and ${itemCount - 1} more item${itemCount - 1 === 1 ? "" : "s"}` : ""}</h2>
                <p className="mt-1 text-sm text-slate-500">Placed {new Date(order.created_at).toLocaleString()}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className={`rounded-full border px-3 py-1 text-xs font-bold ${orderStatusTone(order.status)}`}>{ORDER_STATUS_LABELS[order.status] ?? order.status}</span>
                <span className={`rounded-full border px-3 py-1 text-xs font-bold ${paymentStatusTone(order.payment_status)}`}>{PAYMENT_STATUS_LABELS[order.payment_status] ?? order.payment_status}</span>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
              <p className="text-lg font-black">{formatMoney(order.total_minor, order.currency)}</p>
              <Link href={`/account/orders/${order.id}`} className="rounded-xl bg-blue-700 px-4 py-2 text-sm font-bold text-white">View order →</Link>
            </div>
          </article>;
        })}
      </div>}
    </div>
  </main>;
}
