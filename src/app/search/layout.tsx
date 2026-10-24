import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Search the marketplace",
  description:
    "Search products, services, transport and property listings from verified providers on Shilevi.",
  alternates: { canonical: "/search" },
  // Result pages are generated from query strings; indexing them creates duplicate thin pages.
  robots: { index: false, follow: true },
};

export default function SearchLayout({ children }: { children: React.ReactNode }) {
  return children;
}
