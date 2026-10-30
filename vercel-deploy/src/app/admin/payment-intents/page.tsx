import "server-only";

import type { Metadata } from "next";
import Link from "next/link";
import { requireStaffCapability } from "@/lib/admin/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AdminShell } from "@/components/admin/AdminShell";
import { formatMoney } from "@/lib/money";

export const metadata: Metadata = {
  title: "Payment intents",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

type Intent = {
  id: string;
  order_id: string | null;
  purpose: string;
  provider: string;
  amount_minor: number;
  currency: string;
  status: string;
  provider_reference: string | null;
  created_at: string;
};

const statusTone: Record<string, string> = {
  succeeded: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
  paid: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
  pending: "border-amber-500/40 bg-amber-500/10 text-amber-200",
  initiated: "border-blue-500/40 bg-blue-500/10 text-blue-200",
  failed: "border-red-500/40 bg-red-500/10 text-red-200",
  cancelled: "border-slate-600 bg-slate-800 text-slate-200",
};

export default async function AdminPaymentIntentsPage() {
  const result = await requireStaffCapability("finance.read");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("payment_intents")
    .select("id,order_id,purpose,provider,amount_minor,currency,status,provider_reference,created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  const intents = (data ?? []) as Intent[];

  const succeeded = intents.filter(intent => ["succeeded", "paid"].includes(intent.status));
  const pending = intents.filter(intent => ["initiated", "pending", "processing"].includes(intent.status));
  const failed = intents.filter(intent => ["failed", "cancelled"].includes(intent.status));
  const settledTotal = succeeded.reduce((total, intent) => total + Number(intent.amount_minor), 0);

  return (
    <AdminShell
      email={result.user.email ?? null}
      mfaLevel={result.mfaLevel}
      title="Payment intents"
      description="Every attempt to collect money, with the provider that was asked and the state the database recorded. An intent is the request; only a verified provider result moves it to succeeded. Provider references are partially masked and full callback payloads live in payment events."
    >
      {error ? (
        <p role="alert" className="rounded-2xl border border-amber-800 bg-amber-950/40 p-5 text-sm leading-6 text-amber-100">
          Payment intents could not be read. Nothing was changed. Reload once; if it persists, System health reports whether the cause is a missing migration, an MFA session or a missing capability.</p>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Succeeded", value: String(succeeded.length), detail: "Recorded as settled" },
              { label: "In flight", value: String(pending.length), detail: "Initiated or awaiting a callback" },
              { label: "Failed", value: String(failed.length), detail: "No money taken" },
              { label: "Settled value", value: formatMoney(settledTotal, "KES"), detail: "Sum of succeeded intents shown" },
            ].map(card => (
              <article key={card.label} className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{card.label}</p>
                <p className="mt-2 text-2xl font-black text-slate-100">{card.value}</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">{card.detail}</p>
              </article>
            ))}
          </section>

          <h2 className="mt-8 text-lg font-black text-slate-100">Recent intents</h2>
          {intents.length === 0 ? (
            <p className="mt-3 rounded-2xl border border-slate-800 bg-slate-900 p-6 text-sm leading-6 text-slate-300">
              No payment has been attempted yet. Because checkout fails closed without configured provider
              credentials, an empty list usually means no real charge was started.
            </p>
          ) : (
            <div className="mt-3 overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-800 text-xs font-bold uppercase tracking-wide text-slate-400">
                  <tr>
                    <th scope="col" className="px-4 py-3">Created</th>
                    <th scope="col" className="px-4 py-3">Purpose</th>
                    <th scope="col" className="px-4 py-3">Provider</th>
                    <th scope="col" className="px-4 py-3">Status</th>
                    <th scope="col" className="px-4 py-3">Reference</th>
                    <th scope="col" className="px-4 py-3 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {intents.map(intent => (
                    <tr key={intent.id}>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-400">
                        {new Date(intent.created_at).toLocaleString("en-KE")}
                      </td>
                      <td className="px-4 py-3 capitalize text-slate-200">{intent.purpose.replaceAll("_", " ")}</td>
                      <td className="px-4 py-3 text-slate-300">{intent.provider}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${statusTone[intent.status] ?? "border-slate-700 text-slate-300"}`}>
                          {intent.status}
                        </span>
                      </td>
                      <td className="max-w-[12rem] truncate px-4 py-3 font-mono text-xs text-slate-500">
                        {intent.provider_reference
                          ? `${intent.provider_reference.slice(0, 4)}…${intent.provider_reference.slice(-4)}`
                          : "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-100">
                        {formatMoney(intent.amount_minor, intent.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-4 text-xs leading-6 text-slate-500">
            Showing the most recent 200 intents. Raw provider callbacks are in{" "}
            <Link href="/admin/payment-events" className="font-semibold text-blue-300 hover:text-blue-200">Payment events</Link>;
            platform-wide totals are in{" "}
            <Link href="/admin/payments" className="font-semibold text-blue-300 hover:text-blue-200">Payments</Link>.
          </p>
        </>
      )}
    </AdminShell>
  );
}
