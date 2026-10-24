import Link from "next/link";
import type { Metadata } from "next";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: true },
};

const links = [
  { href: "/marketplace/products", label: "Products" },
  { href: "/marketplace/services", label: "Services" },
  { href: "/marketplace/transport_delivery", label: "Transport & delivery" },
  { href: "/marketplace/property_places", label: "Property & places" },
];

export default function NotFound() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <SiteHeader />
      <main id="main-content" className="mx-auto max-w-3xl px-5 py-20 sm:px-6">
        <p className="text-sm font-bold uppercase tracking-wide text-blue-700">404</p>
        <h1 className="mt-2 text-4xl font-black tracking-tight">That page is not here</h1>
        <p className="mt-4 text-lg leading-8 text-slate-600">
          The link may be old, the listing may have been removed, or the address may have a typo. Nothing has gone wrong
          with your account.
        </p>
        <div className="mt-8 flex flex-wrap gap-2">
          {links.map(link => (
            <Link key={link.href} href={link.href} className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold hover:border-blue-400">
              {link.label}
            </Link>
          ))}
        </div>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/" className="rounded-xl bg-blue-700 px-5 py-3 font-semibold text-white hover:bg-blue-800">
            Go to the home page
          </Link>
          <Link href="/help" className="rounded-xl border border-slate-300 bg-white px-5 py-3 font-semibold hover:bg-slate-50">
            Visit the help centre
          </Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
