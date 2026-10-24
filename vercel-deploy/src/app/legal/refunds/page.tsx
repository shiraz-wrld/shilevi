import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/LegalPage";

export const metadata: Metadata = {
  title: "Refunds and returns",
  description: "How refunds, returns, cancellations and disputes work on Shilevi, including what happens before and after delivery.",
  alternates: { canonical: "/legal/refunds" },
};

export default function RefundsPage() {
  return (
    <LegalPage
      title="Refunds and returns"
      summary="What you can do when an order is wrong, late, damaged or never arrives — and what the provider and platform each control."
      sections={[
        {
          heading: "Before the provider accepts",
          paragraphs: [
            "You can cancel from the order page while the order is still waiting for the provider. A paid order is refunded to the original payment method.",
          ],
        },
        {
          heading: "After acceptance, before delivery",
          bullets: [
            "The provider may cancel if the item is unavailable, damaged or mispriced. You receive a refund for the affected items.",
            "If you cancel after preparation has started, the provider may deduct reasonable costs that are shown to you before you confirm the cancellation.",
            "Delivery fees are refunded when no delivery took place.",
          ],
        },
        {
          heading: "After delivery",
          bullets: [
            "Open a refund request from the order page within the window shown there. Describe the problem and add photos where they help.",
            "Do not send the item back until the provider or support confirms how and where to return it.",
            "If the item is materially different from the listing, damaged, or missing parts, you are entitled to a replacement or refund under Kenyan consumer law.",
            "Change-of-mind returns depend on the provider and the item. Perishable goods, personalised items, and items that cannot be resold for hygiene reasons are normally excluded, and the listing should say so.",
          ],
        },
        {
          heading: "How a refund is decided",
          paragraphs: [
            "The provider responds first. If you disagree, the request moves to platform review. A reviewer looks at the order record, the listing description, the messages and any evidence, then decides.",
            "Approved refunds are recorded in the ledger and returned to the original payment method. Mobile-money refunds normally land within a few business days; card refunds depend on your bank.",
          ],
        },
        {
          heading: "Disputes",
          paragraphs: [
            "A dispute pauses provider payout for the affected amount until it is resolved. That is why disputes — not star ratings — are the mechanism for withholding money.",
            "Repeated or bad-faith disputes can lead to restrictions on an account, and so can repeated failures by a provider.",
          ],
        },
        {
          heading: "Sandbox mode",
          paragraphs: [
            "While checkout is in sandbox mode, orders and refunds are recorded but no real money moves. The checkout page always states which mode is active.",
          ],
        },
        {
          heading: "Contact",
          paragraphs: ["If you cannot open a request from the order page, contact support and include your order number."],
        },
      ]}
      related={[
        { href: "/legal/terms", label: "Terms of service" },
        { href: "/support", label: "Contact support" },
        { href: "/help", label: "Help centre" },
      ]}
    />
  );
}
