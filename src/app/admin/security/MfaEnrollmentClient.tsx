"use client";

import { FormEvent, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Enrollment = { id: string; qr: string; secret: string };

export default function MfaEnrollmentClient() {
  const [factor, setFactor] = useState<Enrollment | null>(null);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  async function enroll() {
    setBusy(true); setMessage(""); setError(false);
    try {
      const supabase = createSupabaseBrowserClient();
      const { data: listed, error: listError } = await supabase.auth.mfa.listFactors();
      if (listError) throw listError;
      if (listed.totp.some((item) => item.status === "verified")) {
        setMessage("A verified authenticator already exists. Sign out and sign in again to refresh your MFA session.");
        return;
      }
      const { data, error: enrollError } = await supabase.auth.mfa.enroll({ factorType: "totp", issuer: "Shilevi Owner Admin" });
      if (enrollError) throw enrollError;
      if (!data.totp?.qr_code || !data.totp.secret) throw new Error("The Auth service did not return a QR code and setup key.");
      setFactor({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
      setMessage("Scan the QR code with your authenticator app, then verify the current code below.");
    } catch (cause) {
      setError(true); setMessage(cause instanceof Error ? cause.message : "Could not enroll an authenticator.");
    } finally { setBusy(false); }
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!factor) return;
    const value = code.trim();
    if (!/^\d{6,8}$/.test(value)) { setError(true); setMessage("Enter the numeric code currently shown in your authenticator."); return; }
    setBusy(true); setError(false); setMessage("");
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: value });
      if (verifyError) throw verifyError;
      setFactor(null); setCode("");
      setMessage("Authenticator verified. Refresh your session if the admin dashboard still reports aal1.");
    } catch (cause) {
      setError(true); setMessage(cause instanceof Error ? cause.message : "Verification failed. Check the code and try again.");
    } finally { setBusy(false); }
  }

  return <section className="mt-8 rounded-2xl border border-slate-800 bg-slate-900 p-6"><h2 className="text-xl font-bold">Authenticator (TOTP)</h2><p className="mt-2 text-sm leading-6 text-slate-300">Use a trusted authenticator app. Keep the setup key private. This flow uses the signed-in Supabase Auth session, not a service-role key.</p><button type="button" disabled={busy} onClick={() => void enroll()} className="mt-4 rounded-full bg-blue-600 px-5 py-3 font-bold disabled:opacity-50">{busy ? "Please wait…" : "Generate setup QR code"}</button>{factor && <div className="mt-6 space-y-4"><img src={factor.qr} alt="TOTP authenticator setup QR code" className="h-56 w-56 rounded-xl bg-white p-2" /><details className="rounded-xl border border-slate-700 p-4"><summary className="cursor-pointer font-semibold">Show manual setup key</summary><p className="mt-3 break-all font-mono text-sm text-amber-200">{factor.secret}</p><p className="mt-2 text-xs text-slate-400">Anyone with this key may generate your authentication codes. Keep it private.</p></details><form onSubmit={(event) => void verify(event)} className="space-y-3"><label htmlFor="mfa-code" className="block text-sm font-semibold">Current authenticator code</label><input id="mfa-code" value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={8} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white" placeholder="123456" /><button disabled={busy} className="rounded-full bg-white px-5 py-3 font-bold text-slate-950 disabled:opacity-50">{busy ? "Verifying…" : "Verify authenticator"}</button></form></div>}{message && <p role="status" className={`mt-5 rounded-xl border p-4 text-sm leading-6 ${error ? "border-red-800 bg-red-950/40 text-red-200" : "border-blue-800 bg-blue-950/40 text-blue-100"}`}>{message}</p>}</section>;
}
