import "server-only";

import type { Metadata } from "next";
import Link from "next/link";
import { requireOwnerAdmin } from "@/lib/admin/auth";
import { AdminShell } from "@/components/admin/AdminShell";
import AdminListingsClient from "./AdminListingsClient";

export const metadata: Metadata = { title: "Listings", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AdminListingsPage() {
  const access = await requireOwnerAdmin();

  return (
    <AdminShell
      email={access.user.email ?? null}
      mfaLevel={access.mfaLevel}
      title="Listings"
      description="Moderate draft and published listings. Publishing requires an approved provider and an active category; featuring is a separate, reversible decision and never implies an endorsement."
    >
      {access.mfaLevel === "aal2" ? (
        <AdminListingsClient />
      ) : (
        <p className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-5 text-sm leading-6 text-amber-100">
          Listing moderation requires MFA assurance level 2.{" "}
          <Link href="/admin/security" className="font-bold underline">
            Set up your authenticator
          </Link>
          , then reload this page. No listing was changed.
        </p>
      )}
    </AdminShell>
  );
}
