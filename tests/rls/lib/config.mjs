/**
 * Configuration for the live Row-Level Security negative tests.
 *
 * The suite talks to a real hosted Supabase project with real authenticated sessions. It never
 * prints a key, token or password: only whether a value is present, and the project host.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ENV_FILES = [".env.local", ".env"];

function parseEnv(contents) {
  const values = {};
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

/**
 * Reads .env.local then .env, and lets the real process environment win. Values are never logged.
 */
export function loadEnvironment(cwd = process.cwd()) {
  const fromFiles = {};
  for (const file of ENV_FILES) {
    const path = resolve(cwd, file);
    if (!existsSync(path)) continue;
    Object.assign(fromFiles, parseEnv(readFileSync(path, "utf8")));
  }
  return { ...fromFiles, ...process.env };
}

function trimValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Resolves and validates the configuration. Anything that prevents a trustworthy live run is
 * reported in `blocked`; the runner must refuse to touch the database when that list is non-empty.
 */
export function resolveConfig(env) {
  const url = trimValue(env.NEXT_PUBLIC_SUPABASE_URL).replace(/\/+$/, "");
  const anonKey = trimValue(
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
  const serviceKey = trimValue(env.SUPABASE_SERVICE_ROLE_KEY);
  const allowLive = trimValue(env.SHILEVI_RLS_ALLOW_LIVE) === "1";
  const keepData = trimValue(env.SHILEVI_RLS_KEEP_DATA) === "1";

  const blocked = [];
  const warnings = [];

  if (!url) blocked.push("NEXT_PUBLIC_SUPABASE_URL is not set.");
  if (!anonKey) {
    blocked.push(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY) is not set.",
    );
  }
  if (!serviceKey) blocked.push("SUPABASE_SERVICE_ROLE_KEY is not set.");
  if (!allowLive) {
    blocked.push(
      "SHILEVI_RLS_ALLOW_LIVE is not 1. Set it only after confirming the project is a staging or test project.",
    );
  }

  let host = "";
  if (url) {
    try {
      const parsed = new URL(url);
      host = parsed.host;
      if (parsed.protocol !== "https:" && !/^(localhost|127\.0\.0\.1)$/.test(parsed.hostname)) {
        blocked.push("NEXT_PUBLIC_SUPABASE_URL must use https (localhost is allowed for local stacks).");
      }
      if (/prod/i.test(parsed.hostname)) {
        blocked.push(
          `Refusing to run: the project host "${parsed.host}" looks like a production project.`,
        );
      }
    } catch {
      blocked.push("NEXT_PUBLIC_SUPABASE_URL is not a valid URL.");
    }
  }

  if (host && !/\.supabase\.(co|in)$/.test(host) && !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) {
    warnings.push(
      `The project host "${host}" is not a standard Supabase host. Confirm it is a disposable test project.`,
    );
  }

  return {
    url,
    host,
    anonKey,
    serviceKey,
    allowLive,
    keepData,
    blocked,
    warnings,
    configured: blocked.length === 0,
  };
}

/**
 * Removes anything that looks like a JWT or key from free text before it reaches a report.
 */
export function redact(text) {
  return String(text ?? "")
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, "[redacted-jwt]")
    .replace(/sb_[A-Za-z0-9_-]{10,}/g, "[redacted-key]")
    .slice(0, 400);
}
