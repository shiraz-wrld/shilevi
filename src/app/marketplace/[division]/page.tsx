"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const divisions = {
  products: { title: "Products", description: "Browse products from approved sellers." },
  services: { title: "Services", description: "Find professionals and local services." },
  transport_delivery: { title: "Transport & Delivery", description: "Explore transport and delivery providers." },
  property_places: { title: "Property & Places", description: "Explore property, accommodation, venues and places." },
} as const;
type Division = keyof typeof divisions;
type Category = { id: string; slug: string; name: string; division: Division; description: string | null };
type Listing = { id: string; title: string; description: string; price_minor: number | null; currency: string; category_id: string; published_at: string | null };

export default function MarketplaceDivisionPage() {
  const params = useParams<{ division: string }>();
  const rawDivision = typeof params.division === "string" ? params.division : "";
  const validDivision = Object.prototype.hasOwnProperty.call(divisions, rawDivision);
  const division = validDivision ? rawDivision as Division : null;
  const [categorySlug, setCategorySlug] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("newest");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [categories, setCategories] = useState<Category[]>([]);
  const [listings, setListings] = useState<Listing[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const value = query.get("category") ?? "";
    setCategorySlug(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 100 ? value : "");
    const q = (query.get("q") ?? "").slice(0, 80);
    setSearchInput(q); setSearch(q);
    const order = query.get("sort") ?? "newest";
    setSort(["newest", "price_low", "price_high", "title"].includes(order) ? order : "newest");
    setMinPrice(query.get("min") ?? ""); setMaxPrice(query.get("max") ?? "");
  }, []);

  useEffect(() => {
    let alive = true;
    async function load() {
      if (!division) { setState("ready"); return; }
      try {
        const supabase = createSupabaseBrowserClient();
        const categoryResult = await supabase.from("marketplace_categories").select("id,slug,name,division,description").eq("is_active", true).eq("division", division).order("sort_order").limit(100);
        if (categoryResult.error) throw categoryResult.error;
        const availableCategories = (categoryResult.data ?? []) as Category[];
        const selected = categorySlug ? availableCategories.find(category => category.slug === categorySlug) : undefined;
        if (categorySlug && !selected) {
          if (!alive) return;
          setCategories(availableCategories);
          setListings([]);
          setState("ready");
          return;
        }
        let query = supabase.from("listings").select("id,title,description,price_minor,currency,category_id,published_at").eq("status", "published").in("category_id", selected ? [selected.id] : availableCategories.map(category => category.id)).limit(48);
        const cleanSearch = search.trim().replace(/[%_,().]/g, " ").replace(/\s+/g, " ").slice(0, 80);
        if (cleanSearch.length >= 2) query = query.ilike("title", "%" + cleanSearch + "%");
        if (minPrice.trim() && Number.isFinite(Number(minPrice)) && Number(minPrice) >= 0 && Number(minPrice) <= 1000000000) query = query.gte("price_minor", Math.round(Number(minPrice) * 100));
        if (maxPrice.trim() && Number.isFinite(Number(maxPrice)) && Number(maxPrice) >= 0 && Number(maxPrice) <= 1000000000) query = query.lte("price_minor", Math.round(Number(maxPrice) * 100));
        if (sort === "price_low") query = query.order("price_minor", { ascending: true, nullsFirst: false });
        else if (sort === "price_high") query = query.order("price_minor", { ascending: false, nullsFirst: false });
        else if (sort === "title") query = query.order("title", { ascending: true });
        else query = query.order("published_at", { ascending: false, nullsFirst: false });
        if (!availableCategories.length) {
          if (!alive) return;
          setCategories([]);
          setListings([]);
          setState("ready");
          return;
        }
        const listingResult = await query;
        if (listingResult.error) throw listingResult.error;
        if (!alive) return;
        setCategories(availableCategories);
        setListings((listingResult.data ?? []) as Listing[]);
        setState("ready");
      } catch {
        if (alive) setState("error");
      }
    }
    void load();
    return () => { alive = false; };
  }, [division, categorySlug, search, sort, minPrice, maxPrice, refreshKey]);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (minPrice.trim() && maxPrice.trim() && Number(minPrice) > Number(maxPrice)) return;
    setSearch(searchInput.trim().slice(0, 80));
    const params = new URLSearchParams();
    if (categorySlug) params.set("category", categorySlug);
    if (searchInput.trim()) params.set("q", searchInput.trim().slice(0, 80));
    if (sort !== "newest") params.set("sort", sort);
    if (minPrice.trim()) params.set("min", minPrice.trim());
    if (maxPrice.trim()) params.set("max", maxPrice.trim());
    const suffix = params.toString();
    window.history.replaceState(null, "", "/marketplace/" + division + (suffix ? "?" + suffix : ""));
    setRefreshKey(value => value + 1);
  }

  function clearFilters() {
    setCategorySlug(""); setSearchInput(""); setSearch(""); setSort("newest"); setMinPrice(""); setMaxPrice("");
    if (division) window.history.replaceState(null, "", "/marketplace/" + division);
    setRefreshKey(value => value + 1);
  }

  if (!division) return <main className="min-h-screen bg-slate-50 px-5 py-12"><section className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-8"><h1 className="text-2xl font-black">Marketplace section not found</h1><Link href="/" className="mt-4 inline-block font-semibold text-blue-700">Return home</Link></section></main>;
  const formatPrice = (amount: number | null, currency: string) => amount === null ? "Ask for price" : new Intl.NumberFormat("en-KE", { style: "currency", currency: /^[A-Z]{3}$/.test(currency) ? currency : "KES", maximumFractionDigits: 2 }).format(amount / 100);
  const selectedCategory = categories.find(category => category.slug === categorySlug);
  return <main className="min-h-screen bg-slate-50 text-slate-950"><header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5"><Link href="/" className="text-2xl font-black text-blue-700">shilevi</Link><Link href="/" className="text-sm font-semibold text-blue-700 hover:underline">← All marketplace</Link></div></header><div className="mx-auto max-w-6xl px-5 py-10 sm:py-14"><p className="text-sm font-bold uppercase tracking-wide text-blue-700">Explore Shilevi</p><h1 className="mt-2 text-4xl font-black">{divisions[division].title}</h1><p className="mt-3 max-w-2xl leading-7 text-slate-600">{divisions[division].description}</p><div className="mt-7 flex flex-wrap gap-2"><Link href={`/marketplace/${division}`} className={`rounded-full border px-4 py-2 text-sm font-semibold ${!categorySlug ? "border-blue-700 bg-blue-700 text-white" : "border-slate-300 bg-white text-slate-700"}`}>All categories</Link>{categories.map(category=><Link key={category.id} href={`/marketplace/${division}?category=${encodeURIComponent(category.slug)}`} className={`rounded-full border px-4 py-2 text-sm font-semibold ${categorySlug===category.slug ? "border-blue-700 bg-blue-700 text-white" : "border-slate-300 bg-white text-slate-700"}`}>{category.name}</Link>)}</div><form onSubmit={applyFilters} className="mt-7 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="grid gap-4 md:grid-cols-2"><label className="text-sm font-semibold">Search listing titles<input value={searchInput} onChange={e=>setSearchInput(e.target.value)} maxLength={80} placeholder="e.g. office chair, plumber, bedsitter" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" /><span className="mt-1 block text-xs font-normal text-slate-500">Enter at least 2 characters to search.</span></label>
          <label className="text-sm font-semibold">Sort results<select value={sort} onChange={e=>setSort(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-normal"><option value="newest">Newest first</option><option value="price_low">Price: low to high</option><option value="price_high">Price: high to low</option><option value="title">Title: A–Z</option></select></label></div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="text-sm font-semibold">Minimum price<input type="number" min="0" max="1000000000" step="0.01" value={minPrice} onChange={e=>setMinPrice(e.target.value)} placeholder="No minimum" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" /></label><label className="text-sm font-semibold">Maximum price<input type="number" min="0" max="1000000000" step="0.01" value={maxPrice} onChange={e=>setMaxPrice(e.target.value)} placeholder="No maximum" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" /></label></div>
        {minPrice && maxPrice && Number(minPrice) > Number(maxPrice) && <p role="alert" className="mt-3 text-sm text-red-700">Minimum price cannot exceed maximum price.</p>}
        <div className="mt-4 flex gap-3"><button disabled={Boolean(minPrice && maxPrice && Number(minPrice) > Number(maxPrice))} className="rounded-xl bg-blue-700 px-5 py-3 text-sm font-bold text-white disabled:opacity-50">Apply filters</button><button type="button" onClick={clearFilters} className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-bold">Clear filters</button></div>
      </form>{state === "loading" ? <p role="status" className="mt-8 text-slate-500">Loading published listings…</p> : state === "error" ? <p role="alert" className="mt-8 rounded-xl bg-amber-50 p-5 text-sm text-amber-900">Marketplace data is temporarily unavailable. Please try again later.</p> : !categories.length ? <p className="mt-8 rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm leading-6 text-slate-600">Categories for this section are not active yet. Please check back later.</p> : categorySlug && !selectedCategory ? <p className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">That category is not available in this section.</p> : listings.length ? <><p className="mt-8 text-sm text-slate-500">{selectedCategory ? selectedCategory.name : divisions[division].title} · {listings.length} latest {listings.length===1?"listing":"listings"}</p><div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{listings.map(item=><article key={item.id} className="rounded-2xl border border-slate-200 bg-white p-5"><p className="text-xs font-bold uppercase tracking-wide text-blue-700">{categories.find(category=>category.id===item.category_id)?.name ?? "Listing"}</p><h2 className="mt-3 text-lg font-bold">{item.title}</h2><p className="mt-2 line-clamp-3 text-sm leading-6 text-slate-600">{item.description || "Contact the provider for more details."}</p><p className="mt-4 font-bold">{formatPrice(item.price_minor,item.currency)}</p><Link href={"/listing/" + item.id} className="mt-4 inline-flex w-fit rounded-xl bg-blue-700 px-4 py-2 text-sm font-bold text-white hover:bg-blue-800">View listing details →</Link></article>)}</div></> : <p className="mt-8 rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm leading-6 text-slate-600">No published listings in this section yet. Approved providers will appear here after their listings are reviewed and published.</p>}</div></main>;
}
