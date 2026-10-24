import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Create an account",
  description: "Create a Shilevi account to buy, sell, deliver or list property and places in Kenya.",
  alternates: { canonical: "/signup" },
};

export default function SignupLayout({ children }: { children: React.ReactNode }) {
  return children;
}
