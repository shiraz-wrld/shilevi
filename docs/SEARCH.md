# Marketplace search and demand intelligence

Stage: migration `0025`, `GET /api/search`, `POST /api/search/event`, `/search`, `/admin/insights`.

## What search does

One database function, `public.search_marketplace(...)`, is the only read path. The browser calls a
Next.js route; the route calls the function; the function decides what may be seen.

| Rule | Where it is enforced |
|---|---|
| Only `status = 'published'` listings | `search_marketplace` **and** the existing RLS policy on `listings` |
| Only active categories | `search_marketplace` (`c.is_active`) |
| Approved-provider gate | Existing trigger/policy that prevents an unapproved provider publishing |
| House Hunt exact address and contact | Never joined; they live in `property_contacts`, which search does not touch |
| Division, category, county, price | Server-side `where` clauses, not client filtering |
| Pagination, totals, ranking | Database, in one statement |
| Request validation | Route allowlists, then database `raise exception` for direct RPC misuse |

`search_marketplace` is deliberately **not** `SECURITY DEFINER`. RLS keeps deciding visibility, so a
logic error in the function cannot widen what a caller sees.

## Taxonomy and filters

- `p_category_id` matches the category **and its descendants** through a recursive CTE, so choosing
  "Electronics" includes "Phones".
- `p_division` is one of `products`, `services`, `transport_delivery`, `property_places`.
- `p_county` matches `property_listings.county` for property listings or `listings.attributes->>'county'`
  for everything else. Case-insensitive, trimmed.
- `p_min_price_minor` / `p_max_price_minor` compare against `coalesce(listings.price_minor,
  property_listings.rent_minor)` — for property the monthly rent is the price. Negative or inverted
  ranges are refused by the function and by the route.
- Money is always integer minor units. The UI takes KSh and multiplies by 100 once.

## Matching and ranking

- A stored generated `tsvector` column on `listings` (title + description) with a GIN index.
- `websearch_to_tsquery('simple', …)`; the `simple` dictionary has no stop words, so short product
  terms are not silently dropped.
- `ts_rank_cd` orders by relevance. A `LIKE` fallback on title and description keeps partial-word
  queries working (`headph` finds `headphones`).
- LIKE metacharacters in the user's term are escaped, so a query of `%` cannot match the catalogue.
- Featured listings break relevance ties; publication date breaks the rest; `id` makes paging stable.
- Sorts: `relevance` (default when a term is present), `newest`, `price_low`, `price_high`, `title`.

There is **no** typo correction, synonym expansion or semantic embedding. Adding one would be a
separate, explicitly labelled feature; nothing here claims to be AI-powered.

## Limits and clamping

| Input | Behaviour |
|---|---|
| Query > 120 characters | Truncated to 120 |
| Empty / whitespace query | Browse mode, no error |
| Punctuation-only query | No matches (no accidental full match) |
| `page` | Clamped to 1–10 000 |
| `page_size` | Clamped to 1–48 (default 24) |
| Unknown division / sort / category | 400 from the route, exception from the RPC |
| Rate limit | 60 searches per minute per client key, 60 events per minute |

The route returns `Cache-Control: no-store` and never echoes database errors, SQL, or environment
detail.

## Analytics events

`public.search_events` — one row per search or per listing click.

| Column | Why |
|---|---|
| `event_type` | `search` or `listing_click` |
| `user_id` | Nullable; `on delete set null` so account deletion does not erase demand history |
| `query_text`, `query_normalized` | Display term (≤120 chars) and a lowercased, whitespace-collapsed key |
| `division`, `category_id`, `county`, `min_price_minor`, `max_price_minor`, `sort`, `page` | The filters actually used |
| `result_count` | The total the database returned, not a client claim |
| `shown_listing_ids` | First page of results, capped at 24 ids |
| `listing_id` | For clicks only |

Deliberately absent: IP address, user agent, device fingerprint, session id, referrer, free-form
metadata, contact details, payment data.

**Only the service role can write.** `record_search_event` is revoked from `anon` and `authenticated`,
and the route derives `result_count` and `shown_listing_ids` from the database's own answer. A browser
cannot inflate impressions, invent a conversion, or record a click on an unpublished listing (the
function refuses it).

Nothing in this table is financial truth. Orders, payments, unlocks and reviews remain the only
sources of truth for money; no analytics row can mark anything paid, unlocked or complete.

## Reading the data

`public.admin_search_insights(p_days)` — `SECURITY DEFINER`, raises `Not authorized` unless
`is_shilevi_owner_admin()` (verified owner email **and** aal2). Returns:

- totals, zero-result count, click-through (null when there are no searches, never `0%` pretending to be a measurement);
- top queries with average result count and last-seen date;
- zero-result queries (demand with no supply);
- demand by category and county;
- listings shown at least five times with zero clicks;
- a daily series — days with no events are omitted rather than filled with invented zeroes;
- `has_data`, so the UI can say "no search activity in this window" instead of rendering empty charts.

`/admin/insights` renders exactly that, for 7/30/90-day windows, and tells you when analytics writes
are switched off because the service-role key is missing.

## Retention

`public.prune_search_events(p_days default 180)` deletes rows older than the window and returns the
count. It is granted to the service role only.

Recommended: run it daily from a scheduled job (pg_cron in Supabase, or a platform cron calling the
RPC with the service key). The window is a product and data-protection decision — adjust the argument,
not the function body.

## Tests

`npm run test:search` runs migration `0025` in PGlite against a faithful schema stub and asserts 33
behaviours, including:

- drafts, paused listings and listings in inactive categories never appear;
- protected contact data never appears in a payload;
- taxonomy scope, county, price and combined filters;
- relevance ordering, price sorting, stable totals and disjoint pages;
- clamping and truncation;
- SQL and LIKE-wildcard injection attempts have no effect;
- only the service role can write or prune analytics;
- a click on a draft listing is refused;
- non-owners cannot read insights and an empty window reports `has_data = false`.

## Known limitations

- No fuzzy matching, synonyms or transliteration; a misspelt term returns nothing.
- No geospatial radius search — filters are county-level because that is what the schema stores.
- `LIKE '%term%'` fallback will not use the GIN index; acceptable at current catalogue size, revisit
  with trigram indexes if the catalogue grows past tens of thousands of listings.
- Analytics is per instance for rate limiting (in-memory), not distributed.
- No scheduled pruning is configured yet; the function exists and is tested, the cron does not.
