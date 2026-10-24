"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Category = { id: string; name: string; division: string };
type Location = { county: string };

type ResultItem = {
  id: string;
  title: string;
  description: string;
  price_minor: number | null;
  currency: string;
  category_id: string;
  category_name: string;
  category_slug: string;
  division: string;
  transaction_type: string;
  published_at: string | null;
  is_featured: boolean;
  cover_image_url: string | null;
  location: { county: string | null; city: string | null; neighbourhood: string | null };
  property: {
    property_type: string;
    bedrooms: number | null;
    bathrooms: number | null;
    rent_minor: number;
    deposit_minor: number;
    is_vacant: boolean;
    verification_status: string;
  } | null;
};

type SearchResponse = {
  total: number;
  page: number;
  page_size: number;
  pages: number;
  query: string | null;
  sort: string;
  items: ResultItem[];
  error?: string;
};

const DIVISIONS = [
  { value: "", label: "All marketplace sections" },
  { value: "products", label: "Products" },
  { value: "services", label: "Services" },
  { value: "transport_delivery", label: "Transport & delivery" },
  { value: "property_places", label: "Property & places" },
];

const SORTS = [
  { value: "relevance", label: "Most relevant" },
  { value: "newest", label: "Newest first" },
  { value: "price_low", label: "Price: low to high" },
  { value: "price_high", label: "Price: high to low" },
  { value: "title", label: "Title: A–Z" },
];

const PAGE_SIZE = 24;

function formatMoney(minor: number | null, currency: string) {
  if (minor === null || minor === undefined) return "Ask for price";
  const code = /^[A-Z]{3}$/.test(currency) ? currency : "KES";
  try {
    return new Intl.NumberFormat("en-KE", { style: "currency", currency: code, maximumFractionDigits: 0 }).format(minor / 100);
  } catch {
    return `KSh ${Math.round(minor / 100).toLocaleString("en-KE")}`;
  }
}

/** KSh in the form, minor units on the wire. */
function toMinor(value: string): number | null {
  if (!value.trim()) return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return Math.round(amount * 100);
}

function isDivision(value: string) {
  return DIVISIONS.some(item => item.value === value);
}

function isSort(value: string) {
  return SORTS.some(item => item.value === value);
}

