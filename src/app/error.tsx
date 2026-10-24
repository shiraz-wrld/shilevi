"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Log the digest only. Never log form values, addresses or tokens from the client.
    console.error("Route error", { digest: error.digest, message: error.message });
  }, [error]);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-5 py-16">
      <p className="text-sm font-bold uppercase tracking-wide text-blue-700">Something went wrong</p>
      <h1 className="mt-2 text-3xl font-black">This page could not load</h1>
      <p className="mt-4 leading-7 text-slate-600">
        The problem is on our side. Try again, and if it keeps happening contact support. If you were placing an order,
        check your order history before retrying so you do not pay twice.
      </p>
      {error.digest && <p className="mt-3 text-xs text-slate-500">Reference: {error.digest}</p>}
      <div className="mt-8 flex flex-wrap gap-3">
        <button onClick={reset} className="rounded-xl bg-blue-700 px-5 py-3 font-semibold text-white hover:bg-blue-800">
          Try again
        </button>
        <Link href="/account/orders" className="rounded-xl border border-slate-300 bg-white px-5 py-3 font-semibold hover:bg-slate-50">
          Check my orders
        </Link>
        <Link href="/support" className="rounded-xl border border-slate-300 bg-white px-5 py-3 font-semibold hover:bg-slate-50">
          Contact support
        </Link>
      </div>
    </main>
  );
}
