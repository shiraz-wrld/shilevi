import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { default: "Rider area", template: "%s | Riders | Shilevi" },
  description: "Claim delivery jobs, update delivery status and confirm handover as an approved Shilevi transport partner.",
  robots: { index: false, follow: false, nocache: true },
};

export default function RiderLayout({ children }: { children: React.ReactNode }) {
  return children;
}
