"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Application = { id: string; activity_type: string; status: string };
type Category = { id: string; name: string; division: string; description: string | null };
type Listing = { id: string; title: string; description: string; status: string; created_at: string; category_id: string; price_minor: number | null; currency: string };

const divisionLabels: Record<string, string> = { products: "Products", services: "Services", transport_delivery: "Transport & Delivery", property_places: "Property & Places" };
const activityDivision: Record<string, string> = { product_seller: "products", service_provider: "services", transport_partner: "transport_delivery", property_provider: "property_places" };

export default function ProviderListingsPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [applications, setApplications] = useState<Application[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [listings, setListings] = useState<Listing[]>([]);
  const [applicationId, setApplicationId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState("KES");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editCurrency, setEditCurrency] = useState("KES");

  async function load() {
    setLoading(true);
    try {
      const db = createSupabaseBrowserClient();
      const auth = await db.auth.getUser();
      if (auth.error) throw auth.error;
      if (!auth.data.user) { window.location.replace("/login"); return; }
      setUserId(auth.data.user.id);
      const [apps, cats, ownListings] = await Promise.all([
        db.from("provider_applications").select("id,activity_type,status").eq("user_id", auth.data.user.id).eq("status", "approved").limit(50),
        db.from("marketplace_categories").select("id,name,division,description").eq("is_active", true).order("sort_order").limit(200),
        db.from("listings").select("id,title,description,status,created_at,category_id,price_minor,currency").eq("owner_id", auth.data.user.id).order("created_at", { ascending: false }).limit(100),
      ]);
      if (apps.error) throw apps.error;
      if (cats.error) throw cats.error;
      if (ownListings.error) throw ownListings.error;
      setApplications((apps.data ?? []) as Application[]);
      setCategories((cats.data ?? []) as Category[]);
      setListings((ownListings.data ?? []) as Listing[]);
      setApplicationId((current) => current || apps.data?.[0]?.id || "");
      setCategoryId((current) => current || cats.data?.[0]?.id || "");
    } catch (error) {
      setIsError(true);
      setMessage(error instanceof Error ? error.message : "Could not load provider listing data. Confirm migrations 0001–0007 have been reviewed and applied.");
    } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  const selectedApplication = applications.find((item) => item.id === applicationId);
  const compatibleCategories = categories.filter((item) => item.division === (selectedApplication ? activityDivision[selectedApplication.activity_type] : ""));
  const selectedCategory = compatibleCategories.find((item) => item.id === categoryId);

  async function createDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setMessage(""); setIsError(false);
    try {
      if (!userId || !selectedApplication || !selectedCategory) throw new Error("Choose an approved provider application and a matching active category.");
      const cleanTitle = title.trim();
      if (cleanTitle.length < 3 || cleanTitle.length > 180) throw new Error("Title must be between 3 and 180 characters.");
      const cleanDescription = description.trim();
      if (cleanDescription.length > 10000) throw new Error("Description must be 10,000 characters or fewer.");
      let priceMinor: number | null = null;
      if (price.trim()) {
        const amount = Number(price);
        if (!Number.isFinite(amount) || amount < 0 || amount > 1000000000) throw new Error("Enter a valid non-negative price.");
        priceMinor = Math.round(amount * 100);
      }
      const db = createSupabaseBrowserClient();
      const { error } = await db.from("listings").insert({
        owner_id: userId, provider_application_id: selectedApplication.id, category_id: selectedCategory.id,
        title: cleanTitle, description: cleanDescription, status: "draft", price_minor: priceMinor, currency, attributes: {},
      });
      if (error) throw error;
      setTitle(""); setDescription(""); setPrice("");
      setMessage("Draft listing saved. It is not public; an owner must moderate it before publication.");
      await load();
    } catch (error) {
      setIsError(true);
      setMessage(error instanceof Error ? error.message : "Could not save listing. The database must enforce approved-provider and matching-category rules.");
    } finally { setBusy(false); }
  }

  function beginEdit(item: Listing) { setEditingId(item.id); setEditTitle(item.title); setEditDescription(item.description ?? ""); setEditPrice(item.price_minor === null ? "" : (item.price_minor / 100).toFixed(2)); setEditCurrency(item.currency || "KES"); setMessage(""); setIsError(false); }

  async function saveDraftEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage(""); setIsError(false);
    try {
      if (!userId || !editingId) throw new Error("Select a draft to edit.");
      const cleanTitle = editTitle.trim(); const cleanDescription = editDescription.trim();
      if (cleanTitle.length < 3 || cleanTitle.length > 180) throw new Error("Title must be between 3 and 180 characters.");
      if (cleanDescription.length > 10000) throw new Error("Description must be 10,000 characters or fewer.");
      let priceMinor: number | null = null;
      if (editPrice.trim()) { const amount = Number(editPrice); if (!Number.isFinite(amount) || amount < 0 || amount > 1000000000) throw new Error("Enter a valid non-negative price."); priceMinor = Math.round(amount * 100); }
      const db = createSupabaseBrowserClient();
      const result = await db.from("listings").update({ title: cleanTitle, description: cleanDescription, price_minor: priceMinor, currency: editCurrency }).eq("id", editingId).eq("owner_id", userId).eq("status", "draft");
      if (result.error) throw result.error;
      setEditingId(""); setMessage("Draft updated. Publication and moderation status were not changed."); await load();
    } catch (error) { setIsError(true); setMessage(error instanceof Error ? error.message : "Could not update this draft."); }
    finally { setBusy(false); }
  }

  return <main className="min-h-screen bg-slate-50 px-5 py-10"><section className="mx-auto max-w-4xl rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-9">
    <div className="flex flex-wrap gap-4"><Link href="/account" className="text-sm font-bold text-blue-700">← Account</Link><Link href="/provider/requests" className="text-sm font-bold text-blue-700">Customer enquiries →</Link></div>
    <p className="mt-8 text-sm font-bold uppercase tracking-wide text-blue-700">Provider workspace</p>
    <h1 className="mt-2 text-3xl font-black">Create a listing</h1>
    <p className="mt-3 max-w-2xl leading-7 text-slate-600">Only approved provider activities can create draft listings. Your draft remains private to you and is not a booking, order, or payment offer until those workflows are built.</p>
    {message && <p role={isError ? "alert" : "status"} className={`mt-5 rounded-xl p-4 text-sm ${isError ? "bg-red-50 text-red-800" : "bg-blue-50 text-blue-900"}`}>{message}</p>}
    {loading ? <p className="mt-8 text-slate-600">Loading approved activities…</p> : <>
      {applications.length === 0 ? <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5"><h2 className="font-bold">Provider approval required</h2><p className="mt-2 text-sm leading-6 text-amber-900">You do not have an approved provider application yet. Apply and wait for review before creating listings.</p><Link href="/provider/apply" className="mt-4 inline-block font-bold text-blue-700 underline">Open provider applications</Link></div> : <form onSubmit={createDraft} className="mt-7 space-y-5">
        <label className="block text-sm font-bold">Approved activity<select required value={applicationId} onChange={event => { setApplicationId(event.target.value); setCategoryId(""); }} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-normal">{applications.map(app => <option key={app.id} value={app.id}>{divisionLabels[activityDivision[app.activity_type]] ?? app.activity_type}</option>)}</select></label>
        <label className="block text-sm font-bold">Category<select required value={categoryId} onChange={event => setCategoryId(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-normal"><option value="">Choose a category</option>{compatibleCategories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}</select></label>
        {selectedCategory?.description && <p className="text-sm text-slate-500">{selectedCategory.description}</p>}
        {compatibleCategories.length === 0 && <p className="text-sm text-amber-800">No active category is available for this activity yet. The owner must activate a matching category.</p>}
        <label className="block text-sm font-bold">Listing title<input required minLength={3} maxLength={180} value={title} onChange={event => setTitle(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" placeholder="What are you offering?" /></label>
        <label className="block text-sm font-bold">Description<textarea maxLength={10000} rows={5} value={description} onChange={event => setDescription(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" placeholder="Describe the offer accurately. Avoid personal or confidential information." /></label>
        <div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-bold">Price (optional)<input inputMode="decimal" type="number" min="0" max="1000000000" step="0.01" value={price} onChange={event => setPrice(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" placeholder="e.g. 1500.00" /></label><label className="block text-sm font-bold">Currency<select value={currency} onChange={event => setCurrency(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-normal"><option value="KES">KES — Kenyan shilling</option><option value="USD">USD — US dollar</option></select></label></div>
        <button disabled={busy || !selectedCategory} className="w-full rounded-xl bg-blue-700 px-5 py-3 font-bold text-white disabled:opacity-60">{busy ? "Saving draft…" : "Save private draft"}</button>
      </form>}
      <section className="mt-10 border-t border-slate-200 pt-7"><h2 className="text-xl font-black">Your listings</h2>{listings.length === 0 ? <p className="mt-3 text-sm text-slate-500">No listings yet.</p> : <ul className="mt-4 space-y-3">{listings.map(item => <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-4"><div><p className="font-bold">{item.title}</p><p className="mt-1 text-xs text-slate-500">Created {new Date(item.created_at).toLocaleDateString()}</p></div><div className="flex items-center gap-2"><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold">{item.status.replaceAll("_", " ")}</span>{item.status === "draft" && <button type="button" onClick={() => beginEdit(item)} className="rounded-lg border border-blue-200 px-3 py-2 text-xs font-bold text-blue-800">Edit draft</button>}</div></li>)}</ul>}{editingId && <form onSubmit={saveDraftEdit} className="mt-5 rounded-2xl border border-blue-200 bg-blue-50/50 p-5"><div className="flex items-center justify-between gap-3"><h3 className="font-bold">Edit private draft</h3><button type="button" onClick={() => setEditingId("")} className="text-sm font-semibold text-slate-600 underline">Cancel</button></div><label className="mt-4 block text-sm font-bold">Title<input required minLength={3} maxLength={180} value={editTitle} onChange={event => setEditTitle(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-normal" /></label><label className="mt-4 block text-sm font-bold">Description<textarea maxLength={10000} rows={4} value={editDescription} onChange={event => setEditDescription(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-normal" /></label><div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="block text-sm font-bold">Price<input type="number" inputMode="decimal" min="0" max="1000000000" step="0.01" value={editPrice} onChange={event => setEditPrice(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-normal" placeholder="Leave blank for ask for price" /></label><label className="block text-sm font-bold">Currency<select value={editCurrency} onChange={event => setEditCurrency(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-normal"><option value="KES">KES — Kenyan shilling</option><option value="USD">USD — US dollar</option></select></label></div><button disabled={busy} className="mt-4 rounded-xl bg-blue-700 px-5 py-3 font-bold text-white disabled:opacity-50">{busy ? "Saving…" : "Save draft changes"}</button></form>}</section>
    </>}
  </section></main>;
}
