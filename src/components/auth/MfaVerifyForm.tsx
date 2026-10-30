"use client";

import { FormEvent, useId, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export type VerifiableFactor = { id: string; label: string };

/**
 * Verifies a TOTP code against a real Supabase Auth factor and confirms the session really reached
 * aal2 before reporting success. A challenge is single-use and short-lived, so one is created per
 * submission; a wrong code only fails that attempt.
 */
export default function MfaVerifyForm({
  factors,
  onVerified,
  submitLabel = "Verify code",
}: {
  factors: VerifiableFactor[];
  onVerified: () => void;
  submitLabel?: string;
}) {
  const inputId = useId();
  const [factorId, setFactorId] = useState(factors[0]?.id ?? "");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function explain(failure: { message?: string; code?: string } | null | undefined) {
    const text = `${failure?.code ?? ""} ${failure?.message ?? ""}`.toLowerCase();
    if (text.includes("expired") || text.includes("challenge")) {
      return "That code challenge expired. Enter the code your authenticator shows now and try again.";
    }
    if (text.includes("invalid") || text.includes("totp") || text.includes("verification")) {
      return "That code was not accepted. Codes change every 30 seconds — use the current one from your authenticator.";
    }
    if (text.includes("rate") || text.includes("too many")) {
      return "Too many attempts. Wait a minute, then try the current code again.";
    }
    if (text.includes("fetch") || text.includes("network")) {
      return "Your authenticator could not be checked because the connection failed. Try again.";
    }
    return "The code could not be verified. Reload the page and try again.";
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = code.replace(/\s+/g, "");
    if (!/^\d{6,8}$/.test(value)) {
      setError("Enter the numeric code shown in your authenticator app.");
      return;
    }
    if (!factorId) {
      setError("No authenticator factor is available for this account.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const supabase = createSupabaseBrowserClient();
      const challenge = await supabase.auth.mfa.challenge({ factorId });
      if (challenge.error) throw challenge.error;

      const verified = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challenge.data.id,
        code: value,
      });
      if (verified.error) throw verified.error;

      // The auth library has already stored the upgraded session; refreshing makes the server
      // components see the aal2 claims on the very next request instead of the previous cookie.
      await supabase.auth.refreshSession();
      const assurance = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (assurance.error || assurance.data?.currentLevel !== "aal2") {
        setError("The code was accepted but this session is still below MFA level 2. Reload and verify again.");
        return;
      }

      setCode("");
      onVerified();
    } catch (cause) {
      setError(
        explain(
          cause && typeof cause === "object"
            ? { message: (cause as { message?: string }).message, code: (cause as { code?: string }).code }
            : null,
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {factors.length > 1 && (
        <fieldset className="space-y-2">
          <legend className="field-label">Authenticator</legend>
          {factors.map(factor => (
            <label key={factor.id} className="flex items-center gap-2 text-sm font-normal text-ink-700">
              <input
                type="radio"
                name="factor"
                value={factor.id}
                checked={factorId === factor.id}
                onChange={() => setFactorId(factor.id)}
              />
              {factor.label}
            </label>
          ))}
        </fieldset>
      )}

      <label htmlFor={inputId} className="field-label">
        Authenticator code
        <input
          id={inputId}
          value={code}
          onChange={event => setCode(event.target.value)}
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          maxLength={8}
          className="field mt-1.5 font-mono tracking-[0.3em]"
          placeholder="123456"
        />
      </label>

      <button type="submit" disabled={busy} className="btn btn-primary w-full">
        {busy ? "Checking code…" : submitLabel}
      </button>

      {error && (
        <p role="alert" className="notice notice-error">
          {error}
        </p>
      )}
    </form>
  );
}
