"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = { href: string; label: string; hint: string };

const groups: { heading: string; items: NavItem[] }[] = [
  {
    heading: "Operations",
    items: [
      { href: "/admin", label: "Overview", hint: "Queues, counts and the current posture" },
      { href: "/admin/applications", label: "Applications", hint: "Approve or reject provider applications" },
      { href: "/admin/listings", label: "Listings", hint: "Publish, pause and feature listings" },
      { href: "/admin/orders", label: "Orders", hint: "Recent orders and their payment state" },
      { href: "/admin/deliveries", label: "Deliveries", hint: "Delivery jobs, counties and rider assignment" },
      { href: "/admin/incidents", label: "Incidents", hint: "Reported delivery problems and their resolution" },
      { href: "/admin/refunds", label: "Refunds", hint: "Approve or reject customer refund requests" },
      { href: "/admin/requests", label: "Customer enquiries", hint: "Listing enquiries and response state" },
    ],
  },
  {
    heading: "Mobility & homes",
    items: [
      { href: "/admin/rides", label: "Passenger trips", hint: "Trips, routes, fares and payment state" },
      { href: "/admin/vehicles", label: "Vehicle approval", hint: "Approve or reject transport vehicles" },
      { href: "/admin/document-requirements", label: "Document requirements", hint: "What each role must supply before approval" },
      { href: "/admin/riders", label: "Riders", hint: "Earnings, withdrawals and completed trips" },
      { href: "/admin/service-areas", label: "Service coverage", hint: "Which counties providers serve" },
      { href: "/admin/properties", label: "House Hunt review", hint: "Verify and publish properties" },
      { href: "/admin/property-unlocks", label: "Contact unlocks", hint: "Paid House Hunt contact access" },
    ],
  },
  {
    heading: "Catalogue & people",
    items: [
      { href: "/admin/categories", label: "Categories", hint: "Taxonomy and public visibility" },
      { href: "/admin/brands", label: "Brands", hint: "Create storefronts and feature them" },
      { href: "/admin/commission", label: "Commission rules", hint: "Rates, tiers and effective windows" },
      { href: "/admin/providers", label: "Providers", hint: "Applications, grants and live listings" },
      { href: "/admin/customers", label: "Customers", hint: "Account directory and order history" },
    ],
  },
  {
    heading: "Money",
    items: [
      { href: "/admin/payments", label: "Payments & payouts", hint: "Revenue, intents and withdrawals" },
      { href: "/admin/payment-intents", label: "Payment intents", hint: "Every collection attempt" },
      { href: "/admin/payment-events", label: "Payment events", hint: "Provider callbacks as received" },
      { href: "/admin/ledger", label: "Ledger", hint: "Double-entry debits and credits" },
      { href: "/admin/payouts", label: "Payouts", hint: "Withdrawal queue and dispatch" },
      { href: "/admin/payouts/reconciliation", label: "Payout reconciliation", hint: "Commission claimed against commission posted" },
      { href: "/admin/payments/providers", label: "Payment methods", hint: "Which methods are offered" },
      { href: "/admin/settings", label: "Fees & settings", hint: "Commission and delivery fee configuration" },
    ],
  },
  {
    heading: "Demand & comms",
    items: [
      { href: "/admin/insights", label: "Search insights", hint: "Demand and zero-result searches" },
      { href: "/admin/reviews", label: "Trip reviews", hint: "Ratings left after completed trips" },
      { href: "/admin/notifications", label: "Notifications", hint: "The outbox and delivery state" },
      { href: "/admin/onboarding", label: "Onboarding", hint: "Completion, intent and location" },
    ],
  },
  {
    heading: "Governance",
    items: [
      { href: "/admin/roles", label: "Role assignments", hint: "Marketplace roles on record" },
      { href: "/admin/staff", label: "Staff access", hint: "Grant and revoke capabilities" },
      { href: "/admin/deletion-requests", label: "Deletions", hint: "Account deletion review" },
      { href: "/admin/audit-log", label: "Audit log", hint: "Privileged change history" },
      { href: "/admin/security", label: "Security", hint: "Owner MFA and session assurance" },
      { href: "/admin/system-health", label: "System health", hint: "Migrations and provider configuration" },
    ],
  },
];

