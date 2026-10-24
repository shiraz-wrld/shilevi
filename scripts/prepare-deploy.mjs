#!/usr/bin/env node
/**
 * Build (and verify) the self-contained Vercel deployment folder.
 *
 *   node scripts/prepare-deploy.mjs          # rewrite vercel-deploy/ from the source of truth
 *   node scripts/prepare-deploy.mjs --check  # fail if vercel-deploy/ or its manifest has drifted
 *
 * Source of truth
 * ---------------
 * The repository root is authoritative. `vercel-deploy/` is generated output: never edit files
 * there by hand, edit the root file and re-run this script. `docs/DEPLOY_MANIFEST.json` records the
 * exact file list and SHA-256 of every shipped file, so drift is detectable and reviewable.
 *
 * What ships: the Next.js application (source, configuration, lockfile, public assets) and the safe
 * environment template. What does not: migrations, tests, audit scripts, project documentation,
 * local reports, caches and dependency directories.
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";

const CHECK = process.argv.includes("--check");
const ROOT = process.cwd();
const OUT = join(ROOT, "vercel-deploy");
const MANIFEST = join(ROOT, "docs", "DEPLOY_MANIFEST.json");

/** Files copied verbatim from the repository root. */
const ROOT_FILES = [
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "next.config.ts",
  "postcss.config.mjs",
  "eslint.config.mjs",
  "next-env.d.ts",
  "README.md",
  ".env.example",
  ".gitignore",
];

/** Directories copied recursively (never generated output). */
const ROOT_DIRS = ["src", "public"];

const FORBIDDEN_IN_OUTPUT = [
  /^supabase\//,
  /^tests\//,
  /^docs\//,
  /^scripts\//,
  /^archive\//,
  /^reports\//,
  /^\.github\//,
  /^\.next\//,
  /^node_modules\//,
  /(^|\/)\.env$/,
  /(^|\/)\.env\.(?!example$)/,
  /\.sql$/,
  /\.log$/,
];

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

/** Install and build output that a local verification build creates; never part of the bundle. */
const PRESERVE_AT_ROOT = new Set(["node_modules", ".next", ".vercel"]);

function listFiles(directory, prefix = "") {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === ".DS_Store") continue;
    if (!prefix && PRESERVE_AT_ROOT.has(entry.name)) continue;
    const full = join(directory, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...listFiles(full, rel));
    } else if (entry.isFile()) {
      files.push(rel);
    }
  }
  return files.sort();
}

/** The authoritative set of files that must exist in vercel-deploy/, mapped to their content. */
function collectSource() {
  const files = new Map();

  for (const name of ROOT_FILES) {
    const full = join(ROOT, name);
    if (!existsSync(full)) {
      throw new Error(`Required deployment file is missing from the repository root: ${name}`);
    }
    files.set(name, readFileSync(full));
  }

  for (const directory of ROOT_DIRS) {
    const full = join(ROOT, directory);
    if (!existsSync(full)) continue;
    for (const rel of listFiles(full, directory)) {
      files.set(rel, readFileSync(join(ROOT, rel)));
    }
  }

  for (const path of files.keys()) {
    const forbidden = FORBIDDEN_IN_OUTPUT.find(pattern => pattern.test(path));
    if (forbidden) throw new Error(`Refusing to ship a non-application path: ${path}`);
  }

  return files;
}

function readManifest() {
  if (!existsSync(MANIFEST)) return null;
  try {
    return JSON.parse(readFileSync(MANIFEST, "utf8"));
  } catch {
    return null;
  }
}

function gitCommit() {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return "uncommitted";
  }
}

const source = collectSource();

if (CHECK) {
  const problems = [];

  if (!existsSync(OUT)) {
    problems.push("vercel-deploy/ does not exist — run `npm run deploy:sync`.");
  } else {
    const shipped = new Set(listFiles(OUT));

    for (const path of source.keys()) {
      if (!shipped.has(path)) problems.push(`missing from vercel-deploy/: ${path}`);
    }
    for (const path of shipped) {
      if (!source.has(path)) problems.push(`unexpected file in vercel-deploy/: ${path}`);
    }
    for (const path of source.keys()) {
      if (!shipped.has(path)) continue;
      const onDisk = readFileSync(join(OUT, path));
      if (sha256(onDisk) !== sha256(source.get(path))) problems.push(`stale copy in vercel-deploy/: ${path}`);
    }
  }

  const manifest = readManifest();
  if (!manifest) {
    problems.push("docs/DEPLOY_MANIFEST.json is missing — run `npm run deploy:sync`.");
  } else {
    const recorded = new Map((manifest.files ?? []).map(entry => [entry.path, entry.sha256]));
    for (const [path, content] of source) {
      if (!recorded.has(path)) problems.push(`manifest is missing: ${path}`);
      else if (recorded.get(path) !== sha256(content)) problems.push(`manifest hash is stale: ${path}`);
    }
    for (const path of recorded.keys()) {
      if (!source.has(path)) problems.push(`manifest lists a file that should not ship: ${path}`);
    }
  }

  if (problems.length) {
    console.error(`FAIL — vercel-deploy/ is out of sync (${problems.length} problem(s)):`);
    for (const problem of problems.slice(0, 40)) console.error(`  ${problem}`);
    if (problems.length > 40) console.error(`  … ${problems.length - 40} more`);
    process.exit(1);
  }

  console.log(`PASS — vercel-deploy/ matches the source of truth (${source.size} files) and the manifest.`);
  process.exit(0);
}

mkdirSync(OUT, { recursive: true });

const manifestFiles = [];
let totalBytes = 0;

for (const [path, content] of [...source.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  const destination = join(OUT, path);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, content);
  manifestFiles.push({ path, bytes: content.byteLength, sha256: sha256(content) });
  totalBytes += content.byteLength;
}

/**
 * Remove files that are no longer part of the bundle without destroying a local verification build.
 * `node_modules` and `.next` are install/build output, not bundle content; deleting them would force
 * a fresh `npm ci` and a full rebuild after every source edit.
 */
function prune(directory, prefix = "") {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (!prefix && PRESERVE_AT_ROOT.has(entry.name)) continue;
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      prune(full, rel);
      if (readdirSync(full).length === 0) rmSync(full, { recursive: true, force: true });
    } else if (!source.has(rel)) {
      rmSync(full, { force: true });
    }
  }
}

prune(OUT);

// No commit id is recorded on purpose: writing the manifest changes the tree, so it could only ever
// name the previous commit. The hashes below are the durable evidence; the build log prints the
// commit the bundle was generated from.
const manifest = {
  description:
    "Generated by scripts/prepare-deploy.mjs. vercel-deploy/ is the Vercel Root Directory; the repository root is the source of truth.",
  rootDirectory: "vercel-deploy",
  framework: "nextjs",
  nodeEngine: JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).engines?.node ?? "unspecified",
  fileCount: manifestFiles.length,
  totalBytes,
  files: manifestFiles,
};
writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Wrote vercel-deploy/ — ${manifestFiles.length} files, ${(totalBytes / 1024).toFixed(1)} KiB.`);
console.log(`Wrote ${relative(ROOT, MANIFEST).split(sep).join("/")} (generated from ${gitCommit()}).`);
console.log("Next: cd vercel-deploy && npm ci && npm run build   (or `npm run verify:deploy`)");
