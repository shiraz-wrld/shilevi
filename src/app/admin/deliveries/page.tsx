import "server-only";

import type { Metadata } from "next";
import Link from "next/link";
import { requireStaffCapability } from "@/lib/admin/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AdminShell } from "@/components/admin/AdminShell";
import { formatMoney } from "@/lib/money";

export const metadata: Metadata = {
  title: "Deliveries",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

type DeliveryRow = {
  id: string;
  order_number: string;
  status: string;
  dropoff_county: string | null;
  delivery_fee_minor: number;
  rider_assigned: boolean;
  created_at: string;
  delivered_at: string | null;
};

const openStatuses = new Set(["requested", "assigned", "to_pickup", "collected", "in_transit"]);

export default async function AdminDeliveriesPage() {
  const result = await requireStaffCapability("orders.read");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_list_deliveries", { p_limit: 100 });
  const deliveries = (data ?? []) as unknown as DeliveryRow[];

  const open = deliveries.filter(delivery => openStatuses.has(delivery.status));
  const failed = deliveries.filter(delivery => delivery.status === "failed");
  const delivered = deliveries.filter(delivery => delivery.status === "delivered");
  const feeTotal = delivered.reduce((total, delivery) => total + Number(delivery.delivery_fee_minor), 0);

  return (
    <AdminShell
      email={result.user.email ?? null}
      mfaLevel={result.mfaLevel}
      title="Deliveries"
      description="Delivery jobs attached to orders, including county, fee split and whether a rider has claimed the job. Street addresses and proof codes are deliberately excluded from this view."
    >
      {error ? (
        <p role="alert" className="rounded-2xl border border-amber-800 bg-amber-950/40 p-5 text-sm leading-6 text-amber-100">
          Delivery jobs could not be read. Nothing was changed. Reload once; if it persists, System health reports whether the cause is a missing migration, an MFA session or a missing capability.</p>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "In progress", value: String(open.length), detail: "Requested through in transit" },
              { label: "Delivered", value: String(delivered.length), detail: "Most recent 100 jobs" },
              { label: "Failed", value: String(failed.length), detail: "Needs a support decision" },
              { label: "Delivered fees", value: formatMoney(feeTotal, "KES"), detail: "Sum of the delivery fee on delivered jobs" },
            ].map(card => (
              <article key={card.label} className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{card.label}</p>
                <p className="mt-2 text-2xl font-black text-slate-100">{card.value}</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">{card.detail}</p>
              </article>
            ))}
          </section>

          <h2 className="mt-8 text-lg font-black text-slate-100">Recent jobs</h2>
          {deliveries.length === 0 ? (
            <p className="mt-3 rounded-2xl border border-slate-800 bg-slate-900 p-6 text-sm leading-6 text-slate-300">
              No delivery job exists yet. Delivery jobs are created only for orders that chose platform
              delivery at checkout.
            </p>
          ) : (
            <div className="mt-3 overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-800 text-xs font-bold uppercase tracking-wide text-slate-400">
                  <tr>
                    <th scope="col" className="px-4 py-3">Order</th>
                    <th scope="col" className="px-4 py-3">Created</th>
                    <th scope="col" className="px-4 py-3">County</th>
                    <th scope="col" className="px-4 py-3">Status</th>
                    <th scope="col" className="px-4 py-3">Rider</th>
                    <th scope="col" className="px-4 py-3 text-right">Fee</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {deliveries.map(delivery => (
                    <tr key={delivery.id}>
                      <td className="px-4 py-3 font-semibold text-slate-100">{delivery.order_number}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-400">
                        {new Date(delivery.created_at).toLocaleString("en-KE")}
                      </td>
                      <td className="px-4 py-3 text-slate-300">{delivery.dropoff_county ?? "—"}</td>
                      <td className="px-4 py-3 capitalize text-slate-300">{delivery.status.replaceAll("_", " ")}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${delivery.rider_assigned ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200" : "border-amber-500/40 bg-amber-500/10 text-amber-200"}`}>
                          {delivery.rider_assigned ? "Assigned" : "Unclaimed"}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-100">
                        {formatMoney(delivery.delivery_fee_minor, "KES")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-4 text-xs leading-6 text-slate-500">
            Showing the most recent 100 jobs. Order-level payment state is on{" "}
            <Link href="/admin/orders" className="font-semibold text-blue-300 hover:text-blue-200">Orders</Link>; the
            delivery fee itself is recorded in the ledger when the order is paid.
          </p>
        </>
      )}
    </AdminShell>
  );
}
