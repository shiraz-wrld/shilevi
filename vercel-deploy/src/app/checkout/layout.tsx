import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Checkout",
  description: "Confirm delivery details and place your Shilevi order.",
  robots: { index: false, follow: false },
};

export default function CheckoutLayout({ children }: { children: React.ReactNode }) {
  return children;
}
