"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const STORAGE_KEY = "shilevi.cookie-notice.v1";

/**
 * Storage notice.
 *
 * The build sets only strictly necessary auth cookies plus the local-storage shopping cart, so this
 * is a notice, not a consent gate. If analytics or advertising is added later, replace this with a
 * real consent component that keeps non-essential storage off until the visitor opts in.
 */
export function CookieNotice() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (!window.localStorage.getItem(STORAGE_KEY)) setVisible(true);
    } catch {
      // Storage blocked: do not nag on every render.
    }
  }, []);

  function dismiss() {
    try {
      window.localStorage.setItem(STORAGE_KEY, new Date().toISOString());
    } catch {
      // Ignore: the notice simply reappears next time.
    }
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <aside
      aria-label="Storage notice"
      className="fixed inset-x-3 bottom-3 z-40 mx-auto max-w-3xl rounded-2xl border border-slate-300 bg-white p-4 shadow-lg sm:inset-x-6"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm leading-6 text-slate-700">
          We use only the storage needed to keep you signed in and to remember your cart. No analytics or advertising
          cookies are set.{" "}
          <Link href="/legal/cookies" className="font-semibold text-blue-700 underline">
            What we store
          </Link>
          .
        </p>
        <button
          onClick={dismiss}
          className="shrink-0 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
        >
          Got it
        </button>
      </div>
    </aside>
  );
}
