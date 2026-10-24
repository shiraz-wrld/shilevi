import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Legal",
  description: "Every Shilevi legal document in one place: terms, privacy, cookies, refunds, provider agreement and acceptable use.",
  alternates: { canonical: "/legal" },
};

const documents = [
  {
    href: "/legal/terms",
    title: "Terms of service",
    summary: "The contract between you and Shilevi when you browse, buy, sell or deliver.",
  },
  {
    href: "/legal/privacy",
    title: "Privacy notice",
    summary: "What personal data we collect, why, who receives it, and the rights you can exercise.",
  },
  {
    href: "/legal/cookies",
    title: "Cookies",
    summary: "The cookies and local storage this site uses, and how to control them.",
  },
  {
    href: "/legal/refunds",
    title: "Refunds & returns",
    summary: "When you can return an item, how refunds are decided, and the timelines that apply.",
  },
  {
    href: "/legal/provider-agreement",
    title: "Provider agreement",
    summary: "The extra terms that apply when you sell products, offer services, deliver, or list property.",
  },
  {
    href: "/legal/acceptable-use",
    title: "Acceptable use",
    summary: "Prohibited items, conduct and content, and how enforcement works.",
  },
];

export default function LegalIndexPage() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <SiteHeader />
      <main id="main-content" className="mx-auto max-w-5xl px-5 py-12 sm:px-6">
        <p className="text-sm font-bold uppercase tracking-wide text-blue-700">Legal</p>
        <h1 className="mt-2 text-4xl font-black tracking-tight">The rules, in plain language</h1>
        <p className="mt-4 max-w-3xl text-lg leading-8 text-slate-600">
          These documents describe how {site.name} actually behaves today. They are written to be read, not to be
          hidden behind. Each page shows the date it was last updated.
        </p>
        <p className="mt-3 text-sm text-slate-500">
          Documents last updated{" "}
          <time dateTime={site.legalUpdated}>
            {new Date(site.legalUpdated).toLocaleDateString("en-KE", { year: "numeric", month: "long", day: "numeric" })}
          </time>
          .
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {documents.map(document => (
            <Link
              key={document.href}
              href={document.href}
              className="group rounded-2xl border border-slate-200 bg-white p-6 transition hover:border-blue-400 hover:shadow-sm"
            >
              <h2 className="text-lg font-bold group-hover:text-blue-700">{document.title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">{document.summary}</p>
              <span className="mt-4 inline-block text-sm font-semibold text-blue-700">Read →</span>
            </Link>
          ))}
        </div>

        <section className="mt-10 rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-xl font-black">Questions or a data request</h2>
          <p className="mt-2 leading-7 text-slate-600">
            Email{" "}
            <a href={`mailto:${site.supportEmail}`} className="font-semibold text-blue-700 underline">
              {site.supportEmail}
            </a>{" "}
            for general questions, or{" "}
            <a href={`mailto:${site.privacyEmail}`} className="font-semibold text-blue-700 underline">
              {site.privacyEmail}
            </a>{" "}
            to access, correct or delete your personal data. Security reports go to{" "}
            <a href={`mailto:${site.securityEmail}`} className="font-semibold text-blue-700 underline">
              {site.securityEmail}
            </a>
            .
          </p>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
