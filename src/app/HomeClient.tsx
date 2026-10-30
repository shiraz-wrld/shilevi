"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";

type Division = "products" | "services" | "transport_delivery" | "property_places";
type Category = { id: string; slug: string; name: string; division: Division; description: string | null; sort_order: number };
type Brand = { id: string; slug: string; name: string; description: string; logo_url: string | null; is_featured: boolean; sort_order: number };
type Listing = { id: string; title: string; description: string; price_minor: number | null; currency: string; brand_id: string | null; published_at: string | null; category_id: string };

const divisions: { key: Division; title: string; description: string; href: string; icon: string }[] = [
  {
    key: "products",
    title: "Products",
    description: "Goods from approved sellers, with a real order record from checkout to handover.",
    href: "/marketplace/products",
    icon: "M4 8.5 12 4l8 4.5v7L12 20l-8-4.5zM4 8.5 12 13l8-4.5M12 13v7",
  },
  {
    key: "services",
    title: "Services",
    description: "Local professionals and businesses you can reach through a moderated enquiry.",
    href: "/marketplace/services",
    icon: "M4 7h16v10H4zM9 7v10M4 12h5",
  },
  {
    key: "transport_delivery",
    title: "Transport & Delivery",
    description: "Passenger trips and parcel delivery with claimed jobs and handover codes.",
    href: "/transport",
    icon: "M3 16V7h11v9M14 10h4l3 3v3h-7M6.5 19a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5ZM17.5 19a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5Z",
  },
  {
    key: "property_places",
    title: "Property & Places",
    description: "Homes, stays and venues. House Hunt keeps contact details behind a paid unlock.",
    href: "/house-hunt",
    icon: "M4 11 12 4l8 7v9H4zM9.5 20v-6h5v6",
  },
];

const pillars = [
  { title: "Approved providers", body: "Every seller and service provider is reviewed before a listing can be published." },
  { title: "Moderated listings", body: "Only published, active-category listings appear in discovery and search." },
  { title: "Clear order records", body: "Totals, commission and delivery are calculated server-side, never by the browser." },
  { title: "Privacy by default", body: "House Hunt contact details stay locked until access is paid for and verified." },
];

function money(minor: number | null, currency: string) {
  if (minor === null || !Number.isFinite(minor)) return "Ask for price";
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: /^[A-Z]{3}$/.test(currency) ? currency : "KES",
    maximumFractionDigits: 0,
  }).format(minor / 100);
}

