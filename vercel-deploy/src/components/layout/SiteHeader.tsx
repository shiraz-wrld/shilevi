import Link from "next/link";
import { CartLink } from "@/components/cart/CartLink";
import { site } from "@/lib/site";

const links = [
  { href: "/marketplace/products", label: "Products" },
  { href: "/marketplace/services", label: "Services" },
  { href: "/transport", label: "Transport" },
  { href: "/house-hunt", label: "House Hunt" },
  { href: "/marketplace/transport_delivery", label: "Delivery" },
  { href: "/marketplace/property_places", label: "Property" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/help", label: "Help" },
];

export function SiteHeader() {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-6">
        <Link href="/" className="text-2xl font-black tracking-tight text-blue-700" aria-label={`${site.name} home`}>
          {site.name.toLowerCase()}
        </Link>
        <nav aria-label="Main navigation" className="flex flex-wrap items-center gap-4 text-sm">
          {links.map(link => (
            <Link key={link.href} href={link.href} className="hidden text-slate-700 hover:text-blue-700 sm:inline">
              {link.label}
            </Link>
          ))}
          <CartLink />
          <Link href="/account" className="text-slate-700 hover:text-blue-700">Account</Link>
          <Link href="/login" className="rounded-full bg-blue-700 px-4 py-2 font-semibold text-white hover:bg-blue-800">
            Log in
          </Link>
        </nav>
      </div>
    </header>
  );
}
