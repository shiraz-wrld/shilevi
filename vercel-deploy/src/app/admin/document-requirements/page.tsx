import "server-only";

import type { Metadata } from "next";
import Link from "next/link";
import { requireOwnerAdmin } from "@/lib/admin/auth";
import { AdminShell } from "@/components/admin/AdminShell";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { describeAdminReadFailure } from "@/lib/admin/errors";
import DocumentRequirementsClient, { type DocumentType } from "./DocumentRequirementsClient";

export const metadata: Metadata = {
  title: "Document requirements",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

export default async function DocumentRequirementsPage() {
  const access = await requireOwnerAdmin();
  const supabase = await createSupabaseServerClient();

  const [typesResult, pendingResult] = await Promise.all([
    supabase
      .from("delivery_document_types")
      .select("code,label,applies_to,is_required,is_active,sort_order")
      .order("sort_order", { ascending: true })
      .limit(200),
    supabase
      .from("delivery_documents")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending"),
  ]);

  const rows = (typesResult.data ?? []) as DocumentType[];
  const readProblem = typesResult.error
    ? describeAdminReadFailure("Document requirements", typesResult.error)
    : null;
  const pendingCount = pendingResult.error ? null : (pendingResult.count ?? 0);

  return (
    <AdminShell
      email={access.user.email ?? null}
      mfaLevel={access.mfaLevel}
      title="Document requirements"
      description="Which evidence each role must supply before approval. Every type ships optional: making a licence or an insurance certificate mandatory is your policy and legal decision, not a default this platform should invent."
    >
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-300">
          {pendingCount === null
            ? "Pending document reviews could not be counted."
            : `${pendingCount} document${pendingCount === 1 ? "" : "s"} awaiting review`}
        </p>
        <Link href="/admin/vehicles" className="text-sm font-bold text-brand-300 hover:text-brand-200">
          Review submitted documents →
        </Link>
      </div>

      {readProblem ? (
        <p role="alert" className="mb-5 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-5 text-sm leading-6 text-amber-100">
          {readProblem}
        </p>
      ) : (
        <DocumentRequirementsClient rows={rows} />
      )}
    </AdminShell>
  );
}
