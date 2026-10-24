import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { requireUser } from "@/lib/auth/guards";

export const metadata: Metadata = {
  title: "Rider workspace",
  description: "Claim delivery jobs, update delivery status and review completed jobs as a Shilevi transport partner.",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

export default async function RiderHomePage() {
  const user = await requireUser("/rider");

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <SiteHeader />
      <main id="main-content" className="mx-auto max-w-5xl px-5 py-12 sm:px-6">
        <p className="text-sm font-bold uppercase tracking-wide text-blue-700">Rider workspace</p>
        <h1 className="mt-2 text-4xl font-black tracking-tight">Deliveries, without the guesswork</h1>
        <p className="mt-4 max-w-2xl text-lg leading-8 text-slate-600">
          Signed in as <span className="font-semibold text-slate-900">{user.email ?? "your account"}</span>. Jobs show a
          pick-up area before you accept. The exact address appears only after you take the job.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <Link href="/rider/rides" className="rounded-2xl border border-slate-200 bg-white p-6 transition hover:border-blue-400">
            <h2 className="text-lg font-bold">Passenger trips</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Answer fare proposals, run paid passenger trips, confirm completion and request withdrawals from your earnings.
            </p>
            <span className="mt-4 inline-block text-sm font-semibold text-blue-700">Open passenger trips →</span>
          </Link>
          <Link href="/rider/jobs" className="rounded-2xl border border-slate-200 bg-white p-6 transition hover:border-blue-400">
            <h2 className="text-lg font-bold">Available jobs</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Claim a delivery, then update status from pickup through to delivery. Never ask for the handover code early.
            </p>
            <span className="mt-4 inline-block text-sm font-semibold text-blue-700">Open job board →</span>
          </Link>
          <Link href="/provider/apply" className="rounded-2xl border border-slate-200 bg-white p-6 transition hover:border-blue-400">
            <h2 className="text-lg font-bold">Transport application</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Apply as a transport partner before claiming work. Approval for another activity does not make you a rider.
            </p>
            <span className="mt-4 inline-block text-sm font-semibold text-blue-700">Apply →</span>
          </Link>
          <Link href="/provider/transport-details" className="rounded-2xl border border-slate-200 bg-white p-6 transition hover:border-blue-400">
            <h2 className="text-lg font-bold">Vehicle and coverage</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Keep the vehicle type and the counties and towns you can serve up to date.
            </p>
            <span className="mt-4 inline-block text-sm font-semibold text-blue-700">Update details →</span>
          </Link>
          <Link href="/safety" className="rounded-2xl border border-slate-200 bg-white p-6 transition hover:border-blue-400">
            <h2 className="text-lg font-bold">Safety expectations</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Address privacy, handover proof and what to do if a delivery feels unsafe.
            </p>
            <span className="mt-4 inline-block text-sm font-semibold text-blue-700">Read safety →</span>
          </Link>
        </div>

        <section className="mt-10 rounded-2xl border border-amber-200 bg-amber-50 p-6">
          <h2 className="text-xl font-black text-amber-950">What still depends on configuration</h2>
          <p className="mt-2 leading-7 text-amber-950">
            Live rider tracking, route optimisation and automatic M-Pesa B2C payouts require external configuration.
            Withdrawals are recorded and remain pending until the payout provider confirms them. The job board shows the
            records the database actually holds, and no live map is implied.
          </p>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
