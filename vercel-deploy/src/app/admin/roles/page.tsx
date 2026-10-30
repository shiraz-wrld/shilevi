import "server-only";

import type { Metadata } from "next";
import Link from "next/link";
import { requireOwnerAdmin } from "@/lib/admin/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AdminShell } from "@/components/admin/AdminShell";

export const metadata: Metadata = {
  title: "Role assignments",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

type RoleRow = {
  user_id: string;
  email: string | null;
  role: string;
  granted_at: string;
};

const roleTone: Record<string, string> = {
  admin: "border-red-500/40 bg-red-500/10 text-red-200",
  super_admin: "border-red-500/40 bg-red-500/10 text-red-200",
  staff: "border-amber-500/40 bg-amber-500/10 text-amber-200",
  transport_partner: "border-blue-500/40 bg-blue-500/10 text-blue-200",
  product_seller: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
  service_provider: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
  property_provider: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
  customer: "border-slate-600 bg-slate-800 text-slate-200",
};

export default async function AdminRolesPage() {
  const result = await requireOwnerAdmin();

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_list_role_assignments", { p_limit: 300 });
  const rows = (data ?? []) as unknown as RoleRow[];

  const byRole = rows.reduce<Record<string, number>>((totals, row) => {
    totals[row.role] = (totals[row.role] ?? 0) + 1;
    return totals;
  }, {});

  return (
    <AdminShell
      email={result.user.email ?? null}
      mfaLevel={result.mfaLevel}
      title="Role assignments"
      description="Marketplace roles recorded in user_roles. A role row is descriptive: privileged operations are gated by the owner allowlist, MFA and named staff capabilities, never by a role name alone. This screen is read-only — roles are granted by the workflows that own them."
    >
      {error ? (
        <p role="alert" className="rounded-2xl border border-amber-800 bg-amber-950/40 p-5 text-sm leading-6 text-amber-100">
          Roles could not be read. Nothing was changed. Reload once; if it persists, System health reports whether the cause is a missing migration, an MFA session or a missing capability.</p>
      ) : rows.length === 0 ? (
        <p className="rounded-2xl border border-slate-800 bg-slate-900 p-6 text-sm leading-6 text-slate-300">
          No role has been recorded yet. The database trigger that creates a customer role row may not
          have run, or no account has completed onboarding.
        </p>
      ) : (
        <>
          <section className="flex flex-wrap gap-2">
            {Object.entries(byRole)
              .sort((a, b) => b[1] - a[1])
              .map(([role, count]) => (
                <span key={role} className={`rounded-full border px-3 py-1 text-xs font-bold ${roleTone[role] ?? "border-slate-700 text-slate-300"}`}>
                  {role.replaceAll("_", " ")} · {count}
                </span>
              ))}
          </section>

          <div className="mt-5 overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-800 text-xs font-bold uppercase tracking-wide text-slate-400">
                <tr>
                  <th scope="col" className="px-4 py-3">Account</th>
                  <th scope="col" className="px-4 py-3">Role</th>
                  <th scope="col" className="px-4 py-3">Granted</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {rows.map(row => (
                  <tr key={`${row.user_id}-${row.role}`}>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-slate-100">{row.email ?? "No email on record"}</p>
                      <p className="break-all font-mono text-[11px] text-slate-600">{row.user_id}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${roleTone[row.role] ?? "border-slate-700 text-slate-300"}`}>
                        {row.role.replaceAll("_", " ")}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-400">
                      {new Date(row.granted_at).toLocaleString("en-KE")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-4 max-w-3xl text-xs leading-6 text-slate-500">
            Staff capabilities are a separate, revocable grant. Manage them in{" "}
            <Link href="/admin/staff" className="font-semibold text-blue-300 hover:text-blue-200">Staff access</Link>.
            Holding an admin role does not grant a capability and does not bypass the owner allowlist.
          </p>
        </>
      )}
    </AdminShell>
  );
}
