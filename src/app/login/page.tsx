"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const SAFE_POST_LOGIN_PATHS = new Set(["/onboarding", "/account", "/account/orders", "/cart", "/checkout", "/admin", "/admin/categories", "/admin/brands", "/provider/orders", "/rider/jobs"]);

function getSafePostLoginPath() {
  const requested = new URLSearchParams(window.location.search).get("next");
  if (!requested) return "/onboarding";
  if (SAFE_POST_LOGIN_PATHS.has(requested)) return requested;
  if (/^\/account\/orders\/[0-9a-f-]{36}$/i.test(requested)) return requested;
  if (/^\/rider\/jobs\/[0-9a-f-]{36}$/i.test(requested)) return requested;
  if (/^\/listing\/[0-9a-f-]{36}$/i.test(requested)) return requested;
  return "/onboarding";
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [callbackError, setCallbackError] = useState(false);
  useEffect(() => { setCallbackError(new URLSearchParams(window.location.search).get("error") === "auth_callback"); }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setBusy(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
      window.location.assign(getSafePostLoginPath());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to sign in. Please try again.");
    } finally { setBusy(false); }
  }

  async function signInWithGoogle() {
    setMessage("");
    setBusy(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const callback = new URL("/auth/callback", window.location.origin);
      callback.searchParams.set("next", getSafePostLoginPath());
      const redirectTo = callback.toString();
      const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo, queryParams: { access_type: "offline", prompt: "select_account" } } });
      if (error) throw error;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Google sign-in could not be started.");
      setBusy(false);
    }
  }

  return <main className="flex min-h-screen items-center justify-center bg-slate-50 px-5 py-12"><section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-xl">
    <Link href="/" className="text-2xl font-black text-blue-700">shilevi</Link>
    <h1 className="mt-8 text-3xl font-black">Welcome back</h1>
    <p className="mt-2 text-slate-600">Sign in to your Shilevi account.</p>
    {callbackError && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">The sign-in link could not be verified. Please try again or request a fresh email.</p>}
    <button type="button" onClick={signInWithGoogle} disabled={busy} className="mt-7 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-semibold text-slate-800 disabled:opacity-60">Continue with Google</button>
    <div className="my-5 flex items-center gap-3 text-xs text-slate-400"><span className="h-px flex-1 bg-slate-200"/><span>OR WITH EMAIL</span><span className="h-px flex-1 bg-slate-200"/></div>
    <form onSubmit={submit} className="space-y-4">
      <label className="block text-sm font-semibold">Email address<input required type="email" maxLength={254} autoComplete="email" value={email} onChange={event=>setEmail(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-blue-600" /></label>
      <label className="block text-sm font-semibold">Password<input required type="password" autoComplete="current-password" value={password} onChange={event=>setPassword(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-blue-600" /></label>
      <div className="text-right text-sm"><Link className="font-semibold text-blue-700" href="/forgot-password">Forgot password?</Link></div>
      <button disabled={busy} className="w-full rounded-xl bg-blue-700 px-4 py-3 font-bold text-white disabled:opacity-60">{busy ? "Signing in…" : "Sign in with email"}</button>
      {message && <p role="alert" className="text-sm text-red-700">{message}</p>}
    </form>
    <p className="mt-6 text-sm text-slate-600">New to Shilevi? <Link className="font-semibold text-blue-700" href="/signup">Create an account</Link></p>
    <p className="mt-4 text-xs leading-5 text-slate-500">Google sign-in becomes active after you enable Google as an Auth provider and configure its credentials and redirect URLs in your own Supabase project.</p>
  </section></main>;
}
