import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * MFA assurance for a server-side session.
 *
 * Supabase Auth reports two levels: `currentLevel` comes from the session's `aal` claim, and
 * `nextLevel` becomes `aal2` as soon as the account has a verified factor. That means "the account
 * has an authenticator but this session has not used it yet" is expressible without a second query
 * and without guessing from the presence of a QR code.
 */
export type Assurance = {
  currentLevel: "aal1" | "aal2";
  nextLevel: "aal1" | "aal2";
  /** True when the account has at least one verified factor. */
  hasVerifiedFactor: boolean;
};

const AAL1: Assurance = { currentLevel: "aal1", nextLevel: "aal1", hasVerifiedFactor: false };

export async function readAssurance(supabase: SupabaseClient): Promise<Assurance> {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error || !data) return AAL1;

  const currentLevel = data.currentLevel === "aal2" ? "aal2" : "aal1";
  const nextLevel = data.nextLevel === "aal2" ? "aal2" : "aal1";
  return { currentLevel, nextLevel, hasVerifiedFactor: nextLevel === "aal2" };
}
