"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export type IncidentRow = {
  id: string;
  reference: string;
  delivery_id: string;
  category: string;
  description: string;
  status: string;
  resolution_note: string | null;
  resolved_at: string | null;
  created_at: string;
};

const STATUS_STYLES: Record<string, string> = {
  open: "border-amber-400/40 bg-amber-500/10 text-amber-100",
  investigating: "border-sky-400/40 bg-sky-500/10 text-sky-100",
  resolved: "border-emerald-400/40 bg-emerald-500/10 text-emerald-100",
  rejected: "border-rose-400/40 bg-rose-500/10 text-rose-100",
};

/**
 * Incident resolution.
 *
 * The database policy `delivery_incidents_resolve_staff` admits only a caller holding
 * `delivery.manage`, and column grants restrict writes to the resolution columns. This component
 * therefore cannot widen access; it only records the decision and the resolver.
 */
export default function IncidentResolution({ incident }: { incident: IncidentRow }) {
  const router = useRouter();
  const [note, setNote] = useState(incident.resolution_note ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const closed = incident.status === "resolved" || incident.status === "rejected";

  async function decide(status: "investigating" | "resolved" | "rejected") {
    if (busy) return;
    if (status !== "investigating" && note.trim().length < 10) {
      setFailed(true);
      setMessage("Record at least a short explanation (10 characters) before closing an incident.");
      return;
    }
    setBusy(status);
    setMessage("");
    setFailed(false);
    try {
      const supabase = createSupabaseBrowserClient();
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!userData.user) throw new Error("Session expired");

      const patch: Record<string, unknown> = {
        status,
        resolution_note: note.trim() || null,
      };
      if (status === "resolved" || status === "rejected") {
        patch.resolved_at = new Date().toISOString();
        patch.resolved_by = userData.user.id;
      }

      const { data: updated, error } = await supabase
        .from("delivery_incidents")
        .update(patch)
        .eq("id", incident.id)
        .select("id,status");
      if (error) throw error;
      if (!updated || updated.length === 0) {
        setFailed(true);
        setMessage("The update did not apply — this session cannot resolve incidents. Nothing was changed.");
        return;
      }
      setMessage(`Incident marked ${status}.`);
      router.refresh();
    } catch {
      setFailed(true);
      setMessage("The incident could not be updated. Nothing was changed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-4">
      <label className="block text-sm font-bold text-ink-100">
        Resolution note
        <textarea
          rows={2}
          maxLength={2000}
          value={note}
          onChange={event => setNote(event.target.value)}
          placeholder="What was checked, who was contacted, and how the fee or parcel was settled."
          className="mt-2 w-full rounded-xl border border-white/15 bg-ink-950/60 px-3 py-2 text-sm font-normal text-white"
        />
      </label>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy !== null || closed}
          onClick={() => void decide("investigating")}
          className="rounded-full border border-sky-500/50 px-4 py-2 text-sm font-bold text-sky-200 disabled:opacity-40"
        >
          {busy === "investigating" ? "Saving…" : "Mark investigating"}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void decide("resolved")}
          className="rounded-full border border-emerald-500/50 px-4 py-2 text-sm font-bold text-emerald-200 disabled:opacity-40"
        >
          {busy === "resolved" ? "Saving…" : "Resolve"}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void decide("rejected")}
          className="rounded-full border border-rose-500/50 px-4 py-2 text-sm font-bold text-rose-200 disabled:opacity-40"
        >
          {busy === "rejected" ? "Saving…" : "Dismiss as unfounded"}
        </button>
      </div>
      {message ? (
        <p
          role={failed ? "alert" : "status"}
          className={`mt-3 rounded-xl border p-3 text-sm leading-6 ${
            failed
              ? "border-rose-500/40 bg-rose-500/10 text-rose-100"
              : "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
          }`}
        >
          {message}
        </p>
      ) : null}
      <p className="mt-2 text-xs leading-5 text-ink-500">
        Resolving an incident does not move money. A refund or a fee adjustment is a separate,
        audited decision on the refunds screen.
      </p>
      <span className={`mt-3 inline-block rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${STATUS_STYLES[incident.status] ?? "border-white/20 text-ink-200"}`}>
        {incident.status}
      </span>
    </div>
  );
}
