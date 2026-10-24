import "server-only";

import type { Metadata } from "next";
import Link from "next/link";
import { requireOwnerAdmin } from "@/lib/admin/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hasServiceRole } from "@/lib/env.server";
import { AdminAccessDenied, AdminShell } from "@/components/admin/AdminShell";

export const metadata: Metadata = {
  title: "Search insights",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

type QueryRow = {
  query: string;
  searches: number;
  zero_results: number;
  average_results: number | null;
  last_searched: string;
};

type Insights = {
  days: number;
  from: string;
  has_data: boolean;
  searches: number;
  clicks: number;
  zero_result_searches: number;
  click_through: number | null;
  top_queries: QueryRow[];
  zero_result_queries: { query: string; searches: number; last_searched: string }[];
  top_categories: { category: string; slug: string; searches: number }[];
  top_counties: { county: string; searches: number }[];
  low_click_listings: { listing_id: string; title: string | null; shown_count: number; click_count: number }[];
  daily: { day: string; searches: number; clicks: number }[];
};

const RANGES = [7, 30, 90];

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function day(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Unknown" : parsed.toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" });
}

function percent(value: number | null): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  return `${(Number(value) * 100).toFixed(1)}%`;
}

function Table({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[32rem] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-slate-700 text-xs uppercase tracking-wide text-slate-400">
            {head.map(cell => <th key={cell} scope="col" className="py-2 pr-4 font-semibold">{cell}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-b border-slate-800/60 text-slate-200">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="py-2 pr-4 align-top">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function SearchInsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const access = await requireOwnerAdmin();
  if (!access.authorized) return <AdminAccessDenied reason={access.reason} />;

  const params = await searchParams;
  const requested = Number(params.days);
  const days = RANGES.includes(requested) ? requested : 30;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_search_insights", { p_days: days });

  const insights = (data ?? null) as Insights | null;
  const mfaBlocked = Boolean(error && /not authorized/i.test(error.message));
  const migrationMissing = Boolean(error && !mfaBlocked);

  return (
    <AdminShell
      email={access.user.email ?? null}
      mfaLevel={access.mfaLevel}
      title="Search insights"
      description="What people search for, which categories and counties carry demand, what returns nothing, and which listings are seen but never opened. Every figure below is counted from recorded search events; nothing on this page is estimated or seeded."
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-slate-400">Window:</span>
        {RANGES.map(range => (
          <Link
            key={range}
            href={`/admin/insights?days=${range}`}
            className={
              range === days
                ? "rounded-full border border-blue-500 bg-blue-950/60 px-3 py-1 text-sm font-bold text-blue-100"
                : "rounded-full border border-slate-700 px-3 py-1 text-sm font-semibold text-slate-300 hover:border-slate-500"
            }
          >
            Last {range} days
          </Link>
        ))}
        <Link href="/admin/payments" className="ml-auto text-sm font-semibold text-blue-300 hover:text-blue-200">
          Payments →
        </Link>
      </div>

      {mfaBlocked && (
        <section className="mt-6 rounded-2xl border border-amber-800 bg-amber-950/40 p-5 text-sm leading-6 text-amber-100">
          <h2 className="text-base font-bold">MFA assurance level 2 required</h2>
          <p className="mt-2">
            Search reporting is owner-only and the database requires an MFA-verified owner session.
            Enroll an authenticator, verify it and sign in again.
          </p>
        </section>
      )}

      {migrationMissing && (
        <section className="mt-6 rounded-2xl border border-red-900 bg-red-950/40 p-5 text-sm leading-6 text-red-100">
          <h2 className="text-base font-bold">Search reporting is not available</h2>
          <p className="mt-2">
            The reporting function could not be read. Apply migration 0025, confirm the owner session
            has MFA, then reload. No data was changed.
          </p>
        </section>
      )}

      {!error && insights && !insights.has_data && (
        <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900 p-6">
          <h2 className="text-lg font-black text-slate-100">No search activity in this window</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
            No searches were recorded in the last {days} days. That is a real zero, not missing data:
            events are written by the search endpoint as soon as visitors use it. Historic traffic is
            never backfilled, so reporting starts from the moment this feature is deployed.
          </p>
          {!hasServiceRole() && (
            <p className="mt-4 rounded-xl border border-amber-900 bg-amber-950/40 p-4 text-sm leading-6 text-amber-100">
              Analytics writes are switched off on this deployment because the Supabase service-role
              key is not configured. Search still works; nothing is recorded until that key is set in
              the hosting environment.
            </p>
          )}
          <Link href="/search" className="mt-5 inline-flex rounded-full bg-blue-600 px-4 py-2 text-sm font-bold text-white">
            Open marketplace search →
          </Link>
        </section>
      )}

      {!error && insights && insights.has_data && (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Searches", value: number(insights.searches).toLocaleString("en-KE"), hint: `since ${day(insights.from)}` },
              { label: "Result clicks", value: number(insights.clicks).toLocaleString("en-KE"), hint: "listings opened from results" },
              { label: "Zero-result searches", value: number(insights.zero_result_searches).toLocaleString("en-KE"), hint: "demand with no supply" },
              { label: "Click-through", value: percent(insights.click_through), hint: "clicks per search" },
            ].map(card => (
              <section key={card.label} className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
                <h2 className="text-xs font-bold uppercase tracking-wide text-slate-400">{card.label}</h2>
                <p className="mt-2 text-3xl font-black text-slate-100">{card.value}</p>
                <p className="mt-1 text-xs text-slate-500">{card.hint}</p>
              </section>
            ))}
          </div>

          <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <h2 className="text-lg font-black text-slate-100">Top searches</h2>
            <p className="mt-1 text-sm text-slate-400">Terms are lowercased and whitespace-normalised. They are stored without any account, device or network identifier.</p>
            {insights.top_queries.length ? (
              <Table
                head={["Search term", "Searches", "Zero results", "Avg results", "Last searched"]}
                rows={insights.top_queries.map(row => [
                  row.query,
                  number(row.searches).toLocaleString("en-KE"),
                  number(row.zero_results).toLocaleString("en-KE"),
                  row.average_results === null ? "—" : number(row.average_results).toLocaleString("en-KE"),
                  day(row.last_searched),
                ])}
              />
            ) : (
              <p className="mt-3 text-sm text-slate-400">No search terms in this window.</p>
            )}
          </section>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
              <h2 className="text-lg font-black text-slate-100">Demand with no results</h2>
              <p className="mt-1 text-sm text-slate-400">Searches that returned nothing. These are the clearest supply gaps in the marketplace.</p>
              {insights.zero_result_queries.length ? (
                <Table
                  head={["Search term", "Searches", "Last searched"]}
                  rows={insights.zero_result_queries.map(row => [row.query, number(row.searches).toLocaleString("en-KE"), day(row.last_searched)])}
                />
              ) : (
                <p className="mt-3 text-sm text-slate-400">Every recorded search found something in this window.</p>
              )}
            </section>

            <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
              <h2 className="text-lg font-black text-slate-100">Demand by category</h2>
              {insights.top_categories.length ? (
                <Table
                  head={["Category", "Searches"]}
                  rows={insights.top_categories.map(row => [row.category, number(row.searches).toLocaleString("en-KE")])}
                />
              ) : (
                <p className="mt-3 text-sm text-slate-400">No category-filtered searches in this window.</p>
              )}
              <h3 className="mt-6 text-sm font-bold uppercase tracking-wide text-slate-400">Demand by county</h3>
              {insights.top_counties.length ? (
                <Table
                  head={["County", "Searches"]}
                  rows={insights.top_counties.map(row => [row.county, number(row.searches).toLocaleString("en-KE")])}
                />
              ) : (
                <p className="mt-3 text-sm text-slate-400">No county-filtered searches in this window.</p>
              )}
            </section>
          </div>

          <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <h2 className="text-lg font-black text-slate-100">Shown but never opened</h2>
            <p className="mt-1 text-sm text-slate-400">
              Listings that appeared at least five times in results and received no clicks. A high
              count points at titles, pricing or photography rather than traffic.
            </p>
            {insights.low_click_listings.length ? (
              <Table
                head={["Listing", "Times shown", "Clicks"]}
                rows={insights.low_click_listings.map(row => [
                  row.title ?? row.listing_id,
                  number(row.shown_count).toLocaleString("en-KE"),
                  number(row.click_count).toLocaleString("en-KE"),
                ])}
              />
            ) : (
              <p className="mt-3 text-sm text-slate-400">
                No listing crossed five impressions without a click in this window.
              </p>
            )}
          </section>

          <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <h2 className="text-lg font-black text-slate-100">Daily activity</h2>
            <p className="mt-1 text-sm text-slate-400">Days with no recorded activity are omitted, not filled with zeroes.</p>
            {insights.daily.length ? (
              <Table
                head={["Day", "Searches", "Clicks"]}
                rows={insights.daily.map(row => [day(String(row.day)), number(row.searches).toLocaleString("en-KE"), number(row.clicks).toLocaleString("en-KE")])}
              />
            ) : (
              <p className="mt-3 text-sm text-slate-400">No daily activity in this window.</p>
            )}
          </section>
        </>
      )}

      <p className="mt-8 rounded-2xl border border-slate-800 bg-slate-900 p-5 text-sm leading-6 text-slate-400">
        Privacy: search events store a normalised term, the coarse filters used, the number of
        results and listing ids — never IP addresses, device fingerprints, contact details or payment
        data. Clicks are recorded only for published listings, and only from the same origin. Retention
        is enforced by <span className="font-mono text-slate-300">prune_search_events</span> (180-day
        default); see <span className="font-mono text-slate-300">docs/SEARCH.md</span>.
      </p>
    </AdminShell>
  );
}
