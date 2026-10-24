"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { CartLink } from "@/components/cart/CartLink";
import { useCart } from "@/components/cart/CartProvider";

type Listing = { id: string; owner_id: string; title: string; description: string; price_minor: number | null; currency: string; category_id: string; transaction_type: string; published_at: string | null; approximate_location: unknown; brand_id: string | null; attributes: Record<string, unknown> | null };
type Category = { id: string; name: string; division: string };
type Brand = { id: string; name: string; slug: string; is_active: boolean };

const divisionLabels: Record<string, string> = { products: "Products", services: "Services", transport_delivery: "Transport & Delivery", property_places: "Property & Places" };

function describeLocation(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const parts = ["county", "town", "area", "landmark"]
    .map(key => (typeof record[key] === "string" ? record[key].trim() : ""))
    .filter(Boolean);
  return parts.length ? parts.join(", ") : "Approximate location shared by the provider.";
}

export default function ListingDetailPage() {
  const params = useParams<{ id: string }>();
  const id = typeof params.id === "string" ? params.id : "";
  const { addItem, replaceWith } = useCart();
  const [quantity, setQuantity] = useState(1);
  const [cartMessage, setCartMessage] = useState("");
  const [cartError, setCartError] = useState(false);
  const [showReplace, setShowReplace] = useState(false);
  const [listing, setListing] = useState<Listing | null>(null);
  const [category, setCategory] = useState<Category | null>(null);
  const [brand, setBrand] = useState<Brand | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [userId, setUserId] = useState<string | null>(null);
  const [isSaved, setIsSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [requestMessage, setRequestMessage] = useState("");
  const [requestBusy, setRequestBusy] = useState(false);
  const [requestStatus, setRequestStatus] = useState("");

  useEffect(() => {
    let alive = true;
    const db = createSupabaseBrowserClient();
    void db.auth.getUser().then(async ({ data }) => {
      if (!alive) return;
      const currentUserId = data.user?.id ?? null;
      setUserId(currentUserId);
      if (!currentUserId || !id || !/^[0-9a-f-]{36}$/i.test(id)) return;
      const result = await db.from("saved_listings").select("listing_id").eq("user_id", currentUserId).eq("listing_id", id).maybeSingle();
      if (alive && !result.error) setIsSaved(Boolean(result.data));
    }).catch(() => { if (alive) setUserId(null); });
    return () => { alive = false; };
  }, [id]);

  useEffect(() => {
    let alive = true;
    async function load() {
      if (!/^[0-9a-f-]{36}$/i.test(id)) { setState("missing"); return; }
      try {
        const db = createSupabaseBrowserClient();
        const result = await db.from("listings")
          .select("id,owner_id,title,description,price_minor,currency,category_id,transaction_type,published_at,approximate_location,brand_id,attributes")
          .eq("id", id).eq("status", "published").maybeSingle();
        if (result.error) throw result.error;
        if (!result.data) { if (alive) setState("missing"); return; }
        const row = result.data as Listing;
        const [cat, br] = await Promise.all([
          db.from("marketplace_categories").select("id,name,division").eq("id", row.category_id).eq("is_active", true).maybeSingle(),
          row.brand_id ? db.from("marketplace_brands").select("id,name,slug,is_active").eq("id", row.brand_id).eq("is_active", true).maybeSingle() : Promise.resolve({ data: null, error: null }),
        ]);
        if (cat.error || br.error) throw cat.error || br.error;
        if (!alive) return;
        setListing(row); setCategory(cat.data as Category | null); setBrand(br.data as Brand | null); setState("ready");
      } catch {
        if (alive) setState("error");
      }
    }
    void load();
    return () => { alive = false; };
  }, [id]);

  async function toggleSaved() {
    if (!listing) return;
    if (!userId) { window.location.href = "/login?next=" + encodeURIComponent("/listing/" + listing.id); return; }
    setSaving(true); setSaveMessage("");
    try {
      const db = createSupabaseBrowserClient();
      if (isSaved) {
        const result = await db.from("saved_listings").delete().eq("user_id", userId).eq("listing_id", listing.id);
        if (result.error) throw result.error;
        setIsSaved(false); setSaveMessage("Removed from your saved listings.");
      } else {
        const result = await db.from("saved_listings").insert({ user_id: userId, listing_id: listing.id });
        if (result.error && result.error.code !== "23505") throw result.error;
        setIsSaved(true); setSaveMessage("Saved to your listings.");
      }
    } catch {
      setSaveMessage("Could not update saved listings. Confirm migration 0011 is reviewed and applied, then try again.");
    } finally { setSaving(false); }
  }

  async function sendRequest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!listing) return;
    const cleanMessage = requestMessage.trim();
    if (cleanMessage.length < 10 || cleanMessage.length > 3000) { setRequestStatus("Please write an enquiry between 10 and 3,000 characters."); return; }
    if (!userId) { window.location.href = "/login?next=" + encodeURIComponent("/listing/" + listing.id); return; }
    setRequestBusy(true); setRequestStatus("");
    try {
      const db = createSupabaseBrowserClient();
      const ownerResult = await db.from("listings").select("owner_id").eq("id", listing.id).eq("status", "published").maybeSingle();
      if (ownerResult.error) throw ownerResult.error;
      if (!ownerResult.data) throw new Error("This listing is no longer available.");
      if (ownerResult.data.owner_id === userId) throw new Error("You cannot send an enquiry to your own listing.");
      const result = await db.from("listing_requests").insert({ listing_id: listing.id, customer_id: userId, provider_id: ownerResult.data.owner_id, customer_message: cleanMessage, status: "open" });
      if (result.error) throw result.error;
      setRequestMessage(""); setRequestStatus("Enquiry sent. You can track the provider’s response in Your requests.");
    } catch (caught) {
      setRequestStatus(caught instanceof Error ? caught.message : "Could not send your enquiry. Confirm migration 0014 is reviewed and applied.");
    } finally { setRequestBusy(false); }
  }

  const price = (amount: number | null, currency: string) => amount === null ? "Ask for price" : new Intl.NumberFormat("en-KE", { style: "currency", currency: /^[A-Z]{3}$/.test(currency) ? currency : "KES", maximumFractionDigits: 2 }).format(amount / 100);
  const locationText = listing ? describeLocation(listing.approximate_location) : null;
  const canBuy = Boolean(listing && category?.division === "products" && listing.transaction_type === "sale" && listing.price_minor !== null && listing.price_minor > 0);

  function cartInput() {
    if (!listing || listing.price_minor === null || listing.price_minor <= 0) return null;
    return {
      listingId: listing.id,
      ownerId: listing.owner_id,
      title: listing.title,
      priceMinor: listing.price_minor,
      currency: listing.currency,
      division: category?.division,
    };
  }

  function addToCart() {
    const input = cartInput();
    if (!input) return;
    setCartMessage(""); setShowReplace(false); setCartError(false);
    const result = addItem(input, quantity);
    if (result.ok) {
      setCartMessage("Added to your cart.");
      return;
    }
    setCartError(true);
    if (result.reason === "different-seller") {
      setCartMessage("Your cart contains items from another seller. A Shilevi order can only include one seller at a time.");
      setShowReplace(true);
    } else if (result.reason === "different-currency") {
      setCartMessage("Your cart uses a different currency. Clear it before adding this item.");
    } else {
      setCartMessage("This item could not be added to your cart.");
    }
  }

  function replaceCart() {
    const input = cartInput();
    if (!input) return;
    const result = replaceWith(input, quantity);
    if (result.ok) {
      setShowReplace(false); setCartError(false); setCartMessage("Cart replaced with this item.");
    } else {
      setCartError(true); setCartMessage("This item could not be added to your cart.");
    }
  }

  return <main className="min-h-screen bg-slate-50 text-slate-950">
    <header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-5"><Link href="/" className="text-2xl font-black text-blue-700">shilevi</Link><div className="flex items-center gap-3"><CartLink /><Link href="/account" className="text-sm font-semibold text-blue-700">My account</Link></div></div></header>
    <div className="mx-auto max-w-5xl px-5 py-8 sm:py-12"><Link href={category ? "/marketplace/" + category.division : "/"} className="text-sm font-semibold text-blue-700 hover:underline">← Back to {category ? divisionLabels[category.division] || "marketplace" : "marketplace"}</Link>
      {state === "loading" ? <p role="status" className="mt-6 rounded-2xl border border-slate-200 bg-white p-8 text-slate-600">Loading listing details…</p> : state === "error" ? <section role="alert" className="mt-6 rounded-2xl border border-slate-200 bg-white p-8"><h1 className="text-2xl font-black">Listing temporarily unavailable</h1><p className="mt-3 leading-7 text-slate-600">We could not load this listing. Please try again later.</p><button onClick={() => window.location.reload()} className="mt-4 rounded-xl bg-blue-700 px-4 py-2 font-bold text-white">Retry</button></section> : state === "missing" || !listing ? <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-8"><h1 className="text-2xl font-black">Listing not found</h1><p className="mt-3 leading-7 text-slate-600">This listing may have been unpublished or the link may be incorrect.</p><Link href="/" className="mt-4 inline-block font-bold text-blue-700">Explore Shilevi →</Link></section> : <article className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-9"><p className="text-sm font-bold uppercase tracking-wide text-blue-700">{category?.name ?? "Shilevi listing"}</p><h1 className="mt-3 text-3xl font-black leading-tight sm:text-4xl">{listing.title}</h1>{brand && <p className="mt-3 text-sm text-slate-600">Listed under <Link href={"/brands/" + brand.slug} className="font-semibold text-blue-700 hover:underline">{brand.name}</Link></p>}<div className="mt-6 whitespace-pre-wrap break-words text-base leading-8 text-slate-700">{listing.description || "The provider has not added a detailed description yet."}</div>{locationText && <div className="mt-7 rounded-2xl bg-slate-50 p-4"><h2 className="font-bold">Approximate location</h2><p className="mt-1 text-sm leading-6 text-slate-600">{locationText}</p><p className="mt-2 text-xs text-slate-500">Exact addresses and private contact details are shared only through a secure, active order.</p></div>}{listing.published_at && <p className="mt-7 text-xs text-slate-500">Published {new Date(listing.published_at).toLocaleDateString()}</p>}</section>
        <aside className="h-fit rounded-3xl border border-slate-200 bg-white p-6"><p className="text-sm font-semibold text-slate-500">Listed price</p><p className="mt-2 text-3xl font-black">{price(listing.price_minor, listing.currency)}</p>
          {canBuy ? <div className="mt-5 rounded-2xl border border-blue-200 bg-blue-50 p-4">
            <h2 className="font-bold">Buy this item</h2>
            <p className="mt-1 text-xs leading-5 text-slate-600">Checkout uses sandbox payment for now. The server confirms the final price and delivery fee.</p>
            <div className="mt-3 flex items-end gap-3">
              <label className="text-sm font-semibold">Qty
                <input type="number" min={1} max={99} value={quantity} onChange={event => setQuantity(Math.min(99, Math.max(1, Number(event.target.value) || 1)))} className="mt-1 block w-20 rounded-xl border border-slate-300 px-3 py-2" />
              </label>
              <button onClick={addToCart} className="flex-1 rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-800">Add to cart</button>
            </div>
            {cartMessage && <p role={cartError ? "alert" : "status"} className={`mt-3 text-sm leading-6 ${cartError ? "text-red-800" : "text-emerald-800"}`}>{cartMessage}</p>}
            {showReplace && <button onClick={replaceCart} className="mt-2 rounded-xl border border-blue-300 bg-white px-4 py-2 text-sm font-bold text-blue-800">Clear cart and add this item</button>}
            <Link href="/cart" className="mt-3 inline-flex w-full justify-center rounded-xl border border-blue-200 bg-white px-4 py-2 text-sm font-bold text-blue-800">View cart →</Link>
          </div> : <p className="mt-4 rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-600">This listing is not a fixed-price product purchase. Use the enquiry form below to discuss terms with the provider.</p>}
          <button onClick={() => void toggleSaved()} disabled={saving} className="mt-5 w-full rounded-xl border border-blue-200 px-4 py-3 text-sm font-bold text-blue-800 disabled:opacity-50">{saving ? "Saving…" : isSaved ? "♥ Saved — remove" : "♡ Save listing"}</button>{saveMessage && <p role="status" className="mt-3 text-sm text-slate-600">{saveMessage}</p>}<Link href="/account/saved" className="mt-3 inline-flex w-full justify-center rounded-xl border border-slate-300 px-4 py-3 text-sm font-bold">View saved listings</Link><form onSubmit={sendRequest} className="mt-5 border-t border-slate-200 pt-5"><h2 className="font-bold">Ask the provider</h2><p className="mt-1 text-sm leading-6 text-slate-600">Send an enquiry about availability, details, or terms. Do not include passwords, financial credentials, or sensitive personal data.</p><label className="mt-3 block text-sm font-semibold">Your message<textarea required minLength={10} maxLength={3000} rows={4} value={requestMessage} onChange={event => setRequestMessage(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-3 font-normal" placeholder="Hi, is this still available? I would like to know…" /></label><button disabled={requestBusy} className="mt-3 w-full rounded-xl bg-blue-700 px-4 py-3 text-sm font-bold text-white disabled:opacity-50">{requestBusy ? "Sending enquiry…" : "Send enquiry"}</button>{requestStatus && <p role="status" className="mt-3 text-sm leading-6 text-slate-600">{requestStatus} {requestStatus.startsWith("Enquiry sent") && <Link href="/account/requests" className="font-bold text-blue-700 underline">View requests</Link>}</p>}</form><div className="mt-5 rounded-xl bg-amber-50 p-4 text-sm leading-6 text-amber-950">An enquiry is not a confirmed order or payment. For fixed-price products, use the cart to create a real order with sandbox payment. Real payment providers are not enabled yet.</div><Link href="/account" className="mt-5 inline-flex w-full justify-center rounded-xl border border-slate-300 px-4 py-3 text-sm font-bold">Go to account</Link><p className="mt-4 text-xs leading-5 text-slate-500">Shilevi displays published listing information. Verify the offer and applicable terms before making a commitment.</p></aside>
      </article>}
    </div>
  </main>;
}
