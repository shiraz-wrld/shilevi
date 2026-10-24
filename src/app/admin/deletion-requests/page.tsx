import Link from "next/link";
import { requireOwnerAdmin } from "@/lib/admin/auth";
import AdminDeletionRequestsClient from "./AdminDeletionRequestsClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Account deletion requests | Shilevi" };

export default async function AdminDeletionRequestsPage() {
  const access = await requireOwnerAdmin();
  if (!access.authorized) return <main className="min-h-screen bg-slate-950 p-8 text-white"><h1 className="text-2xl font-black">Access denied</h1><p className="mt-3 text-slate-300">Only the two verified owner accounts can access this page.</p><Link href="/admin" className="mt-4 inline-block text-blue-300">Return to admin</Link></main>;
  if (access.mfaLevel !== "aal2") return <main className="min-h-screen bg-slate-950 p-8 text-white"><h1 className="text-2xl font-black">Owner MFA required</h1><p className="mt-3 max-w-xl leading-7 text-slate-300">Reviewing deletion requests requires MFA assurance level 2. Set up and verify an authenticator, then refresh your session.</p><Link href="/admin/security" className="mt-4 inline-block text-blue-300">Open security setup →</Link></main>;
  return <AdminDeletionRequestsClient />;
}
