import "server-only";

import type { Metadata } from "next";
import Link from "next/link";
import { requireOwnerAdmin } from "@/lib/admin/auth";
import { describeAdminReadFailure } from "@/lib/admin/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AdminShell } from "@/components/admin/AdminShell";
import {
  hasServiceRole,
  isMpesaB2cConfigured,
  isMpesaConfigured,
  isResendConfigured,
} from "@/lib/env.server";

export const metadata: Metadata = {
  title: "System health",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

type Check = { label: string; ok: boolean | null; detail: string };

export default async function AdminSystemHealthPage() {
  const result = await requireOwnerAdmin();

  const supabase = await createSupabaseServerClient();

  const [settingsResult, checkoutResult, mockResult, onboardingResult] = await Promise.all([
    supabase.from("platform_settings").select("key", { count: "exact", head: true }),
    supabase.rpc("get_checkout_settings"),
    supabase.rpc("mock_payments_allowed"),
    supabase.rpc("admin_onboarding_overview"),
  ]);

  const checkout = (Array.isArray(checkoutResult.data) ? checkoutResult.data[0] : checkoutResult.data) as
    | { currency?: string; payment_mode?: string }
    | null
    | undefined;

  const migrations: Check[] = [
    {
      label: "Core tables reachable",
      ok: settingsResult.error ? false : true,
      detail: settingsResult.error
        ? describeAdminReadFailure("The platform settings table", settingsResult.error)
        : `${settingsResult.count ?? 0} platform setting rows`,
    },
    {
      label: "Checkout pricing functions (0017, 0023, 0027)",
      ok: checkoutResult.error ? false : true,
      detail: checkoutResult.error
        ? describeAdminReadFailure("Checkout pricing", checkoutResult.error)
        : `Payment mode ${checkout?.payment_mode ?? "unknown"} · currency ${checkout?.currency ?? "KES"}`,
    },
    {
      label: "Sandbox switch (0023)",
      ok: mockResult.error ? null : mockResult.data === true,
      detail: mockResult.error
        ? describeAdminReadFailure("The sandbox payment switch", mockResult.error)
        : mockResult.data === true
          ? "Sandbox payments are ON. Every payment recorded now is simulated."
          : "Sandbox payments are OFF. Live providers must be configured before a charge can start.",
    },
    {
      label: "Owner console read models (0028)",
      ok: onboardingResult.error ? false : true,
      detail: onboardingResult.error
        ? describeAdminReadFailure("Owner console read models", onboardingResult.error)
        : "Directory, delivery, enquiry, review and coverage screens can read their data.",
    },
  ];

  const configuration: Check[] = [
    {
      label: "Supabase public URL and publishable key",
      ok: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
      detail: "Required for every authenticated request.",
    },
    {
      label: "Supabase service role key",
      ok: hasServiceRole(),
      detail: hasServiceRole()
        ? "Present. Used only by callbacks, payouts and the notification dispatcher."
        : "Missing. Provider callbacks, payout settlement and notification dispatch will refuse to run.",
    },
    {
      label: "M-Pesa STK Push",
      ok: isMpesaConfigured(),
      detail: isMpesaConfigured()
        ? "Credentials present. This does not prove production approval; run a controlled live test."
        : "Missing. Checkout fails closed instead of pretending to charge.",
    },
    {
      label: "M-Pesa B2C payouts",
      ok: isMpesaB2cConfigured(),
      detail: isMpesaB2cConfigured()
        ? "Credentials present. Withdrawals can be dispatched by an owner."
        : "Missing. Withdrawal requests stay pending.",
    },
    {
      label: "Transactional email (Resend)",
      ok: isResendConfigured(),
      detail: isResendConfigured()
        ? "API key present. Delivery still depends on a verified sending domain."
        : "Missing. Outbox rows are queued but cannot be delivered.",
    },
    {
      label: "Notification dispatch secret",
      ok: Boolean(process.env.NOTIFICATION_DISPATCH_SECRET),
      detail: "Protects the scheduled dispatch route from public calls.",
    },
  ];

  return (
    <AdminShell
      email={result.user.email ?? null}
      mfaLevel={result.mfaLevel}
      title="System health"
      description="What this deployment can actually do right now. Presence of a credential is not proof of approval or delivery, and a passing database check is not a live end-to-end test. Values are never shown — only whether they are configured."
    >
      <section aria-labelledby="database">
        <h2 id="database" className="text-lg font-black text-slate-100">Database readiness</h2>
        <ul className="mt-3 space-y-2">
          {migrations.map(check => (
            <li key={check.label} className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-bold text-slate-100">{check.label}</p>
                <span className={`rounded-full border px-3 py-1 text-xs font-bold ${check.ok === true ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200" : check.ok === false ? "border-red-500/40 bg-red-500/10 text-red-200" : "border-amber-500/40 bg-amber-500/10 text-amber-200"}`}>
                  {check.ok === true ? "Working" : check.ok === false ? "Failing" : "Sandbox on"}
                </span>
              </div>
              <p className="mt-1 text-sm leading-6 text-slate-400">{check.detail}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="configuration" className="mt-8">
        <h2 id="configuration" className="text-lg font-black text-slate-100">Configuration</h2>
        <ul className="mt-3 space-y-2">
          {configuration.map(check => (
            <li key={check.label} className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-bold text-slate-100">{check.label}</p>
                <span className={`rounded-full border px-3 py-1 text-xs font-bold ${check.ok ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200" : "border-amber-500/40 bg-amber-500/10 text-amber-200"}`}>
                  {check.ok ? "Configured" : "Not configured"}
                </span>
              </div>
              <p className="mt-1 text-sm leading-6 text-slate-400">{check.detail}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8 rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <h2 className="text-lg font-black text-slate-100">What this page cannot tell you</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-400">
          <li>Whether the hosted database has every migration applied in the correct order — run the schema verifier in the SQL editor for that.</li>
          <li>Whether email was delivered to a real inbox. Only a test send to a controlled address proves that.</li>
          <li>Whether a payment reached a real M-Pesa or card account. Only a controlled live test proves that.</li>
          <li>Whether storage buckets are reachable from the browser — that is a storage policy check, not an environment variable.</li>
        </ul>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/admin/payments/providers" className="rounded-xl border border-slate-600 px-4 py-2 text-sm font-bold text-slate-100 hover:border-slate-400">
            Payment methods
          </Link>
          <Link href="/admin/security" className="rounded-xl border border-slate-600 px-4 py-2 text-sm font-bold text-slate-100 hover:border-slate-400">
            Security &amp; MFA
          </Link>
          <Link href="/admin/notifications" className="rounded-xl border border-slate-600 px-4 py-2 text-sm font-bold text-slate-100 hover:border-slate-400">
            Notification outbox
          </Link>
        </div>
      </section>
    </AdminShell>
  );
}
