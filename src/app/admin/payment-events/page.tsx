import "server-only";

import type { Metadata } from "next";
import { requireStaffCapability } from "@/lib/admin/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AdminShell } from "@/components/admin/AdminShell";
import { formatMoney } from "@/lib/money";

export const metadata: Metadata = {
  title: "Payment events",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

type PaymentEvent = {
  id: number;
  order_id: string;
  provider: string;
  event_type: string;
  amount_minor: number;
  currency: string;
  reference: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
};

export default async function AdminPaymentEventsPage() {
  const result = await requireStaffCapability("finance.read");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("payment_events")
    .select("id,order_id,provider,event_type,amount_minor,currency,reference,payload,created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  const events = (data ?? []) as unknown as PaymentEvent[];

  const byProvider = events.reduce<Record<string, number>>((totals, event) => {
    totals[event.provider] = (totals[event.provider] ?? 0) + 1;
    return totals;
  }, {});

  return (
    <AdminShell
      email={result.user.email ?? null}
      mfaLevel={result.mfaLevel}
      title="Payment events"
      description="Provider callbacks as they were received. This is the reconciliation trail behind an intent: what the provider said, when it said it, and for how much. Stored payloads are summarised by key only — they can contain provider secrets and are never rendered wholesale."
    >
      {error ? (
        <p role="alert" className="rounded-2xl border border-amber-800 bg-amber-950/40 p-5 text-sm leading-6 text-amber-100">
          Payment events could not be read. Nothing was changed. Reload once; if it persists, System health reports whether the cause is a missing migration, an MFA session or a missing capability.</p>
      ) : events.length === 0 ? (
        <p className="rounded-2xl border border-slate-800 bg-slate-900 p-6 text-sm leading-6 text-slate-300">
          No provider callback has been recorded. Because no payment provider is configured in this
          deployment unless the payment methods screen says otherwise, this is expected until a live test
          is run.
        </p>
      ) : (
        <>
          <section className="flex flex-wrap gap-2">
            {Object.entries(byProvider)
              .sort((a, b) => b[1] - a[1])
              .map(([provider, count]) => (
                <span key={provider} className="rounded-full border border-slate-700 px-3 py-1 text-xs font-bold text-slate-200">
                  {provider} · {count}
                </span>
              ))}
          </section>

          <div className="mt-5 overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-800 text-xs font-bold uppercase tracking-wide text-slate-400">
                <tr>
                  <th scope="col" className="px-4 py-3">Received</th>
                  <th scope="col" className="px-4 py-3">Provider</th>
                  <th scope="col" className="px-4 py-3">Event</th>
                  <th scope="col" className="px-4 py-3">Order</th>
                  <th scope="col" className="px-4 py-3">Payload keys</th>
                  <th scope="col" className="px-4 py-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {events.map(event => (
                  <tr key={event.id}>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-400">
                      {new Date(event.created_at).toLocaleString("en-KE")}
                    </td>
                    <td className="px-4 py-3 text-slate-300">{event.provider}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-300">{event.event_type}</td>
                    <td className="px-4 py-3 font-mono text-[11px] text-slate-500">{event.order_id.slice(0, 8)}…</td>
                    <td className="max-w-[16rem] px-4 py-3 text-xs text-slate-500">
                      {event.payload && Object.keys(event.payload).length > 0
                        ? Object.keys(event.payload).join(", ")
                        : "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-100">
                      {formatMoney(event.amount_minor, event.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 max-w-3xl text-xs leading-6 text-slate-500">
            Showing the most recent 200 events. Payload bodies are stored for dispute resolution but are
            deliberately not displayed here; provider references are omitted from this table for the same
            reason.
          </p>
        </>
      )}
    </AdminShell>
  );
}
