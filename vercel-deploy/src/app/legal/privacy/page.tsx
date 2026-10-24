import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/LegalPage";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy notice",
  description: "What personal data Shilevi collects, why, who can see it, how long it is kept, and how to exercise your rights.",
  alternates: { canonical: "/legal/privacy" },
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy notice"
      summary={`This notice explains what personal data ${site.name} collects, why we collect it, who can see it, and the choices you have. It is written against how the platform actually works today, not an aspirational future version.`}
      sections={[
        {
          heading: "Who is responsible",
          paragraphs: [
            `${site.name} is the data controller for account, order and platform data described here. Providers act as separate controllers for any data they collect from you outside the platform.`,
            `Privacy questions and rights requests: ${site.privacyEmail}.`,
          ],
        },
        {
          heading: "What we collect",
          bullets: [
            "Account data: email address, password (stored only as a hash by our auth provider), authentication provider, email verification state, and multi-factor enrolment for staff.",
            "Profile data: name, optional phone number, country, county or town, and the intents you select during onboarding.",
            "Provider data: activity type, application answers, business or property descriptions, and the status of your application.",
            "Order data: items, quantities, prices, delivery method, delivery address, contact phone, order notes, status history, and handover proof references.",
            "Delivery data: assignment, status updates and, while a delivery is active, location updates shared by the rider app.",
            "Payment data: provider references, amounts, status and refund or payout records. We do not store full card numbers or mobile-money PINs.",
            "Technical data: IP address, device and browser type, session cookies, and security events such as failed sign-ins.",
            "Listing and message content: photos, descriptions, saved listings and enquiries you send.",
          ],
        },
        {
          heading: "Why we use it",
          bullets: [
            "To create and secure your account, verify your email, and keep you signed in.",
            "To take, price, fulfil and deliver orders, and to let the provider and assigned rider see what they need to complete the job.",
            "To review provider applications and decide what a provider is allowed to list.",
            "To handle refunds, disputes, fraud prevention, abuse reports and safety incidents.",
            "To send transactional messages about your orders and account.",
            "To meet legal, tax and accounting obligations, and to produce aggregated analytics about how the marketplace is used.",
          ],
        },
        {
          heading: "Legal bases",
          paragraphs: [
            "Under the Kenya Data Protection Act, 2019 we rely on: performance of a contract (orders, delivery, payouts); our legitimate interests (security, fraud prevention, service improvement); consent (optional marketing and non-essential cookies); and legal obligation (tax, accounting, lawful requests).",
            "You can withdraw consent at any time for anything based on consent, without affecting processing that already happened.",
          ],
        },
        {
          heading: "Who can see your data",
          bullets: [
            "The provider you order from sees the items, your contact phone, the delivery address and your order notes.",
            "The assigned rider sees the pick-up and drop-off details only after accepting the job.",
            "Our staff see only what their role requires. Access to financial and identity data is limited to finance and owner roles, and sensitive actions are written to an audit log.",
            "Other customers see your public listings and, where you review a provider, the review text and display name you chose.",
            "Service providers that host or support the platform (hosting, database, authentication, email, SMS, payment, maps, storage) process data on our instructions.",
            "We disclose data where the law requires it, or to protect someone's safety.",
          ],
        },
        {
          heading: "Precise location",
          paragraphs: [
            "Precise location is used only for an active delivery or an explicitly started navigation session. It is not collected at sign-up, not shown on public listings, and not retained after the delivery is closed beyond the delivery record needed for disputes.",
          ],
        },
        {
          heading: "Payments",
          paragraphs: [
            "Mobile-money and card payments are processed by the licensed payment provider that is active for your transaction. That provider receives the information needed to process the payment and is responsible for its own notices.",
            "The checkout page always states whether a live provider or a sandbox is in use. In sandbox mode no real money moves.",
          ],
        },
        {
          heading: "How long we keep it",
          bullets: [
            "Account and profile data: while your account is open, then for the period needed to handle disputes, chargebacks and legal claims.",
            "Order, payment and payout records: retained for the period required by Kenyan tax and accounting law.",
            "Application and verification evidence: retained while the provider relationship is active and for a short period afterwards, then deleted or anonymised.",
            "Security and audit logs: retained for a limited period for investigations.",
            "Location during delivery: retained only as long as needed for the delivery record and any dispute.",
          ],
        },
        {
          heading: "Your rights",
          bullets: [
            "Access a copy of the personal data we hold about you.",
            "Correct inaccurate data from your account settings.",
            "Request deletion. Deletion is a reviewed request, not an automatic wipe, because open orders, payouts, disputes and legal retention can require us to keep specific records.",
            "Object to or restrict certain processing, and withdraw consent for optional processing.",
            "Request a portable copy of data you provided.",
            "Complain to the Office of the Data Protection Commissioner (ODPC) in Kenya.",
          ],
        },
        {
          heading: "Account deletion",
          paragraphs: [
            "Use Account settings to submit a deletion request. We review it, tell you what will be deleted and what must be retained, and complete the deletion once open orders and financial obligations are settled.",
          ],
        },
        {
          heading: "Cookies and similar technology",
          paragraphs: [
            "We use strictly necessary cookies for sign-in and security. Non-essential analytics or advertising cookies are off unless you enable them. See the cookies notice for the current list.",
          ],
        },
        {
          heading: "Children",
          paragraphs: ["The marketplace is for people aged 18 and over. We do not knowingly create accounts for children. If you believe a child has an account, contact us and we will remove it."],
        },
        {
          heading: "Security",
          paragraphs: [
            "Passwords are hashed by our auth provider, sessions are short-lived and refreshed, staff accounts require multi-factor authentication, and database access is restricted by row-level policies so one person cannot read another person's orders.",
            "No system is perfectly secure. If you find a vulnerability, please report it through the security page rather than testing it against real accounts.",
          ],
        },
        {
          heading: "Changes",
          paragraphs: ["We will post any material change to this notice here with a new date. Where the change significantly affects your rights, we will tell you in the app or by email."],
        },
      ]}
      related={[
        { href: "/legal/cookies", label: "Cookies" },
        { href: "/legal/terms", label: "Terms of service" },
        { href: "/security", label: "Security" },
      ]}
    />
  );
}
