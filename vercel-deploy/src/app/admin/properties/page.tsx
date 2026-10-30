import "server-only";

import type { Metadata } from "next";
import { requireStaffCapability } from "@/lib/admin/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AdminShell } from "@/components/admin/AdminShell";
import { PropertyReview } from "./PropertyReview";

export const metadata: Metadata = {
  title: "Property verification",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

type Property = {
  listing_id: string;
  county: string;
  city: string;
  neighbourhood: string | null;
  property_type: string;
  bedrooms: number | null;
  rent_minor: number;
  deposit_minor: number;
  is_vacant: boolean;
  verification_status: string;
  created_at: string;
};

type Listing = { id: string; title: string; status: string; owner_id: string; created_at: string };
type Contact = { listing_id: string; exact_address: string; contact_name: string };

export default async function AdminPropertiesPage() {
  const result = await requireStaffCapability("properties.verify");

  const supabase = await createSupabaseServerClient();
  const { data: propertyData, error } = await supabase
    .from("property_listings")
    .select("listing_id,county,city,neighbourhood,property_type,bedrooms,rent_minor,deposit_minor,is_vacant,verification_status,created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  const properties = (propertyData ?? []) as Property[];
  const ids = properties.map(property => property.listing_id);

  const [listingResult, contactResult] = ids.length
    ? await Promise.all([
        supabase.from("listings").select("id,title,status,owner_id,created_at").in("id", ids),
        supabase.from("property_contacts").select("listing_id,exact_address,contact_name").in("listing_id", ids),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];

  const listingMap = new Map(((listingResult.data ?? []) as Listing[]).map(listing => [listing.id, listing]));
  const contactMap = new Map(((contactResult.data ?? []) as Contact[]).map(contact => [contact.listing_id, contact]));

  const rows = properties.map(property => ({
    ...property,
    title: listingMap.get(property.listing_id)?.title ?? "Untitled property",
    listingStatus: listingMap.get(property.listing_id)?.status ?? "missing",
    ownerId: listingMap.get(property.listing_id)?.owner_id ?? "",
    exactAddress: contactMap.get(property.listing_id)?.exact_address ?? "",
    contactName: contactMap.get(property.listing_id)?.contact_name ?? "",
  }));

  return (
    <AdminShell
      email={result.user.email ?? null}
      mfaLevel={result.mfaLevel}
      title="Property verification"
      description="Review property details and ownership evidence before publishing. Browsing is free; tenants pay a fixed platform fee to unlock the protected contact record."
    >
      {error ? (
        <p role="alert" className="rounded-2xl border border-amber-800 bg-amber-950/40 p-5 text-sm leading-6 text-amber-100">
          Properties could not be read. Nothing was changed. Reload once; if it persists, System health reports whether the cause is a missing migration, an MFA session or a missing capability.</p>
      ) : (
        <PropertyReview rows={rows} />
      )}
    </AdminShell>
  );
}
