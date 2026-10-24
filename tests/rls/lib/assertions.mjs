/**
 * Result recording and response normalisation for the live RLS suite.
 *
 * Security outcomes are asserted as outcomes, not error strings:
 *   - a denied read normally returns zero rows;
 *   - a denied write normally returns zero rows or an RLS/privilege error;
 *   - a missing grant returns a permission error.
 * Both shapes are legitimate denials, so the reporters accept either.
 */
import { redact } from "./config.mjs";

const STATUSES = ["PASS", "FAIL", "BLOCKED", "NOT TESTED"];

export function createRecorder({ quiet = false, log = console.log } = {}) {
  const results = [];

  function record(entry) {
    const result = {
      id: entry.id,
      boundary: entry.boundary,
      expectation: entry.expectation,
      status: entry.status,
      detail: entry.detail ?? "",
    };
    results.push(result);
    if (!quiet) {
      log(`${result.status.padEnd(10)} ${result.id.padEnd(4)} ${result.boundary}`);
      if (result.detail) log(`           ${result.detail}`);
    }
    return result;
  }

  return {
    results,
    record,
    pass: (meta, detail) => record({ ...meta, status: "PASS", detail }),
    fail: (meta, detail) => record({ ...meta, status: "FAIL", detail }),
    blocked: (meta, detail) => record({ ...meta, status: "BLOCKED", detail }),
    notTested: (meta, detail) => record({ ...meta, status: "NOT TESTED", detail }),
    summary() {
      const counts = Object.fromEntries(STATUSES.map(status => [status, 0]));
      for (const result of results) counts[result.status] += 1;
      return counts;
    },
  };
}

export async function attempt(thunk) {
  try {
    const response = await thunk();
    if (response && typeof response === "object" && "error" in response) {
      if (response.error) {
        return { ok: false, error: normaliseError(response.error), data: response.data ?? null };
      }
      return { ok: true, error: null, data: response.data ?? null };
    }
    return { ok: true, error: null, data: response ?? null };
  } catch (error) {
    return { ok: false, error: normaliseError(error), data: null };
  }
}

export function normaliseError(error) {
  if (!error) return null;
  const code = error.code ?? error.status ?? error.name ?? "unknown";
  return {
    code: String(code).slice(0, 40),
    message: redact(error.message ?? error.hint ?? error.details ?? String(error)),
  };
}

export function rowCount(data) {
  if (Array.isArray(data)) return data.length;
  return data == null ? 0 : 1;
}

export function isDenied(outcome) {
  if (!outcome.ok) return true;
  // Only an empty result set proves a write or read was filtered. A null response from a void RPC
  // with no error is a SUCCESS, and must never be counted as a denial.
  return Array.isArray(outcome.data) && outcome.data.length === 0;
}

export function describe(outcome) {
  if (!outcome.ok) {
    return `denied: ${outcome.error.code} ${outcome.error.message}`;
  }
  if (Array.isArray(outcome.data)) {
    return outcome.data.length === 0
      ? "denied: no rows / no effect"
      : `allowed: ${outcome.data.length} row(s)`;
  }
  if (outcome.data === null || outcome.data === undefined) {
    return "allowed: the call completed with no error and no data (silent success)";
  }
  return `allowed: ${redact(JSON.stringify(outcome.data)).slice(0, 120)}`;
}
