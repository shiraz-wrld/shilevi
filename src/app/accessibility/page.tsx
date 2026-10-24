import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Accessibility",
  description: "Shilevi's accessibility commitment, what works today, known gaps and how to report a barrier.",
  alternates: { canonical: "/accessibility" },
};

const supported = [
  "Every page is usable with a keyboard alone, with a visible focus outline and a skip link to the main content.",
  "Text is resized with browser zoom and the layout reflows instead of forcing horizontal scrolling on small screens.",
  "Form fields have visible labels, errors are announced with a status or alert role, and buttons state what they do.",
  "Colour is never the only signal: order and payment states also carry a text label.",
  "Decorative graphics are hidden from assistive technology; meaningful images have alternative text.",
  "Pages are written in plain English with headings in a logical order.",
];

const gaps = [
  "There is no live map or location picker in this build, so no map-only interaction exists to make accessible.",
  "Some long forms do not yet group related fields with a fieldset and legend.",
  "Automated contrast and screen-reader checks are not part of CI; they are run manually before a release.",
  "Swahili translation is not available yet. The site declares English (Kenya) as its language.",
];

export default function AccessibilityPage() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <SiteHeader />
      <main id="main-content" className="mx-auto max-w-4xl px-5 py-12 sm:px-6">
        <p className="text-sm font-bold uppercase tracking-wide text-blue-700">Accessibility</p>
        <h1 className="mt-2 text-4xl font-black tracking-tight">A marketplace everyone can use</h1>
        <p className="mt-4 text-lg leading-8 text-slate-600">
          {site.name} aims to meet WCAG 2.2 level AA. We would rather tell you what is not finished than claim full
          compliance we have not tested.
        </p>

        <section className="mt-10">
          <h2 className="text-2xl font-black">What works today</h2>
          <ul className="mt-4 list-disc space-y-2 pl-6 leading-7 text-slate-700">
            {supported.map(item => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>

        <section className="mt-10 rounded-2xl border border-amber-200 bg-amber-50 p-6">
          <h2 className="text-xl font-black text-amber-950">Known gaps</h2>
          <ul className="mt-3 list-disc space-y-2 pl-6 leading-7 text-amber-950">
            {gaps.map(item => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>

        <section className="mt-10">
          <h2 className="text-2xl font-black">Report a barrier</h2>
          <p className="mt-3 leading-7 text-slate-700">
            If something blocks you — a control you cannot reach, text you cannot read, a form that does not explain an
            error — email{" "}
            <a href={`mailto:${site.supportEmail}?subject=${encodeURIComponent("Accessibility barrier")}`} className="font-semibold text-blue-700 underline">
              {site.supportEmail}
            </a>{" "}
            with the page address, what you were trying to do, and the assistive technology you use. We will reply with a
            workaround where one exists and a fix timeline where it does not.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/support" className="rounded-xl bg-blue-700 px-5 py-3 font-semibold text-white hover:bg-blue-800">
              Contact support
            </Link>
            <Link href="/security" className="rounded-xl border border-slate-300 bg-white px-5 py-3 font-semibold hover:bg-slate-50">
              Security policy
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
