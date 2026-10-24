"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { formatMoney } from "@/lib/money";

type Property = {
  listing_id: string;
  title: string;
  description: string;
  county: string;
  city: string;
  neighbourhood: string | null;
  property_type: string;
  bedrooms: number | null;
  bathrooms: number | null;
  rent_minor: number;
  deposit_minor: number;
  is_vacant: boolean;
  amenities: string[] | null;
  verification_status: string;
};

const TYPES: Record<string, string> = {
  apartment: "Apartment",
  house: "House",
  bungalow: "Bungalow",
  bedsitter: "Bedsitter",
  studio: "Studio",
  townhouse: "Townhouse",
  shop: "Shop",
  office: "Office",
  warehouse: "Warehouse",
  land: "Land",
  venue: "Venue",
};

export function HouseHuntSearch() {
  const [county, setCounty] = useState("");
  const [city, setCity] = useState("");
  const [maxRent, setMaxRent] = useState("");
  const [bedrooms, setBedrooms] = useState("");
  const [rows, setRows] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const search = useCallback(async (filters?: { county?: string; city?: string; maxRent?: string; bedrooms?: string }) => {
    setLoading(true);
    setError("");
    try {
      const db = createSupabaseBrowserClient();
      const rent = Number(filters?.maxRent ?? maxRent);
      const beds = Number(filters?.bedrooms ?? bedrooms);
      const { data, error: searchError } = await db.rpc("search_public_properties", {
        p_county: (filters?.county ?? county).trim() || null,
        p_city: (filters?.city ?? city).trim() || null,
        p_max_rent_minor: Number.isFinite(rent) && rent > 0 ? Math.round(rent * 100) : null,
        p_min_bedrooms: Number.isFinite(beds) && beds > 0 ? Math.round(beds) : null,
        p_limit: 30,
      });
      if (searchError) throw searchError;
      setRows((data ?? []) as Property[]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Properties could not be loaded. Confirm migration 0021 has been applied.");
    } finally {
      setLoading(false);
    }
  }, [bedrooms, city, county, maxRent]);

  useEffect(() => {
    let active = true;
    async function initial() {
      try {
        const db = createSupabaseBrowserClient();
        const { data, error: searchError } = await db.rpc("search_public_properties", {
          p_county: null, p_city: null, p_max_rent_minor: null, p_min_bedrooms: null, p_limit: 30,
        });
        if (searchError) throw searchError;
        if (active) setRows((data ?? []) as Property[]);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Properties could not be loaded. Confirm migration 0021 has been applied.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void initial();
    return () => { active = false; };
  }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void search();
  }

  return (
    <section id="search" className="mx-auto max-w-7xl scroll-mt-8 px-5 py-10 sm:px-6">
      <form onSubmit={submit} className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <label className="text-sm font-bold">
            County
            <input value={county} onChange={event => setCounty(event.target.value)} maxLength={80} placeholder="e.g. Nairobi" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" />
          </label>
          <label className="text-sm font-bold">
            Town or city
            <input value={city} onChange={event => setCity(event.target.value)} maxLength={80} placeholder="e.g. Nairobi" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" />
          </label>
          <label className="text-sm font-bold">
            Max rent (KSh)
            <input type="number" min={0} value={maxRent} onChange={event => setMaxRent(event.target.value)} placeholder="No maximum" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" />
          </label>
          <label className="text-sm font-bold">
            Bedrooms
            <input type="number" min={0} max={50} value={bedrooms} onChange={event => setBedrooms(event.target.value)} placeholder="Any" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" />
          </label>
          <button className="self-end rounded-xl bg-blue-700 px-5 py-3 text-sm font-bold text-white hover:bg-blue-800">Search homes</button>
        </div>
        <p className="mt-3 text-xs leading-5 text-slate-500">Searching is free and does not require an account. Listings show the general area, not the exact house number.</p>
      </form>

      <div className="mt-8 flex flex-wrap items-end justify-between gap-2">
        <h2 className="text-2xl font-black tracking-tight">Available properties</h2>
        <p className="text-sm text-slate-500">{loading ? "Loading…" : `${rows.length} ${rows.length === 1 ? "home" : "homes"}`}</p>
      </div>

      {error ? (
        <p role="alert" className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-950">{error}</p>
      ) : loading ? (
        <p role="status" className="mt-4 rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">Loading properties…</p>
      ) : rows.length === 0 ? (
        <p className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm leading-6 text-slate-600">
          No published property matches these filters yet. Try a wider area or a higher rent; we never pad results with
          fake listings.
        </p>
      ) : (
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map(home => (
            <article key={home.listing_id} className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <div className="flex h-28 items-center justify-center bg-gradient-to-br from-blue-50 to-slate-100 text-sm font-bold uppercase tracking-widest text-blue-800">
                {TYPES[home.property_type] ?? home.property_type}
              </div>
              <div className="flex flex-1 flex-col p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h3 className="text-lg font-bold leading-snug">{home.title}</h3>
                  {home.verification_status === "verified" && (
                    <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-800">Verified</span>
                  )}
                </div>
                <p className="mt-1 text-sm text-slate-600">{home.neighbourhood ? `${home.neighbourhood}, ` : ""}{home.city}, {home.county}</p>
                <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">{home.description || "Contact the landlord for more details."}</p>
                <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
                  <div><dt className="text-slate-500">Monthly rent</dt><dd className="font-black">{formatMoney(home.rent_minor, "KES")}</dd></div>
                  <div><dt className="text-slate-500">Deposit</dt><dd className="font-bold">{formatMoney(home.deposit_minor, "KES")}</dd></div>
                  <div><dt className="text-slate-500">Bedrooms</dt><dd className="font-bold">{home.bedrooms ?? "—"}</dd></div>
                  <div><dt className="text-slate-500">Vacancy</dt><dd className="font-bold">{home.is_vacant ? "Available" : "Occupied"}</dd></div>
                </dl>
                {home.amenities && home.amenities.length > 0 && (
                  <p className="mt-3 text-xs leading-5 text-slate-500">{home.amenities.slice(0, 4).join(" · ")}</p>
                )}
                <Link href={`/house-hunt/${home.listing_id}`} className="mt-4 inline-flex w-fit rounded-xl bg-blue-700 px-4 py-2 text-sm font-bold text-white hover:bg-blue-800">
                  View property →
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
