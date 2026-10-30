"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type RequestRow = {
  id: string;
  user_id: string;
  status: "pending" | "in_review" | "completed" | "rejected" | "cancelled";
  requested_at: string;
  processed_at: string | null;
  resolution_note: string | null;
};

const closed = new Set(["completed", "rejected", "cancelled"]);

export default function AdminDeletionRequestsClient() {
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const supabase = createSupabaseBrowserClient();
      const result = await supabase.from("account_deletion_requests")
        .select("id,user_id,status,requested_at,processed_at,resolution_note")
        .order("requested_at", { ascending: false }).limit(200);
      if (result.error) throw result.error;
      setRows((result.data ?? []) as RequestRow[]);
    } catch {
      setError("Could not load requests. Confirm migration 0009 is reviewed and applied, and that this verified owner session has MFA assurance level 2.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function updateRequest(row: RequestRow, status: "in_review" | "completed" | "rejected" | "cancelled") {
    setError(""); setNotice("");
    const note = (notes[row.id] ?? row.resolution_note ?? "").trim();
    if ((status === "rejected" || status === "cancelled") && !note) {
      setError("A clear resolution reason is required when rejecting or cancelling a request.");
      return;
    }
    if (note.length > 1000) {
      setError("Resolution notes must be 1,000 characters or fewer.");
      return;
    }
    const confirmText = status === "completed"
      ? "Mark this request completed only after you have separately reviewed Auth deletion, retained financial/legal records, and related provider data. Continue?"
      : `Change this request to "${status.replaceAll("_", " ")}" ?`;
    if (!window.confirm(confirmText)) return;

    setBusyId(row.id);
    try {
      const supabase = createSupabaseBrowserClient();
      const update = await supabase.from("account_deletion_requests").update({
        status,
        processed_at: status === "in_review" ? null : new Date().toISOString(),
        resolution_note: note || null,
      }).eq("id", row.id);
      if (update.error) throw update.error;
      setNotice("Request updated. This workflow records the review decision; it does not delete the user's Auth account automatically.");
      await load();
    } catch {
      setError("The request could not be updated. It may have been closed already, or the database may reject the transition. Refresh and review the current status.");
    } finally {
      setBusyId("");
    }
  }

  return <div className="space-y-5 text-white">
    <div>
      <div className="flex justify-end">
        <button onClick={() => void load()} disabled={loading} className="rounded-full border border-slate-700 px-4 py-2 text-sm font-bold hover:bg-slate-900 disabled:opacity-50">Refresh</button>
      </div>
      <p className="mt-2 max-w-3xl leading-7 text-slate-300">Owner-only review queue. Use the least data necessary. Closing a request is an administrative record—not proof that Auth, uploaded files, provider content, or retained financial records have been deleted.</p>
      <div className="mt-6 rounded-2xl border border-amber-800 bg-amber-950/40 p-4 text-sm leading-6 text-amber-100">Never mark a request completed until the applicable deletion and retention work is actually finished. This page does not perform destructive account deletion.</div>
      {error && <p role="alert" className="mt-5 rounded-xl border border-red-800 bg-red-950 p-4 text-sm text-red-100">{error}</p>}
      {notice && <p role="status" className="mt-5 rounded-xl border border-emerald-800 bg-emerald-950 p-4 text-sm text-emerald-100">{notice}</p>}
      {loading ? <p role="status" className="mt-8 rounded-xl border border-slate-800 p-6 text-slate-300">Loading requests…</p> : rows.length === 0 ? <div className="mt-8 rounded-2xl border border-slate-800 bg-slate-900 p-8"><h2 className="text-lg font-bold">No requests found</h2><p className="mt-2 text-sm text-slate-300">The queue is empty, or the required migration/policies are not available.</p></div> : <div className="mt-8 space-y-4">
        {rows.map(row => <article key={row.id} className="rounded-2xl border border-slate-800 bg-slate-900 p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><p className="text-xs font-bold uppercase tracking-wider text-slate-400">Request ID</p><p className="mt-1 break-all font-mono text-sm">{row.id}</p><p className="mt-3 text-xs font-bold uppercase tracking-wider text-slate-400">Account user ID</p><p className="mt-1 break-all font-mono text-sm">{row.user_id}</p></div>
            <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${closed.has(row.status) ? "bg-slate-800 text-slate-300" : row.status === "in_review" ? "bg-blue-950 text-blue-200" : "bg-amber-950 text-amber-200"}`}>{row.status.replaceAll("_", " ")}</span>
          </div>
          <div className="mt-4 grid gap-2 text-sm text-slate-300 sm:grid-cols-2"><p>Submitted: {new Date(row.requested_at).toLocaleString()}</p><p>Processed: {row.processed_at ? new Date(row.processed_at).toLocaleString() : "Not processed"}</p></div>
          {row.resolution_note && <p className="mt-3 rounded-xl bg-slate-950 p-3 text-sm text-slate-300">Previous note: {row.resolution_note}</p>}
          {!closed.has(row.status) && <div className="mt-5 space-y-3 border-t border-slate-800 pt-4">
            <label className="block text-sm font-semibold">Resolution note / reason
              <textarea maxLength={1000} rows={3} value={notes[row.id] ?? row.resolution_note ?? ""} onChange={e => setNotes(old => ({ ...old, [row.id]: e.target.value }))} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 font-normal text-white" placeholder="Record the review decision and any follow-up needed." />
            </label>
            <div className="flex flex-wrap gap-2">
              <button disabled={busyId === row.id} onClick={() => void updateRequest(row, "in_review")} className="rounded-xl border border-slate-600 px-4 py-2 text-sm font-bold disabled:opacity-50">Mark in review</button>
              <button disabled={busyId === row.id} onClick={() => void updateRequest(row, "completed")} className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold hover:bg-emerald-600 disabled:opacity-50">Mark completed</button>
              <button disabled={busyId === row.id} onClick={() => void updateRequest(row, "rejected")} className="rounded-xl bg-red-800 px-4 py-2 text-sm font-bold hover:bg-red-700 disabled:opacity-50">Reject request</button>
              <button disabled={busyId === row.id} onClick={() => void updateRequest(row, "cancelled")} className="rounded-xl border border-slate-600 px-4 py-2 text-sm font-bold disabled:opacity-50">Cancel request</button>
            </div>
            {busyId === row.id && <p role="status" className="text-sm text-slate-400">Saving review decision…</p>}
          </div>}
        </article>)}
      </div>}
      <p className="mt-8 text-xs leading-5 text-slate-500">Privacy: this queue shows account IDs, not emails, phone numbers, or profile contents. Contact the account holder through an approved support workflow; do not copy identifiers into public channels.</p>
    </div>
  </div>;
}
