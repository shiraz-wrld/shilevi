"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { AuthShell } from "@/components/auth/AuthShell";
import {
  nextHrefForSignupPath,
  signupPath,
  signupPaths,
  type SignupPath,
} from "@/lib/auth/signup-intent";

/**
 * Registration always creates a customer account. The path chosen here only decides which next step
 * is offered — selling, delivering, carrying passengers or listing property all require a separate
 * application that a reviewer approves, and approval is what grants the work. Nothing about this
 * choice is trusted by the database.
 */
export default function SignupPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pathId, setPathId] = useState<SignupPath["id"]>("customer");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);

  const chosen = signupPath(pathId) ?? signupPaths[0]!;

  /**
   * Best-effort: record the answer on the profile so support and the next sign-in can see it. If the
   * table or column is not reachable the person still gets a working account — the choice is also in
   * their auth metadata, and the application form is linked either way.
   */
  async function recordIntent(userId: string, fullName: string) {
    try {
      const supabase = createSupabaseBrowserClient();
      await supabase
        .from("user_onboarding")
        .upsert(
          {
            user_id: userId,
            full_name: fullName,
            account_intent: chosen.intent,
            signup_activity: chosen.signupActivity,
          },
          { onConflict: "user_id", ignoreDuplicates: true },
        );
    } catch {
      // Never block registration on a profile write.
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage(""); setSuccess(false); setBusy(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const displayName = name.trim();
      const redirectTo = new URL(
        `/auth/callback?next=${encodeURIComponent(nextHrefForSignupPath(chosen.id))}`,
        window.location.origin,
      ).toString();
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(), password,
        options: {
          data: { display_name: displayName, signup_path: chosen.id, signup_activity: chosen.signupActivity },
          emailRedirectTo: redirectTo,
        },
      });
      if (error) throw error;
      // A new account is a customer account immediately: land on the dashboard, where the profile
      // step is offered as an optional shortcut instead of a wall in front of the marketplace.
      if (data.session && data.user) {
        await recordIntent(data.user.id, displayName || "Shilevi member");
        window.location.assign(nextHrefForSignupPath(chosen.id));
        return;
      }
      setSuccess(true);
      setMessage(
        chosen.activity
          ? "Check your inbox for the verification link. After confirming, sign in and your application will be waiting at the next step you chose."
          : "If email confirmation is enabled, check your inbox for the verification link before signing in.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to create your account. Please try again.");
    } finally { setBusy(false); }
  }

  async function signUpWithGoogle() {
    setMessage(""); setBusy(true);
    try {
      const supabase = createSupabaseBrowserClient();
      // The chosen path travels in `next`, which the auth callback validates against the internal
      // allowlist before using it, so a crafted link cannot turn signup into an open redirect.
      const redirectTo = new URL(
        `/auth/callback?next=${encodeURIComponent(nextHrefForSignupPath(chosen.id))}`,
        window.location.origin,
      ).toString();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo, queryParams: { prompt: "select_account" } },
      });
      if (error) throw error;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Google sign-up could not be started.");
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="Every account starts as a customer. Selling, delivering or carrying passengers is a separate application Shilevi reviews first."
      footer={
        <p>
          Already registered?{" "}
          <Link className="font-semibold text-brand-800 underline underline-offset-2" href="/login">
            Sign in
          </Link>
        </p>
      }
    >
      <button type="button" onClick={signUpWithGoogle} disabled={busy} className="btn btn-secondary w-full">
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

      <form onSubmit={submit} className="space-y-5">
        <fieldset>
          <legend className="text-sm font-bold text-ink-900">How will you use Shilevi?</legend>
          <p className="mt-1 text-xs leading-5 text-ink-500">
            Pick the closest fit. You can apply for more than one activity later, and you keep full
            customer access either way.
          </p>
          <div role="radiogroup" aria-label="How will you use Shilevi?" className="mt-3 grid gap-2 sm:grid-cols-2">
            {signupPaths.map(option => {
              const active = option.id === pathId;
              return (
                <label
                  key={option.id}
                  className={`flex cursor-pointer gap-3 rounded-2xl border p-3 transition-colors ${
                    active ? "border-brand-600 bg-brand-50" : "border-line bg-white hover:border-ink-300"
                  }`}
                >
                  <input
                    type="radio"
                    name="signup-path"
                    value={option.id}
                    checked={active}
                    onChange={() => setPathId(option.id)}
                    className="mt-1 accent-brand-700"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-ink-900">{option.label}</span>
                    <span className="mt-0.5 block text-xs leading-5 text-ink-500">{option.detail}</span>
                  </span>
                </label>
              );
            })}
          </div>
          {chosen.activity && (
            <p className="mt-3 rounded-xl bg-mist-100 px-3 py-2 text-xs leading-5 text-ink-600">
              You will start with a customer account and be taken to the {chosen.label.toLowerCase()}{" "}
              application. Your documents and activity are reviewed before you can take work.
            </p>
          )}
        </fieldset>

        <label className="field-label">
          Your name
          <input required maxLength={120} autoComplete="name" value={name} onChange={event => setName(event.target.value)} className="field mt-1.5 font-normal" />
        </label>
        <label className="field-label">
          Email address
          <input required type="email" maxLength={254} autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} className="field mt-1.5 font-normal" />
        </label>
        <label className="field-label">
          Password
          <input required minLength={8} maxLength={128} type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} className="field mt-1.5 font-normal" />
          <span className="mt-1.5 block text-xs font-normal text-ink-400">At least 8 characters. Use a unique password.</span>
        </label>
        <button disabled={busy} className="btn btn-primary w-full">
          {busy ? "Creating account…" : "Create account with email"}
        </button>
        {message && (
          <p role={success ? "status" : "alert"} className={success ? "notice notice-success" : "notice notice-error"}>
            {message}
          </p>
        )}
      </form>

      <p className="mt-6 text-xs leading-5 text-ink-400">
        Google sign-up requires Google provider credentials and redirect URLs in the Supabase project.
        Email confirmation is controlled by the project&apos;s Auth settings.
      </p>
    </AuthShell>
  );
}
