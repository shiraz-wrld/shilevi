import type { Metadata } from "next";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { formatMoney } from "@/lib/money";

type Params = { params: Promise<{ id: string }> };

type ListingMeta = {
  title: string;
  description: string | null;
  price_minor: number | null;
  currency: string;
  approximate_location: string | null;
  status: string;
};

async function loadListing(id: string): Promise<ListingMeta | null> {
  if (!isSupabaseConfigured()) return null;
  // Only published listings are publicly readable; drafts stay hidden from crawlers by RLS.
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("listings")
      .select("title,description,price_minor,currency,approximate_location,status")
      .eq("id", id)
      .eq("status", "published")
      .maybeSingle();
    if (error || !data) return null;
    return data as ListingMeta;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const listing = await loadListing(id);
  const canonical = `/listing/${id}`;

  if (!listing) {
    return {
      title: "Listing",
      description: "View this listing on Shilevi. If it is no longer available, browse similar listings in the marketplace.",
      alternates: { canonical },
      robots: { index: false, follow: true },
    };
  }

  const price = listing.price_minor === null ? "Price on request" : formatMoney(listing.price_minor, listing.currency);
  const place = listing.approximate_location ? ` in ${listing.approximate_location}` : "";
  const summary = (listing.description ?? "").replace(/\s+/g, " ").trim().slice(0, 155);
  const description = summary || `${listing.title}${place}. ${price} from a verified Shilevi provider.`;

  return {
    title: `${listing.title} — ${price}`,
    description,
    alternates: { canonical },
    openGraph: { type: "article", title: listing.title, description, url: canonical },
    twitter: { card: "summary_large_image", title: listing.title, description },
  };
}

export default function ListingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
