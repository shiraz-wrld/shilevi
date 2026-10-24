import Link from "next/link";
import { site } from "@/lib/site";

export type LegalSection = {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
};

export type LegalPageProps = {
  title: string;
  summary: string;
  sections: LegalSection[];
  related?: { href: string; label: string }[];
};

function anchor(heading: string) {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/**
 * Shared legal document layout.
 *
 * The closing notice is deliberate: these documents are drafted from how the platform actually
 * behaves, but they must be reviewed by Kenyan counsel before launch. Remove the notice only
 * after that review, not before.
 */
export function LegalPage({ title, summary, sections, related }: LegalPageProps) {
  return (
    <main id="main-content" className="mx-auto max-w-5xl px-5 py-10 sm:px-6 sm:py-14">
      <p className="text-sm font-bold uppercase tracking-wide text-blue-700">Legal</p>
      <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">{title}</h1>
      <p className="mt-4 max-w-3xl text-lg leading-8 text-slate-600">{summary}</p>
      <p className="mt-3 text-sm text-slate-500">
        Last updated{" "}
        <time dateTime={site.legalUpdated}>
          {new Date(site.legalUpdated).toLocaleDateString("en-KE", { year: "numeric", month: "long", day: "numeric" })}
        </time>
      </p>

      <nav aria-label="On this page" className="mt-8 rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">On this page</h2>
        <ol className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          {sections.map(section => (
            <li key={section.heading}>
              <a href={`#${anchor(section.heading)}`} className="text-blue-700 hover:underline">
                {section.heading}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="mt-10 space-y-10">
        {sections.map((section, index) => (
          <section key={section.heading} id={anchor(section.heading)} className="scroll-mt-24 border-t border-slate-200 pt-8 first:border-t-0 first:pt-0">
            <h2 className="text-xl font-black sm:text-2xl">
              <span className="mr-2 text-blue-700">{index + 1}.</span>
              {section.heading}
            </h2>
            {section.paragraphs?.map(paragraph => (
              <p key={paragraph} className="mt-3 leading-8 text-slate-700">
                {paragraph}
              </p>
            ))}
            {section.bullets && (
              <ul className="mt-3 list-disc space-y-2 pl-6 leading-8 text-slate-700">
                {section.bullets.map(bullet => (
                  <li key={bullet}>{bullet}</li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>

      {related && related.length > 0 && (
        <aside className="mt-12 rounded-2xl border border-slate-200 bg-slate-50 p-5">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Related</h2>
          <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            {related.map(link => (
              <li key={link.href}>
                <Link href={link.href} className="font-medium text-blue-700 hover:underline">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </aside>
      )}

      <p className="mt-10 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
        Working draft. This document describes how {site.name} actually operates today, but it still needs review by
        Kenyan counsel before public launch. Questions: {""}
        <a href={`mailto:${site.supportEmail}`} className="font-semibold underline">
          {site.supportEmail}
        </a>
        .
      </p>
    </main>
  );
}
