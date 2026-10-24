"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type RequestRow = { id: string; listing_id: string; customer_id: string; customer_message: string; provider_response: string | null; status: "open" | "accepted" | "declined" | "closed"; created_at: string };
type ListingRow = { id: string; title: string; status: string };
type ResponseDraft = { status: "accepted" | "declined"; response: string };
const statusStyle: Record<string, string> = { open: "bg-blue-50 text-blue-800", accepted: "bg-emerald-50 text-emerald-800", declined: "bg-red-50 text-red-800", closed: "bg-slate-100 text-slate-700" };

export default function ProviderRequestsPage() {
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, ResponseDraft>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);

  async function load() {
    setLoading(true); setError(false);
    try {
      const db = createSupabaseBrowserClient();
      const auth = await db.auth.getUser();
      if (auth.error) throw auth.error;
      if (!auth.data.user) { window.location.replace("/login?next=%2Fprovider%2Frequests"); return; }
      const result = await db.from("listing_requests").select("id,listing_id,customer_id,customer_message,provider_response,status,created_at").eq("provider_id", auth.data.user.id).order("created_at", { ascending: false }).limit(100);
      if (result.error) throw result.error;
      const items = (result.data ?? []) as RequestRow[];
      setRows(items);
      const ids = [...new Set(items.map(item => item.listing_id))];
      if (ids.length) {
        const listingResult = await db.from("listings").select("id,title,status").in("id", ids);
        if (!listingResult.error) setTitles(Object.fromEntries(((listingResult.data ?? []) as ListingRow[]).map(item => [item.id, item.title + (item.status === "published" ? "" : " (unpublished)")])));
      } else setTitles({});
    } catch {
      setError(true); setMessage("Could not load provider requests. Confirm migration 0014 has been reviewed and applied.");
    } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  async function respond(event: FormEvent<HTMLFormElement>, item: RequestRow) {
    event.preventDefault(); const draft = drafts[item.id];
    if (!draft) return;
    if (draft.response.trim().length > 3000 || (draft.status === "declined" && draft.response.trim().length < 5)) {
      setError(true); setMessage("A decline must include a short explanation; responses must be 3,000 characters or fewer."); return;
    }
    setBusyId(item.id); setMessage(""); setError(false);
    try {
      const db = createSupabaseBrowserClient();
      const result = await db.from("listing_requests").update({ status: draft.status, provider_response: draft.response.trim() || null, responded_at: new Date().toISOString() }).eq("id", item.id);
      if (result.error) throw result.error;
      setMessage("Your response has been saved."); await load();
    } catch {
      setError(true); setMessage("Could not send the response. The request may have changed, or migration 0014 may not be applied.");
    } finally { setBusyId(""); }
  }

  return <main className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6 sm:py-12"><section className="mx-auto max-w-4xl rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
    <div className="flex flex-wrap items-center justify-between gap-3"><Link href="/account" className="text-sm font-bold text-blue-700">← Account</Link><Link href="/provider/listings" className="text-sm font-bold text-blue-700">Manage listings →</Link></div>
    <p className="mt-8 text-sm font-bold uppercase tracking-wide text-blue-700">Provider workspace</p><h1 className="mt-2 text-3xl font-black sm:text-4xl">Customer enquiries</h1>
    <p className="mt-3 max-w-2xl leading-7 text-slate-600">Respond to enquiries about your published listings. Accepting means you are willing to continue discussing the offer; it does not create an order, booking, or payment.</p>
    {message && <p role={error ? "alert" : "status"} className={`mt-5 rounded-xl p-4 text-sm ${error ? "bg-red-50 text-red-800" : "bg-blue-50 text-blue-900"}`}>{message}</p>}
    {loading ? <p role="status" className="mt-8 text-slate-600">Loading enquiries…</p> : rows.length === 0 ? <div className="mt-7 rounded-2xl border border-dashed border-slate-300 p-8 text-center"><h2 className="text-xl font-bold">No enquiries yet</h2><p className="mt-2 text-sm text-slate-600">When a customer sends a request about one of your published listings, it will appear here.</p><Link href="/provider/listings" className="mt-4 inline-block font-bold text-blue-700 underline">Review your listings</Link></div> : <div className="mt-7 space-y-4">{rows.map(item => <article key={item.id} className="rounded-2xl border border-slate-200 p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><Link href={`/listing/${item.listing_id}`} className="text-lg font-bold text-blue-800 hover:underline">{titles[item.listing_id] ?? "Listing details unavailable"}</Link><p className="mt-1 text-xs text-slate-500">Received {new Date(item.created_at).toLocaleString()}</p></div><span className={`rounded-full px-3 py-1 text-xs font-bold capitalize ${statusStyle[item.status] ?? statusStyle.open}`}>{item.status}</span></div><h3 className="mt-4 text-xs font-bold uppercase tracking-wide text-slate-500">Customer message</h3><p className="mt-1 whitespace-pre-wrap break-words leading-7 text-slate-700">{item.customer_message}</p>{item.status === "open" ? <form onSubmit={event => void respond(event, item)} className="mt-5 space-y-3"><label className="block text-sm font-bold">Response<textarea maxLength={3000} rows={4} value={drafts[item.id]?.response ?? ""} onChange={event => setDrafts(current => ({ ...current, [item.id]: { status: current[item.id]?.status ?? "accepted", response: event.target.value } }))} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" placeholder="Answer the customer. Keep private contact or payment details out of this message." /></label><div className="flex flex-wrap gap-3"><button type="button" onClick={() => setDrafts(current => ({ ...current, [item.id]: { status: "accepted", response: current[item.id]?.response ?? "" } }))} className={`rounded-xl border px-4 py-2 text-sm font-bold ${(drafts[item.id]?.status ?? "accepted") === "accepted" ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-slate-300"}`}>Accept enquiry</button><button type="button" onClick={() => setDrafts(current => ({ ...current, [item.id]: { status: "declined", response: current[item.id]?.response ?? "" } }))} className={`rounded-xl border px-4 py-2 text-sm font-bold ${drafts[item.id]?.status === "declined" ? "border-red-300 bg-red-50 text-red-800" : "border-slate-300"}`}>Decline enquiry</button><button disabled={busyId === item.id} className="rounded-xl bg-blue-700 px-5 py-2 text-sm font-bold text-white disabled:opacity-50">{busyId === item.id ? "Sending…" : "Send response"}</button></div></form> : item.provider_response && <div className="mt-4 rounded-xl bg-slate-50 p-4"><h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Your response</h3><p className="mt-1 whitespace-pre-wrap break-words leading-7 text-slate-700">{item.provider_response}</p></div>}</article>)}</div>}
  </section></main>;
}
