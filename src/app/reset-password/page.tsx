"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [saved, setSaved] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    if (password !== confirmPassword) { setMessage("The passwords do not match."); return; }
    setBusy(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setSaved(true);
      setMessage("Your password has been updated. You can now sign in with the new password.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The reset link may be expired. Request a new one and try again.");
    } finally { setBusy(false); }
  }

  return <main className="flex min-h-screen items-center justify-center bg-slate-50 px-5 py-12"><section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-xl">
    <Link href="/" className="text-2xl font-black text-blue-700">shilevi</Link>
    <h1 className="mt-8 text-3xl font-black">Choose a new password</h1>
    <p className="mt-2 text-slate-600">Open this page from the secure link in your password-reset email. Use at least 10 characters.</p>
    <form onSubmit={submit} className="mt-7 space-y-4">
      <label className="block text-sm font-semibold">New password<input required minLength={10} maxLength={128} type="password" autoComplete="new-password" value={password} onChange={event=>setPassword(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-blue-600" /></label>
      <label className="block text-sm font-semibold">Confirm new password<input required minLength={8} maxLength={128} type="password" autoComplete="new-password" value={confirmPassword} onChange={event=>setConfirmPassword(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-blue-600" /></label>
      <button disabled={busy || saved} className="w-full rounded-xl bg-blue-700 px-4 py-3 font-bold text-white disabled:opacity-60">{busy ? "Updating…" : "Update password"}</button>
      {message && <p role={saved ? "status" : "alert"} className="text-sm text-slate-700">{message}</p>}
    </form>
    {saved && <Link className="mt-5 inline-block font-semibold text-blue-700" href="/login">Go to sign in</Link>}
  </section></main>;
}
