"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function PayoutDispatch({ payoutId, configured, canDispatch }: { payoutId: string; configured: boolean; canDispatch: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function dispatch() {
    if (!window.confirm("Send this payout through M-Pesa B2C? The amount will leave the platform account.")) return;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/payments/payouts/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payoutId }),
      });
      const payload = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "The payout could not be dispatched.");
      setMessage(payload.message ?? "Payout submitted. Waiting for the verified result.");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The payout could not be dispatched.");
    } finally {
      setBusy(false);
    }
  }

  if (!canDispatch) {
    return <span className="rounded-full border border-slate-600 px-3 py-1 text-xs font-bold text-slate-300">Owner approval required</span>;
  }
  if (!configured) {
    return <span className="rounded-full border border-amber-800 px-3 py-1 text-xs font-bold text-amber-200">B2C not configured</span>;
  }

  return (
    <div className="text-right">
      <button onClick={() => void dispatch()} disabled={busy} className="rounded-full bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
        {busy ? "Dispatching…" : "Dispatch via M-Pesa"}
      </button>
      {message && <p role="status" className="mt-2 max-w-xs text-xs text-emerald-300">{message}</p>}
      {error && <p role="alert" className="mt-2 max-w-xs text-xs text-red-300">{error}</p>}
    </div>
  );
}
