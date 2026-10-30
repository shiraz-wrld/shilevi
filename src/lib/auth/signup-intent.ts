/**
 * The account paths a person may choose when they register.
 *
 * This list answers one question only: *which next step do we show this new account?* It is not an
 * authorization model. Registering as "Delivery rider" records an intent and sends the person to
 * the rider application; it grants nothing. The database still decides what anyone may do, through
 * `provider_applications`, `provider_activities` and the capability checks in `0033`.
 *
 * Two vocabularies meet here and must not be confused:
 *   - `activity` below is a **provider application activity** — the `provider_applications.activity_type`
 *     value the application form uses. Delivery riders and passenger operators both raise a
 *     `transport_partner` application; they differ in the activity-specific requirements (`0037`)
 *     and in whether the rider may carry passengers, not in the application type.
 *   - `signupActivity` is the narrower label stored on the profile in
 *     `user_onboarding.signup_activity` (`0040`), so support can see what the person said they
 *     wanted without inferring it from an application that may not exist yet.
 *
 * Pure module: no React, no database, no environment access, so the signup page, the onboarding
 * page and any server code can share one definition.
 */

export type SignupIntent = "customer" | "provider";

/** Mirrors `user_onboarding.signup_activity` in migration 0040. */
export const signupActivityValues = [
  "product_seller",
  "service_provider",
  "delivery_rider",
  "transport_operator",
  "property_provider",
] as const;

export type SignupActivity = (typeof signupActivityValues)[number];

/** Mirrors `provider_applications.activity_type`. */
export type ProviderActivity = "product_seller" | "service_provider" | "transport_partner" | "property_provider";

export type SignupPath = {
  id: SignupActivity | "customer";
  label: string;
  detail: string;
  /** Stored on the profile. Descriptive only. */
  signupActivity: SignupActivity | null;
  /** The application type the "continue" link applies for, when there is one. */
  activity: ProviderActivity | null;
  intent: SignupIntent;
  /** Where this account continues after registering. Always a customer account first. */
  href: string;
};

export const signupPaths: readonly SignupPath[] = [
  {
    id: "customer",
    label: "Buy and book",
    detail: "Shop products and food, hire services, request transport and find a home.",
    signupActivity: null,
    activity: null,
    intent: "customer",
    href: "/account",
  },
  {
    id: "product_seller",
    label: "Sell products or food",
    detail: "List stock, take orders and hand them to a rider or the customer.",
    signupActivity: "product_seller",
    activity: "product_seller",
    intent: "provider",
    href: "/provider/apply?activity=product_seller",
  },
  {
    id: "service_provider",
    label: "Offer a service",
    detail: "Publish services, quote for work and manage bookings.",
    signupActivity: "service_provider",
    activity: "service_provider",
    intent: "provider",
    href: "/provider/apply?activity=service_provider",
  },
  {
    id: "delivery_rider",
    label: "Deliver goods",
    detail: "Collect orders from sellers and hand them to customers with a proof code.",
    signupActivity: "delivery_rider",
    activity: "transport_partner",
    intent: "provider",
    href: "/deliver/apply",
  },
  {
    id: "transport_operator",
    label: "Carry passengers",
    detail: "Take passenger trips at an agreed fare, with your vehicle and documents reviewed.",
    signupActivity: "transport_operator",
    activity: "transport_partner",
    intent: "provider",
    href: "/provider/apply?activity=transport_partner",
  },
  {
    id: "property_provider",
    label: "List property",
    detail: "Advertise homes, rooms or venues and answer genuine enquiries.",
    signupActivity: "property_provider",
    activity: "property_provider",
    intent: "provider",
    href: "/provider/apply?activity=property_provider",
  },
];

const byId = new Map(signupPaths.map(path => [path.id as string, path]));

export function isSignupPathId(value: unknown): value is SignupPath["id"] {
  return typeof value === "string" && byId.has(value);
}

export function signupPath(value: unknown): SignupPath | null {
  return typeof value === "string" ? byId.get(value) ?? null : null;
}

/** The `signup_activity` value to store for a chosen path, or null for a plain customer. */
export function signupActivityFor(value: unknown): SignupActivity | null {
  return signupPath(value)?.signupActivity ?? null;
}

/**
 * Where a newly registered account continues.
 *
 * Unknown or missing answers land on the customer dashboard rather than an application form: the
 * account is always a customer account first, and the dashboard is where every other workspace is
 * reachable from.
 */
export function nextHrefForSignupPath(value: unknown): string {
  return signupPath(value)?.href ?? "/account";
}

/** Maps a query-string `?activity=` to a real provider application activity. */
export function providerActivityFrom(value: unknown): ProviderActivity | null {
  if (value === "product_seller" || value === "service_provider" || value === "transport_partner" || value === "property_provider") {
    return value;
  }
  return null;
}
