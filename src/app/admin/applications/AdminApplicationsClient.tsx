"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Application = { id: string; user_id: string; activity_type: string; status: string; business_name: string | null; application_data: Record<string, unknown>; submitted_at: string | null; created_at: string };
export default function AdminApplicationsClient() {
  const [rows, setRows] = useState<Application[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [reviewerId, setReviewerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  async function load() {
    setLoading(true); setMessage(""); setIsError(false);
    try {
      const supabase = createSupabaseBrowserClient();
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!userData.user) throw new Error("Your session has expired. Sign in again.");
      setReviewerId(userData.user.id);
      const { data, error } = await supabase.from("provider_applications").select("id,user_id,activity_type,status,business_name,application_data,submitted_at,created_at").eq("status", "pending").order("submitted_at", { ascending: true }).limit(100);
      if (error) throw error;
      setRows((data ?? []) as Application[]);
    } catch (cause) {
      setIsError(true); setMessage(cause instanceof Error ? cause.message : "Could not load applications. Confirm migration 0006 was reviewed and manually applied, and verify the current owner session has MFA aal2.");
    } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  async function review(row: Application, decision: "approved" | "rejected") {
    const note = (notes[row.id] ?? "").trim();
    if (decision === "rejected" && !note) { setIsError(true); setMessage("A rejection reason is required."); return; }
    setBusyId(row.id); setMessage(""); setIsError(false);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.from("provider_applications").update({
        status: decision,
        reviewed_at: new Date().toISOString(),
        reviewed_by: reviewerId,
        reviewer_note: note || null,
        rejection_reason: decision === "rejected" ? note : null,
      }).eq("id", row.id).eq("status", "pending");
      if (error) throw error;
      setRows((current) => current.filter((item) => item.id !== row.id));
      setMessage(`Application ${decision}.`);
    } catch (cause) {
      setIsError(true); setMessage(cause instanceof Error ? cause.message : "Review failed. Database policies and migration 0006 must be applied; self-review is prohibited.");
    } finally { setBusyId(null); }
  }

  const labels: Record<string, string> = { product_seller: "Product seller", service_provider: "Service provider", transport_partner: "Transport & delivery", property_provider: "Property & places" };
  return <main className="min-h-screen bg-slate-950 px-5 py-10 text-white"><div className="mx-auto max-w-6xl"><Link href="/admin" className="text-sm font-bold text-blue-300">← Back to control center</Link><p className="mt-8 text-sm font-bold uppercase tracking-widest text-blue-300">Owner review queue</p><h1 className="mt-3 text-4xl font-black">Provider applications</h1><p className="mt-4 max-w-3xl leading-7 text-slate-300">Review submitted applications. Database policy and migration 0006 enforce owner MFA, prevent self-review, restrict allowed transitions, and audit review changes. Do not approve an application unless required verification and licensing checks have actually been completed.</p>{message && <p role="status" className={`mt-6 rounded-xl border p-4 text-sm ${isError ? "border-red-800 bg-red-950/40 text-red-200" : "border-blue-800 bg-blue-950/40 text-blue-100"}`}>{message}</p>}{loading ? <p className="mt-8 text-slate-300">Loading pending applications…</p> : rows.length === 0 ? <section className="mt-8 rounded-2xl border border-slate-800 bg-slate-900 p-6"><h2 className="text-lg font-bold">No pending applications</h2><p className="mt-2 text-sm text-slate-300">The review queue is empty, or the database migrations and MFA session still need to be configured.</p><button onClick={() => void load()} className="mt-4 rounded-full bg-blue-600 px-4 py-2 text-sm font-bold">Refresh queue</button></section> : <div className="mt-8 space-y-5">{rows.map((row) => <article key={row.id} className="rounded-2xl border border-slate-800 bg-slate-900 p-5 sm:p-7"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-bold">{labels[row.activity_type] ?? row.activity_type}</h2><p className="mt-1 text-sm text-slate-300">{row.business_name || "No business name supplied"}</p></div><span className="rounded-full border border-amber-800 px-3 py-1 text-xs font-bold uppercase text-amber-200">Pending</span></div><dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-slate-400">Applicant user ID</dt><dd className="mt-1 break-all font-mono text-xs">{row.user_id}</dd></div><div><dt className="text-slate-400">Submitted</dt><dd className="mt-1">{row.submitted_at ? new Date(row.submitted_at).toLocaleString() : "Submission timestamp missing"}</dd></div></dl><div className="mt-4 rounded-xl border border-slate-800 bg-slate-950 p-4"><p className="text-sm font-semibold">Introduction</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-300">{typeof row.application_data?.introduction === "string" ? row.application_data.introduction : "No introduction provided."}</p></div><label className="mt-5 block text-sm font-semibold">Review note / rejection reason<textarea maxLength={1000} rows={3} value={notes[row.id] ?? ""} onChange={(event) => setNotes((old) => ({ ...old, [row.id]: event.target.value }))} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 font-normal text-white" placeholder="Record a concise, respectful reason. Required for rejection." /></label><div className="mt-4 flex flex-wrap gap-3"><button disabled={busyId !== null} onClick={() => void review(row, "approved")} className="rounded-full bg-blue-600 px-5 py-3 text-sm font-bold disabled:opacity-50">{busyId === row.id ? "Saving…" : "Approve"}</button><button disabled={busyId !== null} onClick={() => void review(row, "rejected")} className="rounded-full border border-red-700 px-5 py-3 text-sm font-bold text-red-200 disabled:opacity-50">Reject</button></div></article>)}</div>}<p className="mt-8 text-xs leading-6 text-slate-400">This queue shows only pending application records and is bounded to 100 rows per refresh. Audit entries omit applicant free-text and reviewer notes. The page has not been validated against a live Supabase project.</p></div></main>;
}
