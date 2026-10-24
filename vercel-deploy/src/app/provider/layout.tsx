import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { default: "Provider area", template: "%s | Providers | Shilevi" },
  description: "Apply to become a Shilevi provider, manage listings, fulfil orders and track earnings.",
  robots: { index: false, follow: false, nocache: true },
};

export default function ProviderLayout({ children }: { children: React.ReactNode }) {
  return children;
}
