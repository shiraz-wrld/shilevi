"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function AccountPage() {
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const client = createSupabaseBrowserClient();
        const { data, error } = await client.auth.getUser();
        if (error) throw error;
        if (!data.user) { window.location.replace("/login"); return; }
        if (alive) setEmail(data.user.email ?? null);
      } catch (caught) {
        if (alive) setError(caught instanceof Error ? caught.message : "Unable to load account.");
      } finally { if (alive) setLoading(false); }
    }
    void load();
    return () => { alive = false; };
  }, []);

  async function signOut() {
    try {
      // Sign out on the server so the refresh token is revoked, then leave the page entirely.
      const response = await fetch("/api/auth/signout", { method: "POST", credentials: "same-origin" });
      if (!response.ok) throw new Error("Unable to sign out. Please try again.");
      window.location.assign("/");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to sign out. Please try again.");
    }
  }

  return <main className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6 sm:py-12"><section className="mx-auto max-w-4xl rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
    <header className="flex flex-wrap items-center justify-between gap-4"><Link href="/" className="text-xl font-black text-blue-700">shilevi</Link><Link href="/account/settings" className="rounded-full bg-blue-700 px-4 py-2 text-sm font-bold text-white hover:bg-blue-800">Account settings</Link></header>
    <p className="mt-8 text-sm font-bold uppercase tracking-wide text-blue-700">Your Shilevi</p>
    <h1 className="mt-2 text-3xl font-black sm:text-4xl">Account dashboard</h1>
    {loading ? <p role="status" className="mt-4 text-slate-600">Checking your session…</p> : error ? <p role="alert" className="mt-4 rounded-xl bg-red-50 p-4 text-red-700">{error}</p> : <>
      <p className="mt-3 text-slate-600">Signed in as <span className="font-semibold text-slate-900">{email ?? "your account"}</span>.</p>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Link href="/account/orders" className="rounded-2xl border border-blue-200 bg-blue-50 p-5 transition hover:border-blue-400"><span className="font-bold">Orders and delivery</span><span className="mt-2 block text-sm leading-6 text-slate-600">Track payment, seller progress, rider status, completion, and refunds.</span></Link>
        <Link href="/cart" className="rounded-2xl border border-slate-200 p-5 transition hover:border-blue-400 hover:bg-blue-50"><span className="font-bold">Your cart</span><span className="mt-2 block text-sm leading-6 text-slate-600">Review items and continue to checkout.</span></Link>
        <Link href="/account/settings" className="rounded-2xl border border-slate-200 p-5 transition hover:border-blue-400 hover:bg-blue-50"><span className="font-bold">Profile & security settings</span><span className="mt-2 block text-sm leading-6 text-slate-600">Edit personal details, change your password, and submit an account-deletion request.</span></Link>
        <Link href="/onboarding" className="rounded-2xl border border-slate-200 p-5 transition hover:border-blue-400 hover:bg-blue-50"><span className="font-bold">Profile onboarding</span><span className="mt-2 block text-sm leading-6 text-slate-600">Update your name, optional phone, country, and broad area.</span></Link>
        <Link href="/provider/apply" className="rounded-2xl border border-slate-200 p-5 transition hover:border-blue-400 hover:bg-blue-50"><span className="font-bold">Become a provider</span><span className="mt-2 block text-sm leading-6 text-slate-600">Apply separately to sell products, offer services, provide delivery, or list property and places.</span></Link>
        <Link href="/provider/listings" className="rounded-2xl border border-slate-200 p-5 transition hover:border-blue-400 hover:bg-blue-50"><span className="font-bold">Provider listings</span><span className="mt-2 block text-sm leading-6 text-slate-600">Create private drafts after your provider activity is approved.</span></Link>
        <Link href="/deliver" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 transition hover:border-emerald-400"><span className="font-bold">Deliver with Shilevi</span><span className="mt-2 block text-sm leading-6 text-slate-600">Apply as an individual courier or a fleet. Approval is separate for the application, each vehicle and each driver.</span></Link>
        <Link href="/account/notifications" className="rounded-2xl border border-slate-200 p-5 transition hover:border-blue-400 hover:bg-blue-50"><span className="font-bold">Notifications</span><span className="mt-2 block text-sm leading-6 text-slate-600">Application decisions, job offers, order, delivery and payout updates.</span></Link>
        <Link href="/account/saved" className="rounded-2xl border border-slate-200 p-5 transition hover:border-blue-400 hover:bg-blue-50"><span className="font-bold">Saved listings</span><span className="mt-2 block text-sm leading-6 text-slate-600">Revisit published listings you have saved.</span></Link>
        <Link href="/account/requests" className="rounded-2xl border border-slate-200 p-5 transition hover:border-blue-400 hover:bg-blue-50"><span className="font-bold">My listing requests</span><span className="mt-2 block text-sm leading-6 text-slate-600">Track enquiries, provider replies, and requests you have closed.</span></Link>
        <Link href="/provider/requests" className="rounded-2xl border border-slate-200 p-5 transition hover:border-blue-400 hover:bg-blue-50"><span className="font-bold">Customer enquiries</span><span className="mt-2 block text-sm leading-6 text-slate-600">If you are an approved provider, review and respond to listing enquiries.</span></Link>
        <Link href="/provider/orders" className="rounded-2xl border border-slate-200 p-5 transition hover:border-blue-400 hover:bg-blue-50"><span className="font-bold">Provider orders</span><span className="mt-2 block text-sm leading-6 text-slate-600">Accept, prepare, dispatch, and complete paid orders.</span></Link>
        <Link href="/rider/jobs" className="rounded-2xl border border-slate-200 p-5 transition hover:border-blue-400 hover:bg-blue-50"><span className="font-bold">Rider jobs</span><span className="mt-2 block text-sm leading-6 text-slate-600">Approved transport partners can claim deliveries and update their status.</span></Link>
        <Link href="/" className="rounded-2xl border border-blue-200 bg-blue-50 p-5 transition hover:border-blue-400"><span className="font-bold">Your personalised home</span><span className="mt-2 block text-sm leading-6 text-slate-600">Recommendations, recent searches, saved items and orders in one place.</span></Link>
        <Link href="/marketplace/products" className="rounded-2xl border border-slate-200 p-5 transition hover:border-blue-400 hover:bg-blue-50"><span className="font-bold">Explore Shilevi</span><span className="mt-2 block text-sm leading-6 text-slate-600">Browse the four marketplace divisions.</span></Link>
      </div>
      <p className="mt-5 rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-700">Money only moves through a configured production payment provider. If none is configured, checkout stops and says so — it never simulates a successful charge. Live rider GPS is not available; delivery progress is shown from real status events, not a map.</p>
      <button onClick={signOut} className="mt-6 rounded-xl border border-slate-300 px-5 py-3 font-semibold hover:bg-slate-50">Sign out</button>
    </>}
  </section></main>;
}
