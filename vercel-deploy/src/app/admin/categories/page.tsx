import "server-only";

import type { Metadata } from "next";
import Link from "next/link";
import { requireOwnerAdmin } from "@/lib/admin/auth";
import { AdminShell } from "@/components/admin/AdminShell";
import AdminCategoriesClient from "./AdminCategoriesClient";

export const metadata: Metadata = { title: "Categories", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AdminCategoriesPage() {
  const access = await requireOwnerAdmin();

  return (
    <AdminShell
      email={access.user.email ?? null}
      mfaLevel={access.mfaLevel}
      title="Categories"
      description="The taxonomy that every listing, search filter and marketplace section depends on. Deactivating a category removes it from public browsing; categories that listings reference cannot be deleted."
    >
      {access.mfaLevel === "aal2" ? (
        <AdminCategoriesClient />
      ) : (
        <p className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-5 text-sm leading-6 text-amber-100">
          Category changes require MFA assurance level 2.{" "}
          <Link href="/admin/security" className="font-bold underline">
            Set up your authenticator
          </Link>
          , then reload this page. The current taxonomy is unchanged.
        </p>
      )}
    </AdminShell>
  );
}
