/**
 * Minimal RFC 6238 TOTP generator (SHA-1, 6 digits, 30 second period).
 *
 * The owner and staff authorization paths require an `aal2` session, so the suite must be able to
 * complete a real MFA challenge against the hosted project. Supabase returns the base32 shared
 * secret at enrolment; this converts it into the current code.
 */
import { createHmac } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Decode(input) {
  const cleaned = String(input ?? "").toUpperCase().replace(/=+$/, "").replace(/\s+/g, "");
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of cleaned) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) throw new Error("Invalid base32 character in TOTP secret.");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function totpCode(secret, { digits = 6, period = 30, at = Date.now() } = {}) {
  const counter = Math.floor(at / 1000 / period);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", base32Decode(secret)).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 10 ** digits).padStart(digits, "0");
}

/**
 * Decodes the assurance level from a Supabase access token without verifying it. This is only used
 * to report which level a test session actually reached.
 */
export function assuranceLevel(accessToken) {
  try {
    const payload = String(accessToken).split(".")[1];
    if (!payload) return "unknown";
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof json.aal === "string" ? json.aal : "aal1";
  } catch {
    return "unknown";
  }
}
