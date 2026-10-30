/**
 * The two designated owner accounts.
 *
 * Kept in a plain module so middleware (edge runtime) and server components share one list instead
 * of each carrying its own copy. The database `owner_admin_allowlist` table remains the authority
 * for RLS and RPC guards; this constant only decides whether a request is worth challenging for MFA
 * or should be concealed.
 *
 * Do not widen this list to an email domain, a client-supplied role, profile metadata or a JWT
 * claim. Those are all attacker-controlled in at least one flow.
 */
export const OWNER_ADMIN_EMAILS = new Set([
  "russhiraz565@gmail.com",
  "russhiraz1@gmail.com",
]);

export function isOwnerAdminEmail(email: string | null | undefined): boolean {
  return Boolean(email && OWNER_ADMIN_EMAILS.has(email.trim().toLowerCase()));
}
