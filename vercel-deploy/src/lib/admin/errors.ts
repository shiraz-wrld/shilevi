/**
 * Honest diagnostics for owner-console reads.
 *
 * Every console page used to print the same sentence when a query failed — usually "apply migration
 * 0021" — which was wrong as soon as the real cause was an aal1 session, a revoked grant or a
 * missing GRANT. That sent operators looking for a migration problem that did not exist.
 *
 * This module classifies the failure PostgREST actually reported, then returns user-facing guidance
 * for that cause. It never includes SQL, stack traces, connection strings or credentials.
 */

export type AdminReadFailure = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

export type AdminReadProblem = "not-installed" | "mfa" | "permission" | "session" | "network" | "unknown";

export function classifyAdminReadFailure(failure: AdminReadFailure | null | undefined): AdminReadProblem {
  if (!failure) return "unknown";
  const code = (failure.code ?? "").toUpperCase();
  const text = `${failure.message ?? ""} ${failure.details ?? ""} ${failure.hint ?? ""}`;

  if (code === "PGRST202" || code === "42883" || code === "42P01" || code === "PGRST205") return "not-installed";
  if (/could not find the (function|table)|schema cache|does not exist|undefined (function|table)/i.test(text)) {
    return "not-installed";
  }
  if (/\baal2\b|mfa|authenticator|assurance level/i.test(text)) return "mfa";
  if (code === "42501" || /not authorized|permission denied|insufficient privilege/i.test(text)) return "permission";
  if (code === "PGRST301" || code === "401" || /jwt|session (is )?(missing|expired)|refresh token/i.test(text)) {
    return "session";
  }
  if (/fetch failed|network|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|timeout/i.test(text)) return "network";
  return "unknown";
}

/**
 * One sentence an operator can act on. `resource` names what was being read, never where it lives.
 */
export function describeAdminReadFailure(resource: string, failure: AdminReadFailure | null | undefined): string {
  const problem = classifyAdminReadFailure(failure);
  const code = failure?.code ? ` Reference ${failure.code}.` : "";

  switch (problem) {
    case "not-installed":
      return `${resource} is not available on this database yet. The migration that creates it has not been applied to the linked project. Run the schema verifier in docs/SUPABASE_MIGRATION.md before changing anything else.`;
    case "mfa":
      return `${resource} needs a session at MFA assurance level 2. Verify your authenticator, then reload this page. Nothing was changed.`;
    case "permission":
      return `This account is not permitted to read ${resource.toLowerCase()}. An owner can grant the matching capability under Staff access; until then the database refuses the read.`;
    case "session":
      return `Your session has expired, so ${resource.toLowerCase()} could not be read. Sign in again and reload.`;
    case "network":
      return `${resource} could not be read because the database did not answer. This is a connection problem, not a permissions or migration problem. Try again.${code}`;
    default:
      return `${resource} could not be read and the database did not explain why. Nothing was changed. Reload once; if it persists, check System health.${code}`;
  }
}
