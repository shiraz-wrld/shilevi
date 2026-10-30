import "server-only";

import type { Metadata } from "next";
import Link from "next/link";
import { requireStaffCapability } from "@/lib/admin/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AdminShell } from "@/components/admin/AdminShell";

export const metadata: Metadata = {
  title: "Customer enquiries",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

type RequestRow = {
  id: string;
  listing_title: string;
  status: string;
  created_at: string;
  responded_at: string | null;
};

const statusTone: Record<string, string> = {
  open: "border-amber-500/40 bg-amber-500/10 text-amber-200",
  accepted: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
  declined: "border-red-500/40 bg-red-500/10 text-red-200",
  closed: "border-slate-600 bg-slate-800 text-slate-200",
};

export default async function AdminRequestsPage() {
  const result = await requireStaffCapability("orders.read");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_list_listing_requests", { p_limit: 100 });
  const requests = (data ?? []) as unknown as RequestRow[];

  const open = requests.filter(request => request.status === "open").length;
  const answered = requests.filter(request => request.responded_at !== null).length;

  return (
    <AdminShell
      email={result.user.email ?? null}
      mfaLevel={result.mfaLevel}
      title="Customer enquiries"
      description="Listing enquiries between a customer and a provider. The console shows status and timing only: the message bodies belong to the two participants and are not reproduced here. Providers accept or decline from their own dashboard, not from the admin console."
    >
      {error ? (
        <p role="alert" className="rounded-2xl border border-amber-800 bg-amber-950/40 p-5 text-sm leading-6 text-amber-100">
          Enquiries could not be read. Nothing was changed. Reload once; if it persists, System health reports whether the cause is a missing migration, an MFA session or a missing capability.</p>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-3">
            {[
              { label: "Open", value: String(open), detail: "Waiting for the provider to respond" },
              { label: "Answered", value: String(answered), detail: "Provider response recorded" },
              { label: "Total shown", value: String(requests.length), detail: "Most recent 100 enquiries" },
            ].map(card => (
              <article key={card.label} className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{card.label}</p>
                <p className="mt-2 text-2xl font-black text-slate-100">{card.value}</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">{card.detail}</p>
              </article>
            ))}
          </section>

          <h2 className="mt-8 text-lg font-black text-slate-100">Recent enquiries</h2>
          {requests.length === 0 ? (
            <p className="mt-3 rounded-2xl border border-slate-800 bg-slate-900 p-6 text-sm leading-6 text-slate-300">
              No customer has contacted a provider through a listing yet. This is a true zero.
            </p>
          ) : (
            <div className="mt-3 overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-800 text-xs font-bold uppercase tracking-wide text-slate-400">
                  <tr>
                    <th scope="col" className="px-4 py-3">Listing</th>
                    <th scope="col" className="px-4 py-3">Status</th>
                    <th scope="col" className="px-4 py-3">Sent</th>
                    <th scope="col" className="px-4 py-3">Responded</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {requests.map(request => (
                    <tr key={request.id}>
                      <td className="max-w-sm px-4 py-3 font-semibold text-slate-100">{request.listing_title}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${statusTone[request.status] ?? "border-slate-700 text-slate-300"}`}>
                          {request.status}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-400">
                        {new Date(request.created_at).toLocaleString("en-KE")}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-400">
                        {request.responded_at ? new Date(request.responded_at).toLocaleString("en-KE") : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-4 text-xs leading-6 text-slate-500">
            An enquiry is not an order. Nothing in this queue moves money; conversions appear in{" "}
            <Link href="/admin/orders" className="font-semibold text-blue-300 hover:text-blue-200">Orders</Link> only
            once a checkout actually happens.
          </p>
        </>
      )}
    </AdminShell>
  );
}
