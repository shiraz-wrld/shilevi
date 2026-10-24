import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { JsonLd } from "@/components/seo/JsonLd";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Help centre",
  description: "Answers about buying, selling, delivery, payments, refunds and account security on Shilevi.",
  alternates: { canonical: "/help" },
};

const topics = [
  { href: "#buying", title: "Buying", detail: "Orders, cart, checkout and what the sandbox label means." },
  { href: "#selling", title: "Selling", detail: "Applications, approval, categories and fulfilment." },
  { href: "#delivery", title: "Delivery", detail: "Rider jobs, handover codes and tracking." },
  { href: "#payments", title: "Payments", detail: "Payment modes, commission, payouts and refunds." },
  { href: "#account", title: "Account", detail: "Sign-in, security, deletion and data rights." },
];

const faqs = [
  {
    id: "buying",
    question: "Why does checkout say payment is in sandbox mode?",
    answer:
      "Sandbox mode creates a real order record and a simulated payment so the whole flow can be tested before a licensed payment provider is connected. No money moves and no M-Pesa or card charge is made. The checkout page always states which mode is active.",
  },
  {
    id: "buying",
    question: "Why can I only buy from one seller at a time?",
    answer:
      "Each order has one provider so that pricing, commission, fulfilment and delivery stay unambiguous. Add items from another seller after completing the current order.",
  },
  {
    id: "buying",
    question: "Can I change the delivery address after ordering?",
    answer:
      "Only before the rider accepts the job, and only if the provider has not dispatched. Contact the provider from the order page; if dispatch has started, the address cannot be changed for safety reasons.",
  },
  { id: "selling", question: "How do I become a seller?", answer: "Create an account, then apply under Apply as a provider. Choose the activity that matches what you offer — product seller, service provider, transport partner, or property and places. Approval for one activity does not authorise another." },
  { id: "selling", question: "Why can't I publish my listing?", answer: "A listing can only be published when your application is approved, the category is active and matches your approved activity, and any brand you attached is active. The listing stays as a private draft until those conditions are met." },
  { id: "selling", question: "What does the platform charge?", answer: "Commission defaults to 10% of the item subtotal and is fixed on each order when it is created, so later rate changes never rewrite a past sale. Payment-provider charges are shown on the payout statement." },
  { id: "delivery", question: "How does a rider get my order?", answer: "After payment, the order becomes available on the rider job board. Riders see the pick-up area and a summary, not your full address. Your address appears only after a rider accepts the job." },
  { id: "delivery", question: "What is the handover code?", answer: "A short code only you and the platform know. The rider enters it at handover as proof of delivery. Never share it before the items are in your hands." },
  { id: "payments", question: "When does a provider get paid?", answer: "Payout eligibility starts after delivery is confirmed and the dispute window closes. A dispute pauses payout for the affected amount." },
  { id: "payments", question: "Do I have to leave a rating?", answer: "No. Ratings are optional and never gate completion or payout. If something is wrong, open a refund or dispute instead — that is the mechanism that can withhold money." },
  { id: "account", question: "How do I delete my account?", answer: "Submit a deletion request from Account settings. It is reviewed rather than instant, because open orders, payouts, disputes and legal retention can require specific records to be kept. We tell you what will be deleted and what must remain." },
  { id: "account", question: "Someone accessed my account. What now?", answer: "Change your password immediately, sign out of all sessions from Account settings, then email support. We will review recent activity and restrict the account if needed." },
];

export default function HelpPage() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <SiteHeader />
      <main id="main-content" className="mx-auto max-w-4xl px-5 py-12 sm:px-6">
        <p className="text-sm font-bold uppercase tracking-wide text-blue-700">Help centre</p>
        <h1 className="mt-2 text-4xl font-black tracking-tight">Answers, without the runaround</h1>
        <p className="mt-4 max-w-2xl text-lg leading-8 text-slate-600">
          These answers describe how {site.name} behaves in this build. If something below does not match what you see,
          tell support — that is a bug, not a policy.
        </p>

        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {topics.map(topic => (
            <a key={topic.title} href={topic.href} className="rounded-2xl border border-slate-200 bg-white p-5 transition hover:border-blue-400">
              <h2 className="font-bold">{topic.title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">{topic.detail}</p>
            </a>
          ))}
        </div>

        <div className="mt-10 space-y-3">
          {faqs.map(faq => (
            <details key={faq.question} id={faq.id} className="scroll-mt-24 rounded-2xl border border-slate-200 bg-white p-5">
              <summary className="cursor-pointer font-semibold">{faq.question}</summary>
              <p className="mt-3 leading-7 text-slate-700">{faq.answer}</p>
            </details>
          ))}
        </div>

        <section className="mt-10 rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-xl font-black">Still stuck?</h2>
          <p className="mt-2 text-slate-600">Send us the order number and what you expected to happen.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link href="/support" className="rounded-xl bg-blue-700 px-5 py-3 font-semibold text-white hover:bg-blue-800">
              Contact support
            </Link>
            <Link href="/legal/refunds" className="rounded-xl border border-slate-300 px-5 py-3 font-semibold hover:bg-slate-50">
              Refunds & returns
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: faqs.map(faq => ({
            "@type": "Question",
            name: faq.question,
            acceptedAnswer: { "@type": "Answer", text: faq.answer },
          })),
        }}
      />
    </div>
  );
}
