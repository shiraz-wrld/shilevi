import Link from "next/link";
import { requireOwnerAdmin } from "@/lib/admin/auth";
import MfaEnrollmentClient from "./MfaEnrollmentClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Owner security | Shilevi", robots: { index: false, follow: false } };

/**
 * The one console page reachable at aal1, because an owner with no authenticator has to enrol
 * before any other page can be read. Every other console route sends aal1 here.
 */
export default async function AdminSecurityPage() {
  const access = await requireOwnerAdmin({ allowAal1: true });
  const verified = access.mfaLevel === "aal2";

  return (
    <main className="min-h-screen bg-ink-950 px-5 py-10 text-white">
      <div className="mx-auto max-w-2xl">
        <Link href="/admin" className="text-sm font-bold text-brand-300">
          ← Back to control center
        </Link>
        <p className="mt-8 text-sm font-bold uppercase tracking-widest text-brand-300">Owner security</p>
        <h1 className="mt-3 text-4xl font-black">Authenticator setup</h1>
        <p className="mt-4 leading-7 text-ink-300">
          Category, brand, listing, payout and staff management all require MFA assurance level 2, and
          the database enforces that on every request. This page is the only console surface reachable
          before verification.
        </p>

        <section className="mt-8 rounded-2xl border border-white/10 bg-ink-900 p-6">
          <h2 className="text-xl font-bold">Current session</h2>
          <p className="mt-3 text-ink-300">
            MFA assurance: <strong>{access.mfaLevel}</strong>
          </p>
          <p className="mt-3 text-sm leading-6 text-ink-400">
            {verified
              ? "This session has completed two-step verification. The rest of the console is available."
              : "This session has not completed two-step verification. Verify the authenticator below, then the rest of the console unlocks — no sign-out is needed."}
          </p>
          {!verified && (
            <Link href="/login/mfa?next=%2Fadmin" className="mt-4 inline-block text-sm font-bold text-brand-300 underline">
              Open the verification screen
            </Link>
          )}
        </section>

        <MfaEnrollmentClient />
      </div>
    </main>
  );
}
