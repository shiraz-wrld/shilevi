/**
 * Database integration test for marketplace search and demand intelligence.
 *
 * Runs migration 0025 inside an in-process PostgreSQL (PGlite). The marketplace tables are stubbed
 * with the real production column definitions from migrations 0001–0024 so the generated search
 * column, the taxonomy recursion, the property join and the analytics functions are exercised for
 * real, without touching any Supabase project.
 *
 * What this proves: visibility rules, taxonomy scope, filters, ranking, pagination, input clamping,
 * injection safety, that protected contact data never appears in a search payload, that only the
 * service role can write analytics, and that owner reporting refuses non-owners and admits when it
 * has no data.
 *
 * Run with: npm run test:search
 */
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const db = new PGlite();

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

const stubs = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;

create schema if not exists auth;
create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz);

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create or replace function public.is_shilevi_owner_admin() returns boolean
language sql stable as $$
  select coalesce(current_setting('app.is_admin', true), 'false')::boolean;
$$;

create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Real columns as of migration 0024.
create table public.marketplace_categories (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.marketplace_categories(id),
  slug text not null unique,
  name text not null,
  division text not null,
  description text,
  is_active boolean not null default false,
  sort_order integer not null default 0,
  attributes_schema jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.listings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  category_id uuid not null references public.marketplace_categories(id),
  provider_application_id uuid,
  title text not null,
  description text not null default '',
  status text not null default 'draft',
  price_minor bigint,
  currency char(3) not null default 'KES',
  attributes jsonb not null default '{}'::jsonb,
  approximate_location jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  brand_id uuid,
  is_featured boolean not null default false,
  published_at timestamptz,
  provider_activity_id uuid,
  transaction_type text not null default 'sale'
);