export default function MarketplaceSearchPage() {
  const [input, setInput] = useState("");
  const [queryText, setQueryText] = useState("");
  const [division, setDivision] = useState("");
  const [category, setCategory] = useState("");
  const [county, setCounty] = useState("");
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [sort, setSort] = useState("relevance");
  const [page, setPage] = useState(1);

  const [categories, setCategories] = useState<Category[]>([]);
  const [counties, setCounties] = useState<string[]>([]);
  const [filterOptionsUnavailable, setFilterOptionsUnavailable] = useState(false);

  const [items, setItems] = useState<ResultItem[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(0);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState("");
  const resultsRef = useRef<HTMLDivElement | null>(null);

  // Filter metadata is public: active categories and the serviceable counties. A failure here must
  // not block search, so the controls degrade to text input / all categories.
  useEffect(() => {
    let alive = true;
    async function loadOptions() {
      try {
        const db = createSupabaseBrowserClient();
        const [categoryResult, countyResult] = await Promise.all([
          db.from("marketplace_categories").select("id,name,division").eq("is_active", true).order("sort_order").limit(300),
          db.from("service_locations").select("county").eq("is_active", true).order("sort_order").limit(60),
        ]);
        if (!alive) return;
        if (categoryResult.error) throw categoryResult.error;
        setCategories((categoryResult.data ?? []) as Category[]);
        if (!countyResult.error) {
          const unique = Array.from(new Set(((countyResult.data ?? []) as Location[]).map(row => row.county))).filter(Boolean);
          setCounties(unique.sort((a, b) => a.localeCompare(b)));
        }
      } catch {
        if (alive) setFilterOptionsUnavailable(true);
      }
    }
    void loadOptions();
    return () => {
      alive = false;
    };
  }, []);

  const runSearch = useCallback(
    async (next: {
      query: string;
      division: string;
      category: string;
      county: string;
      min: string;
      max: string;
      sort: string;
      page: number;
    }) => {
      const minMinor = toMinor(next.min);
      const maxMinor = toMinor(next.max);

      if (next.min.trim() && minMinor === null) {
        setError("Enter the minimum price as a number, for example 500.");
        setState("error");
        return;
      }
      if (next.max.trim() && maxMinor === null) {
        setError("Enter the maximum price as a number, for example 5000.");
        setState("error");
        return;
      }
      if (minMinor !== null && maxMinor !== null && minMinor > maxMinor) {
        setError("The minimum price cannot be higher than the maximum price.");
        setState("error");
        return;
      }

      const params = new URLSearchParams();
      if (next.query) params.set("q", next.query);
      if (next.division) params.set("division", next.division);
      if (next.category) params.set("category", next.category);
      if (next.county) params.set("county", next.county);
      if (minMinor !== null) params.set("minPriceMinor", String(minMinor));
      if (maxMinor !== null) params.set("maxPriceMinor", String(maxMinor));
      if (next.sort && next.sort !== "relevance") params.set("sort", next.sort);
      if (next.page > 1) params.set("page", String(next.page));
      params.set("pageSize", String(PAGE_SIZE));

      window.history.replaceState(null, "", `/search${params.toString() ? `?${params.toString()}` : ""}`);

      setError("");
      setState("loading");
      setQueryText(next.query);
      try {
        const response = await fetch(`/api/search?${params.toString()}`, { cache: "no-store" });
        const payload = (await response.json().catch(() => ({}))) as SearchResponse;
        if (!response.ok) {
          setError(payload.error ?? "Search is temporarily unavailable. Try again in a moment.");
          setState("error");
          return;
        }
        setItems(Array.isArray(payload.items) ? payload.items : []);
        setTotal(Number(payload.total) || 0);
        setPages(Number(payload.pages) || 0);
        setPage(Number(payload.page) || 1);
        setState("ready");
      } catch {
        setError("We could not reach search. Check your connection and try again.");
        setState("error");
      }
    },
    [],
  );

  // First load: hydrate from the URL so a shared link reproduces the same search.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initial = {
      query: (params.get("q") ?? "").trim().slice(0, 120),
      division: isDivision(params.get("division") ?? "") ? params.get("division") ?? "" : "",
      category: params.get("category") ?? "",
      county: params.get("county") ?? "",
      min: params.get("minPriceMinor") ? String(Number(params.get("minPriceMinor")) / 100) : "",
      max: params.get("maxPriceMinor") ? String(Number(params.get("maxPriceMinor")) / 100) : "",
      sort: isSort(params.get("sort") ?? "") ? params.get("sort") ?? "relevance" : "relevance",
      page: Math.max(1, Number(params.get("page") ?? 1) || 1),
    };
    setInput(initial.query);
    setDivision(initial.division);
    setCategory(/^[0-9a-f-]{36}$/i.test(initial.category) ? initial.category : "");
    setCounty(initial.county.slice(0, 80));
    setMin(initial.min === "NaN" ? "" : initial.min);
    setMax(initial.max === "NaN" ? "" : initial.max);
    setSort(initial.sort);
    setPage(initial.page);
    void runSearch(initial);
  }, [runSearch]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runSearch({ query: input.trim().replace(/\s+/g, " ").slice(0, 120), division, category, county, min, max, sort, page: 1 });
  }

  function clearFilters() {
    setInput("");
    setDivision("");
    setCategory("");
    setCounty("");
    setMin("");
    setMax("");
    setSort("relevance");
    void runSearch({ query: "", division: "", category: "", county: "", min: "", max: "", sort: "relevance", page: 1 });
  }

  function goToPage(next: number) {
    if (next < 1 || (pages > 0 && next > pages)) return;
    void runSearch({ query: queryText, division, category, county, min, max, sort, page: next });
    resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function recordClick(listingId: string) {
    // Fire-and-forget: engagement analytics must never delay or block navigation.
    try {
      void fetch("/api/search/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId }),
        keepalive: true,
      }).catch(() => undefined);
    } catch {
      // ignored on purpose
    }
  }

  const visibleCategories = useMemo(
    () => categories.filter(item => !division || item.division === division),
    [categories, division],
  );

  const activeFilterCount = [division, category, county, min, max].filter(Boolean).length;

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
          <Link href="/" className="text-2xl font-black text-blue-700">shilevi</Link>
          <nav className="flex items-center gap-4 text-sm font-semibold text-blue-700">
            <Link href="/marketplace/products">Products</Link>
            <Link href="/house-hunt">House Hunt</Link>
            <Link href="/account">My account</Link>
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-5 py-10 sm:py-14">
        <p className="text-sm font-bold uppercase tracking-wide text-blue-700">Find what you need</p>
        <h1 className="mt-2 text-3xl font-black sm:text-4xl">Search Shilevi</h1>
        <p className="mt-3 max-w-2xl leading-7 text-slate-600">
          Search published products, services, transport and property listings. Results show public
          details only; House Hunt contact information always requires the paid unlock on the listing.
        </p>

        <form onSubmit={submit} className="mt-7 rounded-2xl border border-slate-200 bg-white p-5 sm:p-7">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <label className="block text-sm font-bold">
              What are you looking for?
              <input
                value={input}
                onChange={event => setInput(event.target.value.slice(0, 120))}
                maxLength={120}
                placeholder="Try “headphones”, “apartment Kilimani”, “braiding”"
                className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </label>
            <label className="block text-sm font-bold">
              Marketplace section
              <select
                value={division}
                onChange={event => {
                  setDivision(event.target.value);
                  setCategory("");
                }}
                className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-normal focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-200"
              >
                {DIVISIONS.map(item => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block text-sm font-bold">
              Category
              <select
                value={category}
                onChange={event => setCategory(event.target.value)}
                className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-normal focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-200"
              >
                <option value="">All categories</option>
                {category && !visibleCategories.some(item => item.id === category) && (
                  <option value={category}>Selected category</option>
                )}
                {visibleCategories.map(item => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-bold">
              County
              <input
                list="shilevi-counties"
                value={county}
                onChange={event => setCounty(event.target.value.slice(0, 80))}
                placeholder={counties.length ? "Type or choose a county" : "County"}
                maxLength={80}
                className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
              <datalist id="shilevi-counties">
                {counties.map(item => <option key={item} value={item} />)}
              </datalist>
            </label>
            <label className="block text-sm font-bold">
              Minimum price (KSh)
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="1"
                value={min}
                onChange={event => setMin(event.target.value)}
                placeholder="No minimum"
                className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </label>
            <label className="block text-sm font-bold">
              Maximum price (KSh)
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="1"
                value={max}
                onChange={event => setMax(event.target.value)}
                placeholder="No maximum"
                className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </label>
          </div>

          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="block w-full max-w-xs text-sm font-bold">
              Sort results
              <select
                value={sort}
                onChange={event => setSort(event.target.value)}
                className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-normal focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-200"
              >
                {SORTS.map(item => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </label>
            <button className="rounded-xl bg-blue-700 px-6 py-3 font-bold text-white hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-300">
              Search
            </button>
            {activeFilterCount > 0 && (
              <button
                type="button"
                onClick={clearFilters}
                className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-700 hover:border-slate-400"
              >
                Clear filters ({activeFilterCount})
              </button>
            )}
          </div>

          {filterOptionsUnavailable && (
            <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
              Category and county suggestions could not be loaded. You can still search and type a county.
            </p>
          )}
          {error && state !== "error" && (
            <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>
          )}
        </form>

        <div ref={resultsRef} className="mt-8 scroll-mt-6">
          {state === "idle" && (
            <p className="text-sm text-slate-500">Enter a term, or choose a section, category, county or price to browse.</p>
          )}

          {state === "loading" && (
            <div aria-busy="true" className="rounded-2xl border border-slate-200 bg-white p-6">
              <p role="status" className="text-slate-600">Searching published listings…</p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {[0, 1, 2].map(item => (
                  <div key={item} className="h-40 animate-pulse rounded-2xl bg-slate-100" />
                ))}
              </div>
            </div>
          )}

          {state === "error" && (
            <div role="alert" className="rounded-2xl border border-red-200 bg-white p-6">
              <h2 className="text-lg font-bold text-red-800">Search could not be completed</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">{error}</p>
              <button
                onClick={() => void runSearch({ query: input.trim(), division, category, county, min, max, sort, page })}
                className="mt-4 rounded-xl border border-slate-300 bg-white px-5 py-3 font-bold hover:border-slate-400"
              >
                Try again
              </button>
            </div>
          )}

          {state === "ready" && (
            <section aria-labelledby="results-heading">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 id="results-heading" className="text-2xl font-black">
                    {queryText ? <>Results for “{queryText}”</> : "Browse listings"}
                  </h2>
                  <p className="mt-2 text-sm text-slate-500">
                    {division
                      ? `${DIVISIONS.find(item => item.value === division)?.label ?? "Selected section"} · `
                      : ""}
                    {pages > 0 ? `Page ${page} of ${pages}` : "No pages"}
                  </p>
                </div>
                <p aria-live="polite" className="text-sm font-semibold text-slate-700">
                  {total === 1 ? "1 listing" : `${total.toLocaleString("en-KE")} listings`}
                </p>
              </div>

              {items.length === 0 ? (
                <div className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-white p-8">
                  <h3 className="text-lg font-bold">No listings matched</h3>
                  <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">
                    Only published listings in active categories appear here. Try a shorter term,
                    remove a filter, or widen the price range.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-3">
                    {activeFilterCount > 0 && (
                      <button onClick={clearFilters} className="rounded-xl bg-blue-700 px-4 py-2 text-sm font-bold text-white hover:bg-blue-800">
                        Clear filters
                      </button>
                    )}
                    <Link href="/house-hunt" className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold">Browse House Hunt</Link>
                    <Link href="/marketplace/products" className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold">Browse products</Link>
                  </div>
                </div>
              ) : (
                <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {items.map(item => {
                    const place = [item.location.neighbourhood, item.location.city, item.location.county].filter(Boolean).join(", ");
                    return (
                      <article key={item.id} className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white">
                        {item.cover_image_url ? (
                          <img
                            src={item.cover_image_url}
                            alt=""
                            loading="lazy"
                            className="h-40 w-full object-cover"
                          />
                        ) : null}
                        <div className="flex flex-1 flex-col p-5">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-xs font-bold uppercase tracking-wide text-blue-700">{item.category_name}</p>
                            {item.property?.verification_status === "verified" && (
                              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800">Verified</span>
                            )}
                            {item.is_featured && (
                              <span className="rounded-full border border-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-600">Featured</span>
                            )}
                          </div>
                          <h3 className="mt-2 text-lg font-bold">{item.title}</h3>
                          {place && <p className="mt-1 text-sm text-slate-500">{place}</p>}
                          {item.property && (
                            <p className="mt-1 text-sm text-slate-500">
                              {item.property.bedrooms ?? "—"} bed · {item.property.bathrooms ?? "—"} bath
                              {item.property.is_vacant ? "" : " · not currently vacant"}
                            </p>
                          )}
                          <p className="mt-2 line-clamp-3 text-sm leading-6 text-slate-600">
                            {item.description || "No description provided."}
                          </p>
                          <p className="mt-4 font-bold">
                            {formatMoney(item.price_minor, item.currency)}
                            {item.property ? <span className="font-normal text-slate-500"> / month</span> : null}
                          </p>
                          <Link
                            href={`/listing/${item.id}`}
                            onClick={() => recordClick(item.id)}
                            className="mt-4 inline-flex w-fit rounded-xl bg-blue-700 px-4 py-2 text-sm font-bold text-white hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-300"
                          >
                            View details →
                          </Link>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}

              {pages > 1 && (
                <nav aria-label="Search result pages" className="mt-8 flex flex-wrap items-center justify-between gap-3">
                  <button
                    onClick={() => goToPage(page - 1)}
                    disabled={page <= 1}
                    className="rounded-xl border border-slate-300 bg-white px-4 py-2 font-bold disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    ← Previous
                  </button>
                  <p className="text-sm font-semibold text-slate-600">Page {page} of {pages}</p>
                  <button
                    onClick={() => goToPage(page + 1)}
                    disabled={page >= pages}
                    className="rounded-xl border border-slate-300 bg-white px-4 py-2 font-bold disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Next →
                  </button>
                </nav>
              )}
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
