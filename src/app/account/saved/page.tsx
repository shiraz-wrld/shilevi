"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Saved = { listing_id: string; created_at: string };
type Listing = { id: string; title: string; description: string; price_minor: number | null; currency: string; category_id: string };

export default function SavedListingsPage() {
  const [items, setItems] = useState<Listing[]>([]);
  const [categories, setCategories] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState("");

  async function load() {
    setLoading(true); setError("");
    try {
      const db = createSupabaseBrowserClient();
      const auth = await db.auth.getUser();
      if (auth.error) throw auth.error;
      if (!auth.data.user) { window.location.replace("/login?next=%2Faccount%2Fsaved"); return; }
      const saved = await db.from("saved_listings").select("listing_id,created_at").eq("user_id", auth.data.user.id).order("created_at", { ascending: false }).limit(200);
      if (saved.error) throw saved.error;
      const ids = ((saved.data ?? []) as Saved[]).map(row => row.listing_id);
      if (!ids.length) { setItems([]); return; }
      const listingResult = await db.from("listings").select("id,title,description,price_minor,currency,category_id").in("id", ids).eq("status", "published").limit(200);
      if (listingResult.error) throw listingResult.error;
      const rows = (listingResult.data ?? []) as Listing[];
      const byId = new Map(rows.map(row => [row.id, row]));
      setItems(ids.map(id => byId.get(id)).filter((row): row is Listing => Boolean(row)));
      const catIds = [...new Set(rows.map(row => row.category_id))];
      if (catIds.length) {
        const cats = await db.from("marketplace_categories").select("id,name").in("id", catIds);
        if (cats.error) throw cats.error;
        setCategories(Object.fromEntries((cats.data ?? []).map(row => [row.id, row.name])));
      } else setCategories({});
    } catch {
      setError("Your saved listings could not be loaded right now. Please try again in a moment.");
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  async function remove(id: string) {
    setRemoving(id); setError("");
    try {
      const db = createSupabaseBrowserClient();
      const result = await db.from("saved_listings").delete().eq("listing_id", id);
      if (result.error) throw result.error;
      setItems(current => current.filter(item => item.id !== id));
    } catch {
      setError("This listing could not be removed from saved items. Please refresh and try again.");
    } finally { setRemoving(""); }
  }

  const money = (amount: number | null, currency: string) => amount === null ? "Ask for price" : new Intl.NumberFormat("en-KE", { style: "currency", currency: /^[A-Z]{3}$/.test(currency) ? currency : "KES", maximumFractionDigits: 2 }).format(amount / 100);

  return <main className="min-h-screen bg-slate-50 text-slate-950"><header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-5"><Link href="/" className="text-2xl font-black text-blue-700">shilevi</Link><Link href="/account" className="text-sm font-semibold text-blue-700">← Account</Link></div></header><div className="mx-auto max-w-5xl px-5 py-10 sm:py-14"><p className="text-sm font-bold uppercase tracking-wide text-blue-700">Your marketplace</p><h1 className="mt-2 text-3xl font-black sm:text-4xl">Saved listings</h1><p className="mt-3 max-w-2xl leading-7 text-slate-600">Keep interesting offers in one place. A saved listing is not a booking, purchase or price guarantee; availability can change.</p>{error && <p role="alert" className="mt-5 rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</p>}{loading ? <p role="status" className="mt-7 rounded-xl border border-slate-200 bg-white p-6 text-slate-600">Loading saved listings…</p> : items.length ? <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{items.map(item=><article key={item.id} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5"><p className="text-xs font-bold uppercase tracking-wide text-blue-700">{categories[item.category_id] ?? "Marketplace listing"}</p><h2 className="mt-3 text-lg font-bold">{item.title}</h2><p className="mt-2 line-clamp-3 text-sm leading-6 text-slate-600">{item.description || "No description provided."}</p><p className="mt-4 font-bold">{money(item.price_minor,item.currency)}</p><div className="mt-auto flex flex-wrap gap-2 pt-5"><Link href={"/listing/" + item.id} className="rounded-xl bg-blue-700 px-4 py-2 text-sm font-bold text-white">View details</Link><button disabled={removing===item.id} onClick={() => void remove(item.id)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold disabled:opacity-50">{removing===item.id ? "Removing…" : "Remove"}</button></div></article>)}</div> : <section className="mt-7 rounded-2xl border border-dashed border-slate-300 bg-white p-8"><h2 className="text-lg font-bold">No saved listings yet</h2><p className="mt-2 text-sm leading-6 text-slate-600">Browse a marketplace section and use “Save listing” on any published listing you want to revisit.</p><Link href="/" className="mt-4 inline-flex rounded-xl bg-blue-700 px-5 py-3 text-sm font-bold text-white">Explore Shilevi</Link></section>}</div></main>;
}
