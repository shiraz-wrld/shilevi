import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/LegalPage";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Terms of service",
  description: "The rules that apply when you browse, buy, sell, deliver or provide services through Shilevi.",
  alternates: { canonical: "/legal/terms" },
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of service"
      summary={`These terms govern your use of ${site.name}: browsing the marketplace, creating an account, placing orders, and offering products, services, delivery or property as a provider.`}
      sections={[
        {
          heading: "Who we are",
          paragraphs: [
            `${site.name} operates a marketplace that connects customers with independent providers: product sellers, service providers, transport and delivery partners, and property or places providers.`,
            "Unless a page says otherwise, we are not the seller of the goods or services listed. The contract of sale for a product or service is between you and the provider who accepts your order.",
          ],
        },
        {
          heading: "Your account",
          bullets: [
            "You must give accurate information and keep your contact details current.",
            "You are responsible for activity on your account and for keeping your password and authenticator secure.",
            "You must be at least 18 years old to buy, sell or provide delivery through the platform.",
            "One person may hold one personal account. Provider activities are approved separately and are not implied by creating an account.",
            "We may suspend or restrict an account where we have evidence of fraud, abuse, impersonation or a serious safety risk. Where it is safe to do so, we tell you why.",
          ],
        },
        {
          heading: "Orders and acceptance",
          paragraphs: [
            "An order is an offer to buy from the provider. It becomes binding when the provider accepts it and payment is confirmed. The checkout page shows the items, fees, delivery method and total before you place the order.",
            "Prices, commission and fees are calculated on the server. If a price is obviously wrong, or an item becomes unavailable after payment, the provider or we may cancel that part of the order and refund the amount paid for it.",
          ],
        },
        {
          heading: "Payment",
          paragraphs: [
            "The checkout page always states which payment mode is active. When a sandbox or test mode is shown, no real money moves and no real charge is made.",
            "When a live mobile-money or card provider is active, payment is collected by that licensed provider. Funds may be held by the provider or its partner bank until the order is delivered, the dispute window closes, or a refund is decided.",
            `${site.name} does not itself hold customer funds. Our operating account receives platform commission and our share of delivery fees.`,
          ],
        },
        {
          heading: "Delivery and handover",
          paragraphs: [
            "Where you choose platform delivery, we request an approved transport partner. A rider sees the pick-up and drop-off details only after accepting the job.",
            "Delivery is confirmed with a handover code, a recipient confirmation or another proof method shown in the order. Do not share the handover code with anyone other than the rider at the point of handover.",
          ],
        },
        {
          heading: "Ratings, reviews and disputes",
          bullets: [
            "Ratings are optional. A customer cannot withhold payment by refusing to rate, and a provider cannot demand a rating to complete a job.",
            "Reviews must describe your own experience. We remove reviews that are abusive, fabricated, or that reveal another person's private information.",
            "If something goes wrong, open a refund or dispute request from the order page within the window shown there. We may ask for photos, messages or other evidence.",
            "Disputes are the mechanism for withholding money, not star ratings.",
          ],
        },
        {
          heading: "Prices, commission and fees",
          paragraphs: [
            "Provider commission defaults to 10% of the item subtotal and is shown on the provider pages and in the order record. Commission is fixed on each order when it is created, so later rate changes do not rewrite past sales.",
            "Any delivery fee, platform fee or payment-provider charge is shown before you confirm.",
          ],
        },
        {
          heading: "Your content",
          paragraphs: [
            "You keep ownership of the photos, text and documents you upload. You grant us a licence to host, resize and display that content for the purpose of running the marketplace.",
            "You must have the right to upload the content you provide, and it must not infringe anyone's intellectual property or privacy.",
          ],
        },
        {
          heading: "Service availability",
          paragraphs: [
            "We work to keep the platform available, but we do not promise uninterrupted service. We may pause features for maintenance, security or legal reasons.",
            "We are not responsible for a provider's failure to perform, but we do operate the dispute and refund process described on this site and we act on repeated or serious breaches.",
          ],
        },
        {
          heading: "Liability",
          paragraphs: [
            "Nothing in these terms limits rights you have under Kenyan consumer law that cannot be excluded.",
            "To the extent the law allows, our liability for a claim connected to the marketplace is limited to the platform fees we received on the order that gave rise to the claim.",
          ],
        },
        {
          heading: "Changes and governing law",
          paragraphs: [
            "We may update these terms. Material changes are announced on this page with a new date before they take effect for existing accounts.",
            "These terms are governed by the laws of Kenya, and the courts of Kenya have jurisdiction over disputes that are not resolved through our support and dispute process.",
          ],
        },
        {
          heading: "Contact",
          paragraphs: [`Questions about these terms: ${site.supportEmail}.`],
        },
      ]}
      related={[
        { href: "/legal/privacy", label: "Privacy notice" },
        { href: "/legal/refunds", label: "Refunds & returns" },
        { href: "/legal/provider-agreement", label: "Provider agreement" },
      ]}
    />
  );
}
