import { requireOwnerAdmin } from "@/lib/admin/auth";
import AdminApplicationsClient from "./AdminApplicationsClient";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata = { title: "Provider applications | Shilevi" };

export default async function AdminApplicationsPage() {
  const access = await requireOwnerAdmin();
  if (!access.authorized) return <main className="min-h-screen bg-slate-950 p-8 text-white"><h1 className="text-2xl font-black">Access denied</h1><Link href="/admin" className="mt-4 inline-block text-blue-300">Return to admin</Link></main>;
  if (access.mfaLevel !== "aal2") return <main className="min-h-screen bg-slate-950 p-8 text-white"><h1 className="text-2xl font-black">Owner MFA required</h1><p className="mt-3 max-w-xl leading-7 text-slate-300">Provider review requires MFA assurance level 2. Open the security setup page and verify your authenticator first.</p><Link href="/admin/security" className="mt-4 inline-block text-blue-300">Open security setup →</Link></main>;
  return <AdminApplicationsClient />;
}
