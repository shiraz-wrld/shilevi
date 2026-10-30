"use client";

import { useCallback, useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import MfaVerifyForm, { type VerifiableFactor } from "@/components/auth/MfaVerifyForm";

type Enrollment = { id: string; qr: string; secret: string };

/**
 * Authenticator state machine.
 *
 * Supabase Auth distinguishes four situations that the old screen collapsed into one message:
 * no factor, an enrolment that was started but never verified, a verified factor on an aal1 session,
 * and a verified factor on an aal2 session. Reporting them accurately is the difference between
 * "your authenticator is working" and sending an owner round a sign-out loop that never fixes it.
 */
type Phase = "loading" | "no-factor" | "unfinished" | "step-up" | "active" | "error";

export default function MfaEnrollmentClient() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [verifiedFactors, setVerifiedFactors] = useState<VerifiableFactor[]>([]);
  const [unverifiedCount, setUnverifiedCount] = useState(0);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const inspect = useCallback(async () => {
    setError("");
    try {
      const supabase = createSupabaseBrowserClient();
      const [listed, assurance] = await Promise.all([
        supabase.auth.mfa.listFactors(),
        supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      ]);
      if (listed.error) throw listed.error;
      if (assurance.error) throw assurance.error;

      const totp = listed.data?.totp ?? [];
      const verified = totp
        .filter(factor => factor.status === "verified")
        .map(factor => ({ id: factor.id, label: factor.friendly_name?.trim() || "Authenticator app" }));
      const unverified = totp.filter(factor => factor.status !== "verified").length;

      setVerifiedFactors(verified);
      setUnverifiedCount(unverified);

      if (verified.length > 0) {
        setPhase(assurance.data?.currentLevel === "aal2" ? "active" : "step-up");
      } else if (unverified > 0) {
        setPhase("unfinished");
      } else {
        setPhase("no-factor");
      }
    } catch {
      setPhase("error");
      setError("The authenticator state is unavailable right now. This is a connection problem, not a missing setup.");
    }
  }, []);

  useEffect(() => {
    void inspect();
  }, [inspect]);

  async function discardUnfinished() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const supabase = createSupabaseBrowserClient();
      const listed = await supabase.auth.mfa.listFactors();
      if (listed.error) throw listed.error;
      const unfinished = (listed.data?.totp ?? []).filter(factor => factor.status !== "verified");
      for (const factor of unfinished) {
        const removed = await supabase.auth.mfa.unenroll({ factorId: factor.id });
        if (removed.error) throw removed.error;
      }
      setEnrollment(null);
      setNotice("Unfinished setup discarded. Nothing was activated.");
      await inspect();
    } catch {
      setError("The unfinished setup could not be discarded. Reload and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function enroll() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const supabase = createSupabaseBrowserClient();
      const { data, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        issuer: "Shilevi Owner Admin",
      });
      if (enrollError) throw enrollError;
      if (!data.totp?.qr_code || !data.totp.secret) throw new Error("missing totp payload");
      setEnrollment({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
      setNotice("Scan the QR code, then verify one code to activate the authenticator.");
    } catch {
      setError("A new authenticator could not be created. Reload and try again; no factor was activated.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-8 rounded-2xl border border-white/10 bg-ink-900 p-6">
      <h2 className="text-xl font-bold">Authenticator (TOTP)</h2>
      <p className="mt-2 text-sm leading-6 text-ink-300">
        Use a trusted authenticator app. Keep the setup key private. This flow uses the signed-in
        Supabase Auth session, never a service-role key.
      </p>

      {phase === "loading" && (
        <p role="status" className="mt-5 text-sm text-ink-400">
          Reading the authenticator state…
        </p>
      )}

      {phase === "active" && (
        <p role="status" className="mt-5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm leading-6 text-emerald-100">
          An authenticator is active on this account and this session is verified at MFA level 2.
          Nothing else is needed; enrolling again would create a second factor.
        </p>
      )}

      {phase === "step-up" && (
        <div className="mt-5 space-y-4">
          <p role="status" className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm leading-6 text-amber-100">
            An authenticator is already active, but this session has not used it yet. Enter the
            current code to reach MFA level 2 — do not enrol a second factor.
          </p>
          <MfaVerifyForm
            factors={verifiedFactors}
            submitLabel="Verify this session"
            onVerified={() => {
              setNotice("Session verified at MFA level 2.");
              void inspect();
            }}
          />
        </div>
      )}

      {phase === "unfinished" && (
        <div className="mt-5 space-y-4">
          <p role="status" className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm leading-6 text-amber-100">
            You started enrolling {unverifiedCount === 1 ? "an authenticator" : "authenticators"} but
            never verified a code, so {unverifiedCount === 1 ? "it is" : "they are"} not active. An
            unfinished factor cannot be resumed — discard it and start again with a fresh QR code.
          </p>
          <button type="button" disabled={busy} onClick={() => void discardUnfinished()} className="btn btn-secondary">
            {busy ? "Discarding…" : "Discard unfinished setup"}
          </button>
        </div>
      )}

      {phase === "no-factor" && !enrollment && (
        <button type="button" disabled={busy} onClick={() => void enroll()} className="btn btn-primary mt-4">
          {busy ? "Preparing…" : "Generate setup QR code"}
        </button>
      )}

      {enrollment && (
        <div className="mt-6 space-y-4">
          <div className="flex flex-wrap items-start gap-5">
            {/* The QR is a data URL returned by Supabase Auth; it is not a remote image. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={enrollment.qr}
              alt="TOTP authenticator setup QR code"
              className="h-56 w-56 rounded-xl bg-white p-2"
            />
            <details className="min-w-0 flex-1 rounded-xl border border-white/10 p-4">
              <summary className="cursor-pointer font-semibold">Show manual setup key</summary>
              <p className="mt-3 break-all font-mono text-sm text-amber-200">{enrollment.secret}</p>
              <p className="mt-2 text-xs text-ink-400">
                Anyone with this key may generate your authentication codes. Keep it private.
              </p>
            </details>
          </div>
          <MfaVerifyForm
            factors={[{ id: enrollment.id, label: "Authenticator you are setting up" }]}
            submitLabel="Activate authenticator"
            onVerified={() => {
              setEnrollment(null);
              setNotice("Authenticator verified and active. This session is now at MFA level 2.");
              void inspect();
            }}
          />
        </div>
      )}

      {phase === "error" && (
        <div className="mt-5 space-y-3">
          <p role="alert" className="notice notice-error">
            {error}
          </p>
          <button type="button" onClick={() => void inspect()} className="btn btn-secondary">
            Try again
          </button>
        </div>
      )}

      {error && phase !== "error" && (
        <p role="alert" className="mt-5 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm leading-6 text-red-100">
          {error}
        </p>
      )}

      {notice && (
        <p role="status" className="mt-5 rounded-xl border border-brand-500/40 bg-brand-500/10 p-4 text-sm leading-6 text-brand-100">
          {notice}
        </p>
      )}
    </section>
  );
}
