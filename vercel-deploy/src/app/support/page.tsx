import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Support",
  description: "Contact Shilevi support about an order, a provider application, an account, or a safety issue.",
  alternates: { canonical: "/support" },
};

const routes = [
  {
    title: "Order, delivery or refund",
    email: site.supportEmail,
    subject: "Order support",
    body: "Let us know what happened and what you would like us to do.",
    detail: "Include your order number (it starts with SX-), the item, and photos if the item is damaged or different from the listing.",
    href: "/account/orders",
    linkLabel: "Open your orders",
  },
  {
    title: "Provider application or listings",
    email: site.supportEmail,
    subject: "Provider support",
    body: "Ask about an application decision, a category you need, or a listing that will not publish.",
    detail: "Include the activity you applied for and the email on your account.",
    href: "/provider/apply",
    linkLabel: "Provider applications",
  },
  {
    title: "Privacy or account deletion",
    email: site.privacyEmail,
    subject: "Privacy request",
    body: "Request access, correction or deletion of your personal data.",
    detail: "Deletion is reviewed, not instant: open orders, payouts and legal retention can require specific records to be kept.",
    href: "/legal/privacy",
    linkLabel: "Read the privacy notice",
  },
  {
    title: "Security vulnerability",
    email: site.securityEmail,
    subject: "Security report",
    body: "Report a vulnerability privately and give us a reasonable window to fix it.",
    detail: "Do not test against real customer accounts, and do not access data that is not yours.",
    href: "/security",
    linkLabel: "Security policy",
  },
];

export default function SupportPage() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <SiteHeader />
      <main id="main-content" className="mx-auto max-w-5xl px-5 py-12 sm:px-6">
        <p className="text-sm font-bold uppercase tracking-wide text-blue-700">Support</p>
        <h1 className="mt-2 text-4xl font-black tracking-tight">How can we help?</h1>
        <p className="mt-4 max-w-2xl text-lg leading-8 text-slate-600">
          Pick the route that matches your issue. Messages that include an order number and a clear description are
          answered fastest.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {routes.map(route => (
            <section key={route.title} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-6">
              <h2 className="text-lg font-bold">{route.title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">{route.body}</p>
              <p className="mt-3 text-sm leading-6 text-slate-500">{route.detail}</p>
              <div className="mt-4 flex flex-wrap gap-3 text-sm">
                <a
                  href={`mailto:${route.email}?subject=${encodeURIComponent(`${route.subject} — ${site.name}`)}`}
                  className="rounded-xl bg-blue-700 px-4 py-2 font-semibold text-white hover:bg-blue-800"
                >
                  Email {route.email}
                </a>
                <Link href={route.href} className="rounded-xl border border-slate-300 px-4 py-2 font-semibold hover:bg-slate-50">
                  {route.linkLabel}
                </Link>
              </div>
            </section>
          ))}
        </div>

        <section className="mt-10 rounded-2xl border border-amber-200 bg-amber-50 p-6">
          <h2 className="text-lg font-bold text-amber-950">Urgent safety issue</h2>
          <p className="mt-2 text-sm leading-6 text-amber-950">
            If someone is in immediate danger, contact the police first on <strong>999</strong> or <strong>112</strong>.
            Then tell us through support so we can restrict the account and preserve the order record.
          </p>
        </section>

        <section className="mt-10">
          <h2 className="text-xl font-black">Response times</h2>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-700">
            <li>Security reports are triaged within one business day.</li>
            <li>Active order and delivery problems are handled first, including outside normal hours where staffing allows.</li>
            <li>Application, listing and general questions are answered within two to three business days.</li>
          </ul>
          <p className="mt-4 text-sm text-slate-500">
            Support is currently by email only. There is no phone line and no live chat in this build.
          </p>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
