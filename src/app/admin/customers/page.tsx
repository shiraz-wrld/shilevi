import "server-only";

import type { Metadata } from "next";
import Link from "next/link";
import { requireStaffCapability } from "@/lib/admin/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AdminShell } from "@/components/admin/AdminShell";

export const metadata: Metadata = {
  title: "Customers",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

type CustomerRow = {
  user_id: string;
  email: string | null;
  display_name: string | null;
  country_code: string;
  roles: string;
  order_count: number;
  joined_at: string;
};

export default async function AdminCustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const result = await requireStaffCapability("orders.read");

  const params = await searchParams;
  const query = (params.q ?? "").trim().slice(0, 120);

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_list_customers", {
    p_search: query || null,
    p_limit: 100,
  });
  const customers = (data ?? []) as unknown as CustomerRow[];

  return (
    <AdminShell
      email={result.user.email ?? null}
      mfaLevel={result.mfaLevel}
      title="Customers"
      description="Account directory for support: display name, verified email, recorded roles and how many orders the account has placed. Phone numbers, addresses and payment details are not reproduced here. This screen is read-only — account closure goes through the deletion request workflow."
    >
      <form method="get" className="flex flex-wrap items-end gap-3" role="search">
        <label className="min-w-[16rem] flex-1 text-sm font-bold text-slate-200">
          Search by email or display name
          <input
            type="search"
            name="q"
            defaultValue={query}
            maxLength={120}
            placeholder="name@example.com"
            className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 font-normal text-white placeholder:text-slate-600"
          />
        </label>
        <button type="submit" className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white">
          Search
        </button>
        {query && (
          <Link href="/admin/customers" className="rounded-xl border border-slate-600 px-5 py-2.5 text-sm font-bold text-slate-200">
            Clear
          </Link>
        )}
      </form>

      {error ? (
        <p role="alert" className="mt-5 rounded-2xl border border-amber-800 bg-amber-950/40 p-5 text-sm leading-6 text-amber-100">
          Accounts could not be read. Nothing was changed. Reload once; if it persists, System health reports whether the cause is a missing migration, an MFA session or a missing capability.</p>
      ) : customers.length === 0 ? (
        <p className="mt-5 rounded-2xl border border-slate-800 bg-slate-900 p-6 text-sm leading-6 text-slate-300">
          {query
            ? `No account matches “${query}”. The search covers email and display name only.`
            : "No account has been created yet."}
        </p>
      ) : (
        <div className="mt-5 overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-800 text-xs font-bold uppercase tracking-wide text-slate-400">
              <tr>
                <th scope="col" className="px-4 py-3">Account</th>
                <th scope="col" className="px-4 py-3">Country</th>
                <th scope="col" className="px-4 py-3">Roles</th>
                <th scope="col" className="px-4 py-3 text-right">Orders</th>
                <th scope="col" className="px-4 py-3">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {customers.map(customer => (
                <tr key={customer.user_id}>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-slate-100">{customer.display_name ?? "No display name"}</p>
                    <p className="text-xs text-slate-400">{customer.email ?? "No email on record"}</p>
                    <p className="break-all font-mono text-[11px] text-slate-600">{customer.user_id}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-300">{customer.country_code}</td>
                  <td className="max-w-[14rem] px-4 py-3 text-xs text-slate-300">{customer.roles || "No role recorded"}</td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-100">{customer.order_count}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-400">
                    {new Date(customer.joined_at).toLocaleDateString("en-KE")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-4 text-xs leading-6 text-slate-500">
        Showing at most 100 accounts, newest first. A missing role means no row was ever written in
        user_roles; it does not imply the account is a customer.
      </p>
    </AdminShell>
  );
}
