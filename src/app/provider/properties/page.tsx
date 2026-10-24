"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { formatMoney } from "@/lib/money";

type Category = { id: string; name: string; division: string };
type Application = { id: string; status: string };
type Listing = { id: string; title: string; status: string; category_id: string; created_at: string };
type PropertyRow = { listing_id: string; county: string; city: string; neighbourhood: string | null; rent_minor: number; is_vacant: boolean; verification_status: string };

const TYPES = ["apartment", "house", "bungalow", "bedsitter", "studio", "townhouse", "shop", "office", "warehouse", "land", "venue"];

const initialForm = {
  title: "",
  description: "",
  categoryId: "",
  county: "",
  city: "",
  neighbourhood: "",
  propertyType: "apartment",
  bedrooms: "1",
  bathrooms: "1",
  rent: "",
  deposit: "",
  exactAddress: "",
  unitNumber: "",
  contactName: "",
  contactPhone: "",
  contactEmail: "",
  amenities: "",
};

export default function ProviderPropertiesPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [application, setApplication] = useState<Application | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [listings, setListings] = useState<Listing[]>([]);
  const [properties, setProperties] = useState<Record<string, PropertyRow>>({});
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async (id: string) => {
    const db = createSupabaseBrowserClient();
    const [appResult, categoryResult, listingResult] = await Promise.all([
      db.from("provider_applications").select("id,status").eq("user_id", id).eq("activity_type", "property_provider").maybeSingle(),
      db.from("marketplace_categories").select("id,name,division").eq("division", "property_places").eq("is_active", true).order("sort_order").limit(100),
      db.from("listings").select("id,title,status,category_id,created_at").eq("owner_id", id).order("created_at", { ascending: false }).limit(50),
    ]);
    if (appResult.error) throw appResult.error;
    if (categoryResult.error) throw categoryResult.error;
    if (listingResult.error) throw listingResult.error;

    const cats = (categoryResult.data ?? []) as Category[];
    const propertyCategoryIds = new Set(cats.map(category => category.id));
    const own = ((listingResult.data ?? []) as Listing[]).filter(listing => propertyCategoryIds.has(listing.category_id));

    setApplication((appResult.data as Application | null) ?? null);
    setCategories(cats);
    setListings(own);
    setForm(current => ({ ...current, categoryId: current.categoryId || cats[0]?.id || "" }));

    if (own.length > 0) {
      const { data: detailRows } = await db
        .from("property_listings")
        .select("listing_id,county,city,neighbourhood,rent_minor,is_vacant,verification_status")
        .in("listing_id", own.map(listing => listing.id));
      const map: Record<string, PropertyRow> = {};
      for (const row of (detailRows ?? []) as PropertyRow[]) map[row.listing_id] = row;
      setProperties(map);
    }
  }, []);

  useEffect(() => {
    let active = true;
    async function boot() {
      try {
        const db = createSupabaseBrowserClient();
        const { data: auth } = await db.auth.getUser();
        if (!active) return;
        if (!auth.user) {
          window.location.replace("/login?next=%2Fprovider%2Fproperties");
          return;
        }
        setUserId(auth.user.id);
        await load(auth.user.id);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Could not load your properties. Confirm migrations 0021 have been applied.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void boot();
    return () => { active = false; };
  }, [load]);

  async function createListing(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!userId || !application || !form.categoryId) {
      setError("An approved property provider application and an active property category are required.");
      return;
    }
    setBusy("create");
    setError("");
    setMessage("");
    try {
      const rent = Math.round(Number(form.rent) * 100);
      const deposit = Math.round(Number(form.deposit) * 100);
      if (!Number.isFinite(rent) || rent < 0 || rent > 100000000) throw new Error("Enter the monthly rent in shillings.");
      if (!Number.isFinite(deposit) || deposit < 0) throw new Error("Enter the deposit, or zero.");

      const db = createSupabaseBrowserClient();
      const { data: inserted, error: insertError } = await db
        .from("listings")
        .insert({
          owner_id: userId,
          provider_application_id: application.id,
          category_id: form.categoryId,
          title: form.title.trim(),
          description: form.description.trim(),
          status: "draft",
          price_minor: rent,
          currency: "KES",
          attributes: { property_type: form.propertyType },
        })
        .select("id")
        .single();
      if (insertError) throw insertError;
      const listingId = (inserted as { id: string }).id;

      const { error: detailError } = await db.rpc("save_property_details", {
        p_listing_id: listingId,
        p_payload: {
          county: form.county.trim(),
          city: form.city.trim(),
          neighbourhood: form.neighbourhood.trim(),
          property_type: form.propertyType,
          bedrooms: Number(form.bedrooms) || 0,
          bathrooms: Number(form.bathrooms) || 0,
          rent_minor: rent,
          deposit_minor: deposit,
          is_vacant: true,
          amenities: form.amenities.split(",").map(value => value.trim()).filter(Boolean),
          exact_address: form.exactAddress.trim(),
          unit_number: form.unitNumber.trim(),
          contact_name: form.contactName.trim(),
          contact_phone: form.contactPhone.trim(),
          contact_email: form.contactEmail.trim(),
        },
      });
      if (detailError) throw detailError;

      const { error: submitError } = await db.rpc("submit_property_listing", { p_listing_id: listingId });
      if (submitError) throw submitError;

      setForm({ ...initialForm, categoryId: form.categoryId });
      setMessage("Property submitted for verification. It becomes public only after an owner verifies it and publishes the listing.");
      await load(userId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The property could not be created.");
    } finally {
      setBusy("");
    }
  }

  async function toggleVacancy(row: PropertyRow) {
    setBusy(`${row.listing_id}:vacancy`);
    setError("");
    setMessage("");
    try {
      const db = createSupabaseBrowserClient();
      const { error: vacancyError } = await db.rpc("set_property_vacancy", { p_listing_id: row.listing_id, p_vacant: !row.is_vacant });
      if (vacancyError) throw vacancyError;
      if (userId) await load(userId);
      setMessage("Vacancy status updated.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Vacancy could not be updated.");
    } finally {
      setBusy("");
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-4">
          <Link href="/" className="text-2xl font-black text-blue-700">shilevi</Link>
          <nav className="flex flex-wrap gap-4 text-sm font-semibold text-blue-700">
            <Link href="/provider">Workspace</Link>
            <Link href="/provider/listings">Listings</Link>
            <Link href="/house-hunt">House Hunt</Link>
            <Link href="/account">Account</Link>
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-5 py-10">
        <p className="text-sm font-bold uppercase tracking-widest text-blue-700">Property provider</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">House Hunt listings</h1>
        <p className="mt-3 max-w-2xl leading-7 text-slate-600">
          Publish only homes you own or are authorised to let. Browsing is free for tenants; they pay a small platform
          fee to unlock your contact details. Keep the vacancy status accurate.
        </p>

        {message && <p role="status" className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">{message}</p>}
        {error && <p role="alert" className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
        {loading ? <p className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">Loading property workspace…</p> : !application || application.status !== "approved" ? (
          <section className="mt-6 rounded-3xl border border-amber-200 bg-white p-6">
            <h2 className="text-xl font-black">Property provider approval required</h2>
            <p className="mt-2 leading-7 text-slate-600">Apply as a property provider and wait for approval. Approval for product, service or transport activities does not authorise property listings.</p>
            <Link href="/provider/apply" className="mt-4 inline-flex rounded-full bg-blue-700 px-5 py-3 text-sm font-bold text-white">Apply as a property provider</Link>
          </section>
        ) : (
          <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_1.1fr]">
            <section>
              <h2 className="text-2xl font-black">Your properties</h2>
              {listings.length === 0 ? (
                <p className="mt-3 rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm leading-6 text-slate-600">No property listings yet. Add the first one with the form.</p>
              ) : (
                <div className="mt-4 space-y-3">
                  {listings.map(listing => {
                    const detail = properties[listing.id];
                    return (
                      <article key={listing.id} className="rounded-2xl border border-slate-200 bg-white p-5">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <h3 className="font-bold">{listing.title}</h3>
                            <p className="mt-1 text-sm text-slate-600">{detail ? `${detail.neighbourhood ? `${detail.neighbourhood}, ` : ""}${detail.city}, ${detail.county} · ${formatMoney(detail.rent_minor, "KES")}` : "Property details missing"}</p>
                          </div>
                          <span className="rounded-full border border-slate-300 px-3 py-1 text-xs font-bold capitalize">{listing.status.replaceAll("_", " ")}</span>
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                          <span className={`rounded-full px-2 py-1 font-bold ${detail?.verification_status === "verified" ? "bg-emerald-50 text-emerald-800" : detail?.verification_status === "rejected" ? "bg-red-50 text-red-800" : "bg-amber-50 text-amber-900"}`}>
                            {detail?.verification_status ?? "details missing"}
                          </span>
                          {detail && (
                            <button onClick={() => void toggleVacancy(detail)} disabled={Boolean(busy)} className="rounded-full border border-slate-300 px-3 py-1 font-bold disabled:opacity-50">
                              {detail.is_vacant ? "Mark occupied" : "Mark vacant"}
                            </button>
                          )}
                          <Link href={`/house-hunt/${listing.id}`} className="rounded-full border border-slate-300 px-3 py-1 font-bold">View public page</Link>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
              <p className="mt-4 text-xs leading-6 text-slate-500">A listing becomes public only after an owner verifies the property evidence and publishes it. Exact addresses and phone numbers are never shown in free search results.</p>
            </section>

            <section className="h-fit rounded-3xl border border-slate-200 bg-white p-6 sm:p-8">
              <h2 className="text-2xl font-black">Add a property</h2>
              <form onSubmit={createListing} className="mt-4 space-y-4">
                <label className="block text-sm font-bold">Listing title<input required minLength={5} maxLength={180} value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} placeholder="e.g. Two bedroom apartment in Kilimani" className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" /></label>
                <label className="block text-sm font-bold">Description<textarea required rows={3} maxLength={4000} value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} placeholder="Describe the home, utilities, rules and viewing arrangements." className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" /></label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-sm font-bold">Category<select required value={form.categoryId} onChange={event => setForm({ ...form, categoryId: event.target.value })} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal">{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
                  <label className="text-sm font-bold">Property type<select value={form.propertyType} onChange={event => setForm({ ...form, propertyType: event.target.value })} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal">{TYPES.map(type => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}</select></label>
                  <label className="text-sm font-bold">County<input required value={form.county} onChange={event => setForm({ ...form, county: event.target.value })} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" /></label>
                  <label className="text-sm font-bold">Town or city<input required value={form.city} onChange={event => setForm({ ...form, city: event.target.value })} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" /></label>
                  <label className="text-sm font-bold">Neighbourhood<input value={form.neighbourhood} onChange={event => setForm({ ...form, neighbourhood: event.target.value })} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" /></label>
                  <label className="text-sm font-bold">Amenities (comma separated)<input value={form.amenities} onChange={event => setForm({ ...form, amenities: event.target.value })} placeholder="Water, Parking, WiFi" className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" /></label>
                  <label className="text-sm font-bold">Bedrooms<input type="number" min={0} max={50} value={form.bedrooms} onChange={event => setForm({ ...form, bedrooms: event.target.value })} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" /></label>
                  <label className="text-sm font-bold">Bathrooms<input type="number" min={0} max={50} value={form.bathrooms} onChange={event => setForm({ ...form, bathrooms: event.target.value })} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" /></label>
                  <label className="text-sm font-bold">Monthly rent (KSh)<input required type="number" min={0} value={form.rent} onChange={event => setForm({ ...form, rent: event.target.value })} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" /></label>
                  <label className="text-sm font-bold">Deposit (KSh)<input type="number" min={0} value={form.deposit} onChange={event => setForm({ ...form, deposit: event.target.value })} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" /></label>
                </div>

                <fieldset className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <legend className="px-1 text-sm font-bold">Protected contact details</legend>
                  <p className="text-xs leading-5 text-slate-500">Released only to a tenant who has paid the contact-access fee.</p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="text-sm font-bold">Exact address<input required value={form.exactAddress} onChange={event => setForm({ ...form, exactAddress: event.target.value })} placeholder="Street, house number" className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-normal" /></label>
                    <label className="text-sm font-bold">Unit / house number<input value={form.unitNumber} onChange={event => setForm({ ...form, unitNumber: event.target.value })} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-normal" /></label>
                    <label className="text-sm font-bold">Contact name<input required value={form.contactName} onChange={event => setForm({ ...form, contactName: event.target.value })} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-normal" /></label>
                    <label className="text-sm font-bold">Contact phone<input required value={form.contactPhone} onChange={event => setForm({ ...form, contactPhone: event.target.value })} inputMode="tel" className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-normal" /></label>
                    <label className="text-sm font-bold sm:col-span-2">Contact email (optional)<input type="email" value={form.contactEmail} onChange={event => setForm({ ...form, contactEmail: event.target.value })} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-normal" /></label>
                  </div>
                </fieldset>

                <p className="rounded-xl bg-amber-50 p-4 text-xs leading-5 text-amber-950">
                  Do not advertise a property you are not authorised to let. Keep ownership or management evidence ready
                  for review; do not paste ID numbers or documents into this form.
                </p>
                <button disabled={busy === "create"} className="w-full rounded-xl bg-blue-700 px-5 py-3 font-bold text-white hover:bg-blue-800 disabled:opacity-50">
                  {busy === "create" ? "Submitting…" : "Submit property for verification"}
                </button>
              </form>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
