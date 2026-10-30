import Link from "next/link";
import { site } from "@/lib/site";

const assurances = [
  "Provider applications are reviewed before anything is published.",
  "Order totals and fees are calculated on the server, never in your browser.",
  "House Hunt contact details stay locked until access is paid for.",
];

/**
 * Shared authentication layout.
 *
 * The brand panel is decorative and hidden on small screens, so no credential field ever sits in a
 * cramped column. Forms own their own labels, validation and error states; this shell only frames
 * them consistently with the rest of Shilevi.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-mist-50 text-ink-900 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <section className="relative hidden overflow-hidden bg-ink-950 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="hero-atmosphere" aria-hidden="true" />
        <div className="glow-orb -left-16 top-24 h-64 w-64 bg-brand-500/40" aria-hidden="true" />
        <div className="glow-orb bottom-0 right-0 h-72 w-72 bg-accent-500/30" aria-hidden="true" />

        <Link href="/" className="relative inline-flex items-center gap-2.5 text-white">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-brand-400 via-brand-600 to-brand-800">
            <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
              <path
                d="M16.5 7.2c-.9-1-2.2-1.6-3.9-1.6-2.3 0-3.9 1.1-3.9 2.8 0 1.5 1.1 2.2 3.6 2.7l1.4.3c1.7.4 2.4.8 2.4 1.8 0 1.2-1.2 1.9-3 1.9-1.7 0-3-.6-4-1.8"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.1"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <span className="text-xl font-black tracking-tight">{site.name.toLowerCase()}</span>
        </Link>

        <div className="relative max-w-md">
          <p className="chip border-white/20 bg-white/10 text-white/85">{site.tagline}</p>
          <h2 className="mt-6 text-4xl font-black leading-tight">
            A marketplace built on verified providers and clear records.
          </h2>
          <ul className="mt-8 space-y-3 text-sm leading-6 text-ink-200">
            {assurances.map(item => (
              <li key={item} className="flex gap-3">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white/10">
                  <svg viewBox="0 0 24 24" aria-hidden="true" className="h-3.5 w-3.5 text-accent-300">
                    <path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                {item}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-ink-400">
          © {new Date().getFullYear()} {site.name}. Built for {site.country}.
        </p>
      </section>

      <section className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-md">
          <Link href="/" className="mb-8 inline-flex items-center gap-2 text-lg font-black text-ink-900 lg:hidden">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand-400 via-brand-600 to-brand-800 text-white">
              <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
                <path
                  d="M16.5 7.2c-.9-1-2.2-1.6-3.9-1.6-2.3 0-3.9 1.1-3.9 2.8 0 1.5 1.1 2.2 3.6 2.7l1.4.3c1.7.4 2.4.8 2.4 1.8 0 1.2-1.2 1.9-3 1.9-1.7 0-3-.6-4-1.8"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.1"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            {site.name.toLowerCase()}
          </Link>

          <div className="surface p-7 sm:p-9">
            <h1 className="text-3xl font-black tracking-tight">{title}</h1>
            <p className="mt-2 text-sm leading-6 text-ink-500">{subtitle}</p>
            <div className="mt-7">{children}</div>
          </div>

          {footer && <div className="mt-6 text-sm text-ink-500">{footer}</div>}
          <p className="mt-6 text-xs leading-5 text-ink-400">
            By continuing you agree to the{" "}
            <Link href="/legal/terms" className="font-semibold text-ink-600 underline underline-offset-2">
              terms of service
            </Link>{" "}
            and{" "}
            <Link href="/legal/privacy" className="font-semibold text-ink-600 underline underline-offset-2">
              privacy notice
            </Link>
            .
          </p>
        </div>
      </section>
    </main>
  );
}
