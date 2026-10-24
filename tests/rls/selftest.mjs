#!/usr/bin/env node
/**
 * Offline self-test for the live RLS harness.
 *
 * This proves the parts of the suite that can be verified without a hosted project: the TOTP
 * generator used to reach aal2, the configuration guards that keep the suite away from production,
 * and the outcome normaliser that classifies denials. It is not a substitute for the live run.
 */
import assert from "node:assert/strict";
import { resolveConfig } from "./lib/config.mjs";
import { base32Decode, totpCode, assuranceLevel } from "./lib/totp.mjs";
import { isDenied, rowCount } from "./lib/assertions.mjs";

let failures = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log(`ok  ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL ${name}`);
    console.log(`     ${error.message}`);
  }
};

const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; // ASCII "12345678901234567890"

check("base32 decodes the RFC 6238 secret", () => {
  assert.equal(base32Decode(RFC_SECRET).toString(), "12345678901234567890");
});

// RFC 6238 appendix B, SHA-1, 8 digits.
for (const [seconds, expected] of [
  [59, "94287082"],
  [1111111109, "07081804"],
  [1111111111, "14050471"],
  [1234567890, "89005924"],
  [2000000000, "69279037"],
  [20000000000, "65353130"],
]) {
  check(`TOTP at ${seconds}s matches RFC 6238`, () => {
    assert.equal(totpCode(RFC_SECRET, { digits: 8, at: seconds * 1000 }), expected);
  });
}

check("TOTP emits six digits by default", () => {
  assert.match(totpCode(RFC_SECRET), /^[0-9]{6}$/);
});

check("assuranceLevel reads aal from a JWT payload", () => {
  const payload = Buffer.from(JSON.stringify({ aal: "aal2", sub: "test" })).toString("base64url");
  assert.equal(assuranceLevel(`header.${payload}.signature`), "aal2");
  assert.equal(assuranceLevel("not-a-jwt"), "unknown");
  assert.equal(assuranceLevel(`header.${Buffer.from("{}").toString("base64url")}.s`), "aal1");
});

check("configuration refuses to run with no credentials", () => {
  const config = resolveConfig({});
  assert.equal(config.configured, false);
  assert.equal(config.blocked.length, 4);
});

check("configuration refuses a production-looking host", () => {
  const config = resolveConfig({
    NEXT_PUBLIC_SUPABASE_URL: "https://shilevi-prod.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "public",
    SUPABASE_SERVICE_ROLE_KEY: "secret",
    SHILEVI_RLS_ALLOW_LIVE: "1",
  });
  assert.equal(config.configured, false);
  assert.ok(config.blocked.some(reason => /production/i.test(reason)));
});

check("configuration requires the explicit live opt-in", () => {
  const config = resolveConfig({
    NEXT_PUBLIC_SUPABASE_URL: "https://staging-test.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "public",
    SUPABASE_SERVICE_ROLE_KEY: "secret",
  });
  assert.equal(config.configured, false);
  assert.ok(config.blocked.some(reason => /SHILEVI_RLS_ALLOW_LIVE/.test(reason)));
});

check("configuration accepts a staging project with explicit opt-in", () => {
  const config = resolveConfig({
    NEXT_PUBLIC_SUPABASE_URL: "https://staging-test.supabase.co/",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "public",
    SUPABASE_SERVICE_ROLE_KEY: "secret",
    SHILEVI_RLS_ALLOW_LIVE: "1",
  });
  assert.equal(config.configured, true);
  assert.equal(config.url, "https://staging-test.supabase.co");
});

check("denial classification accepts errors and empty results only", () => {
  assert.equal(isDenied({ ok: false, error: { code: "42501", message: "denied" }, data: null }), true);
  assert.equal(isDenied({ ok: true, error: null, data: [] }), true);
  // A void RPC that returned no error is a success, not a denial: it must fail the boundary test.
  assert.equal(isDenied({ ok: true, error: null, data: null }), false);
  assert.equal(isDenied({ ok: true, error: null, data: [{ id: 1 }] }), false);
  assert.equal(rowCount({ id: 1 }), 1);
  assert.equal(rowCount([]), 0);
});

check("reports stay free of secrets", async () => {
  const { redact } = await import("./lib/config.mjs");
  // A deliberately fake token used to prove report redaction. Not a credential.
  // secret-scan: allow-synthetic
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhYmMifQ.c2lnbmF0dXJl";
  assert.equal(redact(`token ${jwt} leaked`).includes("eyJhbGci"), false);
});

console.log(failures === 0 ? "\nRLS harness self-test passed" : `\n${failures} self-test check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
