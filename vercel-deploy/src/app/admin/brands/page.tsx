import "server-only";

import type { Metadata } from "next";
import Link from "next/link";
import { requireOwnerAdmin } from "@/lib/admin/auth";
import { AdminShell } from "@/components/admin/AdminShell";
import AdminBrandsClient from "./AdminBrandsClient";

export const metadata: Metadata = { title: "Brands", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AdminBrandsPage() {
  const access = await requireOwnerAdmin();

  return (
    <AdminShell
      email={access.user.email ?? null}
      mfaLevel={access.mfaLevel}
      title="Brands"
      description="Create and manage real brand storefronts. A brand record is a directory entry, not an endorsement; featuring a brand places it on the public homepage."
    >
      {access.mfaLevel === "aal2" ? (
        <AdminBrandsClient />
      ) : (
        <p className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-5 text-sm leading-6 text-amber-100">
          Brand changes require MFA assurance level 2.{" "}
          <Link href="/admin/security" className="font-bold underline">
            Set up your authenticator
          </Link>
          , then reload this page. Existing brands are untouched.
        </p>
      )}
    </AdminShell>
  );
}
