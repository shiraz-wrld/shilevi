import "server-only";

import type { Metadata } from "next";
import { requireStaffCapability } from "@/lib/admin/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AdminShell } from "@/components/admin/AdminShell";
import { formatMoney } from "@/lib/money";

export const metadata: Metadata = {
  title: "Riders",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

type RiderRow = {
  user_id: string;
  email: string | null;
  completed_rides: number;
  earned_minor: number;
  paid_out_minor: number;
  pending_payout_minor: number;
};

export default async function AdminRidersPage() {
  const result = await requireStaffCapability("finance.read");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_list_riders", { p_limit: 100 });
  const riders = (data ?? []) as unknown as RiderRow[];

  const totalEarned = riders.reduce((total, rider) => total + Number(rider.earned_minor), 0);
  const totalPaid = riders.reduce((total, rider) => total + Number(rider.paid_out_minor), 0);
  const totalPending = riders.reduce((total, rider) => total + Number(rider.pending_payout_minor), 0);

  return (
    <AdminShell
      email={result.user.email ?? null}
      mfaLevel={result.mfaLevel}
      title="Riders"
      description="Rider earning balances derived from the ledger, not from an editable total. Earned is the rider_payable account balance; paid is confirmed withdrawals; pending is a request that has not settled. A balance is not proof that a payout reached the rider."
    >
      {error ? (
        <p role="alert" className="rounded-2xl border border-amber-800 bg-amber-950/40 p-5 text-sm leading-6 text-amber-100">
          Rider records could not be read. Nothing was changed. Reload once; if it persists, System health reports whether the cause is a missing migration, an MFA session or a missing capability.</p>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-3">
            {[
              { label: "Earned in ledger", value: totalEarned, detail: "Credits minus debits on rider_payable" },
              { label: "Confirmed withdrawals", value: totalPaid, detail: "Payouts marked paid by a provider result" },
              { label: "Awaiting settlement", value: totalPending, detail: "Pending or processing withdrawal requests" },
            ].map(card => (
              <article key={card.label} className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{card.label}</p>
                <p className="mt-2 text-2xl font-black text-slate-100">{formatMoney(card.value, "KES")}</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">{card.detail}</p>
              </article>
            ))}
          </section>

          <h2 className="mt-8 text-lg font-black text-slate-100">Rider accounts</h2>
          {riders.length === 0 ? (
            <p className="mt-3 rounded-2xl border border-slate-800 bg-slate-900 p-6 text-sm text-slate-300">
              No rider has taken a trip or requested a withdrawal yet. This is a true zero.
            </p>
          ) : (
            <div className="mt-3 overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-800 text-xs font-bold uppercase tracking-wide text-slate-400">
                  <tr>
                    <th scope="col" className="px-4 py-3">Rider</th>
                    <th scope="col" className="px-4 py-3 text-right">Completed trips</th>
                    <th scope="col" className="px-4 py-3 text-right">Earned</th>
                    <th scope="col" className="px-4 py-3 text-right">Paid out</th>
                    <th scope="col" className="px-4 py-3 text-right">Pending</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {riders.map(rider => (
                    <tr key={rider.user_id}>
                      <td className="px-4 py-3">
                        <p className="font-semibold text-slate-100">{rider.email ?? "No email on record"}</p>
                        <p className="break-all font-mono text-xs text-slate-500">{rider.user_id}</p>
                      </td>
                      <td className="px-4 py-3 text-right text-slate-300">{rider.completed_rides}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-100">{formatMoney(rider.earned_minor, "KES")}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right text-slate-300">{formatMoney(rider.paid_out_minor, "KES")}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right text-amber-200">{formatMoney(rider.pending_payout_minor, "KES")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-4 max-w-3xl text-xs leading-6 text-slate-500">
            Balances are read-only here on purpose. Withdrawals are requested by the rider and settled by
            a verified M-Pesa B2C result; this screen cannot move money on its own.
          </p>
        </>
      )}
    </AdminShell>
  );
}
