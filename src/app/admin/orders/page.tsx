import "server-only";

import type { Metadata } from "next";
import Link from "next/link";
import { requireOwnerAdmin } from "@/lib/admin/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AdminShell } from "@/components/admin/AdminShell";
import { formatMoney } from "@/lib/money";

export const metadata: Metadata = {
  title: "Orders",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

type OrderRow = {
  id: string;
  order_number: string;
  status: string;
  payment_status: string;
  currency: string;
  total_minor: number;
  delivery_method: string;
  created_at: string;
};

const deliveryLabels: Record<string, string> = {
  platform_delivery: "Platform delivery",
  seller_delivery: "Provider delivery",
  pickup: "Customer pickup",
};

export default async function AdminOrdersPage() {
  const result = await requireOwnerAdmin();

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("orders")
    .select("id,order_number,status,payment_status,currency,total_minor,delivery_method,created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  const orders = (data ?? []) as OrderRow[];

  return (
    <AdminShell
      email={result.user.email ?? null}
      mfaLevel={result.mfaLevel}
      title="Orders"
      description="Read-only operational view of recent orders. Addresses, phone numbers and notes are intentionally excluded; open the participant-facing order record through a support case when details are genuinely required."
    >
      {error ? (
        <p role="alert" className="rounded-2xl border border-amber-800 bg-amber-950/40 p-5 text-sm leading-6 text-amber-100">
          Orders could not be read. Nothing was changed. Reload once; if it persists, System health reports whether the cause is a missing migration, an MFA session or a missing capability.</p>
      ) : orders.length === 0 ? (
        <p className="rounded-2xl border border-slate-800 bg-slate-900 p-6 text-sm leading-6 text-slate-300">
          No orders yet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-800 text-xs font-bold uppercase tracking-wide text-slate-400">
              <tr>
                <th scope="col" className="px-4 py-3">Order</th>
                <th scope="col" className="px-4 py-3">Placed</th>
                <th scope="col" className="px-4 py-3">Fulfilment</th>
                <th scope="col" className="px-4 py-3">Payment</th>
                <th scope="col" className="px-4 py-3">Status</th>
                <th scope="col" className="px-4 py-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {orders.map(order => (
                <tr key={order.id}>
                  <td className="px-4 py-3 font-semibold text-slate-100">{order.order_number}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-400">{new Date(order.created_at).toLocaleString("en-KE")}</td>
                  <td className="px-4 py-3 text-slate-300">{deliveryLabels[order.delivery_method] ?? order.delivery_method}</td>
                  <td className="px-4 py-3 text-slate-300">{order.payment_status}</td>
                  <td className="px-4 py-3 text-slate-300">{order.status}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-100">
                    {formatMoney(order.total_minor, order.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-5 text-xs leading-6 text-slate-500">
        Showing the most recent 100 orders. Customer refund requests are decided in{" "}
        <Link href="/admin/refunds" className="font-semibold text-blue-300 hover:text-blue-200">
          Refunds
        </Link>
        , which requires an MFA-verified owner session. Payout dispatch remains a separate, credential-gated
        step.
      </p>
    </AdminShell>
  );
}
