import "server-only";

import type { Metadata } from "next";
import Link from "next/link";
import { requireOwnerAdmin } from "@/lib/admin/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AdminShell } from "@/components/admin/AdminShell";
import { formatMoney } from "@/lib/money";

export const metadata: Metadata = {
  title: "Commission rules",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

type CommissionRule = {
  id: string;
  slug: string;
  name: string;
  scope: string;
  division: string | null;
  transaction_type: string | null;
  rate_bps: number;
  min_commission_minor: number;
  max_commission_minor: number | null;
  effective_from: string;
  effective_to: string | null;
  is_active: boolean;
};

type CommissionTier = {
  id: string;
  rule_id: string;
  min_base_minor: number;
  max_base_minor: number | null;
  rate_bps: number;
};

function bps(rate: number): string {
  return `${(Number(rate) / 100).toFixed(2)}%`;
}

export default async function AdminCommissionPage() {
  const result = await requireOwnerAdmin();

  const supabase = await createSupabaseServerClient();
  const [rulesResult, tiersResult] = await Promise.all([
    supabase
      .from("commission_rules")
      .select("id,slug,name,scope,division,transaction_type,rate_bps,min_commission_minor,max_commission_minor,effective_from,effective_to,is_active")
      .order("effective_from", { ascending: false })
      .limit(100),
    supabase
      .from("commission_tiers")
      .select("id,rule_id,min_base_minor,max_base_minor,rate_bps")
      .order("min_base_minor", { ascending: true })
      .limit(300),
  ]);

  const rules = (rulesResult.data ?? []) as CommissionRule[];
  const tiers = (tiersResult.data ?? []) as CommissionTier[];
  const readFailed = Boolean(rulesResult.error || tiersResult.error);

  return (
    <AdminShell
      email={result.user.email ?? null}
      mfaLevel={result.mfaLevel}
      title="Commission rules"
      description="The commission rules the database prices against, with their basis-point rate, minimum and maximum and effective window. The commission rate is an unresolved business decision; the global rate used at checkout is configured in Fees & settings. These rows are read-only here."
    >
      {readFailed ? (
        <p role="alert" className="rounded-2xl border border-amber-800 bg-amber-950/40 p-5 text-sm leading-6 text-amber-100">
          Commission rules could not be read. Nothing was changed. Reload once; if it persists, System health reports whether the cause is a missing migration, an MFA session or a missing capability.</p>
      ) : rules.length === 0 ? (
        <p className="rounded-2xl border border-slate-800 bg-slate-900 p-6 text-sm leading-6 text-slate-300">
          No commission rule exists. Migration 0017 seeds a global rule; an empty list means the migration
          did not complete and pricing must not be trusted.
        </p>
      ) : (
        <>
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <h2 className="text-lg font-black text-slate-100">Active rules</h2>
            <ul className="mt-3 space-y-3">
              {rules.map(rule => {
                const ruleTiers = tiers.filter(tier => tier.rule_id === rule.id);
                return (
                  <li key={rule.id} className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-bold text-slate-100">
                          {rule.name}
                          <span className={`ml-2 rounded-full border px-2 py-0.5 text-xs font-bold ${rule.is_active ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200" : "border-slate-600 bg-slate-800 text-slate-300"}`}>
                            {rule.is_active ? "Active" : "Inactive"}
                          </span>
                        </p>
                        <p className="mt-1 text-xs text-slate-400">
                          {rule.slug} · scope {rule.scope}
                          {rule.division ? ` · ${rule.division.replaceAll("_", " ")}` : ""}
                          {rule.transaction_type ? ` · ${rule.transaction_type}` : ""}
                        </p>
                      </div>
                      <p className="text-lg font-black text-slate-100">{bps(rule.rate_bps)}</p>
                    </div>
                    <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-4">
                      <div>
                        <dt className="text-slate-500">Minimum</dt>
                        <dd className="font-semibold text-slate-200">{formatMoney(rule.min_commission_minor, "KES")}</dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">Maximum</dt>
                        <dd className="font-semibold text-slate-200">
                          {rule.max_commission_minor === null ? "No cap" : formatMoney(rule.max_commission_minor, "KES")}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">Effective from</dt>
                        <dd className="font-semibold text-slate-200">
                          {new Date(rule.effective_from).toLocaleDateString("en-KE")}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">Effective to</dt>
                        <dd className="font-semibold text-slate-200">
                          {rule.effective_to ? new Date(rule.effective_to).toLocaleDateString("en-KE") : "Open"}
                        </dd>
                      </div>
                    </dl>
                    {ruleTiers.length > 0 && (
                      <div className="mt-3">
                        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Tiers</p>
                        <ul className="mt-1 space-y-1 text-xs text-slate-300">
                          {ruleTiers.map(tier => (
                            <li key={tier.id}>
                              {formatMoney(tier.min_base_minor, "KES")} –{" "}
                              {tier.max_base_minor === null ? "no upper bound" : formatMoney(tier.max_base_minor, "KES")}{" "}
                              → <span className="font-bold text-slate-100">{bps(tier.rate_bps)}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          <p className="mt-5 max-w-3xl text-xs leading-6 text-slate-500">
            Commission is snapshotted onto an order or trip when it is created, so changing a rate never
            rewrites history. To change the rate checkout uses, open{" "}
            <Link href="/admin/settings" className="font-semibold text-blue-300 hover:text-blue-200">Fees &amp; settings</Link>{" "}
            — it is an owner-only, range-checked write that applies to the next priced order.
          </p>
        </>
      )}
    </AdminShell>
  );
}
