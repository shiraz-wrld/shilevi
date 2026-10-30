"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { AuthShell } from "@/components/auth/AuthShell";

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

  return (
    <AuthShell
      title="Reset your password"
      subtitle="Enter the email address linked to your account. We will send a secure reset link if an account matches."
      footer={
        <p>
          <Link className="font-semibold text-brand-800 underline underline-offset-2" href="/login">
            Back to sign in
          </Link>
        </p>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <label className="field-label">
          Email address
          <input required type="email" maxLength={254} autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} className="field mt-1.5 font-normal" />
        </label>
        <button disabled={busy} className="btn btn-primary w-full">
          {busy ? "Sending…" : "Send reset link"}
        </button>
        {message && (
          <p role={sent ? "status" : "alert"} className={sent ? "notice notice-success" : "notice notice-error"}>
            {message}
          </p>
        )}
      </form>
      <p className="mt-5 text-xs leading-5 text-ink-400">
        For your security we do not reveal whether an address is registered.
      </p>
    </AuthShell>
  );
}
