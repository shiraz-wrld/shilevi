"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { AuthShell } from "@/components/auth/AuthShell";

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

  return (
    <AuthShell
      title="Choose a new password"
      subtitle="Open this page from the secure link in your password-reset email. Use at least 10 characters."
      footer={
        saved ? (
          <p>
            <Link className="font-semibold text-brand-800 underline underline-offset-2" href="/login">
              Continue to sign in
            </Link>
          </p>
        ) : (
          <p>
            <Link className="font-semibold text-brand-800 underline underline-offset-2" href="/forgot-password">
              Request a new link
            </Link>
          </p>
        )
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <label className="field-label">
          New password
          <input required minLength={10} maxLength={128} type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} className="field mt-1.5 font-normal" />
        </label>
        <label className="field-label">
          Confirm new password
          <input required minLength={10} maxLength={128} type="password" autoComplete="new-password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} className="field mt-1.5 font-normal" />
        </label>
        <button disabled={busy || saved} className="btn btn-primary w-full">
          {busy ? "Updating…" : "Update password"}
        </button>
        {message && (
          <p role={saved ? "status" : "alert"} className={saved ? "notice notice-success" : "notice notice-error"}>
            {message}
          </p>
        )}
      </form>
    </AuthShell>
  );
}
