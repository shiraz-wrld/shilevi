"use client";

import { useState } from "react";

type Decision = "approve" | "reject";

/**
 * Refund decision control.
 *
 * The second click is the confirmation: no money moves until the operator presses "Confirm" on the
 * same card, and the reason for a rejection is required before the request is sent. Every failure
 * is surfaced verbatim (401/403/409/503) instead of a success message, because a refund that did
 * not happen must never look like one that did.
 */
export function RefundDecision({
  refundId,
  orderNumber,
  amountLabel,
}: {
  refundId: string;
  orderNumber: string;
  amountLabel: string;
}) {
  const [pending, setPending] = useState<Decision | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<"" | "processed" | "rejected">("");

  async function decide(decision: Decision) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/refunds/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refundId, approve: decision === "approve", note }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        status?: string;
        error?: string;
      };
      if (!response.ok || !payload.ok) {
        setError(payload.error || `The decision failed (HTTP ${response.status}). Nothing was changed.`);
        return;
      }
      setDone(decision === "approve" ? "processed" : "rejected");
      setPending(null);
    } catch {
      setError("The decision could not be sent. Check your connection and try again; nothing was changed.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <p
        role="status"
        className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-200"
      >
        {done === "processed"
          ? `Refund of ${amountLabel} recorded for ${orderNumber}. Reload to see the settled order.`
          : `Refund for ${orderNumber} rejected. The order was restored to its previous status.`}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {pending ? (
        <div className="rounded-xl border border-slate-700 bg-slate-950/60 p-3">
          <p className="text-xs leading-5 text-slate-300">
            {pending === "approve"
              ? `Confirm the refund of ${amountLabel} for ${orderNumber}. This writes the refund ledger, returns the item value to the customer and marks the order refunded. It cannot be undone from this screen.`
              : `Confirm rejecting the refund for ${orderNumber}. The order returns to its previous status and the customer keeps the payment.`}
          </p>
          <label className="mt-3 block text-xs font-bold uppercase tracking-wide text-slate-400">
            {pending === "approve" ? "Note for the customer (optional)" : "Reason for rejection (required)"}
            <textarea
              rows={3}
              value={note}
              maxLength={1000}
              onChange={event => setNote(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-normal text-slate-100 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/40"
              placeholder={
                pending === "approve"
                  ? "What the customer should expect next."
                  : "Explain why the refund is not approved."
              }
            />
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || (pending === "reject" && note.trim().length < 5)}
              onClick={() => void decide(pending)}
              className={`rounded-lg px-3 py-2 text-xs font-bold text-white disabled:opacity-50 ${
                pending === "approve" ? "bg-emerald-600 hover:bg-emerald-500" : "bg-red-600 hover:bg-red-500"
              }`}
            >
              {busy ? "Recording…" : pending === "approve" ? "Confirm refund" : "Confirm rejection"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setPending(null);
                setError("");
              }}
              className="rounded-lg border border-slate-600 px-3 py-2 text-xs font-bold text-slate-200 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setPending("approve");
              setError("");
            }}
            className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-500"
          >
            Approve refund
          </button>
          <button
            type="button"
            onClick={() => {
              setPending("reject");
              setError("");
            }}
            className="rounded-lg border border-red-500/60 px-3 py-2 text-xs font-bold text-red-200 hover:bg-red-500/10"
          >
            Reject
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs leading-5 text-red-200">
          {error}
        </p>
      )}
    </div>
  );
}
