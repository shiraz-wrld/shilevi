import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Pricing",
  description: "What Shilevi charges customers and providers: commission, delivery fees and payment mode explained.",
  alternates: { canonical: "/pricing" },
};

const customerRows = [
  { item: "Creating an account", price: "Free", detail: "Browsing, saving listings and sending enquiries costs nothing." },
  { item: "Buying a product", price: "Item price + delivery", detail: "The checkout total is calculated on the server and shown before you confirm." },
  { item: "Delivery", price: "Quoted per order", detail: "The delivery fee depends on distance and is shown before payment. It is not a subscription." },
  { item: "Refund requests", price: "Free", detail: "Opening a refund or dispute does not cost you anything." },
];

const providerRows = [
  { item: "Applying to become a provider", price: "Free", detail: "Applications are reviewed; approval is never sold." },
  { item: "Publishing a listing", price: "No listing fee", detail: "A listing can be a draft until your application and category requirements are met." },
  { item: "Commission", price: "10% of item subtotal", detail: "The default rate is fixed on each order when it is created, so later rate changes never rewrite a past sale." },
  { item: "Delivery you fulfil yourself", price: "Your own arrangement", detail: "Platform delivery is optional. Where platform delivery applies, the rider fee is shown in the order record." },
  { item: "Payouts", price: "Provider charges may apply", detail: "Payout eligibility starts after delivery and the dispute window. Mobile-money or bank charges are set by those providers, not by Shilevi." },
];

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <SiteHeader />
      <main id="main-content" className="mx-auto max-w-5xl px-5 py-12 sm:px-6">
        <p className="text-sm font-bold uppercase tracking-wide text-blue-700">Pricing</p>
        <h1 className="mt-2 text-4xl font-black tracking-tight">Clear costs, before you commit</h1>
        <p className="mt-4 max-w-3xl text-lg leading-8 text-slate-600">
          {site.name} does not invent fees at the last step. Everything below is what the platform charges today; the
          checkout or order page always shows the exact amount for your transaction.
        </p>

        <section className="mt-10">
          <h2 className="text-2xl font-black">For customers</h2>
          <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs font-bold uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-5 py-3">What</th>
                  <th scope="col" className="px-5 py-3">Price</th>
                  <th scope="col" className="hidden px-5 py-3 sm:table-cell">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {customerRows.map(row => (
                  <tr key={row.item}>
                    <th scope="row" className="px-5 py-4 align-top font-semibold">{row.item}</th>
                    <td className="px-5 py-4 align-top font-bold text-blue-700">{row.price}</td>
                    <td className="hidden px-5 py-4 align-top leading-6 text-slate-600 sm:table-cell">{row.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-10">
          <h2 className="text-2xl font-black">For providers</h2>
          <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs font-bold uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-5 py-3">What</th>
                  <th scope="col" className="px-5 py-3">Price</th>
                  <th scope="col" className="hidden px-5 py-3 sm:table-cell">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {providerRows.map(row => (
                  <tr key={row.item}>
                    <th scope="row" className="px-5 py-4 align-top font-semibold">{row.item}</th>
                    <td className="px-5 py-4 align-top font-bold text-blue-700">{row.price}</td>
                    <td className="hidden px-5 py-4 align-top leading-6 text-slate-600 sm:table-cell">{row.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-10 rounded-2xl border border-blue-200 bg-blue-50 p-6">
          <h2 className="text-xl font-black text-blue-950">Payment mode right now</h2>
          <p className="mt-2 leading-7 text-blue-950">
            Checkout is running in sandbox mode. It creates a real order record with a simulated payment so the whole
            flow can be tested, but no card or mobile-money charge is made. When a licensed payment provider is
            connected, the checkout page will name it and state whether funds are held until delivery.
          </p>
        </section>

        <section className="mt-10">
          <h2 className="text-xl font-black">What we do not charge for</h2>
          <ul className="mt-3 list-disc space-y-2 pl-6 leading-7 text-slate-700">
            <li>Sending an enquiry to a provider.</li>
            <li>Saving a listing or tracking an order.</li>
            <li>Reporting a security issue.</li>
            <li>Requesting access to, or correction of, your personal data.</li>
          </ul>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/provider/apply" className="rounded-xl bg-blue-700 px-5 py-3 font-semibold text-white hover:bg-blue-800">
              Apply as a provider
            </Link>
            <Link href="/legal/provider-agreement" className="rounded-xl border border-slate-300 bg-white px-5 py-3 font-semibold hover:bg-slate-50">
              Provider agreement
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
