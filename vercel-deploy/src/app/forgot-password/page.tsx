"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const supabase = createSupabaseBrowserClient();
      const redirectTo = new URL("/auth/callback?next=%2Freset-password", window.location.origin).toString();
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo });
      if (error) throw error;
      setSent(true);
      setMessage("If an account exists for that address, a password-reset email will be sent. Check your inbox and spam folder.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to request a password reset. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="flex min-h-screen items-center justify-center bg-slate-50 px-5 py-12"><section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-xl">
    <Link href="/" className="text-2xl font-black text-blue-700">shilevi</Link>
    <h1 className="mt-8 text-3xl font-black">Reset your password</h1>
    <p className="mt-2 text-slate-600">Enter the email address linked to your account. We’ll send a secure reset link if an account matches.</p>
    <form onSubmit={submit} className="mt-7 space-y-4">
      <label className="block text-sm font-semibold">Email address<input required type="email" maxLength={254} autoComplete="email" value={email} onChange={event=>setEmail(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-blue-600" /></label>
      <button disabled={busy} className="w-full rounded-xl bg-blue-700 px-4 py-3 font-bold text-white disabled:opacity-60">{busy ? "Sending…" : "Send reset link"}</button>
      {message && <p role={sent ? "status" : "alert"} className="text-sm text-slate-700">{message}</p>}
    </form>
    <p className="mt-6 text-sm text-slate-600"><Link className="font-semibold text-blue-700" href="/login">Back to sign in</Link></p>
  </section></main>;
}
