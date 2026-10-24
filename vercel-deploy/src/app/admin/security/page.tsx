import { requireOwnerAdmin } from "@/lib/admin/auth";
import MfaEnrollmentClient from "./MfaEnrollmentClient";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata = { title: "Owner security | Shilevi" };

export default async function AdminSecurityPage() {
  const access = await requireOwnerAdmin();
  if (!access.authorized) {
    return <main className="min-h-screen bg-slate-950 p-8 text-white"><h1 className="text-2xl font-black">Access denied</h1><p className="mt-3 text-slate-300">Only the two verified owner accounts can access security setup.</p><Link href="/" className="mt-5 inline-block text-blue-300">Return to Shilevi</Link></main>;
  }
  return <main className="min-h-screen bg-slate-950 px-5 py-10 text-white"><div className="mx-auto max-w-2xl"><Link href="/admin" className="text-sm font-bold text-blue-300">← Back to control center</Link><p className="mt-8 text-sm font-bold uppercase tracking-widest text-blue-300">Owner security</p><h1 className="mt-3 text-4xl font-black">Authenticator setup</h1><p className="mt-4 leading-7 text-slate-300">Only the two verified owner accounts can access this page. Category, brand and listing management still require MFA assurance level 2 and database-enforced RLS.</p><section className="mt-8 rounded-2xl border border-slate-800 bg-slate-900 p-6"><h2 className="text-xl font-bold">Current session</h2><p className="mt-3 text-slate-300">MFA assurance: <strong>{access.mfaLevel}</strong></p><p className="mt-3 text-sm leading-6 text-slate-400">After verification, return to the admin dashboard. If it still shows aal1, sign out and sign in again. Keep your authenticator and recovery options secure.</p></section><MfaEnrollmentClient /></div></main>;
}
