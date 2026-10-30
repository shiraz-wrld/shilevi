import Link from "next/link";
import { site } from "@/lib/site";

const columns = [
  {
    heading: "Marketplace",
    links: [
      { href: "/marketplace/products", label: "Products" },
      { href: "/marketplace/services", label: "Services" },
      { href: "/transport", label: "Passenger transport" },
      { href: "/house-hunt", label: "House Hunt" },
      { href: "/marketplace/transport_delivery", label: "Delivery" },
      { href: "/marketplace/property_places", label: "Property & places" },
      { href: "/search", label: "Search" },
    ],
  },
  {
    heading: "Earn with Shilevi",
    links: [
      { href: "/provider/apply", label: "Become a provider" },
      { href: "/provider/orders", label: "Provider orders" },
      { href: "/provider/properties", label: "List a property" },
      { href: "/rider/jobs", label: "Rider jobs" },
      { href: "/rider/rides", label: "Rider passenger trips" },
      { href: "/pricing", label: "Pricing" },
    ],
  },
  {
    heading: "Support",
    links: [
      { href: "/help", label: "Help centre" },
      { href: "/support", label: "Contact support" },
      { href: "/how-it-works", label: "How it works" },
      { href: "/legal/refunds", label: "Refunds & returns" },
      { href: "/safety", label: "Safety" },
      { href: "/accessibility", label: "Accessibility" },
      { href: "/security", label: "Report a security issue" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { href: "/legal", label: "All legal documents" },
      { href: "/legal/terms", label: "Terms of service" },
      { href: "/legal/privacy", label: "Privacy notice" },
      { href: "/legal/cookies", label: "Cookies" },
      { href: "/legal/provider-agreement", label: "Provider agreement" },
      { href: "/legal/acceptable-use", label: "Acceptable use" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="mt-auto bg-ink-950 text-ink-200">
      <div className="shilevi-shell py-14">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)]">
          <div>
            <Link href="/" className="inline-flex items-center gap-2.5 text-white">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand-400 via-brand-600 to-brand-800">
                <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 text-white">
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
            <p className="mt-4 max-w-sm text-sm leading-6 text-ink-300">
              {site.tagline} Shop products, book services, move people and parcels, and explore
              property through one connected Kenyan marketplace.
            </p>
            <a
              href={`mailto:${site.supportEmail}`}
              className="mt-5 inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-white transition-colors hover:border-white/35"
            >
              {site.supportEmail}
            </a>
          </div>

          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {columns.map(column => (
              <nav key={column.heading} aria-label={column.heading}>
                <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-ink-400">{column.heading}</h2>
                <ul className="mt-4 space-y-2.5 text-sm">
                  {column.links.map(link => (
                    <li key={link.href}>
                      <Link href={link.href} className="text-ink-200 transition-colors hover:text-white">
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-4 border-t border-white/10 pt-6 text-xs leading-6 text-ink-400 sm:flex-row sm:items-start sm:justify-between">
          <p>
            © {new Date().getFullYear()} {site.name}. Built for {site.country}.
          </p>
          <p className="max-w-2xl sm:text-right">
            Providers are responsible for the goods and services they offer. Payment handling and any
            fund-holding arrangement depends on the licensed payment provider active for your
            transaction; checkout always states which mode is in use.
          </p>
        </div>
      </div>
    </footer>
  );
}