create table public.property_listings (
  listing_id uuid primary key references public.listings(id) on delete cascade,
  county text not null,
  city text not null,
  neighbourhood text,
  property_type text not null,
  bedrooms integer,
  bathrooms integer,
  rent_minor bigint not null,
  deposit_minor bigint not null default 0,
  is_vacant boolean not null default true,
  available_from date,
  amenities text[] not null default '{}'::text[],
  verification_status text not null default 'pending',
  verification_note text,
  verified_at timestamptz,
  verified_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.property_contacts (
  listing_id uuid primary key references public.listings(id) on delete cascade,
  exact_address text not null,
  contact_name text,
  contact_phone text not null,
  created_at timestamptz not null default now()
);
`;

await db.exec(stubs);

const migration = fs.readFileSync(
  path.join(repoRoot, "supabase/migrations/0025_marketplace_search_and_demand_intelligence.sql"),
  "utf8",
);

try {
  await db.exec(migration);
  console.log("ok 0025_marketplace_search_and_demand_intelligence.sql");
} catch (error) {
  console.error(`FAIL 0025 migration: ${error.message}`);
  process.exit(1);
}

// ---------------------------------------------------------------- fixtures

const SELLER = "11111111-1111-4111-8111-111111111111";
const ids = {
  catElectronics: "22222222-2222-4222-8222-222222222201",
  catPhones: "22222222-2222-4222-8222-222222222202",
  catSalon: "22222222-2222-4222-8222-222222222203",
  catInactive: "22222222-2222-4222-8222-222222222204",
  catHousing: "22222222-2222-4222-8222-222222222205",
  lPhone: "33333333-3333-4333-8333-333333333301",
  lHeadphones: "33333333-3333-4333-8333-333333333302",
  lDraft: "33333333-3333-4333-8333-333333333303",
  lPaused: "33333333-3333-4333-8333-333333333304",
  lInactive: "33333333-3333-4333-8333-333333333305",
  lApartmentNairobi: "33333333-3333-4333-8333-333333333306",
  lApartmentMombasa: "33333333-3333-4333-8333-333333333307",
  lSalon: "33333333-3333-4333-8333-333333333308",
};

const SEED_ADDRESS = "Unit 7B, Secret Court, Kilimani";
const SEED_PHONE = "+254700000001";

await db.exec(`
insert into auth.users (id, email, email_confirmed_at)
values ('${SELLER}', 'seller@example.test', now());

insert into public.marketplace_categories (id, parent_id, slug, name, division, is_active) values
  ('${ids.catElectronics}', null, 'electronics', 'Electronics', 'products', true),
  ('${ids.catPhones}', '${ids.catElectronics}', 'phones', 'Phones', 'products', true),
  ('${ids.catSalon}', null, 'salons', 'Salons', 'services', true),
  ('${ids.catInactive}', null, 'retired', 'Retired', 'products', false),
  ('${ids.catHousing}', null, 'apartments', 'Apartments', 'property_places', true);

insert into public.listings
  (id, owner_id, category_id, title, description, status, price_minor, attributes, published_at, is_featured)
values
  ('${ids.lPhone}', '${SELLER}', '${ids.catPhones}', 'Samsung Galaxy A15 phone',
   'Dual SIM handset with a clear camera.', 'published', 1890000,
   '{"county":"Nairobi","cover_image_url":"https://cdn.example.test/a15.webp"}', now() - interval '1 day', true),
  ('${ids.lHeadphones}', '${SELLER}', '${ids.catElectronics}', 'Over-ear headphones',
   'Wireless noise cancelling headphones for travel.', 'published', 850000,
   '{"county":"Nairobi"}', now() - interval '2 days', false),
  ('${ids.lDraft}', '${SELLER}', '${ids.catPhones}', 'Samsung Galaxy draft phone',
   'Not published yet.', 'draft', 1500000, '{}', null, false),
  ('${ids.lPaused}', '${SELLER}', '${ids.catPhones}', 'Samsung paused phone',
   'Temporarily withdrawn.', 'paused', 1600000, '{}', now() - interval '3 days', false),
  ('${ids.lInactive}', '${SELLER}', '${ids.catInactive}', 'Hidden retired product',
   'Category is switched off.', 'published', 50000, '{}', now() - interval '4 days', false),
  ('${ids.lApartmentNairobi}', '${SELLER}', '${ids.catHousing}', 'Two bedroom apartment in Kilimani',
   'Bright apartment close to the shops.', 'published', 4500000,
   '{"cover_image_url":"https://cdn.example.test/kilimani.webp"}', now() - interval '5 days', false),
  ('${ids.lApartmentMombasa}', '${SELLER}', '${ids.catHousing}', 'Studio near the beach',
   'Furnished studio in Mombasa.', 'published', 2500000, '{}', now() - interval '6 days', false),
  ('${ids.lSalon}', '${SELLER}', '${ids.catSalon}', 'Braiding and styling',
   'Salon appointment for braiding.', 'published', 300000, '{"county":"Nairobi"}', now() - interval '7 days', false);

insert into public.property_listings
  (listing_id, county, city, neighbourhood, property_type, bedrooms, bathrooms, rent_minor, deposit_minor, verification_status, is_vacant)
values
  ('${ids.lApartmentNairobi}', 'Nairobi', 'Nairobi', 'Kilimani', 'apartment', 2, 1, 4500000, 4500000, 'verified', true),
  ('${ids.lApartmentMombasa}', 'Mombasa', 'Mombasa', 'Nyali', 'studio', 1, 1, 2500000, 2500000, 'pending', true);

insert into public.property_contacts (listing_id, exact_address, contact_name, contact_phone)
values ('${ids.lApartmentNairobi}', '${SEED_ADDRESS}', 'Secret Landlord', '${SEED_PHONE}');
`);

async function search(params = {}) {
  const {
    q = null, division = null, categoryId = null, county = null,
    min = null, max = null, sort = "relevance", page = 1, size = 24,
  } = params;
  const { rows } = await db.query(
    `select public.search_marketplace($1::text, $2::text, $3::uuid, $4::text, $5::bigint, $6::bigint, $7::text, $8::int, $9::int) as r`,
    [q, division, categoryId, county, min, max, sort, page, size],
  );
  return rows[0].r;
}

const resultIds = result => result.items.map(item => item.id);

// ---------------------------------------------------------------- visibility

const browse = await search();
check("empty query returns published listings in active categories only", () => {
  assert.equal(browse.total, 5, `expected 5 published visible listings, got ${browse.total}`);
  const returned = new Set(resultIds(browse));
  assert.ok(!returned.has(ids.lDraft), "draft listing leaked");
  assert.ok(!returned.has(ids.lPaused), "paused listing leaked");
  assert.ok(!returned.has(ids.lInactive), "listing in an inactive category leaked");
  assert.equal(browse.page, 1);
  assert.equal(browse.pages, 1);
});

check("results never contain protected contact data", () => {
  const serialized = JSON.stringify(browse);
  assert.ok(!serialized.includes(SEED_ADDRESS), "exact address appeared in a search payload");
  assert.ok(!serialized.includes(SEED_PHONE), "contact phone appeared in a search payload");
  assert.ok(!serialized.includes("Secret Landlord"), "contact name appeared in a search payload");
});

// ---------------------------------------------------------------- matching and ranking

const samsung = await search({ q: "samsung" });
check("title matching returns only published matches", () => {
  assert.equal(samsung.total, 1);
  assert.equal(resultIds(samsung)[0], ids.lPhone);
});

const descriptionMatch = await search({ q: "noise cancelling" });
check("description text is searchable", () => {
  assert.equal(descriptionMatch.total, 1);
  assert.equal(resultIds(descriptionMatch)[0], ids.lHeadphones);
});

const relevance = await search({ q: "wireless headphones" });
check("relevance ranks a matched listing above the rest of the catalogue", () => {
  assert.ok(relevance.total >= 1);
  assert.equal(resultIds(relevance)[0], ids.lHeadphones);
});

const punctuation = await search({ q: "!!!" });
check("a punctuation-only term returns no false matches", () => {
  assert.equal(punctuation.total, 0);
  assert.equal(punctuation.items.length, 0);
});

// ---------------------------------------------------------------- filters

const products = await search({ division: "products" });
check("division filter is applied", () => {
  assert.deepEqual(new Set(resultIds(products)), new Set([ids.lPhone, ids.lHeadphones]));
});

const services = await search({ division: "services" });
check("services division returns only service listings", () => {
  assert.deepEqual(resultIds(services), [ids.lSalon]);
});

const parentCategory = await search({ categoryId: ids.catElectronics });
check("a parent category includes its children", () => {
  assert.deepEqual(new Set(resultIds(parentCategory)), new Set([ids.lPhone, ids.lHeadphones]));
});

const countyNairobi = await search({ county: "Nairobi" });
check("county filter covers property counties and listing attributes", () => {
  const returned = new Set(resultIds(countyNairobi));
  assert.ok(returned.has(ids.lApartmentNairobi), "property county not matched");
  assert.ok(returned.has(ids.lPhone), "listing attribute county not matched");
  assert.ok(!returned.has(ids.lApartmentMombasa), "a different county was returned");
});

const priced = await search({ min: 1000000, max: 3000000 });
check("price range filters on list price and rent", () => {
  assert.deepEqual(new Set(resultIds(priced)), new Set([ids.lPhone, ids.lApartmentMombasa]));
});

const combined = await search({ q: "apartment", division: "property_places", county: "Nairobi" });
check("filters combine", () => {
  assert.deepEqual(resultIds(combined), [ids.lApartmentNairobi]);
});

// ---------------------------------------------------------------- sorting and pagination

const cheapest = await search({ sort: "price_low" });
check("price_low sorts ascending with nulls last", () => {
  const prices = cheapest.items.map(item => item.price_minor);
  const sorted = [...prices].sort((a, b) => a - b);
  assert.deepEqual(prices, sorted);
  assert.equal(prices[0], 300000);
});

const newest = await search({ sort: "newest" });
check("newest sorts by publication date descending", () => {
  const dates = newest.items.map(item => new Date(item.published_at).getTime());
  assert.deepEqual(dates, [...dates].sort((a, b) => b - a));
});

const pageOne = await search({ sort: "price_low", size: 2, page: 1 });
const pageTwo = await search({ sort: "price_low", size: 2, page: 2 });
check("pagination reports a stable total and disjoint pages", () => {
  assert.equal(pageOne.total, browse.total);
  assert.equal(pageOne.pages, 3);
  assert.equal(pageOne.items.length, 2);
  assert.equal(pageTwo.items.length, 2);
  assert.equal(new Set([...resultIds(pageOne), ...resultIds(pageTwo)]).size, 4);
});

check("page size is clamped and page 0 is normalised", () => {
  assert.equal(browse.page_size, 24);
});

const clamped = await search({ size: 500, page: 0 });
check("oversized page requests are clamped", () => {
  assert.equal(clamped.page_size, 48);
  assert.equal(clamped.page, 1);
});

const longQuery = "x".repeat(500);
const clampedQuery = await search({ q: longQuery });
check("an oversized query is truncated rather than rejected", () => {
  assert.equal(clampedQuery.query.length, 120);
  assert.equal(clampedQuery.total, 0);
});

// ---------------------------------------------------------------- input safety

const injected = await search({ q: "'; drop table public.listings; --" });
const listingCount = await db.query("select count(*)::int as count from public.listings");
check("an injection attempt neither matches everything nor damages the schema", () => {
  assert.equal(injected.total, 0);
  assert.equal(Number(listingCount.rows[0].count), 8);
});

const likeWildcard = await search({ q: "%" });
check("LIKE wildcards in the term do not match every row", () => {
  assert.equal(likeWildcard.total, 0);
});

let divisionError = null;
try {
  await search({ division: "not-a-division" });
} catch (error) {
  divisionError = error;
}
check("an unknown division is refused", () => {
  assert.ok(divisionError, "expected the database to refuse an unknown division");
  assert.match(divisionError.message, /Unknown marketplace section/);
});

let priceError = null;
try {
  await search({ min: 500, max: 100 });
} catch (error) {
  priceError = error;
}
check("an inverted price range is refused", () => {
  assert.ok(priceError, "expected the database to refuse min > max");
});

// ---------------------------------------------------------------- analytics authorization

const recordSignature =
  "public.record_search_event(text,text,text,uuid,text,bigint,bigint,text,integer,integer,uuid,uuid[],uuid)";

const privileges = await db.query(
  `select
     has_function_privilege('authenticated', $1, 'execute') as authenticated_can_write,
     has_function_privilege('anon', $1, 'execute') as anon_can_write,
     has_function_privilege('service_role', $1, 'execute') as service_can_write,
     has_function_privilege('authenticated', 'public.prune_search_events(integer)', 'execute') as authenticated_can_prune,
     has_function_privilege('service_role', 'public.prune_search_events(integer)', 'execute') as service_can_prune`,
  [recordSignature],
);
check("only the service role may record or prune analytics", () => {
  const row = privileges.rows[0];
  assert.equal(row.authenticated_can_write, false);
  assert.equal(row.anon_can_write, false);
  assert.equal(row.service_can_write, true);
  assert.equal(row.authenticated_can_prune, false);
  assert.equal(row.service_can_prune, true);
});

const shown = [ids.lPhone, ids.lHeadphones];
const recorded = await db.query(
  `select public.record_search_event('search', $1, 'products', null, 'Nairobi', null, null, 'relevance', 1, 2, null, $2::uuid[], null) as id`,
  ["  Samsung   Galaxy ", shown],
);
const storedEvent = await db.query(
  "select query_text, query_normalized, shown_listing_ids, result_count, event_type from public.search_events where id = $1",
  [recorded.rows[0].id],
);
check("the recorded event keeps the display term and a lowercased key", () => {
  const row = storedEvent.rows[0];
  assert.equal(row.event_type, "search");
  assert.equal(row.query_normalized, "samsung galaxy");
  assert.equal(row.result_count, 2);
  assert.equal(row.shown_listing_ids.length, 2);
});

const crowd = Array.from({ length: 30 }, (_, index) =>
  `33333333-3333-4333-8333-${String(index).padStart(12, "0")}`,
);
const capped = await db.query(
  `select public.record_search_event('search', 'cap test', null, null, null, null, null, null, 1, 0, null, $1::uuid[], null) as id`,
  [crowd],
);
const cappedRow = await db.query(
  "select shown_listing_ids from public.search_events where id = $1",
  [capped.rows[0].id],
);
check("the shown-listing list is capped at 24 ids", () => {
  assert.equal(cappedRow.rows[0].shown_listing_ids.length, 24);
});

let clickError = null;
try {
  await db.query(`select public.record_search_event('listing_click', null, null, null, null, null, null, null, null, null, $1, null, null)`, [
    ids.lDraft,
  ]);
} catch (error) {
  clickError = error;
}
check("a click on an unpublished listing is refused", () => {
  assert.ok(clickError, "expected a click on a draft listing to raise");
  assert.match(clickError.message, /Listing not found/);
});

await db.query(`select public.record_search_event('listing_click', null, null, null, null, null, null, null, null, null, $1, null, null)`, [
  ids.lPhone,
]);
const clickCount = await db.query("select count(*)::int as c from public.search_events where event_type = 'listing_click'");
check("a click on a published listing is recorded", () => {
  assert.equal(Number(clickCount.rows[0].c), 1);
});

// ---------------------------------------------------------------- owner reporting

let unauthorized = null;
await db.exec("select set_config('app.is_admin', 'false', false)");
try {
  await db.query("select public.admin_search_insights(30)");
} catch (error) {
  unauthorized = error;
}
check("non-owners cannot read demand intelligence", () => {
  assert.ok(unauthorized, "expected the insights RPC to refuse a non-owner");
  assert.match(unauthorized.message, /Not authorized/);
});

await db.exec("select set_config('app.is_admin', 'true', false)");
const insights = await db.query("select public.admin_search_insights(30) as r");
const report = insights.rows[0].r;
check("the owner report is computed from real events", () => {
  assert.equal(report.has_data, true);
  assert.equal(Number(report.searches), 2);
  assert.equal(Number(report.clicks), 1);
  assert.equal(Number(report.zero_result_searches), 1);
  assert.ok(report.top_queries.some(row => row.query === "samsung galaxy"));
  assert.ok(report.top_counties.some(row => row.county === "Nairobi"));
  assert.ok(Number(report.click_through) > 0);
  assert.ok(Array.isArray(report.daily) && report.daily.length >= 1);
});

check("impressions without clicks are reported, not invented", () => {
  assert.ok(Array.isArray(report.low_click_listings));
  // The headphones were shown once, below the minimum exposure of 5, so they must not be flagged.
  assert.ok(!report.low_click_listings.some(row => row.listing_id === ids.lHeadphones));
});

// ---------------------------------------------------------------- retention

await db.query(
  `insert into public.search_events (event_type, query_text, query_normalized, result_count, created_at)
   values ('search', 'old term', 'old term', 4, now() - interval '200 days')`,
);
const pruned = await db.query("select public.prune_search_events(180) as removed");
const remaining = await db.query("select count(*)::int as c from public.search_events");
check("pruning deletes the old event and keeps the new ones", () => {
  assert.equal(Number(pruned.rows[0].removed), 1);
  assert.equal(Number(remaining.rows[0].c), 3);
});

await db.exec("delete from public.search_events");
const empty = await db.query("select public.admin_search_insights(30) as r");
check("an empty window reports no data instead of zeros presented as history", () => {
  assert.equal(empty.rows[0].r.has_data, false);
  assert.equal(Number(empty.rows[0].r.searches), 0);
  assert.equal(empty.rows[0].r.click_through, null);
  assert.deepEqual(empty.rows[0].r.top_queries, []);
});

// ---------------------------------------------------------------- done

if (failures > 0) {
  console.error(`\n${failures} search check(s) failed.`);
  process.exit(1);
}
console.log("\nALL SEARCH AND ANALYTICS CHECKS PASSED");
