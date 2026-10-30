import "server-only";

import type { Metadata } from "next";
import Link from "next/link";
import { requireOwnerAdmin } from "@/lib/admin/auth";
import { AdminShell } from "@/components/admin/AdminShell";
import AdminDeletionRequestsClient from "./AdminDeletionRequestsClient";

export const metadata: Metadata = { title: "Account deletions", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AdminDeletionRequestsPage() {
  const access = await requireOwnerAdmin();

  return (
    <AdminShell
      email={access.user.email ?? null}
      mfaLevel={access.mfaLevel}
      title="Account deletion requests"
      description="Owner-only review queue. Read the least data necessary, record a reasoned decision, and never copy account identifiers into public channels."
    >
      {access.mfaLevel === "aal2" ? (
        <AdminDeletionRequestsClient />
      ) : (
        <p className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-5 text-sm leading-6 text-amber-100">
          Deletion review requires MFA assurance level 2.{" "}
          <Link href="/admin/security" className="font-bold underline">
            Set up your authenticator
          </Link>
          , then reload this page.
        </p>
      )}
    </AdminShell>
  );
}
