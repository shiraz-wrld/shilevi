import "server-only";

import type { Metadata } from "next";
import Link from "next/link";
import { requireOwnerAdmin } from "@/lib/admin/auth";
import { AdminShell } from "@/components/admin/AdminShell";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/money";
import { RefundDecision } from "./RefundDecision";

export const metadata: Metadata = {
  title: "Refunds",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

type EmbeddedOrder = { order_number: string; currency: string } | null;

type PendingRefund = {
  id: string;
  reason: string;
  amount_minor: number;
  previous_order_status: string;
  created_at: string;
  orders: EmbeddedOrder;
};

type DecidedRefund = {
  id: string;
  amount_minor: number;
  status: string;
  decided_at: string | null;
  decision_note: string | null;
  orders: EmbeddedOrder;
};

function orderOf(value: EmbeddedOrder | EmbeddedOrder[] | undefined): EmbeddedOrder {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

const statusTone: Record<string, string> = {
  processed: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
  approved: "border-blue-500/40 bg-blue-500/10 text-blue-200",
  rejected: "border-red-500/40 bg-red-500/10 text-red-200",
  failed: "border-amber-500/40 bg-amber-500/10 text-amber-200",
};

export default async function AdminRefundsPage() {
  const result = await requireOwnerAdmin();

  if (result.mfaLevel !== "aal2") {
    return (
      <AdminShell
        email={result.user.email ?? null}
        mfaLevel={result.mfaLevel}
        title="Refunds require MFA"
        description="A refund decision moves money and cannot be taken back. It requires an owner session at MFA assurance level 2."
      >
        <p className="rounded-2xl border border-amber-800 bg-amber-950/40 p-5 text-sm leading-6 text-amber-100">
          Enroll an authenticator in{" "}
          <Link href="/admin/security" className="font-bold underline">
            Admin security
          </Link>
          , verify it, then sign in again. Refund requests remain queued and untouched until then.
        </p>
      </AdminShell>
    );
  }

  const supabase = await createSupabaseServerClient();
  const [pendingResult, decidedResult] = await Promise.all([
    supabase
      .from("refunds")
      .select("id,reason,amount_minor,previous_order_status,created_at,orders(order_number,currency)")
      .eq("status", "requested")
      .order("created_at", { ascending: true })
      .limit(50),
    supabase
      .from("refunds")
      .select("id,amount_minor,status,decided_at,decision_note,orders(order_number,currency)")
      .in("status", ["processed", "approved", "rejected", "failed"])
      .order("decided_at", { ascending: false })
      .limit(25),
  ]);

  const pending = (pendingResult.data ?? []) as unknown as PendingRefund[];
  const decided = (decidedResult.data ?? []) as unknown as DecidedRefund[];
  const readFailed = Boolean(pendingResult.error || decidedResult.error);

  return (
    <AdminShell
      email={result.user.email ?? null}
      mfaLevel={result.mfaLevel}
      title="Refunds"
      description="Customer refund requests, oldest first. Approving settles the refund ledger and returns the order to the customer; rejecting restores the order to the status it held before the request. Nothing happens until you confirm, and every decision is recorded against your account."
    >
      {readFailed ? (
        <div className="rounded-2xl border border-amber-800 bg-amber-950/40 p-5 text-sm leading-6 text-amber-100">
          <p className="font-bold">Refund requests could not be read. Nothing was changed. Reload once; if it persists, System health reports whether the cause is a missing migration, an MFA session or a missing capability.</p>
          <p className="mt-2">
            Confirm the refund tables from migration 0017 are applied and that this session has MFA
            level 2. No refund was changed.
          </p>
        </div>
      ) : (
        <>
          <section aria-labelledby="pending-refunds">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 id="pending-refunds" className="text-lg font-black text-slate-100">
                Awaiting a decision
              </h2>
              <p className="text-sm text-slate-400">
                {pending.length === 0 ? "Nothing waiting" : `${pending.length} waiting`}
              </p>
            </div>

            {pending.length === 0 ? (
              <p className="mt-4 rounded-2xl border border-slate-800 bg-slate-900 p-6 text-sm leading-6 text-slate-300">
                No refund requests are waiting. When a customer requests one, it appears here with the
                amount, the order and their reason.
              </p>
            ) : (
              <ul className="mt-4 space-y-4">
                {pending.map(refund => {
                  const order = orderOf(refund.orders);
                  const currency = order?.currency ?? "KES";
                  const amountLabel = formatMoney(refund.amount_minor, currency);
                  return (
                    <li
                      key={refund.id}
                      className="rounded-2xl border border-slate-800 bg-slate-900 p-5"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-bold text-slate-100">
                            {order?.order_number ?? "Order unavailable"}
                          </p>
                          <p className="mt-1 text-xs text-slate-400">
                            Requested {new Date(refund.created_at).toLocaleString("en-KE")} · order
                            status before the request:{" "}
                            <span className="text-slate-300">{refund.previous_order_status}</span>
                          </p>
                        </div>
                        <p className="text-lg font-black text-slate-100">{amountLabel}</p>
                      </div>
                      <div className="mt-3 rounded-xl bg-slate-950/60 p-3">
                        <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
                          Customer&apos;s reason
                        </p>
                        <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-200">
                          {refund.reason}
                        </p>
                      </div>
                      <div className="mt-4">
                        <RefundDecision
                          refundId={refund.id}
                          orderNumber={order?.order_number ?? "this order"}
                          amountLabel={amountLabel}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section aria-labelledby="decided-refunds" className="mt-10">
            <h2 id="decided-refunds" className="text-lg font-black text-slate-100">
              Recent decisions
            </h2>
            {decided.length === 0 ? (
              <p className="mt-4 rounded-2xl border border-slate-800 bg-slate-900 p-6 text-sm leading-6 text-slate-300">
                No refund has been decided yet. An empty list here means no decisions exist — it is not
                a zero-value sum.
              </p>
            ) : (
              <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-800 text-xs font-bold uppercase tracking-wide text-slate-400">
                    <tr>
                      <th scope="col" className="px-4 py-3">Order</th>
                      <th scope="col" className="px-4 py-3">Status</th>
                      <th scope="col" className="px-4 py-3">Decided</th>
                      <th scope="col" className="px-4 py-3">Note</th>
                      <th scope="col" className="px-4 py-3 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {decided.map(refund => {
                      const order = orderOf(refund.orders);
                      return (
                        <tr key={refund.id}>
                          <td className="px-4 py-3 font-semibold text-slate-100">
                            {order?.order_number ?? "—"}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`rounded-full border px-2 py-0.5 text-xs font-bold ${
                                statusTone[refund.status] ?? "border-slate-700 text-slate-300"
                              }`}
                            >
                              {refund.status}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-slate-400">
                            {refund.decided_at ? new Date(refund.decided_at).toLocaleString("en-KE") : "—"}
                          </td>
                          <td className="max-w-[22rem] px-4 py-3 text-slate-300">
                            {refund.decision_note?.trim() ? refund.decision_note : "—"}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-100">
                            {formatMoney(refund.amount_minor, order?.currency ?? "KES")}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <p className="mt-8 max-w-3xl text-xs leading-6 text-slate-500">
            A refund is recorded here as processed once the ledger entries are written. Returning the
            money to the customer through M-Pesa, Airtel Money or a card is a separate provider step and
            is not claimed by this screen.
          </p>
        </>
      )}
    </AdminShell>
  );
}
