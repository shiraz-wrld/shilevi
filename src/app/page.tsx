import type { Metadata } from "next";
import HomeClient from "./HomeClient";
import CustomerHome from "./CustomerHome";
import { site } from "@/lib/site";
import { getAuthUser } from "@/lib/auth/guards";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { loadCounties, loadCustomerHome } from "@/lib/customer/home";

export const metadata: Metadata = {
  title: `${site.name} — ${site.tagline}`,
  description: site.description,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: site.name,
    title: `${site.name} — ${site.tagline}`,
    description: site.description,
    url: "/",
    locale: site.locale,
  },
};

// The page depends on the request's session cookie, so it is rendered per request and never cached
// as one visitor's personalised home for everybody else.
export const dynamic = "force-dynamic";

/** Best-effort display name; the greeting falls back to the email address. */
async function loadDisplayName(userId: string): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.from("profiles").select("display_name").eq("id", userId).maybeSingle();
    const name = (data as { display_name?: string | null } | null)?.display_name;
    return name?.trim() ? name.trim() : null;
  } catch {
    return null;
  }
}

/**
 * `/` has two genuine states.
 *
 * A signed-out visitor gets the public marketplace marketing page. A signed-in customer gets their
 * own dashboard, built from their real orders, saved listings and recorded activity — the previous
 * implementation rendered the marketing page to everybody, so a signed-in shopper was told to log in
 * and never saw their own orders on the home page.
 *
 * The decision is made on the server from the session cookie, and the personalisation itself is read
 * through `customer_home()`, which scopes every row to `auth.uid()`.
 */
export default async function HomePage() {
  const user = await getAuthUser();
  if (!user) return <HomeClient />;

  const [result, counties, displayName] = await Promise.all([
    loadCustomerHome(8),
    loadCounties(),
    loadDisplayName(user.id),
  ]);

  const greeting = displayName ?? user.email?.split("@")[0] ?? "there";

  return (
    <CustomerHome
      greeting={greeting}
      counties={counties}
      home={result.ok ? result.data : null}
      error={result.ok ? null : result.error}
    />
  );
}
