"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { CartLink } from "@/components/cart/CartLink";

type Division = "products" | "services" | "transport_delivery" | "property_places";
type Category = { id: string; slug: string; name: string; division: Division; description: string | null; sort_order: number };
type Brand = { id: string; slug: string; name: string; description: string; logo_url: string | null; is_featured: boolean; sort_order: number };
type Listing = { id: string; title: string; description: string; price_minor: number | null; currency: string; brand_id: string | null; published_at: string | null; category_id: string };

const divisions: { key: Division; title: string; description: string }[] = [
  { key: "products", title: "Products", description: "Goods from approved sellers." },
  { key: "services", title: "Services", description: "Find local professionals and book services." },
  { key: "transport_delivery", title: "Transport & Delivery", description: "Arrange transport and parcel delivery." },
  { key: "property_places", title: "Property & Places", description: "Explore property, stays, venues, and places." },
];

function money(minor: number | null, currency: string) {
  if (minor === null || !Number.isFinite(minor)) return "Ask for price";
  return new Intl.NumberFormat("en-KE", { style: "currency", currency: /^[A-Z]{3}$/.test(currency) ? currency : "KES", maximumFractionDigits: 2 }).format(minor / 100);
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
  const brandName = (id: string | null) => id ? brands.find(item => item.id === id)?.name : undefined;
  const ListingGrid = ({ items }: { items: Listing[] }) => items.length ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{items.map(item => <article key={item.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-bold uppercase tracking-wide text-blue-700">{categoryName(item.category_id)}</p><h3 className="mt-3 line-clamp-2 text-lg font-bold">{item.title}</h3><p className="mt-2 line-clamp-3 text-sm leading-6 text-slate-600">{item.description || "See details from this approved provider."}</p><p className="mt-4 font-bold">{money(item.price_minor, item.currency)}</p>{brandName(item.brand_id) && <p className="mt-2 text-xs text-slate-500">By {brandName(item.brand_id)}</p>}<Link href={"/listing/" + item.id} className="mt-4 inline-flex w-fit rounded-xl bg-blue-700 px-4 py-2 text-sm font-bold text-white hover:bg-blue-800">View details →</Link></article>)}</div> : <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm leading-6 text-slate-600">Nothing has been published here yet. Check back as verified providers add their first listings.</p>;

  return <main id="main-content" className="min-h-screen bg-slate-50 text-slate-950">
    <header className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-5 sm:px-6"><Link href="/" className="text-2xl font-black tracking-tight text-blue-700">shilevi</Link><nav aria-label="Main navigation" className="flex items-center gap-3 text-sm sm:gap-5"><a href="#marketplaces" className="hidden sm:inline">Explore</a><Link href="/search" className="hidden sm:inline">Search</Link><CartLink /><Link href="/login">Log in</Link><Link href="/signup" className="rounded-full bg-blue-700 px-4 py-2.5 font-semibold text-white hover:bg-blue-800 sm:px-5">Get started</Link></nav></header>
    <section className="mx-auto grid max-w-7xl gap-10 px-5 py-12 sm:px-6 lg:grid-cols-2 lg:items-center lg:py-20"><div><p className="mb-5 inline-flex rounded-full border border-blue-100 bg-white px-4 py-2 text-sm font-medium text-blue-700">Built for Kenya. Designed for everyday life.</p><h1 className="max-w-3xl text-5xl font-black leading-tight tracking-tight sm:text-7xl">One place for <span className="text-blue-700">what you need.</span></h1><p className="mt-6 max-w-xl text-lg leading-8 text-slate-600">Shop products, discover services, arrange delivery, and explore property and places — through one connected marketplace.</p><div className="mt-8 flex flex-wrap gap-3"><a href="#marketplaces" className="rounded-full bg-blue-700 px-6 py-3 font-semibold text-white hover:bg-blue-800">Explore Shilevi →</a><Link href="/signup?intent=provider" className="rounded-full border border-slate-300 bg-white px-6 py-3 font-semibold hover:border-blue-400">Become a provider</Link></div><p className="mt-8 text-sm text-slate-500">One account. Multiple provider activities. Clear offers and safer workflows.</p></div><div className="rounded-[2rem] border border-white bg-white p-5 shadow-xl sm:p-8"><div className="grid grid-cols-2 gap-3 sm:gap-4">{divisions.map((d,i)=><article key={d.key} className="rounded-2xl bg-slate-50 p-4 sm:p-5"><span className="text-sm font-bold text-blue-700">0{i+1}</span><h2 className="mt-5 text-base font-bold sm:mt-6 sm:text-lg">{d.title}</h2><p className="mt-2 text-sm leading-6 text-slate-600">{d.description}</p></article>)}</div><div className="mt-4 rounded-2xl bg-slate-950 p-5 text-white"><p className="text-sm text-blue-200">The Shilevi promise</p><p className="mt-1 text-lg font-semibold">Clear offers. Trusted connections. Better access.</p></div></div></section>
    <section id="marketplaces" className="border-y border-slate-200 bg-white py-14 sm:py-16"><div className="mx-auto max-w-7xl px-5 sm:px-6"><h2 className="text-3xl font-black">Explore the marketplace</h2><p className="mt-3 max-w-2xl text-slate-600">Start with a division, then narrow your search by category.</p>{loadState === "loading" ? <p role="status" className="mt-6 text-sm text-slate-500">Loading live marketplace categories…</p> : loadState === "error" ? <p role="alert" className="mt-6 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">Live categories are temporarily unavailable. You can still create an account or try again later.</p> : <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{divisions.map(d=><article key={d.key} className="rounded-2xl border border-slate-200 p-5"><h3 className="font-bold">{d.title}</h3><p className="mt-2 text-sm leading-6 text-slate-600">{d.description}</p><ul className="mt-4 space-y-2">{categories.filter(c=>c.division===d.key).map(c=><li key={c.id}><Link className="text-sm font-medium text-blue-700 hover:underline" href={`/marketplace/${d.key}?category=${encodeURIComponent(c.slug)}`}>{c.name}</Link></li>)}</ul>{!categories.some(c=>c.division===d.key) && <p className="mt-4 text-xs text-slate-500">Categories will appear when enabled by Shilevi.</p>}</article>)}</div>}</div></section>
    <section className="py-14 sm:py-16"><div className="mx-auto max-w-7xl px-5 sm:px-6"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm font-bold uppercase tracking-wide text-blue-700">Handpicked</p><h2 className="mt-2 text-3xl font-black">Featured finds</h2></div><p className="max-w-md text-sm leading-6 text-slate-500">Items appear here only after an authorized workflow features and publishes them.</p></div><div className="mt-7">{loadState === "loading" ? <p role="status" className="text-sm text-slate-500">Loading published listings…</p> : loadState === "error" ? <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">Featured listings are unavailable right now.</p> : <ListingGrid items={featured}/>}</div></div></section>
    <section className="border-y border-slate-200 bg-white py-14 sm:py-16"><div className="mx-auto max-w-7xl px-5 sm:px-6"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm font-bold uppercase tracking-wide text-blue-700">Freshly published</p><h2 className="mt-2 text-3xl font-black">New on Shilevi</h2></div><p className="max-w-md text-sm leading-6 text-slate-500">A live feed of published listings, not made-up purchase counts or popularity claims.</p></div><div className="mt-7">{loadState === "loading" ? <p role="status" className="text-sm text-slate-500">Loading newest listings…</p> : loadState === "error" ? <p className="rounded-xl border border-slate-200 p-5 text-sm text-slate-600">New listings are unavailable right now.</p> : <ListingGrid items={recent}/>}</div></div></section>
    <section className="py-14 sm:py-16"><div className="mx-auto max-w-7xl px-5 sm:px-6"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm font-bold uppercase tracking-wide text-blue-700">Discover businesses</p><h2 className="mt-2 text-3xl font-black">Featured brands</h2></div><p className="max-w-md text-sm leading-6 text-slate-500">Brand storefronts appear after a brand is added and approved. No partnership is implied by an empty placeholder.</p></div>{loadState === "loading" ? <p role="status" className="mt-7 text-sm text-slate-500">Loading brands…</p> : loadState === "error" ? <p className="mt-7 rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">Brand information is unavailable right now.</p> : brands.length ? <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{brands.map(brand=><Link key={brand.id} href={`/brands/${brand.slug}`} className="rounded-2xl border border-slate-200 bg-white p-5 transition hover:border-blue-400 hover:shadow-sm"><div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl bg-blue-50 text-lg font-black text-blue-700">{brand.logo_url ? <img src={brand.logo_url} alt={`${brand.name} logo`} loading="lazy" className="h-full w-full object-contain"/> : brand.name.slice(0,1).toUpperCase()}</div><h3 className="mt-4 font-bold">{brand.name}</h3><p className="mt-2 line-clamp-3 text-sm leading-6 text-slate-600">{brand.description || "Explore this brand's published Shilevi listings."}</p><span className="mt-4 inline-block text-sm font-semibold text-blue-700">View storefront →</span></Link>)}</div> : <p className="mt-7 rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm leading-6 text-slate-600">No featured brands yet. Once a brand is approved and featured in the admin workflow, its storefront will appear here.</p>}</div></section>
    <section className="bg-slate-950 py-12 text-white"><div className="mx-auto flex max-w-7xl flex-col gap-5 px-5 sm:flex-row sm:items-center sm:justify-between sm:px-6"><div><h2 className="text-2xl font-black">Ready to join Shilevi?</h2><p className="mt-2 text-sm leading-6 text-slate-300">Create an account as a customer and apply separately to become a provider.</p></div><Link href="/signup" className="inline-flex w-fit rounded-full bg-blue-600 px-6 py-3 font-semibold text-white hover:bg-blue-500">Create your account</Link></div></section>
    <footer className="mx-auto flex max-w-7xl flex-wrap justify-between gap-4 px-5 py-8 text-sm text-slate-500 sm:px-6"><span>© {new Date().getFullYear()} Shilevi</span><div className="flex flex-wrap gap-5"><Link href="/how-it-works">How it works</Link><Link href="/pricing">Pricing</Link><Link href="/legal/terms">Terms</Link><Link href="/legal/privacy">Privacy</Link><Link href="/support">Support</Link></div></footer>
  </main>;
}