function SignOutButton() {
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      await fetch("/api/auth/signout", { method: "POST" });
    } catch {
      // Even if the request fails the session cookie is cleared server-side on the next request.
    }
    window.location.assign("/");
  }

  return (
    <button
      type="button"
      onClick={() => void signOut()}
      disabled={busy}
      className="w-full rounded-xl border border-white/15 px-3 py-2 text-xs font-bold text-ink-200 transition-colors hover:border-white/35 hover:text-white disabled:opacity-50"
    >
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}

/**
 * Owner/staff control center frame.
 *
 * Navigation only lists pages that exist and have a real backend behind them; hiding a link is
 * never treated as authorization. Every page re-checks the owner allowlist and MFA level on the
 * server, and the database enforces the same rules on every write.
 */
export function AdminShell({
  email,
  mfaLevel,
  title,
  description,
  children,
}: {
  email: string | null;
  mfaLevel: string | null;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname() || "/admin";
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const activeHref = [...groups.flatMap(group => group.items)]
    .map(item => item.href)
    .filter(href => (href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(`${href}/`)))
    .sort((a, b) => b.length - a.length)[0];

  const sidebar = (
    <nav aria-label="Admin sections" className="flex h-full flex-col gap-6 p-4">
      <Link href="/admin" className="flex items-center gap-2.5 px-2 py-1">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-brand-400 via-brand-600 to-brand-800 text-sm font-black text-white">
          S
        </span>
        <span className="text-sm font-black tracking-tight text-white">
          shilevi <span className="font-semibold text-ink-400">/ admin</span>
        </span>
      </Link>

      <div className="flex-1 space-y-5 overflow-y-auto">
        {groups.map(group => (
          <div key={group.heading}>
            <p className="px-2 text-[10px] font-bold uppercase tracking-[0.16em] text-ink-500">{group.heading}</p>
            <ul className="mt-2 space-y-0.5">
              {group.items.map(item => {
                const active = item.href === activeHref;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={`block rounded-lg px-2.5 py-2 text-sm font-semibold transition-colors ${
                        active ? "bg-brand-600 text-white" : "text-ink-300 hover:bg-white/5 hover:text-white"
                      }`}
                    >
                      {item.label}
                      <span className={`mt-0.5 block text-[11px] font-normal leading-4 ${active ? "text-brand-100" : "text-ink-500"}`}>
                        {item.hint}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      <div className="space-y-2 border-t border-white/10 pt-3">
        <Link href="/" className="block rounded-xl px-3 py-2 text-xs font-bold text-ink-300 hover:text-white">
          View public site →
        </Link>
        <SignOutButton />
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen bg-ink-950 text-white lg:grid lg:grid-cols-[272px_minmax(0,1fr)]">
      <aside className="hidden border-r border-white/10 bg-ink-950 lg:sticky lg:top-0 lg:block lg:h-screen">
        {sidebar}
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-30 border-b border-white/10 bg-ink-950/90 backdrop-blur">
          <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setOpen(current => !current)}
                aria-expanded={open}
                aria-controls="admin-sidebar-mobile"
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/15 px-3 text-xs font-bold text-white lg:hidden"
              >
                {open ? "Close" : "Menu"}
              </button>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-brand-300">Owner control center</p>
                <p className="text-sm font-bold text-white">{title}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`hidden rounded-full border px-2.5 py-1 text-[11px] font-bold sm:inline ${
                  mfaLevel === "aal2"
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                    : "border-amber-500/40 bg-amber-500/10 text-amber-200"
                }`}
              >
                {mfaLevel === "aal2" ? "MFA verified" : "MFA required"}
              </span>
              <span className="hidden max-w-[18rem] truncate text-xs text-ink-300 md:inline">{email}</span>
            </div>
          </div>
        </header>

        <div id="admin-sidebar-mobile" hidden={!open} className="border-b border-white/10 bg-ink-950 lg:hidden">
          {open && <div className="max-h-[70vh] overflow-y-auto">{sidebar}</div>}
        </div>

        <main className="px-4 py-8 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-6xl">
            <h1 className="text-2xl font-black sm:text-3xl">{title}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-300">{description}</p>
            {mfaLevel !== "aal2" && (
              <p className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm leading-6 text-amber-100">
                This session has not completed two-step verification, so the database will refuse
                privileged reads and writes.{" "}
                <Link href="/login/mfa?next=%2Fadmin" className="font-bold underline">
                  Verify your authenticator
                </Link>{" "}
                or{" "}
                <Link href="/admin/security" className="font-bold underline">
                  manage MFA setup
                </Link>
                .
              </p>
            )}
            <div className="mt-6">{children}</div>
          </div>
        </main>
      </div>
    </div>
  );
}
