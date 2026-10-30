"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export type SettingsMap = {
  currency: string;
  payment_mode: string;
  commission_rate_bps: number;
  delivery_commission_bps: number;
  delivery_flat_fee_minor: number;
};

function percentFromBps(value: number) {
  return (value / 100).toString();
}

function bpsFromPercent(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const bps = Math.round(parsed * 100);
  if (bps < 0 || bps > 5000) return null;
  return bps;
}

/**
 * Platform settings editor.
 *
 * Every value is written through admin_update_setting(), which re-checks the owner allowlist and
 * MFA level and rejects out-of-range values. Only changed keys are sent, and the current values stay
 * visible so an accidental save is obvious. Commission and fees are business decisions: this screen
 * never preselects a policy, it only records the one the owner confirms.
 */
export function PlatformSettingsForm({ initial }: { initial: SettingsMap }) {
  const [commission, setCommission] = useState(percentFromBps(initial.commission_rate_bps));
  const [deliveryCommission, setDeliveryCommission] = useState(percentFromBps(initial.delivery_commission_bps));
  const [flatFee, setFlatFee] = useState((initial.delivery_flat_fee_minor / 100).toString());
  const [mode, setMode] = useState(initial.payment_mode);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const nextCommission = bpsFromPercent(commission);
  const nextDeliveryCommission = bpsFromPercent(deliveryCommission);
  const nextFlatFee = Math.round(Number(flatFee) * 100);
  const feeValid = Number.isFinite(nextFlatFee) && nextFlatFee >= 0 && nextFlatFee <= 1_000_000;
  const modeChanged = mode !== initial.payment_mode;
  const dirty =
    nextCommission !== initial.commission_rate_bps ||
    nextDeliveryCommission !== initial.delivery_commission_bps ||
    (feeValid && nextFlatFee !== initial.delivery_flat_fee_minor) ||
    modeChanged;

  const invalid =
    nextCommission === null || nextDeliveryCommission === null || !feeValid || (modeChanged && !confirmed);

  async function save() {
    setBusy(true);
    setMessage("");
    setError("");
    const updates: { key: string; value: unknown; label: string }[] = [];
    if (nextCommission !== initial.commission_rate_bps) {
      updates.push({ key: "commission_rate_bps", value: nextCommission, label: "marketplace commission" });
    }
    if (nextDeliveryCommission !== initial.delivery_commission_bps) {
      updates.push({ key: "delivery_commission_bps", value: nextDeliveryCommission, label: "delivery commission" });
    }
    if (feeValid && nextFlatFee !== initial.delivery_flat_fee_minor) {
      updates.push({ key: "delivery_flat_fee_minor", value: nextFlatFee, label: "delivery fee" });
    }
    if (modeChanged) {
      updates.push({ key: "payment_mode", value: mode, label: "payment mode" });
    }
    if (updates.length === 0) {
      setBusy(false);
      setMessage("Nothing to save.");
      return;
    }

    try {
      const db = createSupabaseBrowserClient();
      const failed: string[] = [];
      for (const update of updates) {
        const { error: rpcError } = await db.rpc("admin_update_setting", { p_key: update.key, p_value: update.value });
        if (rpcError) {
          failed.push(update.label);
        }
      }
      if (failed.length) {
        setError(
          `These settings were not saved: ${failed.join(", ")}. Confirm this session has MFA level 2 and that migration 0027 is applied to the linked database.`,
        );
        return;
      }
      setMessage(
        `Saved ${updates.map(update => update.label).join(", ")}. The change applies to the next order or ride that is priced; existing orders keep the amounts they were created with.`,
      );
      setConfirmed(false);
    } catch {
      setError("The settings could not be saved. Check your connection and try again; nothing was changed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <h2 className="text-lg font-black text-white">Commission</h2>
        <p className="mt-1 text-sm leading-6 text-ink-300">
          Percentages are stored as basis points (100 bps = 1%). The commission rate is an unresolved
          business decision — this screen records your decision, it does not make one. Amounts are
          snapshotted onto each order when it is created.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-bold text-ink-200">
            Marketplace commission (%)
            <input
              type="number"
              min={0}
              max={50}
              step="0.5"
              value={commission}
              onChange={event => setCommission(event.target.value)}
              className="field mt-1.5 font-normal"
            />
            <span className="mt-1 block text-xs font-normal text-ink-400">
              {nextCommission === null ? "Enter a percentage between 0 and 50." : `${nextCommission} bps · currently ${initial.commission_rate_bps} bps`}
            </span>
          </label>
          <label className="text-sm font-bold text-ink-200">
            Delivery commission (%)
            <input
              type="number"
              min={0}
              max={50}
              step="0.5"
              value={deliveryCommission}
              onChange={event => setDeliveryCommission(event.target.value)}
              className="field mt-1.5 font-normal"
            />
            <span className="mt-1 block text-xs font-normal text-ink-400">
              {nextDeliveryCommission === null
                ? "Enter a percentage between 0 and 50."
                : `${nextDeliveryCommission} bps · currently ${initial.delivery_commission_bps} bps`}
            </span>
          </label>
          <label className="text-sm font-bold text-ink-200">
            Flat delivery fee (KSh)
            <input
              type="number"
              min={0}
              max={10000}
              step="1"
              value={flatFee}
              onChange={event => setFlatFee(event.target.value)}
              className="field mt-1.5 font-normal"
            />
            <span className="mt-1 block text-xs font-normal text-ink-400">
              {feeValid ? `KSh ${(nextFlatFee / 100).toLocaleString("en-KE")} · currently KSh ${(initial.delivery_flat_fee_minor / 100).toLocaleString("en-KE")}` : "Enter an amount between 0 and 10,000."}
            </span>
          </label>
          <div className="text-sm font-bold text-ink-200">
            Currency
            <p className="mt-1.5 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-2.5 font-mono text-base text-white">
              {initial.currency}
            </p>
            <span className="mt-1 block text-xs font-normal text-ink-400">
              Fixed here. Changing the ledger currency is a migration, not a setting.
            </span>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <h2 className="text-lg font-black text-white">Payment mode</h2>
        <p className="mt-1 text-sm leading-6 text-ink-300">
          <strong>live</strong> means checkout must reach a configured provider; it fails closed if one
          is missing. <strong>mock</strong> records simulated payments and must never be used with real
          customers. The separate <code className="text-brand-200">allow_mock_payments</code> switch is a
          database setting changed only through a reviewed migration.
        </p>
        <div className="mt-4 max-w-sm">
          <label className="text-sm font-bold text-ink-200">
            Mode
            <select value={mode} onChange={event => setMode(event.target.value)} className="field mt-1.5 font-normal">
              <option value="live">live</option>
              <option value="mock">mock</option>
            </select>
          </label>
        </div>
        {modeChanged && (
          <label className="mt-4 flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm leading-6 text-amber-100">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={event => setConfirmed(event.target.checked)}
              className="mt-1 accent-amber-400"
            />
            <span>
              I understand that switching to <strong>{mode}</strong> changes how every new checkout is
              priced and settled, and that mock payments are simulations only.
            </span>
          </label>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => void save()} disabled={busy || invalid || !dirty} className="btn btn-primary">
          {busy ? "Saving…" : "Save settings"}
        </button>
        <p className="text-xs text-ink-400">
          {dirty ? "Unsaved changes." : "No changes yet."} Every write is attributed to your account.
        </p>
      </div>

      {message && (
        <p role="status" className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm leading-6 text-emerald-100">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm leading-6 text-red-100">
          {error}
        </p>
      )}
    </div>
  );
}
