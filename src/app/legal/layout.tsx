import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";

export const metadata: Metadata = {
  title: { default: "Legal", template: "%s | Legal | Shilevi" },
  description: "Terms of service, privacy notice, cookies, refunds, provider agreement and acceptable use for Shilevi.",
  alternates: { canonical: "/legal" },
};

const documents = [
  { href: "/legal/terms", label: "Terms of service" },
  { href: "/legal/privacy", label: "Privacy notice" },
  { href: "/legal/cookies", label: "Cookies" },
  { href: "/legal/refunds", label: "Refunds & returns" },
  { href: "/legal/provider-agreement", label: "Provider agreement" },
  { href: "/legal/acceptable-use", label: "Acceptable use" },
];

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <SiteHeader />
      <div className="border-b border-slate-200 bg-white">
        <nav aria-label="Legal documents" className="mx-auto flex max-w-7xl gap-x-5 gap-y-2 overflow-x-auto px-5 py-3 text-sm sm:px-6">
          {documents.map(document => (
            <Link key={document.href} href={document.href} className="whitespace-nowrap text-slate-600 hover:text-blue-700">
              {document.label}
            </Link>
          ))}
        </nav>
      </div>
      {children}
      <SiteFooter />
    </div>
  );
}
