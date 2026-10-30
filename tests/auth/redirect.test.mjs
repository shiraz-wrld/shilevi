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

import fs from "node:fs";

import { isSafeNextPath, safeNextPath } from "../../src/lib/auth/redirect.ts";
import {
  nextHrefForSignupPath,
  signupActivityFor,
  signupPath,
} from "../../src/lib/auth/signup-intent.ts";

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

console.log("\n== post-authentication landing defaults ==");
// A signed-in customer belongs on their dashboard. These are the exact fallbacks the login form,
// the signup form and the OAuth callback pass, so a missing or unsafe destination cannot drop a
// customer on an application screen.
expect("login fallback is the dashboard", safeNextPath(null, "/account"), "/account");
expect("signup fallback is the dashboard", safeNextPath(undefined, "/account"), "/account");
expect("oauth callback fallback is the dashboard", safeNextPath("/not/allowed", "/account"), "/account");
// The homepage decides for itself whether to render the marketing page or the dashboard, so a
// redirect to it would be a wasted bounce rather than a destination.
expect("the marketing homepage is not a redirect target", safeNextPath("/", "/account"), "/account");
expect("a provider destination survives sign-in", safeNextPath("/provider/orders", "/account"), "/provider/orders");
expect("a rider destination survives sign-in", safeNextPath("/rider/jobs", "/account"), "/rider/jobs");

// Source guard: the forms must actually pass the dashboard fallback, not merely be able to.
for (const [file, needle] of [
  ["src/app/login/page.tsx", 'safeNextPath(requested, "/account")'],
  ["src/app/auth/callback/route.ts", 'safeNextPath(requestedNext, "/account")'],
]) {
  const source = fs.readFileSync(new URL("../../" + file, import.meta.url), "utf8");
  expect(`${file} defaults to the dashboard`, source.includes(needle), true);
}

// Signup no longer hard-codes a destination: it asks the shared account-path table from migration
// 0040. Both halves are checked — the page uses the resolver, and the resolver's default answer is
// the customer dashboard, never an application form or the sign-in screen.
console.log("\n== signup destinations ==");
expect(
  "signup routes each choice through the shared resolver",
  fs
    .readFileSync(new URL("../../src/app/signup/page.tsx", import.meta.url), "utf8")
    .includes("nextHrefForSignupPath(chosen.id)"),
  true,
);
for (const [input, expected] of [
  [undefined, "/account"],
  [null, "/account"],
  ["customer", "/account"],
  ["not-a-path", "/account"],
  ["product_seller", "/provider/apply?activity=product_seller"],
  ["service_provider", "/provider/apply?activity=service_provider"],
  ["delivery_rider", "/deliver/apply"],
  ["transport_operator", "/provider/apply?activity=transport_partner"],
  ["property_provider", "/provider/apply?activity=property_provider"],
]) {
  expect(`signup destination for ${String(input)}`, nextHrefForSignupPath(input), expected);
}
// A destination handed to the auth callback must pass the same allowlist that protects login.
for (const path of [
  "/account",
  "/provider/apply?activity=product_seller",
  "/provider/apply?activity=transport_partner",
  "/deliver/apply",
]) {
  expect(`${path} survives the callback allowlist`, isSafeNextPath(path), true);
}
expect("an unknown path value resolves to nothing", signupPath("astronaut"), null);
expect("a delivery rider stores the delivery intent", signupActivityFor("delivery_rider"), "delivery_rider");
expect("a passenger operator stores the passenger intent", signupActivityFor("transport_operator"), "transport_operator");
expect("a customer stores no provider intent", signupActivityFor("customer"), null);

console.log(`\n${checks} checks, ${failures} failure(s)`);
if (failures > 0) {
  console.error("REDIRECT VALIDATION FAILED");
  process.exit(1);
}
console.log("ALL REDIRECT CHECKS PASSED");
