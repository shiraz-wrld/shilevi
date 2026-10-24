import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/LegalPage";

export const metadata: Metadata = {
  title: "Cookies",
  description: "The cookies and local storage Shilevi uses, what they do, and how to control them.",
  alternates: { canonical: "/legal/cookies" },
};

export default function CookiesPage() {
  return (
    <LegalPage
      title="Cookies and local storage"
      summary="We keep this short on purpose. This page lists what the platform actually stores in your browser today, not a generic template list."
      sections={[
        {
          heading: "Strictly necessary",
          paragraphs: [
            "These keep you signed in and protect your session. They cannot be turned off without breaking login.",
          ],
          bullets: [
            "Supabase authentication cookies (sb-*) — hold your session token and refresh token, set by our auth provider.",
            "CSRF-token cookies associated with the auth session — protect state-changing requests.",
          ],
        },
        {
          heading: "Local storage",
          paragraphs: [
            "We use browser local storage for the shopping cart so that items survive a page reload. It is not sent to our servers until you place an order.",
            "Key: shilevi.cart.v1 — item ids, titles, prices, quantity and currency for the cart you are building on this device.",
            "The cookie banner uses a small local-storage flag to remember that you dismissed it.",
          ],
        },
        {
          heading: "Analytics and advertising",
          paragraphs: [
            "No analytics or advertising cookies are set by default in this build. If we add them later, they will be off until you opt in, and this page will list them by name and purpose before they are enabled.",
          ],
        },
        {
          heading: "How to control them",
          bullets: [
            "Clear site data in your browser settings to remove the cart and session cookies.",
            "Blocking strictly necessary cookies will prevent you from signing in or completing an order.",
            "Private browsing deletes these when you close the window.",
          ],
        },
        {
          heading: "Do Not Track",
          paragraphs: ["We do not currently run cross-site tracking, so there is nothing to switch off. If that changes, we will honour Global Privacy Control signals where technically possible."],
        },
      ]}
      related={[
        { href: "/legal/privacy", label: "Privacy notice" },
        { href: "/legal/terms", label: "Terms of service" },
      ]}
    />
  );
}
