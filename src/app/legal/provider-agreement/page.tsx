import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/LegalPage";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Provider agreement",
  description: "The terms that apply to sellers, service providers, transport partners and property providers on Shilevi.",
  alternates: { canonical: "/legal/provider-agreement" },
};

export default function ProviderAgreementPage() {
  return (
    <LegalPage
      title="Provider agreement"
      summary="These terms apply once your provider application is approved. Applying does not guarantee approval, and approval for one activity does not authorise another."
      sections={[
        {
          heading: "What you are approved for",
          bullets: [
            "Approval is granted per activity: product seller, service provider, transport partner, or property and places provider.",
            "Each activity is tied to specific categories. You may only publish listings in the categories you were approved for.",
            "Publishing a listing in the wrong division is treated as a breach, not a technicality.",
          ],
        },
        {
          heading: "Verification",
          paragraphs: [
            "We may ask for identity, business registration, vehicle, licence or insurance documents. Documents are stored privately and are never shown to customers.",
            "We may re-verify at any time, and we may suspend a provider whose documents expire, are revoked, or cannot be validated.",
          ],
        },
        {
          heading: "Listings and accuracy",
          bullets: [
            "Describe what you actually sell: condition, size, materials, delivery terms, and any restriction that matters.",
            "Use your own photos or photos you have permission to use.",
            "Do not list prohibited items, counterfeits, stolen goods, or anything you cannot lawfully sell in Kenya.",
            "Keep stock and availability honest. Cancel promptly when something is unavailable instead of stalling the order.",
          ],
        },
        {
          heading: "Commission and fees",
          paragraphs: [
            "Commission defaults to 10% of the item subtotal and is shown on your provider pages. The rate that applies to an order is fixed when the order is created.",
            "Where you choose platform delivery, the delivery fee is collected from the customer and split between the platform and the rider.",
            "Payment-provider charges are deducted as disclosed on the payout statement.",
          ],
        },
        {
          heading: "Fulfilment",
          bullets: [
            "Accept or decline orders within the time shown on the order.",
            "Prepare and hand over within the promised window. Repeated late handovers affect your visibility and can lead to suspension.",
            "Use the status updates honestly. Marking an order dispatched when it has not left is a fulfilment breach.",
            "Pack goods so they survive normal transport.",
          ],
        },
        {
          heading: "Payouts",
          paragraphs: [
            "Payout eligibility begins after delivery is confirmed and the dispute window closes. Payouts are made to the mobile-money or bank details you registered, after verification.",
            "We may hold or reverse a payout where there is a dispute, a chargeback, a fraud signal, a negative balance, or a legal requirement.",
          ],
        },
        {
          heading: "Customer data",
          paragraphs: [
            "You receive a customer's phone number and delivery address for one purpose: completing that order. Do not use it for marketing, do not add it to a personal database, and do not share it.",
            "This obligation continues after the order closes.",
          ],
        },
        {
          heading: "Reviews and disputes",
          paragraphs: [
            "You may reply to a review but not edit or delete it. Ask for removal only where it breaches the acceptable use policy.",
            "Respond to disputes within the stated window. Ignoring a dispute can result in a decision against you.",
          ],
        },
        {
          heading: "Suspension and termination",
          paragraphs: [
            "We may pause listings or suspend an account for counterfeit goods, fraud, unsafe products, harassment, repeated non-fulfilment, or failure to cooperate with a dispute.",
            "You may stop using the platform at any time. Orders already accepted and paid must still be fulfilled or refunded.",
          ],
        },
        {
          heading: "Tax and compliance",
          paragraphs: [
            "You are responsible for your own tax registration, invoices and filings, and for any licence your activity requires.",
            `We may ask for information needed to meet our own obligations. Questions: ${site.supportEmail}.`,
          ],
        },
      ]}
      related={[
        { href: "/legal/acceptable-use", label: "Acceptable use" },
        { href: "/legal/refunds", label: "Refunds & returns" },
        { href: "/provider/apply", label: "Apply as a provider" },
      ]}
    />
  );
}
