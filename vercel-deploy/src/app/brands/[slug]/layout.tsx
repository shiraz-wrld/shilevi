import type { Metadata } from "next";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";

type Params = { params: Promise<{ slug: string }> };

async function loadBrand(slug: string) {
  if (!isSupabaseConfigured() || !/^[a-z0-9-]{1,80}$/i.test(slug)) return null;
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase
      .from("marketplace_brands")
      .select("name,description")
      .eq("slug", slug)
      .eq("is_active", true)
      .maybeSingle();
    return data as { name: string; description: string | null } | null;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const brand = await loadBrand(slug);
  const canonical = `/brands/${slug}`;

  if (!brand) {
    return {
      title: "Brand storefront",
      description: "Browse published listings from this brand on Shilevi.",
      alternates: { canonical },
      robots: { index: false, follow: true },
    };
  }

  const description = brand.description?.trim()
    ? brand.description.replace(/\s+/g, " ").slice(0, 155)
    : `Shop published ${brand.name} listings on Shilevi from verified providers.`;

  return {
    title: brand.name,
    description,
    alternates: { canonical },
    openGraph: { type: "website", title: brand.name, description, url: canonical },
  };
}

export default function BrandLayout({ children }: { children: React.ReactNode }) {
  return children;
}
