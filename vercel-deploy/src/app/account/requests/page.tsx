"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type RequestRow = { id: string; listing_id: string; provider_id: string; customer_message: string; provider_response: string | null; status: "open" | "accepted" | "declined" | "closed"; created_at: string; updated_at: string };
type ListingRow = { id: string; title: string; status: string };

const statusStyle: Record<string, string> = { open: "bg-blue-50 text-blue-800", accepted: "bg-emerald-50 text-emerald-800", declined: "bg-red-50 text-red-800", closed: "bg-slate-100 text-slate-700" };

export default function CustomerRequestsPage() {
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [titles, setTitles] = useState<Record<string, string>>({});
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
      if (!auth.data.user) { window.location.replace("/login?next=%2Faccount%2Frequests"); return; }
      const result = await db.from("listing_requests").select("id,listing_id,provider_id,customer_message,provider_response,status,created_at,updated_at").eq("customer_id", auth.data.user.id).order("created_at", { ascending: false }).limit(100);
      if (result.error) throw result.error;
      const items = (result.data ?? []) as RequestRow[];
      setRows(items);
      const ids = [...new Set(items.map(item => item.listing_id))];
      if (ids.length) {
        const listingResult = await db.from("listings").select("id,title,status").in("id", ids);
        if (!listingResult.error) setTitles(Object.fromEntries(((listingResult.data ?? []) as ListingRow[]).map(item => [item.id, item.title + (item.status === "published" ? "" : " (no longer published)")])));
      } else setTitles({});
    } catch {
      setError(true); setMessage("We could not load your requests right now. Please try again in a moment.");
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  async function closeRequest(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault(); setBusyId(id); setMessage(""); setError(false);
    try {
      const db = createSupabaseBrowserClient();
      const result = await db.from("listing_requests").update({ status: "closed", closed_at: new Date().toISOString() }).eq("id", id);
      if (result.error) throw result.error;
      setMessage("Request closed."); await load();
    } catch {
      setError(true); setMessage("That request could not be closed. It may already be closed — reload to see its current state.");
    } finally { setBusyId(""); }
  }

  return <main className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6 sm:py-12"><section className="mx-auto max-w-4xl rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
    <div className="flex flex-wrap items-center justify-between gap-3"><Link href="/account" className="text-sm font-bold text-blue-700">← Account dashboard</Link><Link href="/search" className="text-sm font-bold text-blue-700">Find listings →</Link></div>
    <p className="mt-8 text-sm font-bold uppercase tracking-wide text-blue-700">Customer workspace</p><h1 className="mt-2 text-3xl font-black sm:text-4xl">Your listing requests</h1>
    <p className="mt-3 max-w-2xl leading-7 text-slate-600">Track enquiries you sent to providers. A response is not a confirmed order, booking, contract, or payment.</p>
    {message && <p role={error ? "alert" : "status"} className={`mt-5 rounded-xl p-4 text-sm ${error ? "bg-red-50 text-red-800" : "bg-blue-50 text-blue-900"}`}>{message}</p>}
    {loading ? <p role="status" className="mt-8 text-slate-600">Loading your requests…</p> : rows.length === 0 ? <div className="mt-7 rounded-2xl border border-dashed border-slate-300 p-8 text-center"><h2 className="text-xl font-bold">No requests yet</h2><p className="mt-2 text-sm text-slate-600">Open a listing and send a clear enquiry to start a conversation.</p><Link href="/search" className="mt-4 inline-block rounded-xl bg-blue-700 px-5 py-3 font-bold text-white">Explore listings</Link></div> : <div className="mt-7 space-y-4">{rows.map(item => <article key={item.id} className="rounded-2xl border border-slate-200 p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><Link href={`/listing/${item.listing_id}`} className="text-lg font-bold text-blue-800 hover:underline">{titles[item.listing_id] ?? "Listing details unavailable"}</Link><p className="mt-1 text-xs text-slate-500">Sent {new Date(item.created_at).toLocaleString()}</p></div><span className={`rounded-full px-3 py-1 text-xs font-bold capitalize ${statusStyle[item.status] ?? statusStyle.open}`}>{item.status}</span></div><h3 className="mt-4 text-xs font-bold uppercase tracking-wide text-slate-500">Your message</h3><p className="mt-1 whitespace-pre-wrap break-words leading-7 text-slate-700">{item.customer_message}</p>{item.provider_response && <div className="mt-4 rounded-xl bg-slate-50 p-4"><h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Provider response</h3><p className="mt-1 whitespace-pre-wrap break-words leading-7 text-slate-700">{item.provider_response}</p></div>}{item.status !== "closed" && <form onSubmit={event => void closeRequest(event, item.id)} className="mt-4"><button disabled={busyId === item.id} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold disabled:opacity-50">{busyId === item.id ? "Closing…" : "Close request"}</button></form>}</article>)}</div>}
  </section></main>;
}
