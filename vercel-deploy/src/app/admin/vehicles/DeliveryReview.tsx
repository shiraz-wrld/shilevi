"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Fleet = { id: string; business_name: string; owner_user_id: string; status: string; submitted_at: string | null };
type Driver = { id: string; fleet_id: string; driver_user_id: string; status: string; created_at: string };
type Document = {
  id: string;
  doc_type: string;
  storage_path: string;
  status: string;
  expires_at: string | null;
  vehicle_id: string | null;
  application_id: string | null;
  fleet_id: string | null;
  created_at: string;
};

function friendly(message: string) {
  if (/not authorized|permission denied/i.test(message)) return "Your session is not authorised for delivery review. Sign in again with MFA.";
  if (/already been reviewed/i.test(message)) return "Another reviewer has already decided this record. Reload to see the current state.";
  return message;
}

export function DeliveryReview({
  fleets,
  drivers,
  documents,
}: {
  fleets: Fleet[];
  drivers: Driver[];
  documents: Document[];
}) {
  const router = useRouter();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function review(kind: "fleet" | "driver" | "document", id: string, approve: boolean) {
    if (!approve && !(notes[id] ?? "").trim()) {
      setError("A rejection needs a reason the applicant can act on.");
      return;
    }
    setBusy(id);
    setError("");
    setNotice("");
    try {
      const db = createSupabaseBrowserClient();
      const args = {
        p_approve: approve,
        p_note: (notes[id] ?? "").trim() || null,
      };
      const call =
        kind === "fleet"
          ? db.rpc("admin_review_delivery_fleet", { p_fleet_id: id, ...args })
          : kind === "driver"
            ? db.rpc("admin_review_delivery_fleet_driver", { p_driver_id: id, ...args })
            : db.rpc("admin_review_delivery_document", { p_document_id: id, ...args });
      const { error: rpcError } = await call;
      if (rpcError) throw rpcError;
      setNotice(
        `${kind === "document" ? "Document" : kind === "fleet" ? "Fleet" : "Driver"} ${approve ? "approved" : "rejected"}. The decision is recorded against your account.`,
      );
      router.refresh();
    } catch (caught) {
      setError(friendly(caught instanceof Error ? caught.message : "The decision could not be saved."));
    } finally {
      setBusy("");
    }
  }

  async function openDocument(document: Document) {
    setError("");
    try {
      const db = createSupabaseBrowserClient();
      const { data, error: signError } = await db.storage
        .from("provider-documents")
        .createSignedUrl(document.storage_path, 120);
      if (signError || !data?.signedUrl) throw signError ?? new Error("No link was returned.");
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? `The document could not be opened: ${caught.message}`
          : "The document could not be opened.",
      );
    }
  }

  const noteField = (id: string, label: string) => (
    <label className="mt-2 block text-xs font-semibold text-slate-400">
      {label}
      <input
        value={notes[id] ?? ""}
        onChange={event => setNotes(current => ({ ...current, [id]: event.target.value }))}
        maxLength={1000}
        placeholder="Required to reject; useful to explain an approval."
        className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-normal text-white"
      />
    </label>
  );

  const actions = (kind: "fleet" | "driver" | "document", id: string) => (
    <div className="mt-2 flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => void review(kind, id, true)}
        disabled={Boolean(busy)}
        className="rounded-full bg-blue-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
      >
        {busy === id ? "Saving…" : "Approve"}
      </button>
      <button
        type="button"
        onClick={() => void review(kind, id, false)}
        disabled={Boolean(busy) || !(notes[id] ?? "").trim()}
        className="rounded-full border border-red-700 px-3 py-1.5 text-xs font-bold text-red-200 disabled:opacity-40"
      >
        Reject
      </button>
    </div>
  );

  return (
    <section className="mt-10 rounded-2xl border border-slate-800 bg-slate-900 p-5">
      <h2 className="text-lg font-black text-slate-100">Delivery network review</h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
        Fleets, fleet drivers and private documents are approved independently. Approving a business never
        approves its drivers, and approving a driver never approves a vehicle. Documents open through a
        short-lived private link; nothing is copied or made public.
      </p>

      {error && <p role="alert" className="mt-3 rounded-xl border border-red-800 bg-red-950/40 p-3 text-sm text-red-100">{error}</p>}
      {notice && <p role="status" className="mt-3 rounded-xl border border-emerald-800 bg-emerald-950/40 p-3 text-sm text-emerald-100">{notice}</p>}

      <h3 className="mt-5 text-sm font-bold uppercase tracking-wide text-slate-400">Fleets awaiting review</h3>
      {fleets.length === 0 ? (
        <p className="mt-2 text-sm text-slate-400">No fleet application is waiting.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {fleets.map(fleet => (
            <li key={fleet.id} className="rounded-xl border border-slate-800 bg-slate-950/50 p-3 text-sm">
              <p className="font-bold text-slate-100">{fleet.business_name}</p>
              <p className="mt-0.5 break-all font-mono text-xs text-slate-500">
                Owner {fleet.owner_user_id} · submitted {fleet.submitted_at ? new Date(fleet.submitted_at).toLocaleString("en-KE") : "unknown"}
              </p>
              {noteField(fleet.id, "Review note")}
              {actions("fleet", fleet.id)}
            </li>
          ))}
        </ul>
      )}

      <h3 className="mt-6 text-sm font-bold uppercase tracking-wide text-slate-400">Drivers awaiting approval</h3>
      {drivers.length === 0 ? (
        <p className="mt-2 text-sm text-slate-400">No fleet driver is waiting.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {drivers.map(driver => (
            <li key={driver.id} className="rounded-xl border border-slate-800 bg-slate-950/50 p-3 text-sm">
              <p className="font-bold text-slate-100">Driver {driver.driver_user_id.slice(0, 8)}…</p>
              <p className="mt-0.5 text-xs text-slate-500">Fleet {driver.fleet_id.slice(0, 8)}… · added {new Date(driver.created_at).toLocaleString("en-KE")}</p>
              {noteField(driver.id, "Review note")}
              {actions("driver", driver.id)}
            </li>
          ))}
        </ul>
      )}

      <h3 className="mt-6 text-sm font-bold uppercase tracking-wide text-slate-400">Documents awaiting review</h3>
      {documents.length === 0 ? (
        <p className="mt-2 text-sm text-slate-400">No document is waiting.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {documents.map(document => (
            <li key={document.id} className="rounded-xl border border-slate-800 bg-slate-950/50 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-bold capitalize text-slate-100">{document.doc_type.replaceAll("_", " ")}</p>
                <button
                  type="button"
                  onClick={() => void openDocument(document)}
                  className="rounded-full border border-slate-600 px-3 py-1 text-xs font-bold text-slate-200 hover:border-slate-400"
                >
                  Open privately
                </button>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {document.vehicle_id ? `Vehicle ${document.vehicle_id.slice(0, 8)}…` : ""}
                {document.fleet_id ? `Fleet ${document.fleet_id.slice(0, 8)}…` : ""}
                {document.application_id ? `Application ${document.application_id.slice(0, 8)}…` : ""}
                {document.expires_at ? ` · expires ${new Date(document.expires_at).toLocaleDateString("en-KE")}` : ""}
              </p>
              {noteField(document.id, "Review note")}
              {actions("document", document.id)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
