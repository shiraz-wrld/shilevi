import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { site, divisionLabels } from "@/lib/site";

export const metadata: Metadata = {
  title: "About",
  description: "What Shilevi is, how the four marketplace divisions fit together, and how trust, payment and delivery are designed.",
  alternates: { canonical: "/about" },
};

const pillars = [
  { title: "One account, many roles", detail: "A customer today can apply to sell, deliver or list property tomorrow. Approval is per activity, so each role is verified on its own." },
  { title: "Verified providers", detail: "Applications are reviewed with evidence before a listing can publish. Category permissions stop a food seller from listing property." },
  { title: "Delivery that is claimed, not assigned blindly", detail: "Approved riders see available jobs, claim one atomically, and only then receive the drop-off details." },
  { title: "Money with a paper trail", detail: "Every payment, commission, refund and payout is written to a double-entry ledger in integer cents, so balances always reconcile." },
  { title: "Disputes, not stars", detail: "Ratings are optional signals. Withholding money is done through a dispute with evidence and a recorded decision." },
  { title: "Configured, not hard-coded", detail: "Commission rates, service areas, categories and payment mode are configuration owned by the platform team, not scattered through the code." },
];

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <SiteHeader />
      <main id="main-content">
        <section className="mx-auto max-w-5xl px-5 py-14 sm:px-6">
          <p className="text-sm font-bold uppercase tracking-wide text-blue-700">About {site.name}</p>
          <h1 className="mt-2 max-w-3xl text-4xl font-black tracking-tight sm:text-5xl">
            A Kenyan marketplace built like infrastructure, not a flyer.
          </h1>
          <p className="mt-5 max-w-3xl text-lg leading-8 text-slate-600">
            {site.name} brings four kinds of trade into one place: {Object.values(divisionLabels).join(", ")}. The point
            is not to look busy. It is to make one transaction work end to end — a verified provider, a clear price, a
            payment that reconciles, a delivery with proof, and a fair way to fix things when they go wrong.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/signup" className="rounded-full bg-blue-700 px-6 py-3 font-semibold text-white hover:bg-blue-800">
              Create an account
            </Link>
            <Link href="/provider/apply" className="rounded-full border border-slate-300 bg-white px-6 py-3 font-semibold hover:border-blue-400">
              Become a provider
            </Link>
          </div>
        </section>

        <section className="border-y border-slate-200 bg-white py-14">
          <div className="mx-auto max-w-5xl px-5 sm:px-6">
            <h2 className="text-3xl font-black">How trust is built</h2>
            <p className="mt-3 max-w-2xl text-slate-600">
              These are design decisions with consequences in code and in the database, not marketing lines.
            </p>
            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              {pillars.map(pillar => (
                <article key={pillar.title} className="rounded-2xl border border-slate-200 p-5">
                  <h3 className="font-bold">{pillar.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{pillar.detail}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-5 py-14 sm:px-6">
          <h2 className="text-3xl font-black">What is live today</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
              <h3 className="font-bold text-emerald-950">Working</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-emerald-950">
                <li>Accounts, verification, password recovery and onboarding</li>
                <li>Marketplace discovery, search, brand storefronts and listing pages</li>
                <li>Provider applications and draft listings with category permissions</li>
                <li>Cart, checkout, orders, delivery jobs and refund requests</li>
                <li>Owner administration for categories, brands, listings and applications</li>
              </ul>
            </div>
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
              <h3 className="font-bold text-amber-950">In progress</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-amber-950">
                <li>Live payment providers (checkout is sandbox only)</li>
                <li>Live rider tracking and navigation</li>
                <li>Reviews, dispute evidence and appeal flows</li>
                <li>Staff roles beyond the two owner accounts</li>
                <li>Payout execution and reconciliation reports</li>
              </ul>
            </div>
          </div>
          <p className="mt-6 text-sm text-slate-500">
            Nothing on this page claims a feature is complete when it is not. The <Link href="/help" className="font-medium text-blue-700 underline">help centre</Link> describes
            current behaviour, including the sandbox payment limitation.
          </p>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
