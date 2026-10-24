"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Brand = { id: string; slug: string; name: string; description: string; logo_url: string | null; website_url: string | null };
type Listing = { id: string; title: string; description: string; price_minor: number | null; currency: string; published_at: string | null };

export default function BrandStorefrontPage() {
  const params = useParams<{ slug: string }>();
  const slug = typeof params.slug === "string" ? params.slug : "";
  const [brand, setBrand] = useState<Brand | null>(null);
  const [listings, setListings] = useState<Listing[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");

  useEffect(() => {
    let alive = true;
    async function load() {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 100) {
        setState("missing");
        return;
      }
      try {
        const supabase = createSupabaseBrowserClient();
        const result = await supabase.from("marketplace_brands").select("id,slug,name,description,logo_url,website_url").eq("slug", slug).eq("is_active", true).maybeSingle();
        if (result.error) throw result.error;
        if (!result.data) { if (alive) setState("missing"); return; }
        const listingResult = await supabase.from("listings").select("id,title,description,price_minor,currency,published_at").eq("brand_id", result.data.id).eq("status", "published").order("published_at", { ascending: false }).limit(48);
        if (listingResult.error) throw listingResult.error;
        if (!alive) return;
        setBrand(result.data as Brand);
        setListings((listingResult.data ?? []) as Listing[]);
        setState("ready");
      } catch {
        if (alive) setState("error");
      }
    }
    void load();
    return () => { alive = false; };
  }, [slug]);

  const formatPrice = (amount: number | null, currency: string) => amount === null ? "Ask for price" : new Intl.NumberFormat("en-KE", { style: "currency", currency: /^[A-Z]{3}$/.test(currency) ? currency : "KES", maximumFractionDigits: 2 }).format(amount / 100);

  return <main className="min-h-screen bg-slate-50 text-slate-950"><header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5"><Link href="/" className="text-2xl font-black text-blue-700">shilevi</Link><Link href="/" className="text-sm font-semibold text-blue-700 hover:underline">← Back to marketplace</Link></div></header><div className="mx-auto max-w-6xl px-5 py-10 sm:py-14">{state === "loading" ? <p role="status" className="rounded-xl bg-white p-6 text-slate-600">Loading brand storefront…</p> : state === "error" ? <section role="alert" className="rounded-2xl border border-slate-200 bg-white p-8"><h1 className="text-2xl font-black">Storefront unavailable</h1><p className="mt-3 text-slate-600">We couldn&apos;t load this brand right now. Please try again later.</p></section> : state === "missing" || !brand ? <section className="rounded-2xl border border-slate-200 bg-white p-8"><h1 className="text-2xl font-black">Brand not found</h1><p className="mt-3 text-slate-600">This brand may not be active or the address may be incorrect.</p><Link href="/" className="mt-5 inline-block font-semibold text-blue-700">Explore Shilevi →</Link></section> : <><section className="rounded-3xl border border-slate-200 bg-white p-7 sm:p-10"><div className="flex flex-col gap-5 sm:flex-row sm:items-center">{brand.logo_url ? <img src={brand.logo_url} alt={`${brand.name} logo`} className="h-20 w-20 rounded-2xl border border-slate-100 object-contain p-2" loading="lazy"/> : <div aria-hidden="true" className="flex h-20 w-20 items-center justify-center rounded-2xl bg-blue-50 text-3xl font-black text-blue-700">{brand.name.slice(0,1).toUpperCase()}</div>}<div><p className="text-sm font-bold uppercase tracking-wide text-blue-700">Brand storefront</p><h1 className="mt-1 text-3xl font-black sm:text-4xl">{brand.name}</h1><p className="mt-3 max-w-2xl leading-7 text-slate-600">{brand.description || "Explore this brand's published listings on Shilevi."}</p>{brand.website_url && <a href={brand.website_url} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-sm font-semibold text-blue-700 hover:underline">Visit brand website ↗</a>}</div></div></section><section className="mt-10"><div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-2xl font-black">Published listings</h2><p className="mt-2 text-sm text-slate-600">Only listings currently published on Shilevi appear here.</p></div><span className="text-sm text-slate-500">{listings.length} {listings.length === 1 ? "listing" : "listings"}</span></div>{listings.length ? <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{listings.map(item=><article key={item.id} className="rounded-2xl border border-slate-200 bg-white p-5"><h3 className="text-lg font-bold">{item.title}</h3><p className="mt-2 line-clamp-3 text-sm leading-6 text-slate-600">{item.description || "Contact the provider for more details."}</p><p className="mt-4 font-bold">{formatPrice(item.price_minor, item.currency)}</p></article>)}</div> : <p className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm leading-6 text-slate-600">This brand has no published listings yet. Please check back later.</p>}</section></>}</div></main>;
}
