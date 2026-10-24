import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { JsonLd } from "@/components/seo/JsonLd";
import { absoluteUrl, site } from "@/lib/site";
import { HouseHuntSearch } from "./HouseHuntSearch";

export const metadata: Metadata = {
  title: "House Hunt",
  description:
    "Browse vacant homes, bedsitters, apartments and houses across Kenya for free. See rent, deposit, amenities and approximate location before paying a small fee to unlock verified contact details.",
  alternates: { canonical: absoluteUrl("/house-hunt") },
  openGraph: {
    title: "House Hunt | Shilevi",
    description: "Free property browsing. Pay only when you choose to unlock a landlord's contact details.",
    url: absoluteUrl("/house-hunt"),
  },
};

export default function HouseHuntPage() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: "Shilevi House Hunt",
          url: absoluteUrl("/house-hunt"),
          isPartOf: { "@type": "WebSite", name: site.name, url: site.url },
          about: "Vacant residential property listings in Kenya",
        }}
      />
      <SiteHeader />
      <main id="main-content">
        <section className="border-b border-slate-200 bg-white">
          <div className="mx-auto max-w-7xl px-5 py-12 sm:px-6 lg:py-16">
            <p className="text-sm font-bold uppercase tracking-widest text-blue-700">House Hunt</p>
            <h1 className="mt-3 max-w-3xl text-4xl font-black tracking-tight sm:text-5xl">
              Find a home without paying to browse.
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-600">
              Search free by town, rent and bedrooms. See photos, amenities, rent, deposit and the general area first.
              Unlock a landlord&apos;s exact address and phone number only when you are ready to enquire.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <a href="#search" className="rounded-full bg-blue-700 px-6 py-3 text-sm font-bold text-white hover:bg-blue-800">Browse properties</a>
              <Link href="/provider/properties" className="rounded-full border border-slate-300 px-6 py-3 text-sm font-bold text-slate-800 hover:border-slate-400">
                List a property
              </Link>
            </div>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-500">
              Contact access is a fixed platform fee shown before payment. It is a Shilevi service fee, not rent and not
              a payment to the landlord. Never send a deposit before viewing a property and confirming ownership.
            </p>
          </div>
        </section>
        <HouseHuntSearch />
      </main>
      <SiteFooter />
    </div>
  );
}
