import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { JsonLd } from "@/components/seo/JsonLd";
import { absoluteUrl, site } from "@/lib/site";
import { TransportClient } from "./TransportClient";

export const metadata: Metadata = {
  title: "Passenger transport",
  description:
    "Request a car, motorcycle, tuk-tuk, bicycle or van trip in Kenya, propose your fare, agree it with an approved transport partner and pay securely.",
  alternates: { canonical: absoluteUrl("/transport") },
  openGraph: {
    title: "Passenger transport | Shilevi",
    description: "Choose a verified transport partner, agree the fare and travel with a recorded trip.",
    url: absoluteUrl("/transport"),
  },
};

const RIDE_MODES = [
  { name: "Motorcycle", detail: "Fast solo trips through traffic. One passenger." },
  { name: "Car", detail: "Comfortable private trips for up to four passengers." },
  { name: "Tuk-tuk", detail: "Short local trips at an agreed fare." },
  { name: "Bicycle", detail: "Low-cost short-distance travel." },
  { name: "Van", detail: "Group trips with luggage where the vehicle allows it." },
];

export default function TransportPage() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Service",
          name: `${site.name} passenger transport`,
          serviceType: "Passenger transport booking",
          areaServed: "Kenya",
          provider: { "@type": "Organization", name: site.name, url: site.url },
        }}
      />
      <SiteHeader />
      <main id="main-content">
        <section className="border-b border-slate-200 bg-white">
          <div className="mx-auto max-w-7xl px-5 py-12 sm:px-6 lg:py-16">
            <p className="text-sm font-bold uppercase tracking-widest text-blue-700">Passenger transport</p>
            <h1 className="mt-3 max-w-3xl text-4xl font-black tracking-tight sm:text-5xl">
              Agree the fare first. Then travel.
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-600">
              Choose an approved transport partner and vehicle, propose a fare, and pay only after both sides agree.
              A trip is not a delivery: your pickup, destination, fare and confirmations are recorded on a passenger
              booking.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <a href="#book" className="rounded-full bg-blue-700 px-6 py-3 text-sm font-bold text-white hover:bg-blue-800">
                Request a trip
              </a>
              <Link href="/rider" className="rounded-full border border-slate-300 px-6 py-3 text-sm font-bold text-slate-800 hover:border-slate-400">
                Drive with Shilevi
              </Link>
            </div>
            <dl className="mt-8 grid gap-3 text-sm sm:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 p-4">
                <dt className="font-bold">No hidden fare changes</dt>
                <dd className="mt-1 leading-6 text-slate-600">The agreed amount is snapshotted and cannot be rewritten after payment.</dd>
              </div>
              <div className="rounded-2xl border border-slate-200 p-4">
                <dt className="font-bold">Both sides confirm</dt>
                <dd className="mt-1 leading-6 text-slate-600">The trip completes only after the rider and the customer confirm.</dd>
              </div>
              <div className="rounded-2xl border border-slate-200 p-4">
                <dt className="font-bold">Contact stays private</dt>
                <dd className="mt-1 leading-6 text-slate-600">Phone numbers are released only after the fare is paid.</dd>
              </div>
            </dl>
          </div>
        </section>

        <TransportClient />

        <section className="mx-auto max-w-7xl px-5 pb-16 sm:px-6">
          <h2 className="text-2xl font-black tracking-tight">Transport modes</h2>
          <p className="mt-2 max-w-2xl leading-7 text-slate-600">
            Availability depends on approved partners with an active, verified vehicle in your area. If no partner is
            listed for a mode, none is currently approved — we do not display invented riders.
          </p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {RIDE_MODES.map(mode => (
              <article key={mode.name} className="rounded-2xl border border-slate-200 bg-white p-5">
                <h3 className="font-bold">{mode.name}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{mode.detail}</p>
              </article>
            ))}
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
