import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { absoluteUrl } from "@/lib/site";
import { HouseHuntDetail } from "./HouseHuntDetail";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function publicProperty(id: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  try {
    const db = createClient(url, key, { auth: { persistSession: false } });
    const { data } = await db
      .from("property_listings")
      .select("listing_id,county,city,neighbourhood,property_type,bedrooms,rent_minor,deposit_minor,is_vacant,verification_status")
      .eq("listing_id", id)
      .maybeSingle();
    if (!data) return null;
    const { data: listing } = await db.from("listings").select("title,description,status").eq("id", id).eq("status", "published").maybeSingle();
    return listing ? { ...data, ...listing } : null;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  if (!UUID.test(id)) return { title: "Property not found" };
  const property = await publicProperty(id);
  if (!property) return { title: "Property not found", robots: { index: false, follow: false } };
  const rent = typeof property.rent_minor === "number" ? property.rent_minor / 100 : null;
  const location = [property.neighbourhood, property.city, property.county].filter(Boolean).join(", ");
  return {
    title: `${String(property.title).slice(0, 70)} — ${location || "Kenya"}`,
    description: `${property.bedrooms ?? ""} bedroom ${String(property.property_type).replaceAll("_", " ")} in ${location}.${rent ? ` Rent KSh ${rent.toLocaleString("en-KE")} per month.` : ""} View details on Shilevi House Hunt.`,
    alternates: { canonical: absoluteUrl(`/house-hunt/${id}`) },
    openGraph: { title: String(property.title), description: `${location} · Shilevi House Hunt`, url: absoluteUrl(`/house-hunt/${id}`) },
  };
}

export default async function HouseHuntDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <SiteHeader />
      <main id="main-content" className="mx-auto max-w-6xl px-5 py-10 sm:px-6">
        <HouseHuntDetail listingId={id} />
      </main>
      <SiteFooter />
    </div>
  );
}
