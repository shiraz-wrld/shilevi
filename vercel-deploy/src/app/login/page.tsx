"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { safeNextPath } from "@/lib/auth/redirect";
import { AuthShell } from "@/components/auth/AuthShell";

function getSafePostLoginPath() {
  const requested = new URLSearchParams(window.location.search).get("next");
  // A signed-in customer belongs on their dashboard, not on an application screen. A specific
  // protected destination (for example /account/orders) is still honoured when it is safe.
  return safeNextPath(requested, "/account");
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

      // A password sign-in is aal1 even when the account has a verified authenticator. Privileged
      // pages need aal2, so challenge the session now instead of bouncing the user off those pages.
      const destination = getSafePostLoginPath();
      const assurance = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (!assurance.error && assurance.data?.nextLevel === "aal2" && assurance.data.currentLevel !== "aal2") {
        window.location.assign(`/login/mfa?next=${encodeURIComponent(destination)}`);
        return;
      }

      window.location.assign(destination);
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

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to manage your orders, enquiries and saved listings."
      footer={
        <p>
          New to Shilevi?{" "}
          <Link className="font-semibold text-brand-800 underline underline-offset-2" href="/signup">
            Create an account
          </Link>
        </p>
      }
    >
      {callbackError && (
        <p role="alert" className="notice notice-error mb-5">
          The sign-in link could not be verified. Please try again or request a fresh email.
        </p>
      )}

      <button type="button" onClick={signInWithGoogle} disabled={busy} className="btn btn-secondary w-full">
        <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
          <path fill="#4285F4" d="M21.6 12.2c0-.7-.06-1.2-.18-1.8H12v3.4h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.1Z" />
          <path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1a6 6 0 0 1-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22Z" />
          <path fill="#FBBC05" d="M6.4 14a6 6 0 0 1 0-3.9V7.5H3.1a10 10 0 0 0 0 9l3.3-2.5Z" />
          <path fill="#EA4335" d="M12 6a5.4 5.4 0 0 1 3.8 1.5l2.8-2.8A9.6 9.6 0 0 0 12 2 10 10 0 0 0 3.1 7.5L6.4 10A6 6 0 0 1 12 6Z" />
        </svg>
        Continue with Google
      </button>

      <div className="my-6 flex items-center gap-3 text-xs font-semibold uppercase tracking-wide text-ink-400">
        <span className="h-px flex-1 bg-line" />
        <span>or with email</span>
        <span className="h-px flex-1 bg-line" />
      </div>

      <form onSubmit={submit} className="space-y-4">
        <label className="field-label">
          Email address
          <input required type="email" maxLength={254} autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} className="field mt-1.5 font-normal" />
        </label>
        <label className="field-label">
          Password
          <input required type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} className="field mt-1.5 font-normal" />
        </label>
        <div className="text-right text-sm">
          <Link className="font-semibold text-brand-800 hover:underline" href="/forgot-password">
            Forgot password?
          </Link>
        </div>
        <button disabled={busy} className="btn btn-primary w-full">
          {busy ? "Signing in…" : "Sign in with email"}
        </button>
        {message && (
          <p role="alert" className="notice notice-error">
            {message}
          </p>
        )}
      </form>

      <p className="mt-6 text-xs leading-5 text-ink-400">
        Google sign-in becomes active once Google is enabled as an Auth provider in the Supabase
        project with the matching redirect URLs.
      </p>
    </AuthShell>
  );
}
