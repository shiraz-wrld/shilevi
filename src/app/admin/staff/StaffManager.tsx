"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type StaffRow = {
  user_id: string;
  email: string;
  capability: string;
  granted_at: string;
  revoked_at: string | null;
};

const CAPABILITIES = [
  ["applications.review", "Review provider applications"],
  ["listings.moderate", "Moderate listings"],
  ["orders.read", "Read orders"],
  ["rides.manage", "Manage passenger trips"],
  ["properties.verify", "Verify House Hunt properties"],
  ["finance.read", "Read financial records"],
  ["finance.payout", "Release payouts"],
  ["users.suspend", "Suspend accounts"],
  ["settings.manage", "Change platform settings"],
  ["audit.read", "Read the audit log"],
] as const;

export function StaffManager({ initialRows, ownerEmail }: { initialRows: StaffRow[]; ownerEmail: string }) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [email, setEmail] = useState("");
  const [capability, setCapability] = useState<string>("applications.review");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function apply(targetEmail: string, targetCapability: string, grant: boolean) {
    setBusy(`${targetEmail}:${targetCapability}`);
    setError("");
    setMessage("");
    try {
      const db = createSupabaseBrowserClient();
      const { error: grantError } = await db.rpc("admin_grant_staff_capability", {
        p_email: targetEmail,
        p_capability: targetCapability,
        p_grant: grant,
      });
      if (grantError) throw grantError;
      setMessage(grant ? "Capability granted." : "Capability revoked.");
      const { data } = await db.rpc("admin_list_staff");
      setRows((data ?? []) as StaffRow[]);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The capability change could not be saved.");
    } finally {
      setBusy("");
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (email.trim().toLowerCase() === ownerEmail.toLowerCase()) {
      setError("Owner permissions already cover your own account.");
      return;
    }
    await apply(email.trim(), capability, true);
    setEmail("");
  }

  return (
    <div className="space-y-6">
      {message && <p role="status" className="rounded-2xl border border-emerald-800 bg-emerald-950/40 p-4 text-sm text-emerald-100">{message}</p>}
      {error && <p role="alert" className="rounded-2xl border border-red-800 bg-red-950/40 p-4 text-sm text-red-100">{error}</p>}

      <form onSubmit={submit} className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <h2 className="text-lg font-bold">Grant a capability</h2>
        <p className="mt-2 text-sm leading-6 text-slate-400">The account must already exist and have a confirmed email. Grant only the capability the person needs.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <label className="text-sm font-semibold text-slate-300">Staff email<input required type="email" value={email} onChange={event => setEmail(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 font-normal text-white" /></label>
          <label className="text-sm font-semibold text-slate-300">Capability<select value={capability} onChange={event => setCapability(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 font-normal text-white">{CAPABILITIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <button disabled={Boolean(busy)} className="self-end rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white disabled:opacity-50">Grant</button>
        </div>
      </form>

      <section>
        <h2 className="text-lg font-bold">Current assignments</h2>
        {rows.length === 0 ? (
          <p className="mt-3 rounded-2xl border border-slate-800 bg-slate-900 p-5 text-sm text-slate-300">No staff capabilities have been granted. Owners retain full access through the verified allowlist.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {rows.map(row => {
              const active = !row.revoked_at;
              return (
                <li key={`${row.user_id}:${row.capability}`} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900 p-4">
                  <div>
                    <p className="font-semibold text-slate-100">{row.email}</p>
                    <p className="mt-1 text-xs text-slate-400">{row.capability} · granted {new Date(row.granted_at).toLocaleDateString("en-KE")}{row.revoked_at ? ` · revoked ${new Date(row.revoked_at).toLocaleDateString("en-KE")}` : ""}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2 py-1 text-xs font-bold ${active ? "bg-emerald-950 text-emerald-200" : "bg-slate-800 text-slate-400"}`}>{active ? "active" : "revoked"}</span>
                    {active && <button onClick={() => void apply(row.email, row.capability, false)} disabled={Boolean(busy)} className="rounded-full border border-red-700 px-3 py-1 text-xs font-bold text-red-200 disabled:opacity-50">Revoke</button>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <p className="rounded-2xl border border-slate-800 bg-slate-900 p-5 text-xs leading-6 text-slate-400">
        Staff web sign-in is not enabled yet: the control centre currently requires an owner account. Capabilities are
        enforced by the database functions that will back staff actions, so a capability alone cannot grant browser
        access. Do not share an owner account to work around that.
      </p>
    </div>
  );
}
