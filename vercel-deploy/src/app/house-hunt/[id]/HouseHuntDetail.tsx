"use client";

import { useCallback, useEffect, useState } from "react";
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
  available_from: string | null;
};

type Contact = {
  exact_address: string;
  unit_number: string | null;
  contact_name: string;
  contact_phone: string;
  contact_email: string | null;
  expires_at: string | null;
};

export function HouseHuntDetail({ listingId }: { listingId: string }) {
  const [property, setProperty] = useState<Property | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [fee, setFee] = useState(2000);
  const [paymentMode, setPaymentMode] = useState("mock");
  const [hasAccess, setHasAccess] = useState(false);
  const [contact, setContact] = useState<Contact | null>(null);
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadContact = useCallback(async () => {
    const db = createSupabaseBrowserClient();
    const { data, error: contactError } = await db.rpc("get_property_contact", { p_listing_id: listingId });
    if (contactError) throw contactError;
    const row = Array.isArray(data) ? data[0] : data;
    if (row) setContact(row as Contact);
  }, [listingId]);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const db = createSupabaseBrowserClient();
        const { data: details, error: detailsError } = await db
          .from("property_listings")
          .select("listing_id,county,city,neighbourhood,property_type,bedrooms,bathrooms,rent_minor,deposit_minor,is_vacant,amenities,verification_status,available_from")
          .eq("listing_id", listingId)
          .maybeSingle();
        if (detailsError) throw detailsError;
        if (!details) {
          if (active) setMissing(true);
          return;
        }
        const { data: listing } = await db.from("listings").select("title,description").eq("id", listingId).eq("status", "published").maybeSingle();
        if (!listing) {
          if (active) setMissing(true);
          return;
        }
        if (!active) return;
        setProperty({ ...(details as Omit<Property, "title" | "description">), ...listing } as Property);

        const { data: settings } = await db.rpc("get_checkout_settings");
        if (settings && typeof settings === "object" && "payment_mode" in settings) {
          setPaymentMode(String((settings as { payment_mode: string }).payment_mode ?? "mock"));
        }
        const { data: feeData } = await db.rpc("get_property_contact_fee");
        if (feeData) setFee(Number(feeData));

        const { data: auth } = await db.auth.getUser();
        if (!active) return;
        if (auth.user) {
          setUserId(auth.user.id);
          const { data: access } = await db.rpc("has_property_access", { p_listing_id: listingId });
          if (active && access === true) {
            setHasAccess(true);
            await loadContact();
          }
        }
      } catch (cause) {
        console.error("[house-hunt] detail load failed", cause instanceof Error ? cause.message : cause);
        if (active) setError("This property could not be loaded right now. Please try again shortly.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [listingId, loadContact]);

  async function unlock() {
    if (!userId) {
      window.location.href = `/login?next=${encodeURIComponent(`/house-hunt/${listingId}`)}`;
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const db = createSupabaseBrowserClient();
      if (paymentMode === "mock") {
        const { error: unlockError } = await db.rpc("confirm_mock_property_unlock", { p_listing_id: listingId });
        if (unlockError) throw unlockError;
        setMessage("Sandbox unlock recorded. No real money moved.");
      } else {
        if (!phone.trim()) throw new Error("Enter the M-Pesa phone number to charge.");
        const response = await fetch("/api/payments/mpesa/initiate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ purpose: "property_contact", targetId: listingId, phone: phone.trim() }),
        });
        const payload = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
        if (!response.ok) throw new Error(payload.error ?? "The payment could not be started.");
        setMessage(payload.message ?? "Check your phone and enter your M-Pesa PIN. Contact details unlock after payment is verified.");
        return;
      }
      setHasAccess(true);
      await loadContact();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The contact details could not be unlocked.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <p role="status" className="rounded-2xl border border-slate-200 bg-white p-8 text-slate-600">Loading property details…</p>;
  }
  if (missing || !property) {
    return (
      <section className="rounded-3xl border border-slate-200 bg-white p-8">
        <h1 className="text-2xl font-black">Property not found</h1>
        <p className="mt-3 leading-7 text-slate-600">This home may have been let, unpublished, or the link may be incorrect.</p>
        <Link href="/house-hunt" className="mt-5 inline-flex rounded-full bg-blue-700 px-5 py-3 text-sm font-bold text-white">Browse House Hunt</Link>
      </section>
    );
  }

  const location = [property.neighbourhood, property.city, property.county].filter(Boolean).join(", ");
  const type = property.property_type.replaceAll("_", " ");

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <article className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-8">
        <Link href="/house-hunt" className="text-sm font-semibold text-blue-700 hover:underline">← Back to House Hunt</Link>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold uppercase tracking-wide text-blue-800">{type}</span>
          {property.verification_status === "verified" ? (
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-800">Ownership verified</span>
          ) : (
            <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-900">Verification pending</span>
          )}
          <span className={`rounded-full px-3 py-1 text-xs font-bold ${property.is_vacant ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>
            {property.is_vacant ? "Available" : "Occupied"}
          </span>
        </div>
        <h1 className="mt-4 text-3xl font-black leading-tight sm:text-4xl">{property.title}</h1>
        <p className="mt-2 text-lg text-slate-600">{location}</p>
        <div className="mt-5 h-44 rounded-2xl bg-gradient-to-br from-blue-50 to-slate-100 p-6">
          <p className="text-sm font-bold uppercase tracking-widest text-blue-800">Property photos</p>
          <p className="mt-2 max-w-md text-sm leading-6 text-slate-600">
            The landlord has not supplied a verified photo set for this listing, so no stock image is shown. Ask for
            current photos and arrange a viewing before paying a deposit.
          </p>
        </div>
        <div className="mt-6 whitespace-pre-wrap break-words text-base leading-8 text-slate-700">
          {property.description || "The landlord has not added a detailed description yet."}
        </div>

        <dl className="mt-7 grid grid-cols-2 gap-4 rounded-2xl bg-slate-50 p-5 sm:grid-cols-4">
          <div><dt className="text-xs font-bold uppercase tracking-wide text-slate-500">Rent</dt><dd className="mt-1 text-lg font-black">{formatMoney(property.rent_minor, "KES")}</dd></div>
          <div><dt className="text-xs font-bold uppercase tracking-wide text-slate-500">Deposit</dt><dd className="mt-1 text-lg font-bold">{formatMoney(property.deposit_minor, "KES")}</dd></div>
          <div><dt className="text-xs font-bold uppercase tracking-wide text-slate-500">Bedrooms</dt><dd className="mt-1 text-lg font-bold">{property.bedrooms ?? "—"}</dd></div>
          <div><dt className="text-xs font-bold uppercase tracking-wide text-slate-500">Bathrooms</dt><dd className="mt-1 text-lg font-bold">{property.bathrooms ?? "—"}</dd></div>
        </dl>

        {property.available_from && <p className="mt-4 text-sm text-slate-600">Available from {new Date(property.available_from).toLocaleDateString("en-KE")}.</p>}
        {property.amenities && property.amenities.length > 0 && (
          <div className="mt-5">
            <h2 className="font-bold">Amenities</h2>
            <ul className="mt-2 flex flex-wrap gap-2">
              {property.amenities.map(amenity => <li key={amenity} className="rounded-full border border-slate-200 px-3 py-1 text-sm text-slate-700">{amenity}</li>)}
            </ul>
          </div>
        )}

        <section className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-950">
          <h2 className="font-bold">Before you pay a deposit</h2>
          <p className="mt-1">View the property in person, confirm the person can lawfully let it, and never send money to an unverified account. Shilevi&apos;s contact-access fee is not rent and is not paid to the landlord.</p>
        </section>
      </article>

      <aside className="h-fit space-y-4">
        <section className="rounded-3xl border border-slate-200 bg-white p-6">
          <p className="text-sm font-semibold text-slate-500">Restricted contact details</p>
          <h2 className="mt-1 text-2xl font-black">{hasAccess && contact ? "Unlocked" : `Unlock for ${formatMoney(fee, "KES")}`}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            The exact house number and the landlord&apos;s phone number stay hidden until the platform fee is confirmed.
            Access lasts for the period shown after unlocking.
          </p>

          {hasAccess && contact ? (
            <div className="mt-4 space-y-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
              <p className="font-bold">{contact.contact_name}</p>
              <p>{contact.exact_address}{contact.unit_number ? `, ${contact.unit_number}` : ""}</p>
              <a href={`tel:${contact.contact_phone}`} className="inline-flex rounded-full bg-emerald-700 px-4 py-2 font-bold text-white">Call {contact.contact_phone}</a>
              {contact.contact_email && <a href={`mailto:${contact.contact_email}`} className="block break-all font-semibold underline">{contact.contact_email}</a>}
              {contact.expires_at && <p className="text-xs">Access expires {new Date(contact.expires_at).toLocaleDateString("en-KE")}.</p>}
            </div>
          ) : (
            <>
              {!userId && (
                <p className="mt-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950">Sign in to unlock and keep the access record in your account.</p>
              )}
              {userId && paymentMode !== "mock" && (
                <label className="mt-3 block text-xs font-bold text-slate-600">
                  M-Pesa phone
                  <input value={phone} onChange={event => setPhone(event.target.value)} placeholder="0712 345 678" inputMode="tel" className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 font-normal" />
                </label>
              )}
              <button onClick={() => void unlock()} disabled={busy} className="mt-4 w-full rounded-full bg-blue-700 px-5 py-3 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-50">
                {busy ? "Starting…" : userId ? `Unlock contact — ${formatMoney(fee, "KES")}` : "Sign in to unlock"}
              </button>
              <p className="mt-3 text-xs leading-5 text-slate-500">
                {paymentMode === "mock"
                  ? "This deployment is in sandbox payment mode. A sandbox unlock moves no real money and is for testing only."
                  : "Payment is verified with M-Pesa before details are released. A pending or failed payment unlocks nothing."}
              </p>
            </>
          )}

          {message && <p role="status" className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">{message}</p>}
          {error && <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 text-sm leading-6 text-slate-600">
          <h2 className="font-bold text-slate-900">Report this property</h2>
          <p className="mt-1">If the listing looks fraudulent, duplicated, or the contact demands money before a viewing, report it to support.</p>
          <Link href="/support" className="mt-3 inline-flex text-sm font-bold text-blue-700">Contact support →</Link>
        </section>
      </aside>
    </div>
  );
}
