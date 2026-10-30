import Link from "next/link";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { CustomerHomeControls } from "./CustomerHomeControls";
import { formatMoney } from "@/lib/money";
import {
  ORDER_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  orderStatusTone,
  paymentStatusTone,
} from "@/lib/order-status";
import { searchHref, type CustomerHomeData, type HomeListing } from "@/lib/customer/home";

type Props = {
  greeting: string;
  counties: string[];
  home: CustomerHomeData | null;
  error: string | null;
};

const divisionLabels: Record<string, string> = {
  products: "Products",
  services: "Services",
  transport_delivery: "Transport & delivery",
  property_places: "Property & places",
};

function ListingCard({ listing, showCategory = true }: { listing: HomeListing; showCategory?: boolean }) {
  return (
    <article className="surface surface-interactive flex flex-col p-5">
      {showCategory && (
        <p className="text-xs font-bold uppercase tracking-[0.12em] text-brand-700">
          {listing.category_name}
          {listing.county ? ` · ${listing.county}` : ""}
        </p>
      )}
      <h3 className="mt-3 line-clamp-2 text-lg font-bold text-ink-900">{listing.title}</h3>
      {listing.description && (
        <p className="mt-2 line-clamp-3 flex-1 text-sm leading-6 text-ink-500">{listing.description}</p>
      )}
      <p className="mt-4 text-lg font-black text-ink-900">{formatMoney(listing.price_minor, listing.currency)}</p>
      <Link href={`/listing/${listing.id}`} className="link-arrow mt-4 text-sm">
        View listing <span aria-hidden="true">→</span>
      </Link>
    </article>
  );
}

