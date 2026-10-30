"use client";

import { useEffect, useState } from "react";
import {
  currentPushState,
  disablePush,
  enablePush,
  pushSupported,
  vapidPublicKey,
  type PushState,
} from "@/lib/push/client";

/**
 * Push opt-in.
 *
 * Permission is only ever requested from the button below, never on page load, and the current state
 * is read from the browser rather than assumed. When the deployment has no VAPID public key the
 * component says so instead of offering a control that cannot work.
 */
export function PushOptIn() {
  const [state, setState] = useState<PushState>("available");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    setSupported(pushSupported());
    void currentPushState().then(setState);
  }, []);

  async function refresh() {
    setState(await currentPushState());
  }

  async function onEnable() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await enablePush();
      setNotice("This device is subscribed. Job and ride offers can now reach you here.");
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Push could not be enabled.");
    } finally {
      setBusy(false);
    }
  }

  async function onDisable() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await disablePush();
      setNotice("This device has been unsubscribed.");
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Push could not be disabled.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
      <h2 className="text-lg font-black text-slate-900">Push notifications on this device</h2>
      <p className="mt-1 text-sm leading-6 text-slate-600">
        Job offers, ride proposals and delivery updates can reach this browser even when the tab is
        closed. Notification text never includes a customer&apos;s address, phone number or documents.
      </p>

      {!supported ? (
        <p className="mt-3 rounded-xl bg-slate-100 p-3 text-sm leading-6 text-slate-700">
          This browser does not support web push. Use the inbox below, or a current Chrome, Edge,
          Firefox or Safari on a supported device.
        </p>
      ) : !vapidPublicKey() ? (
        <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm leading-6 text-amber-900">
          Push is not configured on this deployment. The operator must set{" "}
          <code className="font-mono text-xs">NEXT_PUBLIC_VAPID_PUBLIC_KEY</code> and{" "}
          <code className="font-mono text-xs">VAPID_PRIVATE_KEY</code> and redeploy. Until then the
          inbox below still records every update.
        </p>
      ) : state === "blocked" ? (
        <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm leading-6 text-amber-900">
          Notifications are blocked for this site. Allow them in your browser&apos;s site settings, then
          reload this page.
        </p>
      ) : state === "subscribed" ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-800">
            Subscribed on this device
          </span>
          <button
            type="button"
            onClick={() => void onDisable()}
            disabled={busy}
            className="rounded-full border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 disabled:opacity-50"
          >
            {busy ? "Working…" : "Turn off on this device"}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => void onEnable()}
          disabled={busy}
          className="mt-3 rounded-full bg-blue-700 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50"
        >
          {busy ? "Requesting permission…" : "Enable push notifications"}
        </button>
      )}

      {error && (
        <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">
          {notice}
        </p>
      )}
      <p className="mt-3 text-xs leading-5 text-slate-500">
        Permission is requested only when you press the button. Push is delivered by your browser&apos;s
        push service; Shilevi records whether each send succeeded.
      </p>
    </section>
  );
}
