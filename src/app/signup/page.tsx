"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function SignupPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage(""); setSuccess(false); setBusy(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const redirectTo = new URL("/auth/callback?next=%2Fonboarding", window.location.origin).toString();
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(), password,
        options: { data: { display_name: name.trim() }, emailRedirectTo: redirectTo },
      });
      if (error) throw error;
      if (data.session) { window.location.assign("/onboarding"); return; }
      setSuccess(true);
      setMessage("If email confirmation is enabled, check your inbox for the verification link before signing in.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to create your account. Please try again.");
    } finally { setBusy(false); }
  }

  async function signUpWithGoogle() {
    setMessage(""); setBusy(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const redirectTo = new URL("/auth/callback?next=%2Fonboarding", window.location.origin).toString();
      const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo, queryParams: { prompt: "select_account" } } });
      if (error) throw error;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Google sign-up could not be started.");
      setBusy(false);
    }
  }

  return <main className="flex min-h-screen items-center justify-center bg-slate-50 px-5 py-12"><section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-xl">
    <Link href="/" className="text-2xl font-black text-blue-700">shilevi</Link>
    <h1 className="mt-8 text-3xl font-black">Create your account</h1>
    <p className="mt-2 text-slate-600">Start as a customer. You can apply for provider activities separately.</p>
    <button type="button" onClick={signUpWithGoogle} disabled={busy} className="mt-7 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-semibold text-slate-800 disabled:opacity-60">Continue with Google</button>
    <div className="my-5 flex items-center gap-3 text-xs text-slate-400"><span className="h-px flex-1 bg-slate-200"/><span>OR WITH EMAIL</span><span className="h-px flex-1 bg-slate-200"/></div>
    <form onSubmit={submit} className="space-y-4">
      <label className="block text-sm font-semibold">Your name<input required maxLength={120} autoComplete="name" value={name} onChange={event=>setName(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-blue-600" /></label>
      <label className="block text-sm font-semibold">Email address<input required type="email" maxLength={254} autoComplete="email" value={email} onChange={event=>setEmail(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-blue-600" /></label>
      <label className="block text-sm font-semibold">Password<input required minLength={8} maxLength={128} type="password" autoComplete="new-password" value={password} onChange={event=>setPassword(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-blue-600" /><span className="mt-1 block text-xs font-normal text-slate-500">Use at least 8 characters and a unique password.</span></label>
      <button disabled={busy} className="w-full rounded-xl bg-blue-700 px-4 py-3 font-bold text-white disabled:opacity-60">{busy ? "Creating account…" : "Create account with email"}</button>
      {message && <p role={success ? "status" : "alert"} className={success ? "text-sm text-green-700" : "text-sm text-red-700"}>{message}</p>}
    </form>
    <p className="mt-6 text-sm text-slate-600">Already registered? <Link className="font-semibold text-blue-700" href="/login">Sign in</Link></p>
    <p className="mt-4 text-xs leading-5 text-slate-500">Google sign-up requires Google provider credentials and redirect URLs to be configured in your own Supabase project. Email confirmation is controlled by your Auth settings.</p>
  </section></main>;
}