function MiniList({
  title,
  items,
  emptyCopy,
}: {
  title: string;
  items: { id: string; title: string; price_minor: number | null; currency: string; category_name: string }[];
  emptyCopy: string;
}) {
  return (
    <section className="surface p-5">
      <h2 className="text-sm font-bold uppercase tracking-[0.12em] text-ink-400">{title}</h2>
      {items.length ? (
        <ul className="mt-4 space-y-3">
          {items.map(item => (
            <li key={item.id} className="flex items-start justify-between gap-3">
              <Link href={`/listing/${item.id}`} className="text-sm font-semibold text-ink-800 hover:underline">
                {item.title}
                <span className="mt-0.5 block text-xs font-normal text-ink-400">{item.category_name}</span>
              </Link>
              <span className="shrink-0 text-sm font-bold text-ink-700">
                {formatMoney(item.price_minor, item.currency)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm leading-6 text-ink-500">{emptyCopy}</p>
      )}
    </section>
  );
}

/**
 * The signed-in home page.
 *
 * Everything on it is derived from real rows for this account: pending actions from unpaid or
 * delivered orders, recommendations from recorded searches, views, saved items and past orders,
 * saved items and orders from their own tables. When there is no history the page says so and shows
 * the newest published listings instead of pretending to know the shopper.
 *
 * A failed read is reported; it never degrades into an empty grid that looks like a considered
 * result.
 */
export default function CustomerHome({ greeting, counties, home, error }: Props) {
  const recommendations = home?.recommendations ?? [];
  const nearby = home?.nearby ?? [];

  return (
    <main id="main-content" className="flex min-h-screen flex-col bg-mist-50 text-ink-900">
      <SiteHeader />

      <section className="shilevi-shell pt-6 sm:pt-10">
        <div className="relative overflow-hidden rounded-4xl bg-ink-950 px-6 py-10 text-white shadow-[0_40px_120px_-60px_rgba(11,19,41,0.9)] sm:px-10">
          <div className="hero-atmosphere" aria-hidden="true" />
          <div className="glow-orb -right-10 top-6 h-52 w-52 bg-accent-500/40" aria-hidden="true" />
          <div className="relative">
            <p className="chip border-white/20 bg-white/10 text-white/90 backdrop-blur">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
              Signed in{home?.area ? ` · ${home.area}` : ""}
            </p>
            <h1 className="mt-5 text-3xl font-black leading-tight tracking-tight sm:text-4xl">
              Welcome back, <span className="text-brand-200">{greeting}</span>
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-ink-200 sm:text-base">
              Your orders, saved listings and recommendations live here. Browsing stays the same
              marketplace — only the shortcuts change.
            </p>

            <form action="/search" method="get" role="search" className="mt-6 max-w-2xl">
              <label htmlFor="home-search" className="sr-only">
                Search Shilevi listings
              </label>
              <div className="flex flex-col gap-3 rounded-2xl border border-white/15 bg-white/10 p-2 backdrop-blur-md sm:flex-row sm:items-center">
                <input
                  id="home-search"
                  name="q"
                  maxLength={120}
                  placeholder="Search headphones, plumbers, bedsitters…"
                  className="min-w-0 flex-1 rounded-xl bg-transparent px-4 py-3 text-base text-white placeholder:text-ink-300 focus:outline-none"
                />
                {home?.area && <input type="hidden" name="county" value={home.area} />}
                <button type="submit" className="btn btn-primary shrink-0">
                  Search marketplace
                </button>
              </div>
            </form>

            <div className="mt-5 flex flex-wrap gap-2">
              <Link href="/account/orders" className="btn btn-secondary">
                Your orders
              </Link>
              <Link href="/account/saved" className="btn border-white/25 bg-white/5 text-white hover:bg-white/10">
                Saved listings
              </Link>
              <Link href="/account" className="btn border-white/25 bg-white/5 text-white hover:bg-white/10">
                Account settings
              </Link>
            </div>
          </div>
        </div>
      </section>

      {error && (
        <section className="shilevi-shell mt-8">
          <p role="alert" className="notice notice-warn">
            {error} You can still search and browse the marketplace.
          </p>
        </section>
      )}

      {home && home.pending_actions.length > 0 && (
        <section className="shilevi-shell mt-8" aria-labelledby="actions-heading">
          <div className="surface border-l-4 border-l-amber-400 p-5">
            <h2 id="actions-heading" className="text-lg font-black text-ink-900">
              Waiting on you
            </h2>
            <ul className="mt-3 space-y-2">
              {home.pending_actions.map(action => (
                <li key={`${action.kind}-${action.order_id}`}>
                  <Link
                    href={`/account/orders/${action.order_id}`}
                    className="text-sm font-semibold text-brand-800 hover:underline"
                  >
                    {action.label} →
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {home && (
        <section className="shilevi-shell mt-8">
          <CustomerHomeControls
            counties={counties}
            area={home.area}
            personalizationEnabled={home.personalization_enabled}
          />
        </section>
      )}

      <section className="shilevi-shell mt-12" aria-labelledby="recs-heading">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">{home?.has_history ? "Ranked from your activity" : "Freshly published"}</p>
            <h2 id="recs-heading" className="mt-3 text-3xl font-black sm:text-4xl">
              {home?.has_history ? "Picked for you" : "Start exploring"}
            </h2>
          </div>
          <Link href="/search" className="btn btn-secondary">
            Open full search
          </Link>
        </div>

        {home?.has_history ? (
          <p className="mt-3 max-w-2xl text-sm leading-6 text-ink-500">
            These listings are ranked by your recorded searches, views, saved items and past orders
            {home.area ? `, weighted towards ${home.area}` : ""}. The signals are listed below so you
            can see exactly why.
          </p>
        ) : (
          <p className="mt-3 max-w-2xl text-sm leading-6 text-ink-500">
            You have no recorded marketplace activity yet, so this is simply the newest published
            listings. Search or open something and your home page will start reflecting your interests.
          </p>
        )}

        {recommendations.length ? (
          <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {recommendations.map(listing => (
              <ListingCard key={listing.id} listing={listing} />
            ))}
          </div>
        ) : (
          <p className="surface-muted mt-7 p-6 text-sm leading-6 text-ink-500">
            No published listings match your signals yet. Try a search, or browse a section from the
            navigation — nothing here is invented.
          </p>
        )}
      </section>

      {home && home.interests.length > 0 && (
        <section className="shilevi-shell mt-12" aria-labelledby="interests-heading">
          <h2 id="interests-heading" className="text-sm font-bold uppercase tracking-[0.12em] text-ink-400">
            Your current interests
          </h2>
          <div className="mt-4 flex flex-wrap gap-2">
            {home.interests.map(interest => (
              <Link
                key={interest.category_id}
                href={`/search?category=${encodeURIComponent(interest.category_id)}`}
                className="chip border-brand-200 bg-brand-50 text-brand-800 hover:border-brand-400"
              >
                {interest.category_name}
                <span className="ml-1 text-xs font-normal text-brand-700">
                  ({divisionLabels[interest.division] ?? interest.division})
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {home && home.recent_searches.length > 0 && (
        <section className="shilevi-shell mt-12" aria-labelledby="searches-heading">
          <h2 id="searches-heading" className="text-sm font-bold uppercase tracking-[0.12em] text-ink-400">
            Your recent searches
          </h2>
          <div className="mt-4 flex flex-wrap gap-2">
            {home.recent_searches.map(search => (
              <Link
                key={`${search.query_normalized ?? search.category_id ?? "browse"}-${search.county ?? ""}`}
                href={searchHref(search)}
                className="chip border-line bg-white text-ink-700 hover:border-brand-300"
              >
                {search.query ?? search.category_name ?? "Browse all"}
                {search.county ? ` · ${search.county}` : ""}
              </Link>
            ))}
          </div>
        </section>
      )}

      {nearby.length > 0 && (
        <section className="shilevi-shell mt-12" aria-labelledby="nearby-heading">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="eyebrow">In your chosen area</p>
              <h2 id="nearby-heading" className="mt-3 text-3xl font-black sm:text-4xl">
                Around {home?.area}
              </h2>
            </div>
            <Link href={`/search?county=${encodeURIComponent(home?.area ?? "")}`} className="btn btn-secondary">
              Search this county
            </Link>
          </div>
          <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {nearby.map(listing => (
              <ListingCard key={listing.id} listing={listing} />
            ))}
          </div>
        </section>
      )}

      <section className="shilevi-shell mt-12 grid gap-4 lg:grid-cols-3" aria-label="Your shortcuts">
        <MiniList
          title="Recently viewed"
          items={home?.recently_viewed ?? []}
          emptyCopy="Listings you open while signed in appear here, so you can find them again."
        />
        <MiniList
          title="Saved listings"
          items={home?.saved ?? []}
          emptyCopy="Nothing saved yet. Use “Save listing” on any published listing."
        />
        <section className="surface p-5">
          <h2 className="text-sm font-bold uppercase tracking-[0.12em] text-ink-400">Recent orders</h2>
          {home && home.orders.length ? (
            <ul className="mt-4 space-y-4">
              {home.orders.map(order => (
                <li key={order.id}>
                  <Link href={`/account/orders/${order.id}`} className="text-sm font-semibold text-ink-800 hover:underline">
                    {order.order_number}
                  </Link>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span className={`chip border ${orderStatusTone(order.status)}`}>
                      {ORDER_STATUS_LABELS[order.status] ?? order.status}
                    </span>
                    <span className={`chip border ${paymentStatusTone(order.payment_status)}`}>
                      {PAYMENT_STATUS_LABELS[order.payment_status] ?? order.payment_status}
                    </span>
                    <span className="text-xs text-ink-500">
                      {formatMoney(order.total_minor, order.currency)} · {order.item_count} item
                      {order.item_count === 1 ? "" : "s"}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm leading-6 text-ink-500">
              No orders yet. Your first order will show its payment state and progress here.
            </p>
          )}
          <Link href="/account/orders" className="link-arrow mt-4 text-sm">
            All orders <span aria-hidden="true">→</span>
          </Link>
        </section>
      </section>

      <section className="shilevi-shell mt-12" aria-labelledby="devices-heading">
        <div className="surface p-6">
          <h2 id="devices-heading" className="text-lg font-black">
            Keep browsing
          </h2>
          <p className="mt-2 text-sm leading-6 text-ink-500">
            Anything you do next — a search, saving a listing, ordering — updates this page. Your
            history stays private to your account and can be cleared above at any time.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {Object.entries(divisionLabels).map(([division, label]) => (
              <Link key={division} href={`/marketplace/${division}`} className="btn btn-secondary">
                {label}
              </Link>
            ))}
          </div>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
