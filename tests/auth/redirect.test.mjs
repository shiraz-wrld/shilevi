#!/usr/bin/env node
/**
 * Post-authentication redirect validation.
 *
 * The login form and the auth callback share one validator. This suite is the regression test for
 * open redirects and for the "signed in, but dropped on the wrong page" defect:
 *
 *   node tests/auth/redirect.test.mjs
 *
 * Node 24 strips TypeScript types on import, so the test exercises the exact module the app ships
 * rather than a copy of its rules.
 */

import { isSafeNextPath, safeNextPath } from "../../src/lib/auth/redirect.ts";

let failures = 0;
let checks = 0;

function expect(name, actual, expected) {
  checks += 1;
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
}

console.log("== destinations that must be allowed ==");
for (const path of [
  "/account",
  "/account/settings",
  "/account/orders/8f14e45f-ceea-467f-a1b2-3c4d5e6f7a8b",
  "/admin",
  "/admin/insights",
  "/cart",
  "/checkout",
  "/onboarding",
  "/provider",
  "/provider/apply",
  "/provider/orders",
  "/rider/jobs",
  "/search?q=perfume&county=Nairobi",
  "/house-hunt",
  "/listing/8f14e45f-ceea-467f-a1b2-3c4d5e6f7a8b",
  "/reset-password",
]) {
  expect(`allow ${path}`, safeNextPath(path, "/fallback"), path);
}

console.log("\n== destinations that must be replaced by the fallback ==");
const refused = [
  "https://evil.example/account",
  "//evil.example/account",
  "/\\evil.example",
  "\\\\evil.example",
  "javascript:alert(1)",
  "account",
  "",
  "/account/../../login",
  "/api/search",
  "/login",
  "/signup",
  "/account\u0000x",
  `/account/${"a".repeat(400)}`,
  null,
  undefined,
];
for (const path of refused) {
  expect(`refuse ${JSON.stringify(path)}`, safeNextPath(path, "/fallback"), "/fallback");
}

console.log("\n== origin confusion ==");
expect("absolute https is not safe", isSafeNextPath("https://shilevi.example/account"), false);
expect("protocol-relative is not safe", isSafeNextPath("//shilevi.example/account"), false);
expect("normalised traversal is not safe", isSafeNextPath("/account/../admin"), false);

console.log(`\n${checks} checks, ${failures} failure(s)`);
if (failures > 0) {
  console.error("REDIRECT VALIDATION FAILED");
  process.exit(1);
}
console.log("ALL REDIRECT CHECKS PASSED");
