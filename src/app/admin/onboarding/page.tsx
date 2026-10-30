import "server-only";

import type { Metadata } from "next";
import { requireStaffCapability } from "@/lib/admin/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AdminShell } from "@/components/admin/AdminShell";

export const metadata: Metadata = {
  title: "Onboarding",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

type Overview = {
  total: number;
  completed: number;
  incomplete: number;
  customers: number;
  providers: number;
  missing_county: number;
  counties: { county: string; accounts: number }[];
};

export default async function AdminOnboardingPage() {
  const result = await requireStaffCapability("orders.read");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_onboarding_overview");
  const overview = (data ?? null) as unknown as Overview | null;

  return (
    <AdminShell
      email={result.user.email ?? null}
      mfaLevel={result.mfaLevel}
      title="Onboarding"
      description="How far new accounts get through onboarding: how many started, how many finished, what they intend to do, and where they are located. These are recorded facts from user_onboarding, not estimates."
    >
      {error || !overview ? (
        <p role="alert" className="rounded-2xl border border-amber-800 bg-amber-950/40 p-5 text-sm leading-6 text-amber-100">
          Onboarding records could not be read. Nothing was changed. Reload once; if it persists, System health reports whether the cause is a missing migration, an MFA session or a missing capability.</p>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Started", value: overview.total, detail: "Onboarding rows written" },
              { label: "Completed", value: overview.completed, detail: "completed_at is set" },
              { label: "Unfinished", value: overview.incomplete, detail: "Started but not completed" },
              { label: "No county", value: overview.missing_county, detail: "Cannot be matched to coverage" },
            ].map(card => (
              <article key={card.label} className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{card.label}</p>
                <p className="mt-2 text-2xl font-black text-slate-100">{Number(card.value)}</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">{card.detail}</p>
              </article>
            ))}
          </section>

          <div className="mt-8 grid gap-4 lg:grid-cols-2">
            <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
              <h2 className="text-lg font-black text-slate-100">Account intent</h2>
              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-slate-400">Customers</dt>
                  <dd className="font-bold text-slate-100">{Number(overview.customers)}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-slate-400">Providers</dt>
                  <dd className="font-bold text-slate-100">{Number(overview.providers)}</dd>
                </div>
              </dl>
              <p className="mt-3 text-xs leading-5 text-slate-500">
                Intent is what the account chose during onboarding. It is not proof that a provider
                application was approved.
              </p>
            </section>

            <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
              <h2 className="text-lg font-black text-slate-100">Top counties</h2>
              {overview.counties.length === 0 ? (
                <p className="mt-3 text-sm text-slate-300">
                  No onboarding record has a county yet, so there is nothing to rank.
                </p>
              ) : (
                <ol className="mt-3 space-y-2 text-sm">
                  {overview.counties.map(row => (
                    <li key={row.county} className="flex items-baseline justify-between gap-3">
                      <span className="text-slate-300">{row.county}</span>
                      <span className="font-bold text-slate-100">{Number(row.accounts)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>

          <p className="mt-6 max-w-3xl text-xs leading-6 text-slate-500">
            Counts are totals over all onboarding rows, not a time series. There is no historical trend on
            this screen because the table stores the latest state only — presenting a trend would mean
            inventing one.
          </p>
        </>
      )}
    </AdminShell>
  );
}
