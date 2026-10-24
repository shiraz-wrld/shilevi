import "server-only";

import type { Metadata } from "next";
import { requireOwnerAdmin } from "@/lib/admin/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AdminAccessDenied, AdminShell } from "@/components/admin/AdminShell";
import { StaffManager } from "./StaffManager";

export const metadata: Metadata = {
  title: "Staff access",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

type StaffRow = {
  user_id: string;
  email: string;
  capability: string;
  granted_at: string;
  revoked_at: string | null;
};

export default async function AdminStaffPage() {
  const result = await requireOwnerAdmin();
  if (!result.authorized) return <AdminAccessDenied reason={result.reason} />;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_list_staff");
  const rows = (data ?? []) as StaffRow[];

  return (
    <AdminShell
      email={result.user.email ?? null}
      mfaLevel={result.mfaLevel}
      title="Staff access"
      description="Grant narrow, named capabilities to confirmed accounts. Capabilities are enforced by database functions; they are never inferred from a job title or a client-side flag."
    >
      {error ? (
        <p role="alert" className="rounded-2xl border border-amber-800 bg-amber-950/40 p-5 text-sm leading-6 text-amber-100">
          Staff capabilities could not be read. Apply migration 0021 and confirm MFA level 2.
        </p>
      ) : (
        <StaffManager initialRows={rows} ownerEmail={result.user.email ?? ""} />
      )}
    </AdminShell>
  );
}
