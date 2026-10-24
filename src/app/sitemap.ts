import type { MetadataRoute } from "next";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { absoluteUrl } from "@/lib/site";

/**
 * Public sitemap.
 *
 * Private routes (/account, /admin, /checkout, /cart, /provider, /rider) are intentionally absent:
 * they hold per-person data and must not be indexed.
 *
 * Listings and brand storefronts are read at request time when Supabase is configured. When it is
 * not, the sitemap still returns the static public routes instead of failing the build.
 */

export const revalidate = 3600;

const staticRoutes: { path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"] }[] = [
  { path: "/", priority: 1, changeFrequency: "daily" },
  { path: "/marketplace/products", priority: 0.9, changeFrequency: "daily" },
  { path: "/marketplace/services", priority: 0.9, changeFrequency: "daily" },
  { path: "/transport", priority: 0.9, changeFrequency: "weekly" },
  { path: "/house-hunt", priority: 0.9, changeFrequency: "daily" },
  { path: "/marketplace/transport_delivery", priority: 0.8, changeFrequency: "weekly" },
  { path: "/marketplace/property_places", priority: 0.8, changeFrequency: "weekly" },
  { path: "/search", priority: 0.7, changeFrequency: "daily" },
  { path: "/about", priority: 0.5, changeFrequency: "monthly" },
  { path: "/how-it-works", priority: 0.6, changeFrequency: "monthly" },
  { path: "/pricing", priority: 0.6, changeFrequency: "monthly" },
  { path: "/safety", priority: 0.5, changeFrequency: "monthly" },
  { path: "/accessibility", priority: 0.3, changeFrequency: "yearly" },
  { path: "/help", priority: 0.5, changeFrequency: "monthly" },
  { path: "/support", priority: 0.5, changeFrequency: "monthly" },
  { path: "/security", priority: 0.4, changeFrequency: "yearly" },
  { path: "/legal", priority: 0.3, changeFrequency: "yearly" },
  { path: "/legal/terms", priority: 0.3, changeFrequency: "yearly" },
  { path: "/legal/privacy", priority: 0.3, changeFrequency: "yearly" },
  { path: "/legal/cookies", priority: 0.3, changeFrequency: "yearly" },
  { path: "/legal/refunds", priority: 0.4, changeFrequency: "yearly" },
  { path: "/legal/provider-agreement", priority: 0.3, changeFrequency: "yearly" },
  { path: "/legal/acceptable-use", priority: 0.3, changeFrequency: "yearly" },
];

type SitemapEntry = MetadataRoute.Sitemap[number];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = staticRoutes.map(route => ({
    url: absoluteUrl(route.path),
    lastModified: new Date(),
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return entries;

  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
          } catch {
            // Read-only context: the public listing queries do not need refreshed cookies.
          }
        },
      },
    });

    const [{ data: listings }, { data: brands }] = await Promise.all([
      supabase
        .from("listings")
        .select("id,published_at")
        .eq("status", "published")
        .order("published_at", { ascending: false })
        .limit(1000),
      supabase.from("marketplace_brands").select("slug").eq("is_active", true).limit(500),
    ]);

    for (const listing of listings ?? []) {
      const row = listing as { id: string; published_at: string | null };
      entries.push({
        url: absoluteUrl(`/listing/${row.id}`),
        lastModified: row.published_at ? new Date(row.published_at) : new Date(),
        changeFrequency: "weekly",
        priority: 0.6,
      } satisfies SitemapEntry);
    }

    for (const brand of brands ?? []) {
      const row = brand as { slug: string };
      entries.push({
        url: absoluteUrl(`/brands/${row.slug}`),
        lastModified: new Date(),
        changeFrequency: "weekly",
        priority: 0.5,
      } satisfies SitemapEntry);
    }
  } catch {
    // A sitemap must never take the site down; fall back to the public routes.
  }

  return entries;
}
