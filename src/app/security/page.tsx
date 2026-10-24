import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Security",
  description: "How Shilevi protects accounts and payments, and how to report a vulnerability responsibly.",
  alternates: { canonical: "/security" },
};

const controls = [
  "Sessions are issued by our auth provider, refreshed per request, and private pages are marked no-store.",
  "Staff administration requires an allowlisted, email-verified account with multi-factor authentication at assurance level 2.",
  "Database access is enforced with row-level policies: a signed-in customer cannot read another customer's orders, addresses or payments.",
  "Money movements go through security-definer functions with participant checks, idempotency keys and a balanced double-entry ledger.",
  "Payment webhooks must be signature-verified and replay-safe before any order state changes.",
  "Security headers restrict framing, MIME sniffing, referrers and browser capabilities; a report-only content security policy tracks further tightening.",
  "Provider and staff actions are written to an append-only audit log with bounded metadata — never application documents, notes or full contact details.",
];

const outOfScope = [
  "Denial-of-service testing, load testing, or automated scanning that degrades the service.",
  "Social engineering of staff or customers.",
  "Physical attacks, or access to a device you do not own.",
  "Testing against real customer accounts or data you do not own.",
  "Reports produced only by a scanner with no demonstrated impact.",
];

export default function SecurityPage() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <SiteHeader />
      <main id="main-content" className="mx-auto max-w-4xl px-5 py-12 sm:px-6">
        <p className="text-sm font-bold uppercase tracking-wide text-blue-700">Security</p>
        <h1 className="mt-2 text-4xl font-black tracking-tight">Security at {site.name}</h1>
        <p className="mt-4 text-lg leading-8 text-slate-600">
          A marketplace holds addresses, phone numbers and payment references. We treat that as a duty of care, and we
          want to hear from anyone who finds a gap before someone with worse intentions does.
        </p>

        <section className="mt-10">
          <h2 className="text-2xl font-black">Controls in place</h2>
          <ul className="mt-4 list-disc space-y-2 pl-6 leading-7 text-slate-700">
            {controls.map(control => (
              <li key={control}>{control}</li>
            ))}
          </ul>
        </section>

        <section className="mt-10 rounded-2xl border border-blue-200 bg-blue-50 p-6">
          <h2 className="text-2xl font-black text-blue-950">Report a vulnerability</h2>
          <p className="mt-2 leading-7 text-blue-950">
            Email{" "}
            <a href={`mailto:${site.securityEmail}?subject=${encodeURIComponent("Security report")}`} className="font-semibold underline">
              {site.securityEmail}
            </a>{" "}
            with the affected URL, a short description, reproduction steps, and the impact you believe it has. Do not
            include other people&apos;s personal data in your report.
          </p>
          <p className="mt-3 text-sm leading-6 text-blue-950">
            We aim to acknowledge within one business day, tell you what we intend to do, and keep you updated until it
            is fixed. Please give us a reasonable window before publishing.
          </p>
        </section>

        <section className="mt-10">
          <h2 className="text-2xl font-black">Safe harbour</h2>
          <p className="mt-3 leading-7 text-slate-700">
            If you act in good faith, stay within the scope below, avoid privacy violations and data destruction, and
            give us time to respond, we will not pursue legal action or report you to law enforcement for your research.
            This does not protect activity that is unrelated to security research.
          </p>
        </section>

        <section className="mt-10">
          <h2 className="text-2xl font-black">Out of scope</h2>
          <ul className="mt-4 list-disc space-y-2 pl-6 leading-7 text-slate-700">
            {outOfScope.map(item => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>

        <section className="mt-10">
          <h2 className="text-2xl font-black">If your account is compromised</h2>
          <ol className="mt-4 list-decimal space-y-2 pl-6 leading-7 text-slate-700">
            <li>Change your password from a device you trust.</li>
            <li>Sign out of all sessions from Account settings.</li>
            <li>Turn on multi-factor authentication if it is available for your account type.</li>
            <li>Email support with the approximate time and any unfamiliar order or listing activity.</li>
          </ol>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/account/settings" className="rounded-xl bg-blue-700 px-5 py-3 font-semibold text-white hover:bg-blue-800">
              Account settings
            </Link>
            <Link href="/support" className="rounded-xl border border-slate-300 bg-white px-5 py-3 font-semibold hover:bg-slate-50">
              Contact support
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
