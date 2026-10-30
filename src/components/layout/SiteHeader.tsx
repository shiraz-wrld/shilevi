"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CartLink } from "@/components/cart/CartLink";
import { useAuth } from "@/components/auth/AuthProvider";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { site } from "@/lib/site";

const primaryLinks = [
  { href: "/marketplace/products", label: "Products" },
  { href: "/marketplace/services", label: "Services" },
  { href: "/transport", label: "Transport" },
  { href: "/house-hunt", label: "House Hunt" },
  { href: "/marketplace/transport_delivery", label: "Delivery" },
  { href: "/marketplace/property_places", label: "Property" },
];

const secondaryLinks = [
  { href: "/search", label: "Search" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/pricing", label: "Pricing" },
  { href: "/help", label: "Help" },
];

/** Routes that only make sense for an account that already holds the capability. */
const workspaceLinks = {
  provider: [
    { href: "/provider", label: "Seller workspace" },
    { href: "/provider/orders", label: "Orders to fulfil" },
    { href: "/provider/listings", label: "My listings" },
    { href: "/provider/requests", label: "Customer enquiries" },
  ],
  rider: [
    { href: "/deliver", label: "Deliverer workspace" },
    { href: "/deliver/jobs", label: "Delivery jobs" },
    { href: "/rider/jobs", label: "Rider jobs" },
  ],
} as const;

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function BrandMark() {
  return (
    <span className="flex items-center gap-2.5">
      <span className="relative grid h-9 w-9 place-items-center overflow-hidden rounded-xl bg-gradient-to-br from-brand-400 via-brand-600 to-brand-800 shadow-[0_8px_20px_-10px_rgba(29,78,216,0.9)]">
        <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 text-white">
          <path
            d="M16.5 7.2c-.9-1-2.2-1.6-3.9-1.6-2.3 0-3.9 1.1-3.9 2.8 0 1.5 1.1 2.2 3.6 2.7l1.4.3c1.7.4 2.4.8 2.4 1.8 0 1.2-1.2 1.9-3 1.9-1.7 0-3-.6-4-1.8"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.1"
            strokeLinecap="round"
          />
        </svg>
      </span>
      <span className="text-xl font-black tracking-tight text-ink-900">{site.name.toLowerCase()}</span>
    </span>
  );
}

/**
 * Shared public header.
 *
 * Client-side so it can highlight the current section, drive the mobile disclosure and reflect the
 * signed-in session without shipping a second header per page. It performs no privileged work: the
 * links it offers depend on the roles Supabase reports, and every route still authorizes on the
 * server with RLS behind it.
 *
 * While the session is still unknown it renders a fixed-width placeholder rather than "Log in", so a
 * signed-in visitor never sees a log-out state that was never true.
 */
export function SiteHeader({ initialAuthStatus }: { initialAuthStatus?: "signed-in" | "signed-out" } = {}) {
  const pathname = usePathname() || "/";
  const { status: sessionStatus, user, signOut } = useAuth();
  // A page that already knows the answer on the server can render the right state immediately, so
  // the marketing homepage keeps working without JavaScript and crawlers see real links. Once the
  // session resolves, its answer wins.
  const status = sessionStatus === "unknown" && initialAuthStatus ? initialAuthStatus : sessionStatus;
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  // Which workspaces to offer comes from approved applications/activities, not from a role name:
  // approval never writes a `user_roles` row, so a role-only check would hide every real provider.
  const providerLinks = user?.workspaces.provider ? workspaceLinks.provider : [];
  const riderLinks = user?.workspaces.rider ? workspaceLinks.rider : [];
  const greeting = user?.displayName?.trim() || user?.email || "your account";

  return (
    <header className="sticky top-0 z-40 border-b border-line/80 bg-white/85 backdrop-blur-md">
      <div className="shilevi-shell flex h-16 items-center justify-between gap-4">
        <Link href={status === "signed-in" ? "/account" : "/"} aria-label={`${site.name} home`} className="shrink-0">
          <BrandMark />
        </Link>

        <nav aria-label="Main navigation" className="hidden items-center gap-1 lg:flex">
          {primaryLinks.map(link => {
            const active = isActive(pathname, link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`rounded-full px-3 py-2 text-sm font-semibold transition-colors ${
                  active
                    ? "bg-brand-50 text-brand-800"
                    : "text-ink-600 hover:bg-mist-100 hover:text-ink-900"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-1.5">
          <Link
            href="/search"
            aria-label="Search Shilevi"
            className="hidden h-10 w-10 items-center justify-center rounded-full text-ink-500 transition-colors hover:bg-mist-100 hover:text-ink-900 sm:flex"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
              <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.9" />
              <path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
            </svg>
          </Link>
          <CartLink />
          <NotificationBell />

          {status === "unknown" && (
            <span aria-hidden="true" className="hidden h-10 w-24 rounded-full bg-mist-100 md:block" />
          )}

          {status === "signed-out" && (
            <>
              <Link
                href="/login"
                className="hidden rounded-full px-3 py-2 text-sm font-semibold text-ink-600 transition-colors hover:bg-mist-100 hover:text-ink-900 md:inline-flex"
              >
                Log in
              </Link>
              <Link href="/signup" className="btn btn-primary hidden md:inline-flex">
                Join
              </Link>
            </>
          )}

          {status === "signed-in" && user && (
            <details className="group relative hidden md:block">
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded-full border border-ink-200 px-3 py-2 text-sm font-semibold text-ink-800 transition-colors hover:bg-mist-100">
                <span className="max-w-[9rem] truncate">{greeting}</span>
                <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 text-ink-400">
                  <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </summary>
              <div className="absolute right-0 z-50 mt-2 w-72 overflow-hidden rounded-2xl border border-line bg-white p-2 shadow-xl">
                <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-ink-400">
                  {user.email ?? "Signed in"}
                </p>
                <Link href="/account" className="block rounded-xl px-3 py-2 text-sm font-semibold text-ink-800 hover:bg-mist-100">
                  Customer dashboard
                </Link>
                <Link href="/account/orders" className="block rounded-xl px-3 py-2 text-sm font-semibold text-ink-800 hover:bg-mist-100">
                  Orders &amp; delivery
                </Link>
                <Link href="/account/notifications" className="block rounded-xl px-3 py-2 text-sm font-semibold text-ink-800 hover:bg-mist-100">
                  Notifications
                </Link>
                <Link href="/account/saved" className="block rounded-xl px-3 py-2 text-sm font-semibold text-ink-800 hover:bg-mist-100">
                  Saved listings
                </Link>
                <Link href="/account/requests" className="block rounded-xl px-3 py-2 text-sm font-semibold text-ink-800 hover:bg-mist-100">
                  My requests
                </Link>

                {(providerLinks.length > 0 || riderLinks.length > 0) && (
                  <div className="mt-1 border-t border-line pt-1">
                    <p className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-ink-400">Your workspaces</p>
                    {[...providerLinks, ...riderLinks].map(link => (
                      <Link
                        key={link.href}
                        href={link.href}
                        className="block rounded-xl px-3 py-2 text-sm font-semibold text-brand-800 hover:bg-brand-50"
                      >
                        {link.label}
                      </Link>
                    ))}
                  </div>
                )}

                {(providerLinks.length === 0 || riderLinks.length === 0) && (
                  <div className="mt-1 border-t border-line pt-1">
                    <p className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-ink-400">
                      Earn with Shilevi
                    </p>
                    {providerLinks.length === 0 && (
                      <Link href="/provider/apply" className="block rounded-xl px-3 py-2 text-sm font-semibold text-ink-700 hover:bg-mist-100">
                        Apply to sell or offer services
                      </Link>
                    )}
                    {riderLinks.length === 0 && (
                      <Link href="/deliver/apply" className="block rounded-xl px-3 py-2 text-sm font-semibold text-ink-700 hover:bg-mist-100">
                        Apply to deliver
                      </Link>
                    )}
                  </div>
                )}

                <div className="mt-1 border-t border-line pt-1">
                  <button
                    type="button"
                    onClick={() => void signOut()}
                    className="block w-full rounded-xl px-3 py-2 text-left text-sm font-semibold text-ink-700 hover:bg-mist-100"
                  >
                    Sign out
                  </button>
                </div>
              </div>
            </details>
          )}

          <button
            type="button"
            onClick={() => setOpen(current => !current)}
            aria-expanded={open}
            aria-controls="site-mobile-menu"
            className="inline-flex h-10 items-center gap-2 rounded-full border border-ink-200 px-3 text-sm font-semibold text-ink-800 lg:hidden"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
              {open ? (
                <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              ) : (
                <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              )}
            </svg>
            {open ? "Close" : "Menu"}
          </button>
        </div>
      </div>

      <div
        id="site-mobile-menu"
        hidden={!open}
        className="border-t border-line bg-white lg:hidden"
      >
        <nav aria-label="Mobile navigation" className="shilevi-shell grid gap-1 py-4 sm:grid-cols-2">
          {[...primaryLinks, ...secondaryLinks].map(link => {
            const active = isActive(pathname, link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`rounded-xl px-3 py-2.5 text-sm font-semibold ${
                  active ? "bg-brand-50 text-brand-800" : "text-ink-700 hover:bg-mist-100"
                }`}
              >
                {link.label}
              </Link>
            );
          })}

          <div className="mt-2 flex flex-col gap-2 border-t border-line pt-3 sm:col-span-2">
            {status === "signed-in" && user ? (
              <>
                <p className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-400">
                  Signed in as {user.email ?? "your account"}
                </p>
                {[
                  { href: "/account", label: "Customer dashboard" },
                  { href: "/account/orders", label: "Orders & delivery" },
                  { href: "/account/notifications", label: "Notifications" },
                  ...providerLinks,
                  ...riderLinks,
                ].map(link => (
                  <Link key={link.href} href={link.href} className="rounded-xl px-3 py-2.5 text-sm font-semibold text-ink-800 hover:bg-mist-100">
                    {link.label}
                  </Link>
                ))}
                <button
                  type="button"
                  onClick={() => void signOut()}
                  className="btn btn-secondary w-full"
                >
                  Sign out
                </button>
              </>
            ) : (
              <>
                {status === "signed-out" && (
                  <>
                    <Link href="/account" className="btn btn-secondary w-full">
                      My account
                    </Link>
                    <div className="flex gap-2">
                      <Link href="/login" className="btn btn-secondary flex-1">
                        Log in
                      </Link>
                      <Link href="/signup" className="btn btn-primary flex-1">
                        Join
                      </Link>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </nav>
      </div>
    </header>
  );
}
