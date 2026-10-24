import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/LegalPage";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Acceptable use",
  description: "What may not be listed, said or done on Shilevi, and how reports are handled.",
  alternates: { canonical: "/legal/acceptable-use" },
};

export default function AcceptableUsePage() {
  return (
    <LegalPage
      title="Acceptable use policy"
      summary="This policy protects customers, providers and riders. It applies to listings, messages, reviews, delivery notes and account behaviour."
      sections={[
        {
          heading: "Prohibited items and services",
          bullets: [
            "Counterfeit or replica branded goods, and goods that infringe intellectual property.",
            "Stolen property, or goods you cannot prove you are entitled to sell.",
            "Weapons, ammunition, explosives and other items restricted under Kenyan law.",
            "Narcotics, unregulated medicines, prescription drugs without authority, and controlled substances.",
            "Wildlife products, protected species, and items restricted by conservation law.",
            "Human tissue, blood, and anything involving the sale of human beings or sexual services.",
            "Gambling, unlicensed financial products, pyramid schemes and get-rich-quick offers.",
            "Personal identity documents, account credentials, and stolen data.",
            "Hazardous materials that cannot be carried safely by ordinary transport partners.",
          ],
        },
        {
          heading: "Prohibited behaviour",
          bullets: [
            "Impersonating another person, business or brand.",
            "Creating multiple accounts to evade a suspension or a review decision.",
            "Manipulating ratings, reviews or orders, including paying for reviews or reviewing your own listings.",
            "Harassment, threats, hate speech, or sharing someone's private information without consent.",
            "Scraping the marketplace, probing for vulnerabilities without permission, or disrupting service.",
            "Circumventing commission by moving a platform transaction off-platform after an introduction is made here.",
            "Sending unsolicited marketing to phone numbers or addresses obtained through an order.",
          ],
        },
        {
          heading: "Listings and media",
          bullets: [
            "Use photos you own or are licensed to use. Do not copy another seller's images.",
            "Do not show people who have not consented to appear in your listing media.",
            "Describe condition, size and limitations honestly. Hiding a material defect is a misrepresentation.",
            "Keep prices and availability current so customers are not charged for things you cannot supply.",
          ],
        },
        {
          heading: "Property and places",
          bullets: [
            "Only list property you own or are authorised to market.",
            "State the true location, rent or price, deposit, and any agency fee before a viewing.",
            "Do not collect a deposit before the customer has seen the property and the terms in writing.",
          ],
        },
        {
          heading: "Reviews",
          bullets: [
            "Review only experiences you actually had on the platform.",
            "No personal attacks, discriminatory language, or private information about an individual.",
            "Providers may reply once to a review. Replies are held to the same standard.",
          ],
        },
        {
          heading: "Enforcement",
          paragraphs: [
            "Depending on severity we may remove content, pause a listing, restrict an account, hold a payout, or close an account. Serious cases involving safety or fraud may be reported to the police or a regulator.",
            "Where it is safe and lawful to do so, we tell you what rule was broken and how to appeal.",
          ],
        },
        {
          heading: "Reporting",
          paragraphs: [
            "Use the report control on a listing or order, or email support with links and screenshots.",
            `Urgent safety issues: ${site.supportEmail}. Security vulnerabilities: ${site.securityEmail}.`,
          ],
        },
      ]}
      related={[
        { href: "/legal/terms", label: "Terms of service" },
        { href: "/legal/provider-agreement", label: "Provider agreement" },
        { href: "/security", label: "Security" },
      ]}
    />
  );
}
