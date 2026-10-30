import "server-only";

import type { Metadata } from "next";
import Link from "next/link";
import { requireOwnerAdmin } from "@/lib/admin/auth";
import { AdminShell } from "@/components/admin/AdminShell";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { describeAdminReadFailure } from "@/lib/admin/errors";
import { formatMoney } from "@/lib/money";

export const metadata: Metadata = {
  title: "Payout reconciliation",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

type ReconciliationRow = {
  payout_id: string;
  payee_id: string;
  payee_role: string;
  status: string;
  currency: string;
  gross_minor: number;
  commission_rate_bps: number;
  commission_minor: number;
  net_minor: number;
  ledger_commission_minor: number;
  ledger_reversed_minor: number;
  commission_applied_at: string | null;
  commission_reversed_at: string | null;
  created_at: string;
};

const LIMITS = [50, 100, 250];

function when(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" });
}

export default async function PayoutReconciliationPage({
  searchParams,
}: {
  searchParams: Promise<{ limit?: string }>;
}) {
  const access = await requireOwnerAdmin();
  const params = await searchParams;
  const requested = Number(params.limit);
  const limit = LIMITS.includes(requested) ? requested : 100;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_payout_reconciliation", { p_limit: limit });
  const rows = (data ?? []) as ReconciliationRow[];

  const totals = rows.reduce(
    (accumulator, row) => ({
      gross: accumulator.gross + Number(row.gross_minor),
      commission: accumulator.commission + Number(row.commission_minor),
      net: accumulator.net + Number(row.net_minor),
      ledger: accumulator.ledger + Number(row.ledger_commission_minor),
      reversed: accumulator.reversed + Number(row.ledger_reversed_minor),
    }),
    { gross: 0, commission: 0, net: 0, ledger: 0, reversed: 0 },
  );

  // A row is inconsistent when the commission the payout claims differs from the commission the
  // ledger actually posted. That is a bookkeeping defect, not a display quirk, so it is surfaced.
  const mismatches = rows.filter(
    row =>
      Number(row.commission_minor) !== Number(row.ledger_commission_minor) &&
      row.commission_applied_at !== null,
  );
  const currency = rows[0]?.currency?.trim() || "KES";

  return (
    <AdminShell
      email={access.user.email ?? null}
      mfaLevel={access.mfaLevel}
      title="Payout reconciliation"
      description="Every payout against the commission the ledger actually posted. This page reads a database view of recorded rows; it never dispatches money, and a balanced total does not prove a provider was paid."
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-ink-400">Rows:</span>
        {LIMITS.map(option => (
          <Link
            key={option}
            href={`/admin/payouts/reconciliation?limit=${option}`}
            className={
              option === limit
                ? "rounded-full border border-brand-400 bg-brand-500/20 px-3 py-1 text-sm font-bold text-brand-100"
                : "rounded-full border border-white/15 px-3 py-1 text-sm font-semibold text-ink-300 hover:border-white/30"
            }
          >
            {option}
          </Link>
        ))}
        <Link href="/admin/payouts" className="ml-auto text-sm font-semibold text-brand-300 hover:text-brand-200">
          Payout queue →
        </Link>
        <Link href="/admin/ledger" className="text-sm font-semibold text-brand-300 hover:text-brand-200">
          Ledger →
        </Link>
      </div>

      {error ? (
        <p role="alert" className="mt-5 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-5 text-sm leading-6 text-amber-100">
          {describeAdminReadFailure("Payout reconciliation", error)}
        </p>
      ) : rows.length === 0 ? (
        <p className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-sm leading-6 text-ink-300">
          No payout exists yet. Reconciliation starts once a payout row is created after a completed
          delivery or trip; nothing on this page is estimated.
        </p>
      ) : (
        <>
          <section className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {[
              { label: "Gross", value: totals.gross, hint: `${rows.length} payouts` },
              { label: "Commission claimed", value: totals.commission, hint: "on the payout row" },
              { label: "Commission in ledger", value: totals.ledger, hint: "posted entries" },
              { label: "Commission reversed", value: totals.reversed, hint: "refunded or corrected" },
              { label: "Net to payees", value: totals.net, hint: "gross minus commission" },
            ].map(card => (
              <article key={card.label} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <p className="text-[11px] font-bold uppercase tracking-wide text-ink-500">{card.label}</p>
                <p className="mt-2 text-xl font-black text-white">{formatMoney(card.value, currency)}</p>
                <p className="mt-1 text-xs text-ink-500">{card.hint}</p>
              </article>
            ))}
          </section>

          {mismatches.length ? (
            <p role="alert" className="mt-5 rounded-2xl border border-rose-500/40 bg-rose-500/10 p-5 text-sm leading-6 text-rose-100">
              {mismatches.length} payout{mismatches.length === 1 ? "" : "s"} show a commission that
              does not match the ledger entries posted against them. Do not settle those rows until the
              discrepancy is explained — see the highlighted lines below.
            </p>
          ) : (
            <p className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-sm leading-6 text-ink-300">
              Every payout with an applied commission matches its ledger entries. This proves internal
              consistency only; it does not prove a provider received money.
            </p>
          )}

          <div className="mt-5 overflow-x-auto rounded-2xl border border-white/10">
            <table className="w-full min-w-[64rem] text-left text-sm">
              <thead className="bg-white/[0.04] text-[11px] font-bold uppercase tracking-wide text-ink-500">
                <tr>
                  <th scope="col" className="px-4 py-3">Payout</th>
                  <th scope="col" className="px-4 py-3">Payee role</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                  <th scope="col" className="px-4 py-3 text-right">Gross</th>
                  <th scope="col" className="px-4 py-3 text-right">Rate</th>
                  <th scope="col" className="px-4 py-3 text-right">Commission</th>
                  <th scope="col" className="px-4 py-3 text-right">In ledger</th>
                  <th scope="col" className="px-4 py-3 text-right">Net</th>
                  <th scope="col" className="px-4 py-3">Applied</th>
                  <th scope="col" className="px-4 py-3">Reversed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {rows.map(row => {
                  const mismatch =
                    Number(row.commission_minor) !== Number(row.ledger_commission_minor) &&
                    row.commission_applied_at !== null;
                  return (
                    <tr key={row.payout_id} className={mismatch ? "bg-rose-500/10" : undefined}>
                      <td className="px-4 py-3 font-mono text-xs text-ink-200">
                        {row.payout_id.slice(0, 8)}
                      </td>
                      <td className="px-4 py-3 text-ink-200">{row.payee_role}</td>
                      <td className="px-4 py-3 text-ink-200">{row.status}</td>
                      <td className="px-4 py-3 text-right text-ink-100">
                        {formatMoney(Number(row.gross_minor), row.currency?.trim() || currency)}
                      </td>
                      <td className="px-4 py-3 text-right text-ink-300">
                        {(Number(row.commission_rate_bps) / 100).toFixed(2)}%
                      </td>
                      <td className="px-4 py-3 text-right text-ink-100">
                        {formatMoney(Number(row.commission_minor), row.currency?.trim() || currency)}
                      </td>
                      <td className={`px-4 py-3 text-right ${mismatch ? "font-bold text-rose-200" : "text-ink-300"}`}>
                        {formatMoney(Number(row.ledger_commission_minor), row.currency?.trim() || currency)}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-white">
                        {formatMoney(Number(row.net_minor), row.currency?.trim() || currency)}
                      </td>
                      <td className="px-4 py-3 text-ink-400">{when(row.commission_applied_at)}</td>
                      <td className="px-4 py-3 text-ink-400">{when(row.commission_reversed_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="mt-4 text-xs leading-6 text-ink-500">
            Commission is calculated when the payout is created, from the platform settings in force at
            that moment. Changing the global rate later never rewrites an existing payout — that is why
            the applied rate is printed on every row.
          </p>
        </>
      )}
    </AdminShell>
  );
}
