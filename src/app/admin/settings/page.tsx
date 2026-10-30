import "server-only";

import type { Metadata } from "next";
import Link from "next/link";
import { requireOwnerAdmin } from "@/lib/admin/auth";
import { describeAdminReadFailure } from "@/lib/admin/errors";
import { AdminShell } from "@/components/admin/AdminShell";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PlatformSettingsForm, type SettingsMap } from "./PlatformSettingsForm";

export const metadata: Metadata = { title: "Fees & settings", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type SettingRow = { key: string; value: unknown; updated_at: string };

const DEFAULTS: SettingsMap = {
  currency: "KES",
  payment_mode: "live",
  commission_rate_bps: 0,
  delivery_commission_bps: 0,
  delivery_flat_fee_minor: 0,
};

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function asString(value: unknown): string | null {
  if (typeof value === "string") return value;
  return null;
}

export default async function AdminSettingsPage() {
  const access = await requireOwnerAdmin();

  if (access.mfaLevel !== "aal2") {
    return (
      <AdminShell
        email={access.user.email ?? null}
        mfaLevel={access.mfaLevel}
        title="Fees & settings"
        description="Commission, delivery fees and payment mode are money-moving configuration. They require an owner session at MFA assurance level 2."
      >
        <p className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-5 text-sm leading-6 text-amber-100">
          Enroll an authenticator in{" "}
          <Link href="/admin/security" className="font-bold underline">
            Security
          </Link>
          , verify it, then sign in again. No setting was changed.
        </p>
      </AdminShell>
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("get_admin_settings");
  const rows = (error ? [] : (data ?? [])) as SettingRow[];
  const byKey = new Map(rows.map(row => [row.key, row.value]));

  const settings: SettingsMap = {
    currency: asString(byKey.get("currency")) ?? DEFAULTS.currency,
    payment_mode: asString(byKey.get("payment_mode")) ?? "unknown",
    commission_rate_bps: asNumber(byKey.get("commission_rate_bps")) ?? DEFAULTS.commission_rate_bps,
    delivery_commission_bps: asNumber(byKey.get("delivery_commission_bps")) ?? DEFAULTS.delivery_commission_bps,
    delivery_flat_fee_minor: asNumber(byKey.get("delivery_flat_fee_minor")) ?? DEFAULTS.delivery_flat_fee_minor,
  };

  const updated = rows.reduce<string | null>((latest, row) => {
    if (!latest) return row.updated_at;
    return new Date(row.updated_at).getTime() > new Date(latest).getTime() ? row.updated_at : latest;
  }, null);

  return (
    <AdminShell
      email={access.user.email ?? null}
      mfaLevel={access.mfaLevel}
      title="Fees & settings"
      description="The money configuration every new order and ride is priced from. Values are read from platform_settings through an owner-guarded function; nothing here changes existing orders."
    >
      {error ? (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-5 text-sm leading-6 text-amber-100">
          <p role="alert" className="font-bold">{describeAdminReadFailure("Platform settings", error)} No setting was changed.</p>
        </div>
      ) : (
        <>
          <PlatformSettingsForm initial={settings} />
          <p className="mt-6 text-xs leading-6 text-ink-500">
            {rows.length} settings stored. Last change {updated ? new Date(updated).toLocaleString("en-KE") : "not recorded"}.
            Writes are attributed to your account in <span className="text-ink-300">platform_settings.updated_by</span>.
          </p>
        </>
      )}
    </AdminShell>
  );
}
