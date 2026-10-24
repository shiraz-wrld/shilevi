import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { JsonLd } from "@/components/seo/JsonLd";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "How it works",
  description: "How buying, selling, delivery and support work on Shilevi, step by step.",
  alternates: { canonical: "/how-it-works" },
};

const steps = [
  {
    title: "Create one account",
    body: "Sign up with an email address, confirm it, and add the details you are comfortable sharing. Phone and area are optional at the start. The same account can later apply to become a provider or a rider.",
    href: "/signup",
    linkLabel: "Create an account",
  },
  {
    title: "Find what you need",
    body: "Browse the four divisions or search by title. Listings show the provider, category, listed price and an approximate location. Exact addresses are never public.",
    href: "/marketplace/products",
    linkLabel: "Browse the marketplace",
  },
  {
    title: "Ask, or add to cart",
    body: "For services, transport and property, send an enquiry and agree the details with the provider. For fixed-price products, add the item to your cart. One order contains items from one seller so pricing and fulfilment stay unambiguous.",
    href: "/search",
    linkLabel: "Search listings",
  },
  {
    title: "Check out with the price you see",
    body: "The server recalculates the item subtotal, commission and delivery fee before the order is created. The checkout page states which payment mode is active. In sandbox mode a real order is created but no real money moves.",
    href: "/cart",
    linkLabel: "Open your cart",
  },
  {
    title: "Track fulfilment and delivery",
    body: "The provider accepts and prepares the order, then hands it to a rider where platform delivery applies. Your order page shows payment, fulfilment and delivery status in one timeline.",
    href: "/account/orders",
    linkLabel: "Your orders",
  },
  {
    title: "Confirm handover, or raise an issue",
    body: "Share the handover code only when the items are in your hands. If something is wrong, open a refund or dispute from the order instead of withholding a rating. Disputes are the mechanism that can pause payout.",
    href: "/legal/refunds",
    linkLabel: "Refunds & returns",
  },
];

const audiences = [
  {
    title: "For customers",
    body: "Shop products, enquire about services, arrange delivery and explore property. Saved listings and requests live in your account.",
    links: [
      { href: "/account/orders", label: "Orders" },
      { href: "/account/saved", label: "Saved listings" },
      { href: "/account/requests", label: "Your requests" },
    ],
  },
  {
    title: "For providers",
    body: "Apply for the activity you actually offer. Approval for one activity does not authorise another. Publishing also requires an active category and, if used, an active brand.",
    links: [
      { href: "/provider/apply", label: "Apply" },
      { href: "/provider/listings", label: "Listings" },
      { href: "/provider/orders", label: "Fulfil orders" },
    ],
  },
  {
    title: "For riders and transport partners",
    body: "Approved transport partners see available jobs with pick-up areas, then accept a job to receive the details needed for that delivery.",
    links: [
      { href: "/rider/jobs", label: "Job board" },
      { href: "/provider/apply", label: "Apply as a transport partner" },
      { href: "/legal/provider-agreement", label: "Provider agreement" },
    ],
  },
  {
    title: "For staff and operations",
    body: "Owner access is limited to allowlisted, email-verified accounts with multi-factor authentication. Reviews are recorded with an audit trail.",
    links: [
      { href: "/admin", label: "Control centre" },
      { href: "/admin/audit-log", label: "Audit log" },
      { href: "/security", label: "Security" },
    ],
  },
];

export default function HowItWorksPage() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <SiteHeader />
      <main id="main-content" className="mx-auto max-w-5xl px-5 py-12 sm:px-6">
        <p className="text-sm font-bold uppercase tracking-wide text-blue-700">How it works</p>
        <h1 className="mt-2 text-4xl font-black tracking-tight">From browsing to a confirmed handover</h1>
        <p className="mt-4 max-w-3xl text-lg leading-8 text-slate-600">
          {site.name} connects independent providers with people who need them. Here is the whole journey, including the
          parts that are still being built — so you never have to guess what a button will do.
        </p>

        <ol className="mt-10 space-y-4">
          {steps.map((step, index) => (
            <li key={step.title} className="rounded-2xl border border-slate-200 bg-white p-6">
              <div className="flex flex-wrap items-baseline gap-3">
                <span className="text-sm font-black text-blue-700">{String(index + 1).padStart(2, "0")}</span>
                <h2 className="text-xl font-black">{step.title}</h2>
              </div>
              <p className="mt-3 leading-7 text-slate-600">{step.body}</p>
              <Link href={step.href} className="mt-4 inline-block text-sm font-bold text-blue-700 hover:underline">
                {step.linkLabel} →
              </Link>
            </li>
          ))}
        </ol>

        <section className="mt-12">
          <h2 className="text-2xl font-black">Built for every role</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {audiences.map(audience => (
              <article key={audience.title} className="rounded-2xl border border-slate-200 bg-white p-6">
                <h3 className="text-lg font-bold">{audience.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{audience.body}</p>
                <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm">
                  {audience.links.map(link => (
                    <li key={link.href}>
                      <Link href={link.href} className="font-semibold text-blue-700 hover:underline">
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-12 rounded-2xl border border-amber-200 bg-amber-50 p-6">
          <h2 className="text-xl font-black text-amber-950">What is not live yet</h2>
          <p className="mt-2 leading-7 text-amber-950">
            Live payment collection is not enabled; checkout runs in sandbox mode and the page says so. Automated payout
            transfers, in-app chat, review moderation at scale and per-listing availability calendars are still being
            built. Where a feature is missing, the page says it is missing instead of pretending to work.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link href="/pricing" className="rounded-xl bg-amber-950 px-4 py-2 text-sm font-bold text-white">
              What it costs
            </Link>
            <Link href="/help" className="rounded-xl border border-amber-300 bg-white px-4 py-2 text-sm font-bold text-amber-950">
              Read the help centre
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "HowTo",
          name: "How to buy and sell on Shilevi",
          description: "Create an account, find a listing, check out or enquire, then track fulfilment and delivery.",
          totalTime: "PT10M",
          step: steps.map((step, index) => ({
            "@type": "HowToStep",
            position: index + 1,
            name: step.title,
            text: step.body,
            url: `${site.url}${step.href}`,
          })),
        }}
      />
    </div>
  );
}
