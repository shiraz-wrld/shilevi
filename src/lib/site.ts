/**
 * Single source of truth for public site identity.
 *
 * Renaming the platform is a one-file change here plus the metadata templates that read from it.
 * Never put secrets in this module — everything exported here is public.
 */

function originFromEnv() {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

export const site = {
  name: "Shilevi",
  shortName: "Shilevi",
  tagline: "One place for what you need.",
  description:
    "Shop products, discover services, arrange delivery, and explore property and places through one connected Kenyan marketplace.",
  url: originFromEnv(),
  locale: "en_KE",
  country: "Kenya",
  supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim() || "support@shilevi.app",
  privacyEmail: process.env.NEXT_PUBLIC_PRIVACY_EMAIL?.trim() || "privacy@shilevi.app",
  securityEmail: process.env.NEXT_PUBLIC_SECURITY_EMAIL?.trim() || "security@shilevi.app",
  legalUpdated: "2026-10-20",
} as const;

export const divisionLabels = {
  products: "Products",
  services: "Services",
  transport_delivery: "Transport & Delivery",
  property_places: "Property & Places",
} as const;

export type Division = keyof typeof divisionLabels;

export const divisions = Object.entries(divisionLabels).map(([key, label]) => ({
  key: key as Division,
  label,
}));

/** Absolute URL helper. Rejects protocol-relative and javascript: inputs by construction. */
export function absoluteUrl(path = "/") {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${site.url}${normalized}`;
}
