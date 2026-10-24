import "server-only";

import type { Metadata } from "next";
import Link from "next/link";
import { requireStaffCapability } from "@/lib/admin/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AdminAccessDenied, AdminShell } from "@/components/admin/AdminShell";
import { formatMoney } from "@/lib/money";
import { isMpesaB2cConfigured, isMpesaConfigured } from "@/lib/env.server";
import { PayoutDispatch } from "./PayoutDispatch";

export const metadata: Metadata = {
  title: "Payments and payouts",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

type Intent = {
  id: string;
  purpose: string;
  provider: string;
  amount_minor: number;
  status: string;
  provider_reference: string | null;
  created_at: string;
};

type Payout = {
  id: string;
  payee_id: string;
  amount_minor: number;
  status: string;
  destination_phone: string | null;
  reference: string | null;
  created_at: string;
};

type LedgerRow = {
  entry_type: string;
  account: string;
  debit_minor: number;
  credit_minor: number;
};

type Unlock = { id: string; listing_id: string; amount_minor: number; status: string; created_at: string };

function sum(rows: LedgerRow[], predicate: (row: LedgerRow) => boolean): number {
  return rows.filter(predicate).reduce((total, row) => total + Number(row.credit_minor) - Number(row.debit_minor), 0);
}

export default async function AdminPaymentsPage() {
  const result = await requireStaffCapability("finance.read");
  if (!result.authorized) return <AdminAccessDenied reason={result.reason} />;

  const supabase = await createSupabaseServerClient();
  const [intentResult, payoutResult, ledgerResult, unlockResult] = await Promise.all([
    supabase.from("payment_intents")
      .select("id,purpose,provider,amount_minor,status,provider_reference,created_at")
      .order("created_at", { ascending: false }).limit(60),
    supabase.from("payouts")
      .select("id,payee_id,amount_minor,status,destination_phone,reference,created_at")
      .order("created_at", { ascending: false }).limit(60),
    supabase.from("ledger_entries")
      .select("entry_type,account,debit_minor,credit_minor")
      .order("created_at", { ascending: false }).limit(2000),
    supabase.from("property_contact_unlocks")
      .select("id,listing_id,amount_minor,status,created_at")
      .order("created_at", { ascending: false }).limit(40),
  ]);

  const intents = (intentResult.data ?? []) as Intent[];
  const payouts = (payoutResult.data ?? []) as Payout[];
  const ledger = (ledgerResult.data ?? []) as LedgerRow[];
  const unlocks = (unlockResult.data ?? []) as Unlock[];

  const commissionRevenue = sum(ledger, row => row.account === "platform_commission" && ["commission", "ride_commission"].includes(row.entry_type));
  const propertyRevenue = sum(ledger, row => row.account === "platform_commission" && row.entry_type === "property_unlock");
  const riderObligations = sum(ledger, row => row.account === "rider_payable");
  const gmv = ledger
    .filter(row => ["customer_charge", "ride_charge", "property_unlock"].includes(row.entry_type) && row.account === "customer")
    .reduce((total, row) => total + Number(row.debit_minor), 0);
  const pendingPayouts = payouts.filter(payout => payout.status === "pending");
  const modalConfigured = isMpesaConfigured();
  const b2cConfigured = isMpesaB2cConfigured();

  return (
    <AdminShell
      email={result.user.email ?? null}
      mfaLevel={result.mfaLevel}
      title="Payments and payouts"
      description="Reconciliation of verified payment intents, platform revenue and rider withdrawals. GMV is not revenue; commission is not profit. Figures below come from the ledger, not from editable totals."
    >
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm leading-6 text-slate-400">Payment methods are configured separately from the ledger view.</p>
        <Link href="/admin/payments/providers" className="rounded-xl border border-slate-600 px-4 py-2 text-sm font-bold text-slate-100 hover:border-slate-400">
          Payment methods →
        </Link>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Recorded GMV", value: gmv, detail: "Customer charges recorded in the ledger" },
          { label: "Platform commission", value: commissionRevenue, detail: "Order and trip commission credits" },
          { label: "Property access revenue", value: propertyRevenue, detail: "House Hunt contact fees" },
          { label: "Rider payable", value: riderObligations, detail: "Earned but not yet withdrawn" },
        ].map(card => (
          <article key={card.label} className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{card.label}</p>
            <p className="mt-2 text-2xl font-black text-slate-100">{formatMoney(card.value, "KES")}</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">{card.detail}</p>
          </article>
        ))}
      </section>

      {(intentResult.error || payoutResult.error || ledgerResult.error) && (
        <p role="alert" className="mt-5 rounded-2xl border border-amber-800 bg-amber-950/40 p-5 text-sm leading-6 text-amber-100">
          Some financial records could not be read. Apply migration 0021 and confirm MFA level 2. Do not make payout
          decisions from an incomplete view.
        </p>
      )}

      <section className="mt-8 rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <h2 className="text-lg font-bold">Provider configuration</h2>
        <ul className="mt-3 space-y-2 text-sm">
          <li className="flex flex-wrap items-center justify-between gap-2"><span className="text-slate-300">M-Pesa STK Push</span><span className={`rounded-full px-3 py-1 text-xs font-bold ${modalConfigured ? "bg-emerald-950 text-emerald-200" : "bg-amber-950 text-amber-200"}`}>{modalConfigured ? "Credentials configured" : "Not configured — no charges can start"}</span></li>
          <li className="flex flex-wrap items-center justify-between gap-2"><span className="text-slate-300">M-Pesa B2C payouts</span><span className={`rounded-full px-3 py-1 text-xs font-bold ${b2cConfigured ? "bg-emerald-950 text-emerald-200" : "bg-amber-950 text-amber-200"}`}>{b2cConfigured ? "Credentials configured" : "Not configured — withdrawals stay pending"}</span></li>
        </ul>
        <p className="mt-3 text-xs leading-6 text-slate-500">Configured credentials do not prove production approval. Run a controlled live test before announcing payments as operational.</p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">Withdrawals</h2>
        {payouts.length === 0 ? (
          <p className="mt-3 rounded-2xl border border-slate-800 bg-slate-900 p-5 text-sm text-slate-300">No withdrawals requested yet.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {payouts.map(payout => (
              <article key={payout.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4">
                <div>
                  <p className="font-bold text-slate-100">{formatMoney(payout.amount_minor, "KES")} · <span className="capitalize">{payout.status}</span></p>
                  <p className="mt-1 text-xs text-slate-400">Rider {payout.payee_id.slice(0, 8)}… · {payout.destination_phone ? `phone ending ${payout.destination_phone.slice(-3)}` : "no phone"} · {new Date(payout.created_at).toLocaleString("en-KE")}</p>
                  {payout.reference && <p className="mt-1 break-all font-mono text-xs text-slate-500">{payout.reference}</p>}
                </div>
                {payout.status === "pending" && <PayoutDispatch payoutId={payout.id} configured={b2cConfigured} canDispatch={!result.staff} />}
              </article>
            ))}
          </div>
        )}
        <p className="mt-3 text-xs leading-6 text-slate-500">A payout is only marked paid by the verified provider result callback. Never mark a withdrawal paid manually to clear the queue.</p>
      </section>

      {pendingPayouts.length > 0 && b2cConfigured && (
        <p className="mt-3 rounded-2xl border border-blue-800 bg-blue-950/40 p-4 text-sm text-blue-100">{pendingPayouts.length} withdrawal{pendingPayouts.length === 1 ? "" : "s"} waiting to be dispatched.</p>
      )}

      <section className="mt-8">
        <h2 className="text-lg font-bold">Recent payment intents</h2>
        {intents.length === 0 ? (
          <p className="mt-3 rounded-2xl border border-slate-800 bg-slate-900 p-5 text-sm text-slate-300">No payment intents yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-800 text-xs font-bold uppercase tracking-wide text-slate-400">
                <tr><th scope="col" className="px-4 py-3">Created</th><th scope="col" className="px-4 py-3">Purpose</th><th scope="col" className="px-4 py-3">Provider</th><th scope="col" className="px-4 py-3">Status</th><th scope="col" className="px-4 py-3 text-right">Amount</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {intents.map(intent => (
                  <tr key={intent.id}>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-400">{new Date(intent.created_at).toLocaleString("en-KE")}</td>
                    <td className="px-4 py-3 capitalize text-slate-200">{intent.purpose.replaceAll("_", " ")}</td>
                    <td className="px-4 py-3 text-slate-300">{intent.provider}</td>
                    <td className="px-4 py-3 capitalize text-slate-300">{intent.status}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-100">{formatMoney(intent.amount_minor, "KES")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">House Hunt contact unlocks</h2>
        {unlocks.length === 0 ? <p className="mt-3 text-sm text-slate-400">No contact unlocks yet.</p> : (
          <ul className="mt-3 space-y-2 text-sm">
            {unlocks.map(unlock => (
              <li key={unlock.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-900 p-4">
                <span className="text-slate-300">{new Date(unlock.created_at).toLocaleString("en-KE")} · listing {unlock.listing_id.slice(0, 8)}…</span>
                <span className="font-bold text-slate-100">{formatMoney(unlock.amount_minor, "KES")} · {unlock.status}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs leading-6 text-slate-500">Showing the most recent 40 unlocks. Access records carry an expiry; the fee is platform revenue, not landlord income.</p>
      </section>
    </AdminShell>
  );
}
