import "server-only";

import type { Metadata } from "next";
import Link from "next/link";
import { requireStaffCapability } from "@/lib/admin/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AdminShell } from "@/components/admin/AdminShell";
import { formatMoney } from "@/lib/money";

export const metadata: Metadata = {
  title: "House Hunt unlocks",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

type Unlock = {
  id: string;
  user_id: string;
  listing_id: string;
  amount_minor: number;
  currency: string;
  provider: string;
  status: string;
  paid_at: string;
  expires_at: string | null;
};

const statusTone: Record<string, string> = {
  paid: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
  refunded: "border-amber-500/40 bg-amber-500/10 text-amber-200",
  revoked: "border-red-500/40 bg-red-500/10 text-red-200",
};

export default async function AdminPropertyUnlocksPage() {
  const result = await requireStaffCapability("properties.verify");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("property_contact_unlocks")
    .select("id,user_id,listing_id,amount_minor,currency,provider,status,paid_at,expires_at")
    .order("created_at", { ascending: false })
    .limit(200);

  const unlocks = (data ?? []) as Unlock[];
  const now = Date.now();
  const active = unlocks.filter(
    unlock => unlock.status === "paid" && (!unlock.expires_at || new Date(unlock.expires_at).getTime() > now),
  );
  const expired = unlocks.filter(
    unlock => unlock.status === "paid" && unlock.expires_at && new Date(unlock.expires_at).getTime() <= now,
  );
  const revenue = unlocks
    .filter(unlock => unlock.status === "paid")
    .reduce((total, unlock) => total + Number(unlock.amount_minor), 0);

  return (
    <AdminShell
      email={result.user.email ?? null}
      mfaLevel={result.mfaLevel}
      title="House Hunt unlocks"
      description="Paid contact unlocks for House Hunt properties. Browsing and search are free; the contact record is released only after a verified unlock. The property's own contact details are never shown on this screen — only who unlocked what, when, and until when it is valid."
    >
      {error ? (
        <p role="alert" className="rounded-2xl border border-amber-800 bg-amber-950/40 p-5 text-sm leading-6 text-amber-100">
          Unlocks could not be read. Nothing was changed. Reload once; if it persists, System health reports whether the cause is a missing migration, an MFA session or a missing capability.</p>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Unlocks shown", value: String(unlocks.length), detail: "Most recent 200" },
              { label: "Currently valid", value: String(active.length), detail: "Paid and not expired" },
              { label: "Expired access", value: String(expired.length), detail: "Paid but outside the window" },
              { label: "Recorded revenue", value: formatMoney(revenue, "KES"), detail: "Sum of paid unlocks shown" },
            ].map(card => (
              <article key={card.label} className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{card.label}</p>
                <p className="mt-2 text-2xl font-black text-slate-100">{card.value}</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">{card.detail}</p>
              </article>
            ))}
          </section>

          <h2 className="mt-8 text-lg font-black text-slate-100">Unlock records</h2>
          {unlocks.length === 0 ? (
            <p className="mt-3 rounded-2xl border border-slate-800 bg-slate-900 p-6 text-sm leading-6 text-slate-300">
              No contact has been unlocked yet. A House Hunt listing can still be browsed and searched
              without one.
            </p>
          ) : (
            <div className="mt-3 overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-800 text-xs font-bold uppercase tracking-wide text-slate-400">
                  <tr>
                    <th scope="col" className="px-4 py-3">Paid</th>
                    <th scope="col" className="px-4 py-3">Property</th>
                    <th scope="col" className="px-4 py-3">Customer</th>
                    <th scope="col" className="px-4 py-3">Provider</th>
                    <th scope="col" className="px-4 py-3">Status</th>
                    <th scope="col" className="px-4 py-3">Valid until</th>
                    <th scope="col" className="px-4 py-3 text-right">Fee</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {unlocks.map(unlock => (
                    <tr key={unlock.id}>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-400">
                        {new Date(unlock.paid_at).toLocaleString("en-KE")}
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] text-slate-500">{unlock.listing_id.slice(0, 8)}…</td>
                      <td className="px-4 py-3 font-mono text-[11px] text-slate-500">{unlock.user_id.slice(0, 8)}…</td>
                      <td className="px-4 py-3 text-slate-300">{unlock.provider}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${statusTone[unlock.status] ?? "border-slate-700 text-slate-300"}`}>
                          {unlock.status}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-400">
                        {unlock.expires_at ? new Date(unlock.expires_at).toLocaleString("en-KE") : "Open-ended"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-100">
                        {formatMoney(unlock.amount_minor, unlock.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-4 max-w-3xl text-xs leading-6 text-slate-500">
            Access is enforced by get_property_contact and has_property_access in the database, not by this
            page. The unlock fee is platform revenue; it is not paid to the landlord. Property review is in{" "}
            <Link href="/admin/properties" className="font-semibold text-blue-300 hover:text-blue-200">House Hunt review</Link>.
          </p>
        </>
      )}
    </AdminShell>
  );
}
