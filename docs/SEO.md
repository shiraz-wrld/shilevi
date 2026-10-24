# SEO

Everything below is implemented in this repository unless marked otherwise. No claim here is
aspirational: if a route is not listed, it has no special SEO treatment.

## What exists

| Piece | Where | Behaviour |
|---|---|---|
| Global metadata | `src/app/layout.tsx` | `metadataBase`, title template `%s \| Shilevi`, description, keywords, robots defaults, `formatDetection`, icons, viewport theme colour. |
| Home metadata | `src/app/page.tsx` | Server wrapper around the client home page, so the home route has a self-referencing canonical and Open Graph data. |
| Title/description per page | `src/app/**/layout.tsx` and `page.tsx` | Server layouts hold metadata for client-rendered pages, because a `"use client"` page cannot export `metadata`. |
| Canonical URLs | Every public route (home, divisions, listing, brand, search, about, how-it-works, pricing, safety, accessibility, help, support, security, legal index and each legal document) | Absolute and self-referencing. The legal layout defaults to `/legal`; each legal document overrides it. |
| Dynamic listing metadata | `src/app/listing/[id]/layout.tsx` | Reads the published listing title, price and location; falls back to a generic title + `noindex` when the listing is missing or unpublished. |
| Brand metadata | `src/app/brands/[slug]/layout.tsx` | Brand name + description, `noindex` when the brand is missing or inactive. |
| `robots.txt` | `src/app/robots.ts` | Allows public pages; disallows `/account`, `/checkout`, `/cart`, `/admin`, `/provider`, `/rider`, `/auth/`, `/api/`, password routes. |
| `sitemap.xml` | `src/app/sitemap.ts` | Static public routes (including the new information and legal pages) plus published listings and active brands when Supabase is configured. Revalidates hourly. |
| Robots meta on private pages | `account`, `checkout`, `cart`, `admin`, `provider`, `rider`, `search`, password routes | `noindex, nofollow` (plus `nocache` on personal areas). Private areas also receive an `X-Robots-Tag` response header from `next.config.ts`. |
| Open Graph image | `src/app/opengraph-image.tsx` | Generated 1200×630 PNG, no binary asset to keep in sync. |
| Web manifest + icon | `src/app/manifest.ts`, `src/app/icon.svg` | Installable storefront metadata. |
| Structured data | `src/components/seo/JsonLd.tsx`, root layout, `/help`, `/how-it-works` | `Organization` and `WebSite` site-wide; `FAQPage` on `/help`; `HowTo` on `/how-it-works`. No fake ratings, review counts or offers. |
| Security headers | `next.config.ts` + `src/lib/security/headers.ts` | HSTS, `nosniff`, frame denial, referrer policy, permissions policy, report-only CSP with a report endpoint. |
| Route audit | `scripts/route-audit.mjs` | `npm run verify:routes` checks status, canonical paths, titles, robots directives, headers, legal links, sitemap entries, structured endpoints and internal links against a running build. |

### Why there is no global Open Graph block

Next replaces an inherited `openGraph` object wholesale when a page defines its own. A site-wide
default therefore leaks the home page title onto every page that does not define one. Home and the
marketplace divisions define their own; other pages derive `og:title` and `og:description` from
their resolved metadata and use the generated OG image.

## Rules this codebase follows

1. **Never index a page that shows one person's data.** Account, order, checkout, cart, provider,
   rider and admin pages are `noindex`, disallowed in `robots.txt` and tagged by header.
2. **Never invent structured data.** `aggregateRating`, `reviewCount`, `availability` and price
   offers must come from real rows. Empty marketplace feeds must not emit `ItemList` markup.
3. **Canonical is self-referencing and absolute.** `NEXT_PUBLIC_SITE_URL` must be set in production,
   otherwise canonicals and sitemap URLs fall back to `http://localhost:3000`. The route audit
   compares canonical *paths*, so it still catches a wrong segment when the host is unset.
4. **Search result pages are `noindex, follow`.** Query-string permutations create thin duplicates.
5. **Listing pages are only indexable while published.** Unpublished or missing listings return
   `noindex` metadata rather than exposing draft titles.
6. **Legal documents each canonicalise to themselves.** The shared legal layout only provides a
   default (`/legal`); a page that inherits it instead of overriding would collapse six documents
   into one URL. The route audit fails if that regresses.

## Before launch

- [ ] Set `NEXT_PUBLIC_SITE_URL` (for example `https://shilevi.app`) in the hosting environment
      before the production build. Next inlines public variables at build time.
- [ ] Run `npm run verify:routes` against the deployed build (or CI) and keep it green.
- [ ] Submit `/sitemap.xml` in Google Search Console and Bing Webmaster Tools.
- [ ] Verify the domain, then confirm the property is not showing a verification failure.
- [ ] Test three URLs in the Rich Results Test: home, a listing, `/how-it-works` (HowTo).
- [ ] Test link previews in WhatsApp, X and LinkedIn — they cache aggressively.
- [ ] Confirm `/robots.txt` and `/sitemap.xml` on the production domain, not just locally.
- [ ] Add `hreflang` only if a Swahili locale actually ships. Do not add placeholder alternates.

## Known gaps

- No per-listing `Product` JSON-LD yet. It should be added only once price, availability and
  condition are trustworthy for every listing; otherwise it produces misleading rich results.
- No `BreadcrumbList` markup yet.
- No image sitemap: listing media URLs are not yet stable enough to publish.
- The OG image is generic. A per-listing OG image would improve click-through on shared links.
- Search and marketplace filters are client-rendered; the HTML contains the shell and listing feed,
  not a server-rendered result set. Crawlers index categories through the sitemap, not query strings.
