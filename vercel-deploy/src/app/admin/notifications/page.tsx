import "server-only";

import type { Metadata } from "next";
import { requireOwnerAdmin } from "@/lib/admin/auth";
import { AdminShell } from "@/components/admin/AdminShell";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Notifications", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type OutboxRow = {
  id: number;
  channel: string;
  template: string;
  status: string;
  attempts: number;
  last_error: string | null;
  next_attempt_at: string;
  sent_at: string | null;
  created_at: string;
};

const tone: Record<string, string> = {
  sent: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
  queued: "border-white/15 bg-white/5 text-ink-200",
  sending: "border-brand-500/40 bg-brand-500/10 text-brand-200",
  failed: "border-red-500/40 bg-red-500/10 text-red-200",
  skipped: "border-amber-500/40 bg-amber-500/10 text-amber-200",
};

export default async function AdminNotificationsPage() {
  const access = await requireOwnerAdmin();

  const supabase = await createSupabaseServerClient();
  const [recentResult, queuedResult, failedResult] = await Promise.all([
    supabase
      .from("notification_outbox")
      .select("id,channel,template,status,attempts,last_error,next_attempt_at,sent_at,created_at")
      .order("id", { ascending: false })
      .limit(50),
    supabase.from("notification_outbox").select("*", { count: "exact", head: true }).eq("status", "queued"),
    supabase.from("notification_outbox").select("*", { count: "exact", head: true }).eq("status", "failed"),
  ]);

  const rows = (recentResult.data ?? []) as OutboxRow[];
  const readFailed = Boolean(recentResult.error);

  return (
    <AdminShell
      email={access.user.email ?? null}
      mfaLevel={access.mfaLevel}
      title="Notifications"
      description="The email/SMS outbox. Rows are written by database triggers inside the same transaction as the event that caused them, so an order, refund or application change cannot silently lose its notification."
    >
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: "Queued", value: queuedResult.error ? null : (queuedResult.count ?? 0) },
          { label: "Failed", value: failedResult.error ? null : (failedResult.count ?? 0) },
          { label: "Shown", value: rows.length },
        ].map(item => (
          <div key={item.label} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-2xl font-black text-white">{item.value === null ? "—" : item.value}</p>
            <p className="mt-1 text-xs font-bold uppercase tracking-wide text-ink-400">{item.label}</p>
          </div>
        ))}
      </div>

      <section className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <h2 className="text-lg font-black text-white">Delivery worker</h2>
        <p className="mt-2 text-sm leading-6 text-ink-300">
          Delivery is performed by the authenticated dispatcher endpoint, which is called by the
          scheduler and never by a browser. It needs `NOTIFICATION_DISPATCH_SECRET` and a configured
          email provider; without them it refuses to run and rows stay queued. This screen is a
          read-only operational view — it deliberately cannot send mail or reveal the provider key.
        </p>
      </section>

      {readFailed ? (
        <p className="mt-6 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-5 text-sm leading-6 text-amber-100">
          The outbox could not be read. Nothing was changed. Reload once; if it persists, System health reports whether the cause is a missing migration, an MFA session or a missing capability.</p>
      ) : rows.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-sm leading-6 text-ink-300">
          No notification has been queued yet. This is an empty outbox, not a delivery failure.
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.03]">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-white/10 text-[11px] font-bold uppercase tracking-wide text-ink-500">
              <tr>
                <th scope="col" className="px-4 py-3">#</th>
                <th scope="col" className="px-4 py-3">Template</th>
                <th scope="col" className="px-4 py-3">Channel</th>
                <th scope="col" className="px-4 py-3">Status</th>
                <th scope="col" className="px-4 py-3">Attempts</th>
                <th scope="col" className="px-4 py-3">Next attempt</th>
                <th scope="col" className="px-4 py-3">Last error</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {rows.map(row => (
                <tr key={row.id}>
                  <td className="px-4 py-3 text-ink-400">{row.id}</td>
                  <td className="px-4 py-3 font-semibold text-white">{row.template}</td>
                  <td className="px-4 py-3 text-ink-200">{row.channel}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${tone[row.status] ?? "border-white/15 text-ink-200"}`}>
                      {row.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-ink-200">{row.attempts}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink-400">
                    {new Date(row.next_attempt_at).toLocaleString("en-KE")}
                  </td>
                  <td className="max-w-[22rem] px-4 py-3 text-ink-300">{row.last_error?.slice(0, 200) ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminShell>
  );
}
