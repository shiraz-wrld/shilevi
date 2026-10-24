import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Safety",
  description: "How Shilevi protects addresses, handover codes and payments, and what to do if something feels wrong.",
  alternates: { canonical: "/safety" },
};

const protections = [
  {
    title: "Your address stays private",
    body: "Public listings show an approximate area, not your home or business address. A rider receives pick-up and drop-off details only after accepting the job, and only for that delivery.",
  },
  {
    title: "The handover code proves delivery",
    body: "A short code that only you and the platform know is used at handover. Never share it before the items are in your hands — sharing it early is the same as signing for the delivery.",
  },
  {
    title: "Money follows the order record",
    body: "Prices, commission and fees are calculated on the server. Payment webhooks must be signature-verified and replay-safe before an order changes state. In sandbox mode no real money moves at all.",
  },
  {
    title: "Provider checks are honest about their limits",
    body: "Provider applications are reviewed against the activity they apply for. That review is not a guarantee of quality, and a listing is not an endorsement. Check the offer, terms and provider details before committing.",
  },
  {
    title: "Staff access is narrow and logged",
    body: "Owner administration requires an allowlisted, email-verified account with multi-factor authentication. Review actions write an audit record with bounded metadata — never documents, notes or full contact details.",
  },
  {
    title: "You can report a problem",
    body: "Use the order page for delivery and refund problems, and email support for safety concerns. Urgent danger should go to the police first.",
  },
];

export default function SafetyPage() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <SiteHeader />
      <main id="main-content" className="mx-auto max-w-5xl px-5 py-12 sm:px-6">
        <p className="text-sm font-bold uppercase tracking-wide text-blue-700">Safety</p>
        <h1 className="mt-2 text-4xl font-black tracking-tight">Safety is a workflow, not a badge</h1>
        <p className="mt-4 max-w-3xl text-lg leading-8 text-slate-600">
          {site.name} handles addresses, phone numbers and payment references. These are the controls that exist today,
          stated plainly, plus what to do when something goes wrong.
        </p>

        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {protections.map(item => (
            <section key={item.title} className="rounded-2xl border border-slate-200 bg-white p-6">
              <h2 className="text-lg font-bold">{item.title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">{item.body}</p>
            </section>
          ))}
        </div>

        <section className="mt-10 rounded-2xl border border-amber-200 bg-amber-50 p-6">
          <h2 className="text-xl font-black text-amber-950">If someone is in immediate danger</h2>
          <p className="mt-2 leading-7 text-amber-950">
            Contact the police first on <strong>999</strong> or <strong>112</strong>. Then email{" "}
            <a href={`mailto:${site.supportEmail}`} className="font-semibold underline">
              {site.supportEmail}
            </a>{" "}
            with the order number so we can restrict the account and preserve the record.
          </p>
        </section>

        <section className="mt-10">
          <h2 className="text-2xl font-black">Meeting a rider or provider</h2>
          <ul className="mt-4 list-disc space-y-2 pl-6 leading-7 text-slate-700">
            <li>Meet in a public place during daylight where you can, especially for high-value items.</li>
            <li>Check the item before sharing the handover code.</li>
            <li>Do not move a conversation to another app to avoid the order record; that removes your evidence.</li>
            <li>Never send money outside the checkout for an order you found on Shilevi.</li>
            <li>If a rider or provider asks for your password, a one-time code, or your handover code early, refuse and report it.</li>
          </ul>
        </section>

        <section className="mt-10">
          <h2 className="text-2xl font-black">Reporting</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <Link href="/support" className="rounded-2xl border border-slate-200 bg-white p-5 hover:border-blue-400">
              <h3 className="font-bold">Support</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">Order, delivery and account problems.</p>
            </Link>
            <Link href="/security" className="rounded-2xl border border-slate-200 bg-white p-5 hover:border-blue-400">
              <h3 className="font-bold">Security</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">Report a vulnerability privately.</p>
            </Link>
            <Link href="/legal/acceptable-use" className="rounded-2xl border border-slate-200 bg-white p-5 hover:border-blue-400">
              <h3 className="font-bold">Acceptable use</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">What is prohibited and how enforcement works.</p>
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
