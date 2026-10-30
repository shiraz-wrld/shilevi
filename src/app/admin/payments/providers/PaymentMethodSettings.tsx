"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Row = {
  provider: string;
  label: string;
  enabled: boolean;
  configured: boolean;
  blocker: string | null;
  sandbox: boolean;
};

function friendlyError(message: string) {
  const text = message.toLowerCase();
  if (/aal2|mfa|assurance/.test(text)) {
    return "Payment changes need a session at MFA level 2. Verify your authenticator, then retry. Nothing was changed.";
  }
  if (/not authorized|permission denied/.test(text)) {
    return "This account is not permitted to change payment methods. Nothing was changed.";
  }
  if (/could not find the function|schema cache|does not exist/.test(text)) {
    return "Payment methods cannot be changed because the payment registry function is not installed on this database. Nothing was changed.";
  }
  return "The payment method could not be changed. Nothing was changed; reload and try again.";
}

export function PaymentMethodSettings({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function toggle(row: Row) {
    setBusy(row.provider);
    setError("");
    setNotice("");
    try {
      const db = createSupabaseBrowserClient();
      const { error: rpcError } = await db.rpc("admin_set_payment_method", {
        p_provider: row.provider,
        p_enabled: !row.enabled,
      });
      if (rpcError) throw new Error(rpcError.message);
      setNotice(
        !row.enabled
          ? `${row.label} is now offered to customers${row.configured ? "" : " — but it stays unavailable until the server credentials are configured"}.`
          : `${row.label} is no longer offered.`,
      );
      router.refresh();
    } catch (caught) {
      setError(friendlyError(caught instanceof Error ? caught.message : "The payment method could not be changed."));
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="mt-6 space-y-3">
      {error && (
        <p role="alert" className="rounded-2xl border border-red-800 bg-red-950/40 p-4 text-sm leading-6 text-red-100">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-2xl border border-emerald-800 bg-emerald-950/40 p-4 text-sm leading-6 text-emerald-100">
          {notice}
        </p>
      )}

      {rows.map(row => (
        <article key={row.provider} className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-black text-slate-100">{row.label}</h2>
                <span className="rounded-full border border-slate-700 px-2 py-0.5 text-xs font-semibold text-slate-300">
                  {row.enabled ? "Enabled" : "Disabled"}
                </span>
                <span
                  className={
                    row.configured
                      ? "rounded-full border border-emerald-700 bg-emerald-950/60 px-2 py-0.5 text-xs font-semibold text-emerald-200"
                      : "rounded-full border border-amber-700 bg-amber-950/50 px-2 py-0.5 text-xs font-semibold text-amber-200"
                  }
                >
                  {row.configured ? "Chargeable" : "Not chargeable"}
                </span>
                {row.sandbox && (
                  <span className="rounded-full border border-slate-700 px-2 py-0.5 text-xs font-semibold text-slate-400">
                    Sandbox only
                  </span>
                )}
              </div>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
                {row.configured
                  ? "The server holds what this method needs. Customers can choose it once it is enabled."
                  : row.blocker}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void toggle(row)}
              disabled={Boolean(busy)}
              className="shrink-0 rounded-xl border border-slate-600 px-4 py-2 text-sm font-bold text-slate-100 hover:border-slate-400 disabled:opacity-50"
            >
              {busy === row.provider ? "Saving…" : row.enabled ? "Disable" : "Enable"}
            </button>
          </div>
        </article>
      ))}

      <p className="text-xs leading-5 text-slate-500">
        Enabling records the marketplace&apos;s intent. It does not activate a provider: the server
        re-checks credentials for every checkout and never falls back from a real provider to sandbox
        money.
      </p>
    </section>
  );
}
