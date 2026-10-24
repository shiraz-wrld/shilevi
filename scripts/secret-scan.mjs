#!/usr/bin/env node
/**
 * Secret scan.
 *
 *   node scripts/secret-scan.mjs [directory]
 *
 * Walks the given directory (default: the repository root) and reports files that contain material
 * that must never be committed or shipped to Vercel: private keys, JWTs (including Supabase
 * service-role keys), payment and email provider keys, cloud access keys and committed env files.
 *
 * The report names the file, the line and the category. It never prints the matched value, so
 * running it in a shared terminal cannot leak the secret it is warning about.
 *
 * Exit codes: 0 = clean, 1 = findings.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const target = process.argv[2] ? join(ROOT, process.argv[2]) : ROOT;

const SKIP_DIRS = new Set([".git", "node_modules", ".next", "out", "build", "coverage", ".domain-build", "reports", "archive"]);
const SKIP_FILES = new Set(["package-lock.json"]);
const MAX_BYTES = 1_000_000;

const RULES = [
  {
    name: "private key block",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/,
  },
  {
    name: "JSON Web Token (could be a Supabase service-role or anon key)",
    // Any three-part JWT. Publishable keys are not secrets, but this repository never hardcodes one.
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
  },
  {
    name: "Stripe-style secret key",
    pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{12,}/,
  },
  {
    name: "Resend API key",
    pattern: /\bre_[A-Za-z0-9]{20,}/,
  },
  {
    name: "AWS access key id",
    pattern: /\bAKIA[0-9A-Z]{16}\b/,
  },
  {
    name: "Google API key",
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/,
  },
  {
    name: "Slack token",
    pattern: /\bxox[baprs]-[0-9A-Za-z-]{10,}/,
  },
  {
    name: "GitHub token",
    pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}/,
  },
  {
    name: "Daraja consumer secret assigned a literal value",
    pattern: /MPESA_CONSUMER_SECRET\s*=\s*(?!$|\s*$|["']?\$|your|xxx|<)[A-Za-z0-9]{10,}/,
  },
  {
    name: "service-role key assigned a literal value",
    pattern: /SUPABASE_SERVICE_ROLE_KEY\s*=\s*(?!$|\s*$|["']?\$|your|xxx|<)[A-Za-z0-9._-]{20,}/,
  },
];

const findings = [];
let scanned = 0;

function isEnvFile(name) {
  return /^\.env(\.|$)/.test(name) && name !== ".env.example" && !name.endsWith(".example");
}

function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    const rel = relative(ROOT, full).split(sep).join("/");
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full);
      continue;
    }
    if (!entry.isFile() || SKIP_FILES.has(entry.name)) continue;

    if (isEnvFile(entry.name)) {
      findings.push({ file: rel, line: 0, rule: "committed environment file" });
      continue;
    }
    if (entry.name.endsWith(".pem") || entry.name.endsWith(".p12") || entry.name.endsWith(".key")) {
      findings.push({ file: rel, line: 0, rule: "key material file" });
      continue;
    }

    let size = 0;
    try {
      size = statSync(full).size;
    } catch {
      continue;
    }
    if (size > MAX_BYTES) continue;

    let text = "";
    try {
      text = readFileSync(full, "utf8");
    } catch {
      continue;
    }
    if (text.includes("\u0000")) continue; // binary
    scanned += 1;

    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (line.length > 4_000) continue;
      // A test fixture that must contain a token-shaped string can opt out explicitly. The marker
      // is deliberately verbose so it cannot be added by accident to a real credential.
      const synthetic = line.includes("secret-scan: allow-synthetic")
        || (lines[index - 1] ?? "").includes("secret-scan: allow-synthetic");
      if (synthetic) continue;
      for (const rule of RULES) {
        if (rule.pattern.test(line)) {
          findings.push({ file: rel, line: index + 1, rule: rule.name });
        }
      }
    }
  }
}

console.log(`Scanning ${relative(ROOT, target) || "."} for credentials…`);
walk(target);

if (findings.length === 0) {
  console.log(`PASS — ${scanned} text files scanned, no credentials or key material found.`);
  process.exit(0);
}

console.error(`\nFAIL — ${findings.length} finding(s). Values are deliberately not printed.`);
for (const finding of findings) {
  console.error(`  ${finding.file}${finding.line ? `:${finding.line}` : ""} — ${finding.rule}`);
}
console.error("\nRemove the material, rotate the credential with its provider, and keep only env names in source.");
process.exit(1);