export default function HomeClient() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [featured, setFeatured] = useState<Listing[]>([]);
  const [recent, setRecent] = useState<Listing[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const supabase = createSupabaseBrowserClient();
        const [categoryResult, brandResult, featuredResult, recentResult] = await Promise.all([
          supabase.from("marketplace_categories").select("id,slug,name,division,description,sort_order").eq("is_active", true).order("sort_order").limit(32),
          supabase.from("marketplace_brands").select("id,slug,name,description,logo_url,is_featured,sort_order").eq("is_active", true).eq("is_featured", true).order("sort_order").limit(8),
          supabase.from("listings").select("id,title,description,price_minor,currency,brand_id,published_at,category_id").eq("status", "published").eq("is_featured", true).order("published_at", { ascending: false }).limit(8),
          supabase.from("listings").select("id,title,description,price_minor,currency,brand_id,published_at,category_id").eq("status", "published").order("published_at", { ascending: false }).limit(8),
        ]);
        if ([categoryResult, brandResult, featuredResult, recentResult].some(result => result.error)) throw new Error("Marketplace content is temporarily unavailable.");
        if (!alive) return;
        setCategories((categoryResult.data ?? []) as Category[]);
        setBrands((brandResult.data ?? []) as Brand[]);
        setFeatured((featuredResult.data ?? []) as Listing[]);
        setRecent((recentResult.data ?? []) as Listing[]);
        setLoadState("ready");
      } catch {
        if (alive) setLoadState("error");
      }
    }
    void load();
    return () => { alive = false; };
  }, []);

  const categoryName = (id: string) => categories.find(item => item.id === id)?.name ?? "Marketplace listing";
  const brandName = (id: string | null) => (id ? brands.find(item => item.id === id)?.name : undefined);

  function ListingGrid({ items }: { items: Listing[] }) {
    if (!items.length) {
      return (
        <p className="surface-muted mt-7 p-6 text-sm leading-6 text-ink-500">
          Nothing has been published here yet. Check back as verified providers add their first listings.
        </p>
      );
    }
    return (
      <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {items.map(item => (
          <article key={item.id} className="surface surface-interactive flex flex-col p-5">
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-brand-700">{categoryName(item.category_id)}</p>
            <h3 className="mt-3 line-clamp-2 text-lg font-bold text-ink-900">{item.title}</h3>
            <p className="mt-2 line-clamp-3 flex-1 text-sm leading-6 text-ink-500">
              {item.description || "See details from this approved provider."}
            </p>
            <p className="mt-4 text-lg font-black text-ink-900">{money(item.price_minor, item.currency)}</p>
            {brandName(item.brand_id) && <p className="mt-1 text-xs text-ink-400">By {brandName(item.brand_id)}</p>}
            <Link href={`/listing/${item.id}`} className="link-arrow mt-4 text-sm">
              View details <span aria-hidden="true">→</span>
            </Link>
          </article>
        ))}
      </div>
    );
  }

  return (
    <main id="main-content" className="flex min-h-screen flex-col bg-mist-50 text-ink-900">
      <SiteHeader initialAuthStatus="signed-out" />

      {/* Hero */}
      <section className="shilevi-shell pt-6 sm:pt-10">
        <div className="relative overflow-hidden rounded-4xl bg-ink-950 px-6 py-14 text-white shadow-[0_40px_120px_-60px_rgba(11,19,41,0.9)] sm:px-12 sm:py-20 lg:px-16">
          <div className="hero-atmosphere" aria-hidden="true" />
          <div className="glow-orb -right-10 top-10 h-56 w-56 bg-accent-500/40" aria-hidden="true" />
          <div className="glow-orb -bottom-16 left-1/3 h-64 w-64 bg-brand-500/40" aria-hidden="true" />

          <div className="relative max-w-3xl rise-in">
            <p className="chip border-white/20 bg-white/10 text-white/90 backdrop-blur">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
              Built for Kenya · One connected marketplace
            </p>
            <h1 className="mt-6 text-4xl font-black leading-[1.05] tracking-tight sm:text-6xl lg:text-[4.25rem]">
              One place for{" "}
              <span className="bg-gradient-to-r from-brand-300 via-accent-300 to-sun-300 bg-clip-text text-transparent">
                what you need.
              </span>
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-ink-200">
              Shop products, discover services, arrange delivery, and explore property and places —
              with approved providers, moderated listings and a clear record of every order.
            </p>

            <form action="/search" method="get" role="search" className="mt-8 max-w-2xl">
              <label htmlFor="home-search" className="sr-only">
                Search Shilevi listings
              </label>
              <div className="flex flex-col gap-3 rounded-2xl border border-white/15 bg-white/10 p-2 backdrop-blur-md sm:flex-row sm:items-center">
                <input
                  id="home-search"
                  name="q"
                  maxLength={120}
                  placeholder="Search headphones, plumbers, bedsitters…"
                  className="min-w-0 flex-1 rounded-xl bg-transparent px-4 py-3 text-base text-white placeholder:text-ink-300 focus:outline-none"
                />
                <button type="submit" className="btn btn-primary shrink-0">
                  Search marketplace
                </button>
              </div>
            </form>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Link href="/signup" className="btn btn-secondary">
                Create an account
              </Link>
              <Link
                href="/signup?intent=provider"
                className="btn border-white/25 bg-white/5 text-white hover:border-white/45 hover:bg-white/10"
              >
                Become a provider
              </Link>
              <span className="text-sm text-ink-300">Free to browse. Apply to sell.</span>
            </div>
          </div>

          <div className="relative mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {divisions.map((division, index) => (
              <Link
                key={division.key}
                href={division.href}
                className="group rounded-2xl border border-white/12 bg-white/[0.06] p-4 backdrop-blur-sm transition-colors hover:border-white/30 hover:bg-white/10"
              >
                <span className="flex items-center justify-between">
                  <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6 text-accent-300">
                    <path d={division.icon} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span className="text-xs font-bold text-white/40">0{index + 1}</span>
                </span>
                <h2 className="mt-4 text-base font-bold text-white">{division.title}</h2>
                <p className="mt-1.5 text-xs leading-5 text-ink-300">{division.description}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Pillars */}
      <section className="shilevi-shell mt-10 sm:mt-14" aria-labelledby="pillars-heading">
        <h2 id="pillars-heading" className="sr-only">
          Why Shilevi
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {pillars.map(pillar => (
            <div key={pillar.title} className="surface p-5">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-50 text-brand-700">
                <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4.5 w-4.5">
                  <path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <h3 className="mt-4 text-sm font-bold text-ink-900">{pillar.title}</h3>
              <p className="mt-1.5 text-sm leading-6 text-ink-500">{pillar.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Categories */}
      <section id="marketplaces" className="shilevi-shell mt-16 scroll-mt-24" aria-labelledby="explore-heading">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Explore the marketplace</p>
            <h2 id="explore-heading" className="mt-3 text-3xl font-black sm:text-4xl">
              Start with a section
            </h2>
            <p className="mt-3 max-w-2xl leading-7 text-ink-500">
              Categories are managed by Shilevi and only active ones appear here. Narrow further with
              search filters for category, county and price.
            </p>
          </div>
          <Link href="/search" className="btn btn-secondary">
            Open full search
          </Link>
        </div>

        {loadState === "error" ? (
          <p role="alert" className="notice notice-warn mt-6">
            Live marketplace categories are temporarily unavailable. You can still create an account or
            try again shortly.
          </p>
        ) : (
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {divisions.map(division => {
              const live = categories.filter(category => category.division === division.key);
              return (
                <article key={division.key} className="surface flex flex-col p-5">
                  <h3 className="text-lg font-bold text-ink-900">{division.title}</h3>
                  <p className="mt-1.5 text-sm leading-6 text-ink-500">{division.description}</p>
                  {loadState === "loading" ? (
                    <div aria-hidden="true" className="mt-4 space-y-2">
                      <div className="shimmer h-4 w-3/4 rounded" />
                      <div className="shimmer h-4 w-2/3 rounded" />
                      <div className="shimmer h-4 w-1/2 rounded" />
                    </div>
                  ) : live.length ? (
                    <ul className="mt-4 space-y-2">
                      {live.slice(0, 6).map(category => (
                        <li key={category.id}>
                          <Link
                            href={`/marketplace/${division.key}?category=${encodeURIComponent(category.slug)}`}
                            className="text-sm font-medium text-brand-800 hover:underline"
                          >
                            {category.name}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-4 text-xs leading-5 text-ink-400">
                      Categories appear here once Shilevi activates them for this section.
                    </p>
                  )}
                  <Link href={division.href} className="link-arrow mt-auto pt-5 text-sm">
                    Browse {division.title.toLowerCase()} <span aria-hidden="true">→</span>
                  </Link>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Featured */}
      <section className="shilevi-shell mt-16" aria-labelledby="featured-heading">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Handpicked</p>
            <h2 id="featured-heading" className="mt-3 text-3xl font-black sm:text-4xl">
              Featured finds
            </h2>
          </div>
          <p className="max-w-md text-sm leading-6 text-ink-500">
            Listings appear here only after an authorized workflow features and publishes them.
          </p>
        </div>
        {loadState === "loading" ? (
          <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-busy="true">
            {[0, 1, 2, 3].map(item => (
              <div key={item} className="shimmer h-56 rounded-3xl" />
            ))}
          </div>
        ) : loadState === "error" ? (
          <p className="notice mt-6">Featured listings are unavailable right now.</p>
        ) : (
          <ListingGrid items={featured} />
        )}
      </section>

      {/* How it works */}
      <section className="shilevi-shell mt-16" aria-labelledby="how-heading">
        <div className="surface-dark relative overflow-hidden p-8 sm:p-12">
          <div className="glow-orb -right-10 -top-10 h-48 w-48 bg-brand-500/40" aria-hidden="true" />
          <div className="relative">
            <p className="eyebrow text-accent-300">How Shilevi works</p>
            <h2 id="how-heading" className="mt-3 max-w-2xl text-3xl font-black sm:text-4xl">
              From discovery to handover, in three clear steps.
            </h2>
            <ol className="mt-9 grid gap-6 sm:grid-cols-3">
              {[
                { step: "01", title: "Find it", body: "Browse sections, use search filters, or open a House Hunt listing. Only published listings are shown." },
                { step: "02", title: "Order it", body: "Checkout confirms the price, delivery method and fee on the server before anything is charged." },
                { step: "03", title: "Receive it", body: "Track the order, confirm handover with a delivery code, and keep a record you can refund against." },
              ].map(item => (
                <li key={item.step} className="rounded-2xl border border-white/12 bg-white/[0.04] p-5">
                  <span className="text-sm font-black text-accent-300">{item.step}</span>
                  <h3 className="mt-3 text-lg font-bold text-white">{item.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-ink-300">{item.body}</p>
                </li>
              ))}
            </ol>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/how-it-works" className="btn bg-white text-ink-900 hover:bg-ink-100">
                Read the full flow
              </Link>
              <Link href="/house-hunt" className="btn border-white/25 bg-transparent text-white hover:bg-white/10">
                Explore House Hunt
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* New listings */}
      <section className="shilevi-shell mt-16" aria-labelledby="new-heading">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Freshly published</p>
            <h2 id="new-heading" className="mt-3 text-3xl font-black sm:text-4xl">
              New on Shilevi
            </h2>
          </div>
          <p className="max-w-md text-sm leading-6 text-ink-500">
            A live feed of published listings — not made-up purchase counts or popularity claims.
          </p>
        </div>
        {loadState === "loading" ? (
          <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-busy="true">
            {[0, 1, 2, 3].map(item => (
              <div key={item} className="shimmer h-56 rounded-3xl" />
            ))}
          </div>
        ) : loadState === "error" ? (
          <p className="notice mt-6">New listings are unavailable right now.</p>
        ) : (
          <ListingGrid items={recent} />
        )}
      </section>

      {/* Brands */}
      <section className="shilevi-shell mt-16" aria-labelledby="brands-heading">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Discover businesses</p>
            <h2 id="brands-heading" className="mt-3 text-3xl font-black sm:text-4xl">
              Featured brands
            </h2>
          </div>
          <p className="max-w-md text-sm leading-6 text-ink-500">
            Brand storefronts appear after a brand is added and approved. An empty placeholder implies
            no partnership.
          </p>
        </div>
        {loadState === "error" ? (
          <p className="notice mt-6">Brand information is unavailable right now.</p>
        ) : brands.length ? (
          <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {brands.map(brand => (
              <Link key={brand.id} href={`/brands/${brand.slug}`} className="surface surface-interactive p-5">
                <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl bg-brand-50 text-lg font-black text-brand-700">
                  {brand.logo_url ? (
                    <img src={brand.logo_url} alt={`${brand.name} logo`} loading="lazy" className="h-full w-full object-contain" />
                  ) : (
                    brand.name.slice(0, 1).toUpperCase()
                  )}
                </div>
                <h3 className="mt-4 font-bold text-ink-900">{brand.name}</h3>
                <p className="mt-2 line-clamp-3 text-sm leading-6 text-ink-500">
                  {brand.description || "Explore this brand's published Shilevi listings."}
                </p>
                <span className="mt-4 inline-block text-sm font-semibold text-brand-800">View storefront →</span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="surface-muted mt-7 p-6 text-sm leading-6 text-ink-500">
            No featured brands yet. Once a brand is approved and featured in the admin workflow, its
            storefront will appear here.
          </p>
        )}
      </section>

      {/* Closing CTA */}
      <section className="shilevi-shell mt-16" aria-labelledby="join-heading">
        <div className="relative overflow-hidden rounded-4xl bg-gradient-to-br from-brand-700 via-brand-800 to-ink-900 p-8 text-white sm:p-12">
          <div className="glow-orb -right-8 top-0 h-52 w-52 bg-accent-400/30" aria-hidden="true" />
          <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 id="join-heading" className="text-2xl font-black sm:text-3xl">
                Ready to join Shilevi?
              </h2>
              <p className="mt-2 max-w-xl text-sm leading-6 text-brand-100">
                Create a customer account in a minute. Selling is a separate application that Shilevi
                reviews before your first listing goes live.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="/signup" className="btn bg-white text-brand-800 hover:bg-brand-50">
                Create your account
              </Link>
              <Link href="/provider/apply" className="btn border-white/30 bg-transparent text-white hover:bg-white/10">
                Apply as a provider
              </Link>
            </div>
          </div>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
