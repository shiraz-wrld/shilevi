/**
 * Capability model.
 *
 * Roles are coarse labels a person carries; capabilities are the exact actions the platform
 * allows. Screens and server actions should ask "does this actor hold this capability?", never
 * "is this person an admin?".
 *
 * Pure module: no React, no database, no environment access. The database remains the final
 * authority — RLS policies and security-definer functions must enforce the same rules.
 */

export const capabilities = [
  // Customer
  "order:create",
  "order:read:own",
  "order:cancel:own",
  "order:confirm:own",
  "refund:request:own",
  "review:write:own",
  "profile:manage:own",
  "saved:manage:own",
  "request:create:own",

  // Provider
  "provider:apply",
  "listing:create:own",
  "listing:publish:request",
  "order:read:provider",
  "order:fulfil",
  "earnings:read:own",
  "payout:request:own",

  // Rider / transport partner
  "delivery:claim",
  "delivery:update:assigned",
  "delivery:proof",
  "earnings:read:rider",

  // Staff and operations
  "admin:access",
  "admin:application:review",
  "admin:listing:moderate",
  "admin:taxonomy:manage",
  "admin:brand:manage",
  "admin:order:inspect",
  "admin:payment:inspect",
  "admin:refund:decide",
  "admin:payout:approve",
  "admin:dispute:resolve",
  "admin:user:restrict",
  "admin:deletion:process",
  "admin:settings:manage",
  "admin:staff:manage",
  "admin:audit:read",
] as const;

export type Capability = (typeof capabilities)[number];

export type Role = "customer" | "provider" | "rider" | "support" | "finance" | "moderator" | "owner";

const customerCapabilities: Capability[] = [
  "order:create",
  "order:read:own",
  "order:cancel:own",
  "order:confirm:own",
  "refund:request:own",
  "review:write:own",
  "profile:manage:own",
  "saved:manage:own",
  "request:create:own",
];

const providerCapabilities: Capability[] = [
  "provider:apply",
  "listing:create:own",
  "listing:publish:request",
  "order:read:provider",
  "order:fulfil",
  "earnings:read:own",
  "payout:request:own",
];

const riderCapabilities: Capability[] = [
  "delivery:claim",
  "delivery:update:assigned",
  "delivery:proof",
  "earnings:read:rider",
];

/**
 * Staff roles are additive on top of customer abilities: staff are people too, and they may
 * order on the same account. Capabilities never include another person's private data by default.
 */
export const roleCapabilities: Record<Role, readonly Capability[]> = {
  customer: customerCapabilities,
  provider: providerCapabilities,
  rider: riderCapabilities,
  support: ["admin:access", "admin:order:inspect", "admin:dispute:resolve", "admin:application:review"],
  finance: [
    "admin:access",
    "admin:order:inspect",
    "admin:payment:inspect",
    "admin:refund:decide",
    "admin:payout:approve",
    "admin:audit:read",
  ],
  moderator: [
    "admin:access",
    "admin:listing:moderate",
    "admin:application:review",
    "admin:user:restrict",
    "admin:audit:read",
  ],
  owner: ["admin:access", ...capabilities.filter(capability => capability.startsWith("admin:"))],
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && value in roleCapabilities;
}

export function capabilitiesFor(roles: readonly Role[]): Set<Capability> {
  const granted = new Set<Capability>();
  for (const role of roles) {
    for (const capability of roleCapabilities[role] ?? []) granted.add(capability);
  }
  return granted;
}

export function can(roles: readonly Role[], capability: Capability): boolean {
  return roles.some(role => roleCapabilities[role]?.includes(capability));
}

/** Human label for admin navigation, kept next to the capability it gates. */
export const capabilityLabels: Partial<Record<Capability, string>> = {
  "admin:application:review": "Provider applications",
  "admin:listing:moderate": "Listings",
  "admin:taxonomy:manage": "Categories",
  "admin:brand:manage": "Brands",
  "admin:order:inspect": "Orders",
  "admin:payment:inspect": "Payments",
  "admin:refund:decide": "Refunds",
  "admin:payout:approve": "Payouts",
  "admin:dispute:resolve": "Disputes",
  "admin:user:restrict": "Accounts",
  "admin:deletion:process": "Deletion requests",
  "admin:settings:manage": "Platform settings",
  "admin:staff:manage": "Staff",
  "admin:audit:read": "Audit log",
};
