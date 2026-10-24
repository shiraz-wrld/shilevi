import "server-only";

import type { Metadata } from "next";
import { requireOwnerAdmin } from "@/lib/admin/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AdminAccessDenied, AdminShell } from "@/components/admin/AdminShell";

export const metadata: Metadata = {
  title: "Audit log",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

type AuditRow = {
  id: number;
  actor_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  outcome: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

function summarizeMetadata(metadata: Record<string, unknown> | null) {
  if (!metadata) return "—";
  const allowed = ["operation", "table", "status", "is_featured", "is_active", "slug", "name", "activity_type"];
  const parts = allowed
    .filter(key => metadata[key] !== undefined && metadata[key] !== null)
    .map(key => `${key}: ${String(metadata[key]).slice(0, 80)}`);
  return parts.length ? parts.join(" · ") : "—";
}

export default async function AdminAuditLogPage() {
  const result = await requireOwnerAdmin();
  if (!result.authorized) return <AdminAccessDenied reason={result.reason} />;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("audit_events")
    .select("id,actor_id,action,resource_type,resource_id,outcome,metadata,created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  const rows = (data ?? []) as AuditRow[];

  return (
    <AdminShell
      email={result.user.email ?? null}
      mfaLevel={result.mfaLevel}
      title="Audit log"
      description="Append-only record of privileged marketplace changes. Metadata is deliberately bounded: no documents, notes, emails or phone numbers are stored here."
    >
      {error ? (
        <p role="alert" className="rounded-2xl border border-amber-800 bg-amber-950/40 p-5 text-sm leading-6 text-amber-100">
          The audit log could not be read. Apply reviewed migration 0019 to grant the owner read policy, then reload.
        </p>
      ) : rows.length === 0 ? (
        <p className="rounded-2xl border border-slate-800 bg-slate-900 p-6 text-sm leading-6 text-slate-300">
          No audit events recorded yet. Category, brand, listing and provider-application changes appear here once review
          actions are performed.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-800 text-xs font-bold uppercase tracking-wide text-slate-400">
              <tr>
                <th scope="col" className="px-4 py-3">When</th>
                <th scope="col" className="px-4 py-3">Action</th>
                <th scope="col" className="px-4 py-3">Resource</th>
                <th scope="col" className="px-4 py-3">Outcome</th>
                <th scope="col" className="px-4 py-3">Metadata</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {rows.map(row => (
                <tr key={row.id} className="align-top">
                  <td className="whitespace-nowrap px-4 py-3 text-slate-400">
                    {new Date(row.created_at).toLocaleString("en-KE")}
                  </td>
                  <td className="px-4 py-3 font-semibold text-slate-100">{row.action}</td>
                  <td className="px-4 py-3 text-slate-300">
                    {row.resource_type}
                    {row.resource_id ? <span className="block text-xs text-slate-500">{row.resource_id.slice(0, 60)}</span> : null}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-1 text-xs font-bold ${row.outcome === "success" ? "bg-emerald-950 text-emerald-200" : row.outcome === "denied" ? "bg-amber-950 text-amber-200" : "bg-red-950 text-red-200"}`}>
                      {row.outcome}
                    </span>
                  </td>
                  <td className="max-w-md px-4 py-3 text-xs leading-5 text-slate-400">{summarizeMetadata(row.metadata)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-5 text-xs leading-6 text-slate-500">
        Showing the most recent 100 events. Audit rows are written by database triggers inside the same transaction as the
        change; this page is read-only and cannot edit or delete them.
      </p>
    </AdminShell>
  );
}
