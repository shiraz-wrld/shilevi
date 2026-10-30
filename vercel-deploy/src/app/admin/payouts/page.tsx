import "server-only";

import type { Metadata } from "next";
import Link from "next/link";
import { requireStaffCapability } from "@/lib/admin/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AdminShell } from "@/components/admin/AdminShell";
import { formatMoney } from "@/lib/money";
import { isMpesaB2cConfigured } from "@/lib/env.server";
import { PayoutDispatch } from "../payments/PayoutDispatch";

export const metadata: Metadata = {
  title: "Payouts",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

type Payout = {
  id: string;
  payee_id: string;
  payee_role: string;
  amount_minor: number;
  currency: string;
  status: string;
  method: string | null;
  reference: string | null;
  created_at: string;
  processed_at: string | null;
};

const statusTone: Record<string, string> = {
  pending: "border-amber-500/40 bg-amber-500/10 text-amber-200",
  processing: "border-blue-500/40 bg-blue-500/10 text-blue-200",
  paid: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
  failed: "border-red-500/40 bg-red-500/10 text-red-200",
  cancelled: "border-slate-600 bg-slate-800 text-slate-200",
};

export default async function AdminPayoutsPage() {
  const result = await requireStaffCapability("finance.read");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("payouts")
    .select("id,payee_id,payee_role,amount_minor,currency,status,method,reference,created_at,processed_at")
    .order("created_at", { ascending: false })
    .limit(200);

  const payouts = (data ?? []) as Payout[];
  const b2cConfigured = isMpesaB2cConfigured();
  const sumWhere = (statuses: string[]) =>
    payouts
      .filter(payout => statuses.includes(payout.status))
      .reduce((total, payout) => total + Number(payout.amount_minor), 0);

  const waiting = payouts.filter(payout => payout.status === "pending");
  const processing = payouts.filter(payout => payout.status === "processing");

  return (
    <AdminShell
      email={result.user.email ?? null}
      mfaLevel={result.mfaLevel}
      title="Payouts"
      description="Withdrawal requests from riders and providers. A request is only marked paid by the verified provider result; this console cannot mark one paid by hand. Dispatching is owner-only and requires M-Pesa B2C credentials, because it moves real money."
    >
      {error ? (
        <p role="alert" className="rounded-2xl border border-amber-800 bg-amber-950/40 p-5 text-sm leading-6 text-amber-100">
          Withdrawals could not be read. Nothing was changed. Reload once; if it persists, System health reports whether the cause is a missing migration, an MFA session or a missing capability.</p>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Waiting", value: String(waiting.length), detail: "Requested, not dispatched" },
              { label: "Processing", value: String(processing.length), detail: "Sent, awaiting a result" },
              { label: "Awaiting value", value: formatMoney(sumWhere(["pending", "processing"]), "KES"), detail: "Pending plus processing" },
              { label: "Paid value", value: formatMoney(sumWhere(["paid"]), "KES"), detail: "Confirmed by provider result" },
            ].map(card => (
              <article key={card.label} className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{card.label}</p>
                <p className="mt-2 text-2xl font-black text-slate-100">{card.value}</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">{card.detail}</p>
              </article>
            ))}
          </section>

          <div className={`mt-5 rounded-2xl border p-4 text-sm leading-6 ${b2cConfigured ? "border-emerald-800 bg-emerald-950/30 text-emerald-100" : "border-amber-800 bg-amber-950/40 text-amber-100"}`}>
            {b2cConfigured
              ? "M-Pesa B2C credentials are present. Dispatching still requires an owner session at MFA level 2, and a controlled live test before announcing payouts as operational."
              : "M-Pesa B2C is not configured in this deployment, so withdrawals stay pending. Add the B2C secrets in the hosting environment; they are never entered in this console."}
          </div>

          <h2 className="mt-8 text-lg font-black text-slate-100">Withdrawal requests</h2>
          {payouts.length === 0 ? (
            <p className="mt-3 rounded-2xl border border-slate-800 bg-slate-900 p-6 text-sm leading-6 text-slate-300">
              No withdrawal has been requested. Riders and providers request one from their own dashboard;
              this screen never creates one.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {payouts.map(payout => (
                <li key={payout.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4">
                  <div className="min-w-0">
                    <p className="font-bold text-slate-100">
                      {formatMoney(payout.amount_minor, payout.currency)} ·{" "}
                      <span className="capitalize">{payout.payee_role}</span>{" "}
                      <span className={`ml-1 rounded-full border px-2 py-0.5 text-xs font-bold ${statusTone[payout.status] ?? "border-slate-700 text-slate-300"}`}>
                        {payout.status}
                      </span>
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      Payee {payout.payee_id.slice(0, 8)}… · requested{" "}
                      {new Date(payout.created_at).toLocaleString("en-KE")}
                      {payout.processed_at ? ` · processed ${new Date(payout.processed_at).toLocaleString("en-KE")}` : ""}
                    </p>
                    {payout.reference && (
                      <p className="mt-1 break-all font-mono text-xs text-slate-500">{payout.reference}</p>
                    )}
                  </div>
                  {payout.status === "pending" ? (
                    <PayoutDispatch payoutId={payout.id} configured={b2cConfigured} canDispatch={!result.staff} />
                  ) : (
                    <span className="rounded-full border border-slate-700 px-3 py-1 text-xs font-bold text-slate-400">
                      {payout.status === "processing" ? "Awaiting provider result" : "Closed"}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 max-w-3xl text-xs leading-6 text-slate-500">
            Showing the most recent 200 requests. Rider earning balances are in{" "}
            <Link href="/admin/riders" className="font-semibold text-blue-300 hover:text-blue-200">Riders</Link>; the
            ledger behind them is in{" "}
            <Link href="/admin/ledger" className="font-semibold text-blue-300 hover:text-blue-200">Ledger</Link>.
          </p>
        </>
      )}
    </AdminShell>
  );
}
