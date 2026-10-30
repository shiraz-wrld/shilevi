#!/usr/bin/env node
/**
 * Owner/staff access decisions and console error classification.
 *
 * These are the branches that decide whether `/admin` exists for a caller and whether a failed read
 * is reported as a migration problem, an MFA problem or a permission problem. They are pure, so
 * they are tested directly — no browser, no database, no network.
 */

import {
  decideOwnerGate,
  decideStaffGate,
  stepUpDestination,
} from "../../src/lib/admin/access.ts";
import { classifyAdminReadFailure, describeAdminReadFailure } from "../../src/lib/admin/errors.ts";

let checks = 0;
let failures = 0;

function check(name, condition) {
  checks += 1;
  if (condition) {
    console.log(`PASS  ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL  ${name}`);
  }
}

const owner = {
  hasSession: true,
  emailVerified: true,
  ownerEmail: true,
  currentLevel: "aal2",
  hasVerifiedFactor: true,
  requireAal2: true,
};

// ---------------------------------------------------------------- owner gate

check(
  "anonymous visitor is concealed",
  decideOwnerGate({ ...owner, hasSession: false, emailVerified: false, ownerEmail: false, currentLevel: null }) ===
    "conceal",
);
check(
  "signed-in non-owner at aal2 is concealed",
  decideOwnerGate({ ...owner, ownerEmail: false }) === "conceal",
);
check(
  "unverified owner email is concealed",
  decideOwnerGate({ ...owner, emailVerified: false }) === "conceal",
);
check("owner at aal2 is allowed", decideOwnerGate(owner) === "allow");
check(
  "owner at aal1 with a verified factor is asked to step up",
  decideOwnerGate({ ...owner, currentLevel: "aal1" }) === "step-up",
);
check(
  "owner at aal1 without a factor is sent to enrolment",
  decideOwnerGate({ ...owner, currentLevel: "aal1", hasVerifiedFactor: false }) === "enroll",
);
check(
  "setup surface is reachable at aal1",
  decideOwnerGate({ ...owner, currentLevel: "aal1", requireAal2: false }) === "allow",
);
check(
  "setup surface still requires the owner allowlist",
  decideOwnerGate({ ...owner, currentLevel: "aal1", requireAal2: false, ownerEmail: false }) === "conceal",
);

// ---------------------------------------------------------------- staff gate

const staff = {
  hasSession: true,
  emailVerified: true,
  ownerEmail: false,
  currentLevel: "aal2",
  hasVerifiedFactor: true,
  hasActiveGrant: true,
  capabilitySatisfied: true,
};

check("staff with the capability at aal2 is allowed", decideStaffGate(staff) === "allow");
check(
  "staff without the requested capability is concealed",
  decideStaffGate({ ...staff, capabilitySatisfied: false }) === "conceal",
);
check("staff at aal1 is asked to step up", decideStaffGate({ ...staff, currentLevel: "aal1" }) === "step-up");
check(
  "staff at aal1 without a factor is concealed, never told to enrol",
  decideStaffGate({ ...staff, currentLevel: "aal1", hasVerifiedFactor: false }) === "conceal",
);
check(
  "signed-in account with no grant is concealed",
  decideStaffGate({ ...staff, hasActiveGrant: false, capabilitySatisfied: false }) === "conceal",
);
check(
  "anonymous staff-gated request is concealed",
  decideStaffGate({ ...staff, hasSession: false, capabilitySatisfied: false }) === "conceal",
);
check(
  "an owner is never admitted through the staff path",
  decideStaffGate({ ...staff, ownerEmail: true }) === "conceal",
);

// ---------------------------------------------------------------- step-up destination

check("step-up keeps a real admin path", stepUpDestination("/admin/refunds") === "/admin/refunds");
check("step-up rejects a foreign path", stepUpDestination("/account") === "/admin");
check("step-up rejects a protocol-relative path", stepUpDestination("//evil.example") === "/admin");
check("step-up rejects a missing path", stepUpDestination(null) === "/admin");

// ---------------------------------------------------------------- error classification

check(
  "missing function is reported as not installed",
  classifyAdminReadFailure({ code: "PGRST202", message: "Could not find the function public.admin_list_staff" }) ===
    "not-installed",
);
check(
  "missing relation is reported as not installed",
  classifyAdminReadFailure({ code: "42P01", message: 'relation "public.notification_outbox" does not exist' }) ===
    "not-installed",
);
check(
  "aal2 refusal is reported as an MFA problem",
  classifyAdminReadFailure({ message: "Owner-only refund decision. Requires MFA level 2." }) === "mfa",
);
check(
  "owner guard refusal is reported as a permission problem",
  classifyAdminReadFailure({ message: "Not authorized." }) === "permission",
);
check(
  "expired session is reported as a session problem",
  classifyAdminReadFailure({ code: "PGRST301", message: "JWT expired" }) === "session",
);
check(
  "connection failure is reported as a network problem",
  classifyAdminReadFailure({ message: "TypeError: fetch failed" }) === "network",
);
check(
  "unknown failure keeps an actionable message",
  /could not be read/i.test(describeAdminReadFailure("Ledger entries", { message: "unexpected" })),
);
check(
  "a missing migration is named as such, not as a permission problem",
  /migration/i.test(describeAdminReadFailure("Ledger entries", { code: "PGRST202" })),
);
check(
  "an MFA failure tells the operator to verify the authenticator",
  /authenticator/i.test(describeAdminReadFailure("Staff capabilities", { message: "MFA level 2 required" })),
);
check(
  "guidance never contains a stack trace or connection string",
  !/postgres:\/\/|password=|at .*\.js:/i.test(
    describeAdminReadFailure("Payments", { message: "postgres://user:password=secret@host at db.js:1" }),
  ),
);

console.log(`\n${checks - failures}/${checks} checks passed.`);
if (failures > 0) {
  console.error(`${failures} check(s) failed.`);
  process.exit(1);
}
