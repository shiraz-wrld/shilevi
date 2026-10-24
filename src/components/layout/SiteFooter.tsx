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
      { href: "/how-it-works", label: "How it works" },
      { href: "/pricing", label: "Pricing" },
    ],
  },
  {
    heading: "Selling",
    links: [
      { href: "/provider/apply", label: "Become a provider" },
      { href: "/legal/provider-agreement", label: "Provider agreement" },
      { href: "/provider/orders", label: "Provider orders" },
      { href: "/provider/properties", label: "List a property" },
      { href: "/rider/jobs", label: "Rider jobs" },
      { href: "/rider/rides", label: "Rider passenger trips" },
    ],
  },
  {
    heading: "Support",
    links: [
      { href: "/help", label: "Help centre" },
      { href: "/support", label: "Contact support" },
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
      { href: "/legal/acceptable-use", label: "Acceptable use" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto max-w-7xl px-5 py-12 sm:px-6">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {columns.map(column => (
            <nav key={column.heading} aria-label={column.heading}>
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">{column.heading}</h2>
              <ul className="mt-4 space-y-2 text-sm">
                {column.links.map(link => (
                  <li key={link.href}>
                    <Link href={link.href} className="text-slate-700 hover:text-blue-700 hover:underline">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t border-slate-200 pt-6 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {new Date().getFullYear()} {site.name}. Built for {site.country}.
          </p>
          <p>
            <a href={`mailto:${site.supportEmail}`} className="font-medium text-blue-700 hover:underline">
              {site.supportEmail}
            </a>
          </p>
        </div>

        <p className="mt-4 max-w-3xl text-xs leading-5 text-slate-500">
          {site.name} connects independent providers and customers. Providers are responsible for the goods and
          services they offer. Payment handling and any fund-holding arrangement depends on the licensed payment
          provider that is active for your transaction; the checkout page always states which mode is in use.
        </p>
      </div>
    </footer>
  );
}
