import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { requireUser } from "@/lib/auth/guards";

export const metadata: Metadata = {
  title: "Provider workspace",
  description: "Apply to sell, offer services, deliver or list property on Shilevi and manage your provider work.",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

const tools = [
  {
    href: "/provider/apply",
    title: "Applications",
    body: "Apply separately for product selling, services, transport and property. One approval never authorises another activity.",
  },
  {
    href: "/provider/listings",
    title: "Listings",
    body: "Create and edit drafts. A listing publishes only when your application, category and brand requirements are met.",
  },
  {
    href: "/provider/orders",
    title: "Orders to fulfil",
    body: "See paid orders, accept them, prepare the items, and record handover or delivery as it actually happens.",
  },
  {
    href: "/provider/requests",
    title: "Customer enquiries",
    body: "Answer listing enquiries. An enquiry is not a confirmed order, booking or price commitment.",
  },
  {
    href: "/provider/properties",
    title: "House Hunt properties",
    body: "Add property details, submit them for verification and keep vacancy status accurate. Browsing is free for tenants.",
  },
  {
    href: "/provider/transport-details",
    title: "Transport details",
    body: "Record vehicle type, optional registration and the counties and towns you cover.",
  },
  {
    href: "/pricing",
    title: "Fees and commission",
    body: "Commission defaults to 10% of the item subtotal and is fixed when an order is created.",
  },
];

export default async function ProviderHomePage() {
  const user = await requireUser("/provider");

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <SiteHeader />
      <main id="main-content" className="mx-auto max-w-5xl px-5 py-12 sm:px-6">
        <p className="text-sm font-bold uppercase tracking-wide text-blue-700">Provider workspace</p>
        <h1 className="mt-2 text-4xl font-black tracking-tight">Sell and deliver on your own terms</h1>
        <p className="mt-4 max-w-2xl text-lg leading-8 text-slate-600">
          Signed in as <span className="font-semibold text-slate-900">{user.email ?? "your account"}</span>. Start with an
          application, then manage listings, orders and enquiries from here.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {tools.map(tool => (
            <Link
              key={tool.href}
              href={tool.href}
              className="rounded-2xl border border-slate-200 bg-white p-6 transition hover:border-blue-400 hover:shadow-sm"
            >
              <h2 className="text-lg font-bold">{tool.title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">{tool.body}</p>
              <span className="mt-4 inline-block text-sm font-semibold text-blue-700">Open →</span>
            </Link>
          ))}
        </div>

        <section className="mt-10 rounded-2xl border border-amber-200 bg-amber-50 p-6">
          <h2 className="text-xl font-black text-amber-950">What still depends on configuration</h2>
          <p className="mt-2 leading-7 text-amber-950">
            Live payment charges require Safaricom Daraja credentials, and email delivery requires Resend/SMTP setup.
            Identity-document storage, photo moderation and a storefront editor are not live yet. The pages above never
            collect documents they cannot securely store, and no page promises a payout the platform cannot execute.
          </p>
          <Link href="/legal/provider-agreement" className="mt-4 inline-block text-sm font-bold text-amber-950 underline">
            Read the provider agreement
          </Link>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
