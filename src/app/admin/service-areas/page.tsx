import "server-only";

import type { Metadata } from "next";
import { requireStaffCapability } from "@/lib/admin/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AdminShell } from "@/components/admin/AdminShell";

export const metadata: Metadata = {
  title: "Service coverage",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

type CoverageRow = {
  location_id: string;
  county: string;
  county_code: number;
  is_active: boolean;
  active_providers: number;
};

export default async function AdminServiceAreasPage() {
  const result = await requireStaffCapability("orders.read");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_service_area_coverage", { p_limit: 100 });
  const coverage = (data ?? []) as unknown as CoverageRow[];

  const covered = coverage.filter(row => Number(row.active_providers) > 0);
  const empty = coverage.filter(row => Number(row.active_providers) === 0);

  return (
    <AdminShell
      email={result.user.email ?? null}
      mfaLevel={result.mfaLevel}
      title="Service coverage"
      description="Which Kenyan counties have at least one provider serving them, read from provider_service_areas. An empty county is honest coverage data, not a launch promise. The list itself comes from the seeded service_locations table in migration 0018."
    >
      {error ? (
        <p role="alert" className="rounded-2xl border border-amber-800 bg-amber-950/40 p-5 text-sm leading-6 text-amber-100">
          Coverage could not be read. Nothing was changed. Reload once; if it persists, System health reports whether the cause is a missing migration, an MFA session or a missing capability.</p>
      ) : coverage.length === 0 ? (
        <p className="rounded-2xl border border-slate-800 bg-slate-900 p-6 text-sm leading-6 text-slate-300">
          No service location is defined. Migration 0018 seeds the 47 counties; if this list is empty the
          migration did not complete.
        </p>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-3">
            {[
              { label: "Counties listed", value: String(coverage.length), detail: "From service_locations" },
              { label: "With a provider", value: String(covered.length), detail: "At least one active service area" },
              { label: "Without a provider", value: String(empty.length), detail: "No active provider coverage" },
            ].map(card => (
              <article key={card.label} className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{card.label}</p>
                <p className="mt-2 text-2xl font-black text-slate-100">{card.value}</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">{card.detail}</p>
              </article>
            ))}
          </section>

          <h2 className="mt-8 text-lg font-black text-slate-100">County coverage</h2>
          <div className="mt-3 overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-800 text-xs font-bold uppercase tracking-wide text-slate-400">
                <tr>
                  <th scope="col" className="px-4 py-3">County</th>
                  <th scope="col" className="px-4 py-3">Code</th>
                  <th scope="col" className="px-4 py-3">Marketplace</th>
                  <th scope="col" className="px-4 py-3 text-right">Active providers</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {coverage.map(row => (
                  <tr key={row.location_id}>
                    <td className="px-4 py-3 font-semibold text-slate-100">{row.county}</td>
                    <td className="px-4 py-3 text-slate-400">{row.county_code}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${row.is_active ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200" : "border-slate-600 bg-slate-800 text-slate-300"}`}>
                        {row.is_active ? "Enabled" : "Disabled"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-100">{row.active_providers}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-xs leading-6 text-slate-500">
            Provider coverage changes when a provider edits their own service areas; there is no
            administrator override here on purpose.
          </p>
        </>
      )}
    </AdminShell>
  );
}
