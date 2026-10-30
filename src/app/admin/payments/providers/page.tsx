import "server-only";

import type { Metadata } from "next";
import Link from "next/link";
import { requireOwnerAdmin } from "@/lib/admin/auth";
import { describeAdminReadFailure } from "@/lib/admin/errors";
import { AdminShell } from "@/components/admin/AdminShell";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { providerReadinessReport, payoutReadiness, type PaymentProviderId } from "@/lib/payments/providers";
import { PaymentMethodSettings } from "./PaymentMethodSettings";

export const metadata: Metadata = {
  title: "Payment methods",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

type MethodRow = { provider: string; enabled: boolean };

export default async function PaymentMethodsPage() {
  const access = await requireOwnerAdmin();
  if (access.mfaLevel !== "aal2") {
    return (
      <AdminShell
        email={access.user.email ?? null}
        mfaLevel={access.mfaLevel}
        title="Payment methods require MFA"
        description="Payment configuration decides what customers can be charged with, so it requires an owner session at MFA assurance level 2."
      >
        <p className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-5 text-sm leading-6 text-amber-100">
          Enroll an authenticator in{" "}
          <Link href="/admin/security" className="font-bold underline">
            Security
          </Link>
          , verify it, then sign in again. No payment method was changed.
        </p>
      </AdminShell>
    );
  }

  const supabase = await createSupabaseServerClient();
  const [methodResult, settingResult] = await Promise.all([
    supabase.from("payment_methods").select("provider,enabled").order("sort_order"),
    supabase
      .from("platform_settings")
      .select("key,value")
      .in("key", ["payment_mode", "allow_mock_payments"]),
  ]);

  if (methodResult.error) {
    return (
      <AdminShell
        email={access.user.email ?? null}
        mfaLevel={access.mfaLevel}
        title="Payment methods are unavailable"
        description="The payment-method registry could not be read, so no method can be trusted or changed from here."
      >
        <p role="alert" className="rounded-2xl border border-amber-800 bg-amber-950/40 p-5 text-sm leading-6 text-amber-100">
          {describeAdminReadFailure("The payment-method registry", methodResult.error)} No payment
          setting was changed.
        </p>
      </AdminShell>
    );
  }

  const settings = Object.fromEntries(
    (settingResult.data ?? []).map(row => [String(row.key), row.value]),
  );
  const mode = typeof settings.payment_mode === "string" ? settings.payment_mode : "unknown";
  const allowMock = settings.allow_mock_payments === true;
  const mockAllowed = allowMock && mode === "mock";

  const enabledByProvider = new Map(
    ((methodResult.data ?? []) as MethodRow[]).map(row => [row.provider, row.enabled]),
  );

  const rows = providerReadinessReport({ mockAllowed }).map(status => ({
    provider: status.provider as PaymentProviderId,
    label: status.label,
    enabled: enabledByProvider.get(status.provider) ?? false,
    configured: status.configured,
    blocker: status.blocker,
    sandbox: status.sandbox,
  }));

  const payouts = payoutReadiness();

  return (
    <AdminShell
      email={access.user.email ?? null}
      mfaLevel={access.mfaLevel}
      title="Payment methods"
      description="Enabled records what the marketplace offers. A method becomes chargeable only when the deployment also holds its server credentials, so a toggle alone can never make an unconfigured provider look operational."
    >
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Link href="/admin/payments" className="font-semibold text-blue-300 hover:text-blue-200">
          ← Payments and payouts
        </Link>
        <span className="rounded-full border border-slate-700 px-3 py-1 text-slate-300">
          Payment mode: <strong className="text-slate-100">{mode}</strong>
        </span>
        <span className="rounded-full border border-slate-700 px-3 py-1 text-slate-300">
          Sandbox switch: <strong className="text-slate-100">{allowMock ? "on" : "off"}</strong>
        </span>
      </div>

      <PaymentMethodSettings rows={rows} />

      <section className="mt-8 rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <h2 className="text-lg font-black text-slate-100">Withdrawals (M-Pesa B2C)</h2>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          {payouts.configured
            ? "B2C credentials are present. Payouts still require an owner dispatch decision and must be reconciled against the provider statement."
            : payouts.blocker}
        </p>
      </section>

      <section className="mt-6 rounded-2xl border border-amber-800 bg-amber-950/40 p-5 text-sm leading-6 text-amber-100">
        <h2 className="text-base font-black">Before real money moves</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>Configure the provider credentials in the hosting environment, never in the database.</li>
          <li>Confirm the provider has approved the merchant account and callback URLs.</li>
          <li>Run one low-value live transaction and reconcile it against the provider statement.</li>
          <li>Turn the sandbox switch off and confirm the site refuses sandbox settlement.</li>
        </ol>
      </section>
    </AdminShell>
  );
}
