/**
 * Pure access decisions for the owner console.
 *
 * The server gate (`lib/admin/auth.ts`) gathers facts — session, verified email, owner allowlist,
 * staff grant, MFA assurance — and this module decides what to do. Keeping the decision pure means
 * every branch can be tested without a browser, a database or a network, and the gate cannot drift
 * into "allow because the page rendered".
 *
 * Decisions:
 * - `allow`   — render the page (the database still re-checks the same rules on every read/write).
 * - `step-up` — the account is authorized but the session is at aal1: ask for the authenticator code.
 * - `enroll`  — the account is authorized but has no verified factor yet: send it to setup.
 * - `conceal` — behave as though the route does not exist. No denial page, no hint, no redirect to
 *               an admin-specific login.
 */

export type GateDecision = "allow" | "step-up" | "enroll" | "conceal";

export type OwnerGateInput = {
  hasSession: boolean;
  emailVerified: boolean;
  ownerEmail: boolean;
  currentLevel: "aal1" | "aal2" | null;
  /** True when the account has at least one verified TOTP factor. */
  hasVerifiedFactor: boolean;
  /** False only for the setup surface that must be reachable before a factor exists. */
  requireAal2: boolean;
};

export function decideOwnerGate(input: OwnerGateInput): GateDecision {
  if (!input.hasSession || !input.emailVerified || !input.ownerEmail) return "conceal";
  if (!input.requireAal2) return "allow";
  if (input.currentLevel === "aal2") return "allow";
  return input.hasVerifiedFactor ? "step-up" : "enroll";
}

export type StaffGateInput = {
  hasSession: boolean;
  emailVerified: boolean;
  ownerEmail: boolean;
  currentLevel: "aal1" | "aal2" | null;
  hasVerifiedFactor: boolean;
  /** Unrevoked capability rows that belong to this account, read with its own session. */
  hasActiveGrant: boolean;
  /** `has_staff_capability()` answered true for the requested capability. */
  capabilitySatisfied: boolean;
};

/**
 * Owners are handled by `decideOwnerGate` first; this covers ordinary staff.
 *
 * A staff grant alone is not authorization: the database capability check (which itself requires
 * aal2) must also pass. A signed-in account with no grant is concealed, never told that the page
 * exists but is forbidden.
 */
export function decideStaffGate(input: StaffGateInput): GateDecision {
  if (!input.hasSession || !input.emailVerified) return "conceal";
  if (input.ownerEmail) return "conceal";
  if (input.currentLevel === "aal2") {
    return input.capabilitySatisfied ? "allow" : "conceal";
  }
  if (input.hasActiveGrant) return input.hasVerifiedFactor ? "step-up" : "conceal";
  return "conceal";
}

/** The internal path to return to after a successful step-up, when a trusted path is available. */
export function stepUpDestination(pathname: string | null | undefined, fallback = "/admin"): string {
  if (!pathname) return fallback;
  if (!pathname.startsWith("/admin")) return fallback;
  if (pathname.startsWith("//") || pathname.includes("\\")) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(pathname)) return fallback;
  return pathname;
}
