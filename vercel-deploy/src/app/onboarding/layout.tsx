import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Complete your profile",
  description: "Tell Shilevi how you want to use the marketplace.",
  robots: { index: false, follow: false },
};

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
