import "server-only";

import type { Metadata } from "next";
import Link from "next/link";
import { requireStaffCapability } from "@/lib/admin/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AdminShell } from "@/components/admin/AdminShell";

export const metadata: Metadata = {
  title: "Providers",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

type ProviderRow = {
  user_id: string;
  email: string | null;
  business_name: string | null;
  activity_type: string;
  application_status: string;
  approved_activities: number;
  listing_count: number;
  active_areas: number;
  submitted_at: string;
};

const statusTone: Record<string, string> = {
  approved: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
  pending: "border-amber-500/40 bg-amber-500/10 text-amber-200",
  under_review: "border-blue-500/40 bg-blue-500/10 text-blue-200",
  rejected: "border-red-500/40 bg-red-500/10 text-red-200",
  suspended: "border-red-500/40 bg-red-500/10 text-red-200",
  withdrawn: "border-slate-600 bg-slate-800 text-slate-200",
  draft: "border-slate-600 bg-slate-800 text-slate-200",
};

const activityLabels: Record<string, string> = {
  product_seller: "Product seller",
  service_provider: "Service provider",
  transport_partner: "Transport partner",
  property_provider: "Property provider",
};

export default async function AdminProvidersPage() {
  const result = await requireStaffCapability("orders.read");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_list_providers", { p_limit: 100 });
  const providers = (data ?? []) as unknown as ProviderRow[];

  const approved = providers.filter(provider => provider.application_status === "approved");
  const awaiting = providers.filter(provider =>
    ["pending", "under_review"].includes(provider.application_status),
  );
  const liveListings = approved.reduce((total, provider) => total + Number(provider.listing_count), 0);

  return (
    <AdminShell
      email={result.user.email ?? null}
      mfaLevel={result.mfaLevel}
      title="Providers"
      description="Every provider application the marketplace has received, with the activities that were granted, live listing counts and how many service areas are active. Decisions are made in the applications queue; this screen is the directory."
    >
      {error ? (
        <p role="alert" className="rounded-2xl border border-amber-800 bg-amber-950/40 p-5 text-sm leading-6 text-amber-100">
          Providers could not be read. Nothing was changed. Reload once; if it persists, System health reports whether the cause is a missing migration, an MFA session or a missing capability.</p>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Approved", value: String(approved.length), detail: "Applications with approved status" },
              { label: "Awaiting review", value: String(awaiting.length), detail: "Resolve in Applications" },
              { label: "Listings on approved accounts", value: String(liveListings), detail: "All listing states" },
              { label: "Applications shown", value: String(providers.length), detail: "Most recent 100" },
            ].map(card => (
              <article key={card.label} className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{card.label}</p>
                <p className="mt-2 text-2xl font-black text-slate-100">{card.value}</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">{card.detail}</p>
              </article>
            ))}
          </section>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-black text-slate-100">Applications</h2>
            <Link href="/admin/applications" className="rounded-xl border border-slate-600 px-4 py-2 text-sm font-bold text-slate-100 hover:border-slate-400">
              Review queue →
            </Link>
          </div>

          {providers.length === 0 ? (
            <p className="mt-3 rounded-2xl border border-slate-800 bg-slate-900 p-6 text-sm leading-6 text-slate-300">
              No provider application exists yet. Providers apply through the public provider flow; nothing
              is created here.
            </p>
          ) : (
            <div className="mt-3 overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-800 text-xs font-bold uppercase tracking-wide text-slate-400">
                  <tr>
                    <th scope="col" className="px-4 py-3">Business</th>
                    <th scope="col" className="px-4 py-3">Activity</th>
                    <th scope="col" className="px-4 py-3">Status</th>
                    <th scope="col" className="px-4 py-3 text-right">Activities</th>
                    <th scope="col" className="px-4 py-3 text-right">Listings</th>
                    <th scope="col" className="px-4 py-3 text-right">Areas</th>
                    <th scope="col" className="px-4 py-3">Submitted</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {providers.map(provider => (
                    <tr key={`${provider.user_id}-${provider.activity_type}-${provider.submitted_at}`}>
                      <td className="px-4 py-3">
                        <p className="font-semibold text-slate-100">{provider.business_name ?? "Unnamed business"}</p>
                        <p className="text-xs text-slate-400">{provider.email ?? "No email on record"}</p>
                        <p className="break-all font-mono text-[11px] text-slate-600">{provider.user_id}</p>
                      </td>
                      <td className="px-4 py-3 text-slate-300">{activityLabels[provider.activity_type] ?? provider.activity_type}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${statusTone[provider.application_status] ?? "border-slate-700 text-slate-300"}`}>
                          {provider.application_status.replaceAll("_", " ")}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-slate-300">{provider.approved_activities}</td>
                      <td className="px-4 py-3 text-right text-slate-300">{provider.listing_count}</td>
                      <td className="px-4 py-3 text-right text-slate-300">{provider.active_areas}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-400">
                        {new Date(provider.submitted_at).toLocaleDateString("en-KE")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-4 text-xs leading-6 text-slate-500">
            Approved activities come from provider_activities, not from the application status alone. An
            application marked approved with zero activities cannot publish anything.
          </p>
        </>
      )}
    </AdminShell>
  );
}
