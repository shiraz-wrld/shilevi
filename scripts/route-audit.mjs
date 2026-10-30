#!/usr/bin/env node
/**
 * End-to-end route audit.
 *
 * Runs against a built, running server (never against source) and checks the things a unit test
 * cannot: HTTP status, canonical URLs, robots directives, security headers, the legal surface,
 * private-area redirects, structured endpoints and internal links.
 *
 * Usage:
 *   npm run build
 *   npm run start -- -p 3100
 *   BASE_URL=http://127.0.0.1:3100 node scripts/route-audit.mjs
 *
 * Without Supabase credentials the app renders its setup states; database-backed pages are checked
 * for a non-500 response and for not leaking a stack trace, not for seeded content.
 */

const BASE = (process.env.BASE_URL || "http://127.0.0.1:3100").replace(/\/+$/, "");

const results = [];
let failures = 0;

function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  if (!ok) failures += 1;
  const status = ok ? "PASS" : "FAIL";
  console.log(`${status}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function get(path, options = {}) {
  const response = await fetch(`${BASE}${path}`, { redirect: "manual", ...options });
  const text = await response.text();
  return { response, text };
}

const PUBLIC_ROUTES = [
  "/",
  "/marketplace/products",
  "/marketplace/services",
  "/transport",
  "/house-hunt",
  "/marketplace/transport_delivery",
  "/marketplace/property_places",
  "/search",
  "/about",
  "/how-it-works",
  "/pricing",
  "/safety",
  "/accessibility",
  "/help",
  "/support",
  "/security",
  "/legal",
  "/legal/terms",
  "/legal/privacy",
  "/legal/cookies",
  "/legal/refunds",
  "/legal/provider-agreement",
  "/legal/acceptable-use",
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
];

function canonicalPath(html) {
  const match = html.match(/<link rel="canonical" href="([^"]+)"/i);
  return match?.[1] ?? "";
}

function hasNoindex(html) {
  return /<meta name="robots" content="[^"]*noindex/i.test(html);
}

function titleOf(html) {
  return html.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim() ?? "";
}

async function auditPublicRoutes() {
  for (const path of PUBLIC_ROUTES) {
    const { response, text } = await get(path);
    const status = response.status;
    record(`GET ${path}`, status === 200, `status ${status}`);

    if (status !== 200) continue;

    record(`  ${path} HTML`, (response.headers.get("content-type") || "").includes("text/html"), response.headers.get("content-type") || "missing content-type");
    record(`  ${path} title`, /Shilevi/i.test(titleOf(text)), titleOf(text) || "no <title>");
    record(`  ${path} no error digest`, !/Reference: [0-9a-f]{8,}/i.test(text), "error boundary rendered");

    if (!["/forgot-password", "/reset-password"].includes(path)) {
      // Canonical host comes from NEXT_PUBLIC_SITE_URL at build time, so compare the path, not the
      // host. A wrong segment (for example every legal page canonicalising to /legal/terms) is the
      // failure this check exists to catch.
      const canonical = canonicalPath(text);
      let canonicalPathname = "";
      try {
        canonicalPathname = new URL(canonical).pathname;
      } catch {
        canonicalPathname = "";
      }
      const wanted = path === "/" ? "/" : path;
      const normalized = canonicalPathname.replace(/\/$/, "") || "/";
      const wantedNormalized = wanted.replace(/\/$/, "") || "/";
      record(`  ${path} canonical`, normalized === wantedNormalized, canonical || "missing");
    }

    if (["/login", "/signup"].includes(path)) {
      record(`  ${path} indexable`, !hasNoindex(text), "login surfaces may be indexed");
    }

    for (const [header, expected] of [
      ["x-content-type-options", "nosniff"],
      ["x-frame-options", "DENY"],
      ["referrer-policy", "strict-origin-when-cross-origin"],
    ]) {
      record(`  ${path} ${header}`, (response.headers.get(header) || "") === expected, response.headers.get(header) || "missing");
    }

    const csp = response.headers.get("content-security-policy-report-only") || "";
    record(`  ${path} CSP report-only`, csp.includes("report-uri /api/security/csp-report"), csp ? "missing report-uri" : "missing CSP");
  }
}

async function auditLegal() {
  const { text } = await get("/legal");
  record("/legal links every document", ["/legal/terms", "/legal/privacy", "/legal/cookies", "/legal/refunds", "/legal/provider-agreement", "/legal/acceptable-use"].every(href => text.includes(`href="${href}"`)), "missing document link");
  for (const path of PUBLIC_ROUTES.filter(route => route.startsWith("/legal/"))) {
    const page = await get(path);
    record(`${path} last updated`, /Last updated/.test(page.text), "missing update date");
  }
}

async function auditPrivateAreas() {
  for (const path of ["/account", "/account/notifications", "/account/orders", "/cart", "/checkout", "/provider", "/provider/properties", "/rider", "/rider/rides", "/onboarding"]) {
    const { response, text } = await get(path);
    const redirected = response.status >= 300 && response.status < 400;
    record(`PRIVATE ${path}`, redirectValue(response) || response.status === 200, `status ${response.status}`);

    if (redirected) {
      const location = response.headers.get("location") || "";
      record(`  ${path} redirect target`, location.includes("/login") || location.includes("/admin"), location);
    } else {
      record(`  ${path} noindex`, hasNoindex(text) || (response.headers.get("x-robots-tag") || "").includes("noindex"), "page is publicly indexable");
    }

    record(`  ${path} X-Robots-Tag`, (response.headers.get("x-robots-tag") || "").includes("noindex"), response.headers.get("x-robots-tag") || "missing");
  }

  // The owner console must be indistinguishable from a missing route for anyone who is not an
  // authorized owner. A 404 is required: a redirect to an admin login, a 403 or an "Access denied"
  // page would all confirm that the console exists and that it is worth attacking.
  for (const path of ["/admin", "/admin/insights", "/admin/staff", "/admin/security", "/admin/system-health", "/admin/nope"]) {
    const { response, text } = await get(path);
    record(`CONCEALED ${path}`, response.status === 404, `status ${response.status}`);
    record(
      `  ${path} reveals no admin surface`,
      !/access denied|owner control center|owner control centre|staff access|owner allowlist|not authorized/i.test(text),
      "admin surface or allowlist leaked",
    );
    record(`  ${path} X-Robots-Tag`, (response.headers.get("x-robots-tag") || "").includes("noindex"), response.headers.get("x-robots-tag") || "missing");
  }

  // Privileged endpoints answer unauthorized callers the way a missing route would.
  const refundProbe = await get("/api/admin/refunds/decide", {
    method: "POST",
    headers: { origin: BASE, "content-type": "application/json" },
    body: JSON.stringify({ refundId: "00000000-0000-4000-8000-000000000000", approve: true }),
  });
  record(
    "admin refund API concealed or unconfigured",
    refundProbe.response.status === 404 || refundProbe.response.status === 503,
    `status ${refundProbe.response.status}`,
  );
  record(
    "admin refund API names no audience",
    !/allowlist|owner|mfa|authenticator/i.test(refundProbe.text),
    "refund API revealed its authorization model",
  );

  const payoutProbe = await get("/api/payments/payouts/dispatch");
  record("payout dispatch API concealed", payoutProbe.response.status === 404, `status ${payoutProbe.response.status}`);
}

function redirectValue(response) {
  return response.status >= 300 && response.status < 400;
}

async function auditSearchNoindex() {
  const { text, response } = await get("/search");
  record("/search is noindex", hasNoindex(text) || (response.headers.get("x-robots-tag") || "").includes("noindex"), "search result pages must not be indexed");
}

async function auditEndpoints() {
  const robots = await get("/robots.txt");
  record("robots.txt", robots.response.status === 200, `status ${robots.response.status}`);
  record("robots.txt sitemap", /Sitemap:\s*https?:\/\//i.test(robots.text), "missing sitemap directive");
  record("robots.txt disallows account", /Disallow:\s*\/account/i.test(robots.text), "private area not disallowed");

  const sitemap = await get("/sitemap.xml");
  record("sitemap.xml", sitemap.response.status === 200, `status ${sitemap.response.status}`);
  for (const path of ["/how-it-works", "/pricing", "/safety", "/accessibility", "/legal"]) {
    record(`sitemap includes ${path}`, sitemap.text.includes(path), "route missing from sitemap");
  }

  const manifest = await get("/manifest.webmanifest");
  record("manifest", manifest.response.status === 200 && /Shilevi/i.test(manifest.text), `status ${manifest.response.status}`);

  const icon = await get("/icon.svg");
  record("icon", icon.response.status === 200, `status ${icon.response.status}`);

  const health = await get("/api/health");
  let healthBody = {};
  try {
    healthBody = JSON.parse(health.text);
  } catch {
    healthBody = {};
  }
  record("health endpoint", [200, 503].includes(health.response.status) && Boolean(healthBody.checks), `status ${health.response.status}`);
  record("health leaks no secrets", !/service_role|apikey|secret/i.test(health.text), "health response mentions a secret");

  const healthHeaders = health.response.headers;
  record("api no-store", (healthHeaders.get("cache-control") || "").includes("no-store"), healthHeaders.get("cache-control") || "missing");
  record("api noindex", (healthHeaders.get("x-robots-tag") || "").includes("noindex"), healthHeaders.get("x-robots-tag") || "missing");

  // Search must fail closed on a deployment without Supabase, and must reject malformed filters
  // before it ever reaches the database.
  const searchUnconfigured = await get("/api/search?q=headphones");
  const searchAnswered =
    searchUnconfigured.response.status === 200 ||
    (searchUnconfigured.response.status === 503 &&
      /not available|temporarily unavailable/i.test(searchUnconfigured.text));
  record("search fails closed without configuration", searchAnswered, `status ${searchUnconfigured.response.status}`);
  if (searchUnconfigured.response.status === 200) {
    record("search returns a result payload", /"items"\s*:\s*\[/.test(searchUnconfigured.text), "items array missing");
  }
  record("search never leaks environment detail", !/SERVICE_ROLE|apikey|supabase\.co/i.test(searchUnconfigured.text), "search response mentions infrastructure");

  const searchBadDivision = await get("/api/search?division=not-a-section");
  record("search rejects an unknown section", searchBadDivision.response.status === 400, `status ${searchBadDivision.response.status}`);

  const searchBadPrice = await get("/api/search?minPriceMinor=500&maxPriceMinor=100");
  record("search rejects an inverted price range", searchBadPrice.response.status === 400, `status ${searchBadPrice.response.status}`);

  const searchEventGet = await get("/api/search/event");
  record("search event GET rejected", searchEventGet.response.status === 405, `status ${searchEventGet.response.status}`);

  const searchEventPost = await get("/api/search/event", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ listingId: "33333333-3333-4333-8333-333333333301" }),
  });
  record("search event requires same origin", searchEventPost.response.status === 403, `status ${searchEventPost.response.status}`);

  const notFound = await get("/this-route-does-not-exist");
  record("404 page", notFound.response.status === 404, `status ${notFound.response.status}`);
  record("404 is branded", /not here|not found/i.test(notFound.text), "custom not-found page missing");

  const signoutGet = await get("/api/auth/signout");
  record("signout GET rejected", signoutGet.response.status === 405, `status ${signoutGet.response.status}`);

  const signoutPost = await get("/api/auth/signout", { method: "POST" });
  record("signout POST requires same origin", signoutPost.response.status === 403, `status ${signoutPost.response.status}`);

  const cspGet = await get("/api/security/csp-report");
  record("csp report GET rejected", cspGet.response.status === 405, `status ${cspGet.response.status}`);

  const cspPost = await get("/api/security/csp-report", {
    method: "POST",
    headers: { "content-type": "application/csp-report" },
    body: JSON.stringify({ "csp-report": { "document-uri": `${BASE}/account?token=secret`, "violated-directive": "script-src", "blocked-uri": "https://example.com/x?q=1" } }),
  });
  record("csp report accepted", cspPost.response.status === 204, `status ${cspPost.response.status}`);

  const cspOversized = await get("/api/security/csp-report", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ padding: "x".repeat(20_000) }),
  });
  record("csp report size limit", cspOversized.response.status === 413, `status ${cspOversized.response.status}`);
}

async function auditInternalLinks() {
  const { text } = await get("/");
  const hrefs = new Set();
  for (const match of text.matchAll(/href="(\/[^"#?]*)(?:\?[^"]*)?"/g)) {
    const href = match[1];
    if (href.startsWith("/_next") || href.startsWith("/api") || href === "/" || /\.[a-z0-9]+$/i.test(href)) continue;
    hrefs.add(href);
  }

  let broken = 0;
  for (const href of [...hrefs].slice(0, 60)) {
    const { response } = await get(href);
    if (response.status === 404 || response.status >= 500) {
      broken += 1;
      record(`link ${href}`, false, `status ${response.status}`);
    }
  }
  record(`home page internal links (${Math.min(hrefs.size, 60)} checked)`, broken === 0, `${broken} broken`);
}

/**
 * Registration must offer every supported account path as a real choice, and must not offer one the
 * platform cannot onboard. This reads the rendered HTML rather than the source, so a broken build —
 * a client component that throws, a table that fails to render — is what fails here.
 */
async function auditSignupPaths() {
  const { text } = await get("/signup");
  const expected = [
    ["Buy and book", "customer"],
    ["Sell products or food", "product_seller"],
    ["Offer a service", "service_provider"],
    ["Deliver goods", "delivery_rider"],
    ["Carry passengers", "transport_operator"],
    ["List property", "property_provider"],
  ];
  record("/signup asks how the account will be used", /How will you use Shilevi\?/.test(text), "question missing");
  for (const [label, value] of expected) {
    record(
      `/signup offers ${value}`,
      text.includes(`value="${value}"`) && text.includes(label),
      "option missing",
    );
  }
  record(
    "/signup keeps provider work an application, not a grant",
    /separate application Shilevi reviews first/i.test(text),
    "no disclosure that approval is separate",
  );
  record("/signup keeps one customer registration form", /autocomplete="email"/i.test(text), "email field missing");
}

async function main() {
  console.log(`Route audit against ${BASE}\n`);
  try {
    await auditPublicRoutes();
    await auditLegal();
    await auditSignupPaths();
    await auditSearchNoindex();
    await auditPrivateAreas();
    await auditEndpoints();
    await auditInternalLinks();
  } catch (error) {
    record("audit completed", false, error instanceof Error ? error.message : String(error));
  }

  console.log(`\n${results.length - failures}/${results.length} checks passed.`);
  if (failures > 0) {
    console.error(`${failures} check(s) failed.`);
    process.exit(1);
  }
}

await main();
