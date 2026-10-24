import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { default: "Your account", template: "%s | Account | Shilevi" },
  description: "Manage your Shilevi orders, saved listings, requests and account security.",
  robots: { index: false, follow: false, nocache: true },
};

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return children;
}
