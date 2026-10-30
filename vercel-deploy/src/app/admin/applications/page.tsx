import "server-only";

import type { Metadata } from "next";
import Link from "next/link";
import { requireOwnerAdmin } from "@/lib/admin/auth";
import { AdminShell } from "@/components/admin/AdminShell";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { describeAdminReadFailure } from "@/lib/admin/errors";
import ApplicationReviewCard, { type ApplicationDetail, type ApplicationRow } from "./ApplicationReviewCard";

export const metadata: Metadata = {
  title: "Provider applications",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

const TABS = [
  { key: "pending", label: "Awaiting decision", statuses: ["pending", "under_review"] },
  { key: "approved", label: "Approved", statuses: ["approved"] },
  { key: "rejected", label: "Rejected", statuses: ["rejected"] },
] as const;

const COLUMNS =
  "id,user_id,activity_type,status,business_name,public_reference,country_code,application_data,submitted_at,created_at,reviewed_at,reviewer_note,rejection_reason";

export default async function AdminApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const access = await requireOwnerAdmin();

  const params = await searchParams;
  const tab = TABS.find(entry => entry.key === params.status) ?? TABS[0];

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("provider_applications")
    .select(COLUMNS)
    .in("status", [...tab.statuses])
    .order("submitted_at", { ascending: true, nullsFirst: true })
    .limit(20);

  const rows = (data ?? []) as ApplicationRow[];

  // Identity and evidence come from one read model (migration 0032) because `profiles` is self-only
  // and email lives in `auth.users`. When that function is not installed the queue still works and
  // the card says exactly which part is unavailable instead of hiding the application.
  async function loadDetail(id: string) {
    const { data: detail, error: detailError } = await supabase.rpc("admin_application_detail", {
      p_application_id: id,
    });
    if (detailError) {
      return {
        detail: null as ApplicationDetail | null,
        problem: describeAdminReadFailure("Applicant identity and evidence", detailError),
      };
    }
    return { detail: (detail ?? null) as ApplicationDetail | null, problem: null };
  }

  // One probe first: if `0032` is missing there is nothing to gain from twenty more failures.
  const probe = rows[0] ? await loadDetail(rows[0].id) : null;
  const unavailable = probe?.problem && /not been applied/i.test(probe.problem) ? probe.problem : null;
  const remainder = unavailable || rows.length <= 1
    ? []
    : await Promise.all(rows.slice(1).map(row => loadDetail(row.id)));

  const details = rows.map((row, index) => {
    if (index === 0) return { id: row.id, detail: probe?.detail ?? null, problem: probe?.problem ?? null };
    if (unavailable) return { id: row.id, detail: null as ApplicationDetail | null, problem: unavailable };
    return { id: row.id, ...(remainder[index - 1] ?? { detail: null, problem: null }) };
  });
  const detailById = new Map(details.map(entry => [entry.id, entry]));

  // Activation needs the real, active taxonomy. Inactive categories are excluded here and refused
  // by `admin_grant_provider_activity` as well, so the list and the rule cannot drift.
  const { data: categoryData } = await supabase
    .from("marketplace_categories")
    .select("id,name,division,slug")
    .eq("is_active", true)
    .order("division", { ascending: true })
    .order("name", { ascending: true })
    .limit(200);
  const categories = (categoryData ?? []) as { id: string; name: string; division: string; slug: string }[];

  const detailMissing = details.some(entry => entry.problem && /not been applied/i.test(entry.problem));
  const readProblem = error ? describeAdminReadFailure("Provider applications", error) : null;

  return (
    <AdminShell
      email={access.user.email ?? null}
      mfaLevel={access.mfaLevel}
      title="Provider applications"
      description="Every decision here is checked three times: this page, the review endpoint and the database trigger. Approval unlocks listing creation for that activity only; self-review is impossible, a rejection needs a written reason, and every change is audited."
    >
      <nav aria-label="Application status" className="flex flex-wrap items-center gap-2">
        {TABS.map(entry => {
          const active = entry.key === tab.key;
          return (
            <Link
              key={entry.key}
              href={entry.key === "pending" ? "/admin/applications" : `/admin/applications?status=${entry.key}`}
              aria-current={active ? "page" : undefined}
              className={
                active
                  ? "rounded-full border border-brand-400 bg-brand-500/20 px-3 py-1.5 text-sm font-bold text-brand-100"
                  : "rounded-full border border-white/15 px-3 py-1.5 text-sm font-semibold text-ink-300 hover:border-white/30"
              }
            >
              {entry.label}
            </Link>
          );
        })}
        <Link
          href="/admin/vehicles"
          className="ml-auto text-sm font-semibold text-brand-300 hover:text-brand-200"
        >
          Vehicle & document approval →
        </Link>
      </nav>

      {readProblem ? (
        <p role="alert" className="mt-5 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-5 text-sm leading-6 text-amber-100">
          {readProblem}
        </p>
      ) : null}

      {detailMissing ? (
        <p className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-sm leading-6 text-ink-300">
          Applicant identity, documents and decision history need migration{" "}
          <span className="font-mono text-ink-100">0032</span>. The queue and the approve/reject
          decision below work without it, because the database trigger already enforces the rules —
          but do not approve anyone until you can see their confirmed email and evidence.
        </p>
      ) : null}

      {!readProblem && rows.length === 0 ? (
        <section className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="text-lg font-black text-white">
            {tab.key === "pending" ? "No application is waiting for a decision" : `No ${tab.label.toLowerCase()} applications in this window`}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-400">
            {detailMissing
              ? "This empty queue cannot be trusted yet: without migration 0032 only your own application is readable, so other applicants would be invisible here. Apply the migration before treating this as a real zero."
              : "This is a true zero for the selected filter, not a failed query. Applications appear here as soon as an applicant submits one; they are never seeded."}
          </p>
          <Link href="/admin" className="mt-4 inline-flex text-sm font-bold text-brand-300 hover:text-brand-200">
            Back to the overview →
          </Link>
        </section>
      ) : null}

      <div className="mt-5 space-y-4">
        {rows.map(row => {
          const entry = detailById.get(row.id);
          return (
            <ApplicationReviewCard
              key={row.id}
              row={row}
              detail={entry?.detail ?? null}
              detailProblem={entry?.problem ?? null}
              isOwnApplication={row.user_id === access.user.id}
              categories={categories}
            />
          );
        })}
      </div>

      {rows.length > 0 ? (
        <p className="mt-6 text-xs leading-6 text-ink-500">
          Showing up to 20 applications per filter, oldest submission first. Documents are private:
          open them through Vehicle approval, which is where the per-file review is recorded.
        </p>
      ) : null}
    </AdminShell>
  );
}
