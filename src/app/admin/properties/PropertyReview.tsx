"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { formatMoney } from "@/lib/money";

type Row = {
  listing_id: string;
  title: string;
  county: string;
  city: string;
  neighbourhood: string | null;
  property_type: string;
  bedrooms: number | null;
  rent_minor: number;
  deposit_minor: number;
  is_vacant: boolean;
  verification_status: string;
  listingStatus: string;
  ownerId: string;
  exactAddress: string;
  contactName: string;
  created_at: string;
};

export function PropertyReview({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function verify(row: Row, approve: boolean) {
    const note = (notes[row.listing_id] ?? "").trim();
    if (!approve && !note) {
      setError("A rejection reason is required.");
      return;
    }
    setBusy(`${row.listing_id}:verify`);
    setError("");
    setMessage("");
    try {
      const db = createSupabaseBrowserClient();
      const { error: verifyError } = await db.rpc("admin_verify_property", {
        p_listing_id: row.listing_id,
        p_approve: approve,
        p_note: note || null,
      });
      if (verifyError) throw verifyError;
      setMessage(approve ? "Property verified. You can now publish it." : "Property rejected. It remains unpublished.");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The verification decision could not be saved.");
    } finally {
      setBusy("");
    }
  }

  async function setPublished(row: Row, published: boolean) {
    setBusy(`${row.listing_id}:publish`);
    setError("");
    setMessage("");
    try {
      if (published && row.verification_status !== "verified") throw new Error("Verify the property before publishing it.");
      const db = createSupabaseBrowserClient();
      const { error: publishError } = await db.from("listings").update({ status: published ? "published" : "paused" }).eq("id", row.listing_id);
      if (publishError) throw publishError;
      setMessage(published ? "Property published to House Hunt." : "Property paused and removed from public search.");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Publication could not be changed.");
    } finally {
      setBusy("");
    }
  }

  if (rows.length === 0) {
    return <p className="rounded-2xl border border-slate-800 bg-slate-900 p-6 text-sm text-slate-300">No property listings have been submitted yet.</p>;
  }

  return (
    <div className="space-y-4">
      {message && <p role="status" className="rounded-2xl border border-emerald-800 bg-emerald-950/40 p-4 text-sm text-emerald-100">{message}</p>}
      {error && <p role="alert" className="rounded-2xl border border-red-800 bg-red-950/40 p-4 text-sm text-red-100">{error}</p>}
      {rows.map(row => (
        <article key={row.listing_id} className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-slate-100">{row.title}</h2>
              <p className="mt-1 text-sm text-slate-300">{row.neighbourhood ? `${row.neighbourhood}, ` : ""}{row.city}, {row.county} · {row.property_type} · {row.bedrooms ?? "—"} bed</p>
              <p className="mt-1 text-sm text-slate-400">Rent {formatMoney(row.rent_minor, "KES")} · deposit {formatMoney(row.deposit_minor, "KES")} · {row.is_vacant ? "vacant" : "occupied"}</p>
              <p className="mt-2 text-xs text-slate-400">Protected address: {row.exactAddress || "missing"} · {row.contactName || "no contact name"}</p>
              <p className="mt-1 break-all font-mono text-xs text-slate-600">Listing {row.listing_id} · owner {row.ownerId}</p>
            </div>
            <div className="text-right">
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${row.verification_status === "verified" ? "bg-emerald-950 text-emerald-200" : row.verification_status === "rejected" ? "bg-red-950 text-red-200" : "bg-amber-950 text-amber-200"}`}>{row.verification_status}</span>
              <p className="mt-2 text-xs uppercase tracking-wide text-slate-500">{row.listingStatus.replaceAll("_", " ")}</p>
            </div>
          </div>

          <label className="mt-4 block text-sm font-semibold text-slate-300">
            Review note / rejection reason
            <textarea rows={2} maxLength={1000} value={notes[row.listing_id] ?? ""} onChange={event => setNotes(current => ({ ...current, [row.listing_id]: event.target.value }))} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 font-normal text-white" placeholder="State what ownership or authority evidence was checked." />
          </label>

          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={() => void verify(row, true)} disabled={Boolean(busy)} className="rounded-full bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Verify property</button>
            <button onClick={() => void verify(row, false)} disabled={Boolean(busy) || !(notes[row.listing_id] ?? "").trim()} className="rounded-full border border-red-700 px-4 py-2 text-sm font-bold text-red-200 disabled:opacity-40">Reject</button>
            {row.listingStatus === "published" ? (
              <button onClick={() => void setPublished(row, false)} disabled={Boolean(busy)} className="rounded-full border border-slate-600 px-4 py-2 text-sm font-bold text-slate-200 disabled:opacity-50">Pause listing</button>
            ) : (
              <button onClick={() => void setPublished(row, true)} disabled={Boolean(busy) || row.verification_status !== "verified"} className="rounded-full bg-emerald-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">Publish to House Hunt</button>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}
