"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AuthShell } from "@/components/auth/AuthShell";
import MfaVerifyForm, { type VerifiableFactor } from "@/components/auth/MfaVerifyForm";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Phase = "checking" | "code" | "no-factor" | "signed-out" | "error";

/**
 * The AAL1 → AAL2 step-up.
 *
 * Signing in with a password (or an OAuth provider) returns an aal1 session even when the account
 * has a verified authenticator. Privileged surfaces require aal2, so the session must be challenged
 * here. This page asks Supabase Auth for a real challenge, verifies the real code and confirms the
 * upgraded level before leaving; it never assumes that a verified factor means a verified session.
 */
export default function MfaChallenge({ nextPath }: { nextPath: string }) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [factors, setFactors] = useState<VerifiableFactor[]>([]);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const supabase = createSupabaseBrowserClient();
        const { data: userData, error: userError } = await supabase.auth.getUser();
        if (!active) return;
        if (userError || !userData.user) {
          setPhase("signed-out");
          return;
        }
        setEmail(userData.user.email ?? null);

        const assurance = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (!active) return;
        if (assurance.data?.currentLevel === "aal2") {
          window.location.replace(nextPath);
          return;
        }

        const listed = await supabase.auth.mfa.listFactors();
        if (!active) return;
        const verified = (listed.data?.totp ?? [])
          .filter(factor => factor.status === "verified")
          .map(factor => ({
            id: factor.id,
            label: factor.friendly_name?.trim() || "Authenticator app",
          }));

        setFactors(verified);
        setPhase(verified.length > 0 ? "code" : "no-factor");
      } catch {
        if (active) setPhase("error");
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [nextPath]);

  async function switchAccount() {
    try {
      await fetch("/api/auth/signout", { method: "POST" });
    } catch {
      // Clearing the cookie is best effort; the login page will still replace the session.
    }
    window.location.assign(`/login?next=${encodeURIComponent(nextPath)}`);
  }

  return (
    <AuthShell
      title="Two-step verification"
      subtitle="This account has an authenticator, and the page you asked for needs a session that has used it."
      footer={
        <p>
          Signed in as <span className="font-semibold text-ink-700">{email ?? "your account"}</span>.{" "}
          <button type="button" onClick={() => void switchAccount()} className="font-semibold text-brand-800 underline underline-offset-2">
            Use a different account
          </button>
        </p>
      }
    >
      {phase === "checking" && (
        <p role="status" className="text-sm leading-6 text-ink-500">
          Checking this session…
        </p>
      )}

      {phase === "code" && (
        <>
          <p className="mb-5 text-sm leading-6 text-ink-500">
            Open your authenticator app and enter the current six-digit code. The code changes every
            30 seconds; an expired one is rejected and nothing is changed.
          </p>
          <MfaVerifyForm
            factors={factors}
            submitLabel="Verify and continue"
            onVerified={() => window.location.assign(nextPath)}
          />
        </>
      )}

      {phase === "no-factor" && (
        <div className="space-y-4">
          <p role="status" className="notice">
            This account has no verified authenticator, so there is no code to ask for. Continue to
            the page you requested — if it requires MFA, it will explain how to set one up.
          </p>
          <button type="button" onClick={() => window.location.assign(nextPath)} className="btn btn-primary w-full">
            Continue
          </button>
        </div>
      )}

      {phase === "signed-out" && (
        <div className="space-y-4">
          <p role="alert" className="notice notice-error">
            Your session has ended, so there is nothing to verify. Sign in again to continue.
          </p>
          <Link href={`/login?next=${encodeURIComponent(nextPath)}`} className="btn btn-primary w-full">
            Go to sign in
          </Link>
        </div>
      )}

      {phase === "error" && (
        <div className="space-y-4">
          <p role="alert" className="notice notice-error">
            Your authenticator state could not be read. This is a connection or configuration
            problem, not a wrong code. Reload to try again.
          </p>
          <button type="button" onClick={() => window.location.reload()} className="btn btn-secondary w-full">
            Reload
          </button>
        </div>
      )}
    </AuthShell>
  );
}
