import "server-only";

import type { Metadata } from "next";
import Link from "next/link";
import { requireStaffCapability } from "@/lib/admin/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AdminShell } from "@/components/admin/AdminShell";
import { formatMoney } from "@/lib/money";

export const metadata: Metadata = {
  title: "Ledger",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

type LedgerEntry = {
  id: number;
  order_id: string;
  entry_type: string;
  account: string;
  party_id: string | null;
  debit_minor: number;
  credit_minor: number;
  currency: string;
  reference: string | null;
  created_at: string;
};

const accountLabels: Record<string, string> = {
  customer: "Customer",
  settlement: "Settlement",
  platform_commission: "Platform commission",
  platform_delivery: "Platform delivery",
  provider_payable: "Provider payable",
  rider_payable: "Rider payable",
};

export default async function AdminLedgerPage() {
  const result = await requireStaffCapability("finance.read");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("ledger_entries")
    .select("id,order_id,entry_type,account,party_id,debit_minor,credit_minor,currency,reference,created_at")
    .order("created_at", { ascending: false })
    .limit(2000);

  const entries = (data ?? []) as LedgerEntry[];
  const recent = entries.slice(0, 200);

  const totals = entries.reduce<Record<string, { debit: number; credit: number; count: number }>>((acc, entry) => {
    const bucket = acc[entry.account] ?? { debit: 0, credit: 0, count: 0 };
    bucket.debit += Number(entry.debit_minor);
    bucket.credit += Number(entry.credit_minor);
    bucket.count += 1;
    acc[entry.account] = bucket;
    return acc;
  }, {});

  const totalDebit = entries.reduce((total, entry) => total + Number(entry.debit_minor), 0);
  const totalCredit = entries.reduce((total, entry) => total + Number(entry.credit_minor), 0);
  const balanced = totalDebit === totalCredit;

  return (
    <AdminShell
      email={result.user.email ?? null}
      mfaLevel={result.mfaLevel}
      title="Ledger"
      description="Double-entry ledger. Every business event posts a debit and a matching credit; the totals below must stay equal. Entries are append-only: no console action edits or deletes one. A balanced ledger proves internal consistency, not that money left a provider account."
    >
      {error ? (
        <p role="alert" className="rounded-2xl border border-amber-800 bg-amber-950/40 p-5 text-sm leading-6 text-amber-100">
          Ledger entries could not be read. Nothing was changed. Reload once; if it persists, System health reports whether the cause is a missing migration, an MFA session or a missing capability.</p>
      ) : entries.length === 0 ? (
        <p className="rounded-2xl border border-slate-800 bg-slate-900 p-6 text-sm leading-6 text-slate-300">
          No ledger entry exists yet. Entries are written when a payment is confirmed, a refund is
          decided, or a trip completes. This is a true zero.
        </p>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-3">
            <article className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Total debits</p>
              <p className="mt-2 text-2xl font-black text-slate-100">{formatMoney(totalDebit, "KES")}</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">Across {entries.length} entries</p>
            </article>
            <article className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Total credits</p>
              <p className="mt-2 text-2xl font-black text-slate-100">{formatMoney(totalCredit, "KES")}</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">Across {entries.length} entries</p>
            </article>
            <article className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Balance check</p>
              <p className={`mt-2 text-2xl font-black ${balanced ? "text-emerald-300" : "text-red-300"}`}>
                {balanced ? "Balanced" : "Out of balance"}
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                {balanced
                  ? "Debits equal credits in the window read"
                  : `Difference of ${formatMoney(Math.abs(totalDebit - totalCredit), "KES")} — investigate before settling anything`}
              </p>
            </article>
          </section>

          <h2 className="mt-8 text-lg font-black text-slate-100">Account totals</h2>
          <div className="mt-3 overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-800 text-xs font-bold uppercase tracking-wide text-slate-400">
                <tr>
                  <th scope="col" className="px-4 py-3">Account</th>
                  <th scope="col" className="px-4 py-3 text-right">Entries</th>
                  <th scope="col" className="px-4 py-3 text-right">Debits</th>
                  <th scope="col" className="px-4 py-3 text-right">Credits</th>
                  <th scope="col" className="px-4 py-3 text-right">Net</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {Object.entries(totals)
                  .sort((a, b) => b[1].debit + b[1].credit - (a[1].debit + a[1].credit))
                  .map(([account, bucket]) => (
                    <tr key={account}>
                      <td className="px-4 py-3 font-semibold text-slate-100">{accountLabels[account] ?? account}</td>
                      <td className="px-4 py-3 text-right text-slate-400">{bucket.count}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right text-slate-300">{formatMoney(bucket.debit, "KES")}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right text-slate-300">{formatMoney(bucket.credit, "KES")}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-100">
                        {formatMoney(bucket.debit - bucket.credit, "KES")}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          <h2 className="mt-8 text-lg font-black text-slate-100">Recent entries</h2>
          <div className="mt-3 overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-800 text-xs font-bold uppercase tracking-wide text-slate-400">
                <tr>
                  <th scope="col" className="px-4 py-3">Recorded</th>
                  <th scope="col" className="px-4 py-3">Type</th>
                  <th scope="col" className="px-4 py-3">Account</th>
                  <th scope="col" className="px-4 py-3">Party</th>
                  <th scope="col" className="px-4 py-3 text-right">Debit</th>
                  <th scope="col" className="px-4 py-3 text-right">Credit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {recent.map(entry => (
                  <tr key={entry.id}>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-400">
                      {new Date(entry.created_at).toLocaleString("en-KE")}
                    </td>
                    <td className="px-4 py-3 capitalize text-slate-300">{entry.entry_type.replaceAll("_", " ")}</td>
                    <td className="px-4 py-3 text-slate-300">{accountLabels[entry.account] ?? entry.account}</td>
                    <td className="px-4 py-3 font-mono text-[11px] text-slate-500">
                      {entry.party_id ? `${entry.party_id.slice(0, 8)}…` : "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-slate-300">
                      {Number(entry.debit_minor) === 0 ? "—" : formatMoney(entry.debit_minor, entry.currency)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-slate-300">
                      {Number(entry.credit_minor) === 0 ? "—" : formatMoney(entry.credit_minor, entry.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-xs leading-6 text-slate-500">
            Totals cover the most recent 2,000 entries; the table shows the latest 200.
            Refund decisions are recorded in{" "}
            <Link href="/admin/refunds" className="font-semibold text-blue-300 hover:text-blue-200">Refunds</Link>;
            withdrawal settlement is in{" "}
            <Link href="/admin/payouts" className="font-semibold text-blue-300 hover:text-blue-200">Payouts</Link>.
          </p>
        </>
      )}
    </AdminShell>
  );
}
