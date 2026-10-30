import "server-only";

import type { Metadata } from "next";
import Link from "next/link";
import { requireOwnerAdmin } from "@/lib/admin/auth";
import { AdminShell } from "@/components/admin/AdminShell";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/money";

export const metadata: Metadata = { title: "Overview", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type CountResult = { count: number | null; error: boolean };
type OrderRow = {
  id: string;
  order_number: string;
  status: string;
  payment_status: string;
  currency: string;
  total_minor: number;
  created_at: string;
};

export default async function AdminPage() {
  const access = await requireOwnerAdmin();

  const supabase = await createSupabaseServerClient();

  async function count(query: PromiseLike<{ count: number | null; error: unknown }>): Promise<CountResult> {
    try {
      const { count: value, error } = await query;
      if (error) return { count: null, error: true };
      return { count: value ?? 0, error: false };
    } catch {
      return { count: null, error: true };
    }
  }

  const [
    applications,
    refunds,
    listingsInReview,
    properties,
    vehicles,
    openRides,
    incidents,
    deletions,
    failedNotifications,
    ordersResult,
    modeResult,
    mockResult,
  ] = await Promise.all([
    count(supabase.from("provider_applications").select("*", { count: "exact", head: true }).in("status", ["pending", "under_review"])),
    count(supabase.from("refunds").select("*", { count: "exact", head: true }).eq("status", "requested")),
    count(supabase.from("listings").select("*", { count: "exact", head: true }).in("status", ["draft", "pending_review"])),
    count(supabase.from("property_listings").select("*", { count: "exact", head: true }).eq("verification_status", "pending")),
    count(supabase.from("transport_vehicles").select("*", { count: "exact", head: true }).eq("verification_status", "pending")),
    count(supabase.from("rides").select("*", { count: "exact", head: true }).not("status", "in", "(completed,cancelled)")),
    count(supabase.from("delivery_incidents").select("*", { count: "exact", head: true }).in("status", ["open", "investigating"])),
    count(supabase.from("account_deletion_requests").select("*", { count: "exact", head: true }).in("status", ["pending", "in_review"])),
    count(supabase.from("notification_outbox").select("*", { count: "exact", head: true }).eq("status", "failed")),
    supabase
      .from("orders")
      .select("id,order_number,status,payment_status,currency,total_minor,created_at")
      .order("created_at", { ascending: false })
      .limit(5),
    supabase.rpc("get_checkout_settings"),
    supabase.rpc("mock_payments_allowed"),
  ]);

  const orders = (ordersResult.data ?? []) as OrderRow[];
  const ordersAvailable = !ordersResult.error;
  const checkout = (Array.isArray(modeResult.data) ? modeResult.data[0] : modeResult.data) as
    | { currency?: string; payment_mode?: string; delivery_flat_fee_minor?: number }
    | null
    | undefined;
  const mode = checkout?.payment_mode ?? (modeResult.error ? null : "unknown");
  const sandboxAllowed = mockResult.error ? null : mockResult.data === true;

  const queues = [
    { label: "Provider applications", value: applications, href: "/admin/applications", blurb: "Waiting for a review decision" },
    { label: "Refund requests", value: refunds, href: "/admin/refunds", blurb: "Customer money is on hold until decided" },
    { label: "Listings in review", value: listingsInReview, href: "/admin/listings", blurb: "Draft or pending review, not public yet" },
    { label: "Properties to verify", value: properties, href: "/admin/properties", blurb: "House Hunt evidence awaiting verification" },
    { label: "Vehicles to approve", value: vehicles, href: "/admin/rides", blurb: "Transport partners who cannot take trips yet" },
    { label: "Open rides", value: openRides, href: "/admin/rides", blurb: "Requested, agreed or in progress" },
    { label: "Delivery incidents", value: incidents, href: "/admin/incidents", blurb: "Reported problems with no resolution yet" },
    { label: "Deletion requests", value: deletions, href: "/admin/deletion-requests", blurb: "Account deletion awaiting a decision" },
    { label: "Failed notifications", value: failedNotifications, href: "/admin/notifications", blurb: "Outbox rows that need attention" },
  ];

  return (
    <AdminShell
      email={access.user.email ?? null}
      mfaLevel={access.mfaLevel}
      title="Marketplace operations"
      description="Live queues from the database. A dash means the query failed — it never means zero. Every count links to the screen that resolves it."
    >
      <section aria-labelledby="queues" className="mt-2">
        <h2 id="queues" className="text-sm font-bold uppercase tracking-[0.14em] text-ink-400">
          Needs attention
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {queues.map(queue => (
            <Link
              key={queue.label}
              href={queue.href}
              className="group rounded-2xl border border-white/10 bg-white/[0.03] p-4 transition-colors hover:border-brand-400/60 hover:bg-white/[0.06]"
            >
              <p className="flex items-baseline justify-between gap-2">
                <span className="text-3xl font-black text-white">
                  {queue.value.error ? "—" : (queue.value.count ?? 0)}
                </span>
                <span className="text-[11px] font-bold uppercase tracking-wide text-ink-500 group-hover:text-brand-300">
                  open
                </span>
              </p>
              <p className="mt-2 text-sm font-bold text-ink-100">{queue.label}</p>
              <p className="mt-1 text-xs leading-5 text-ink-400">
                {queue.value.error ? "Could not be read. Check the migration state and your MFA level." : queue.blurb}
              </p>
            </Link>
          ))}
        </div>
      </section>

      <div className="mt-8 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-black text-white">Latest orders</h2>
            <Link href="/admin/orders" className="text-xs font-bold text-brand-300 hover:text-brand-200">
              All orders →
            </Link>
          </div>
          {!ordersAvailable ? (
            <p className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm leading-6 text-amber-100">
              Orders could not be read. Nothing was changed. Reload once; if it persists, System health reports whether the cause is a missing migration, an MFA session or a missing capability.</p>
          ) : orders.length === 0 ? (
            <p className="mt-3 rounded-xl border border-white/10 p-3 text-sm text-ink-300">
              No orders have been placed yet. This is a true zero, not missing data.
            </p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-[11px] font-bold uppercase tracking-wide text-ink-500">
                  <tr>
                    <th scope="col" className="py-2 pr-3">Order</th>
                    <th scope="col" className="py-2 pr-3">Placed</th>
                    <th scope="col" className="py-2 pr-3">Status</th>
                    <th scope="col" className="py-2 pr-3">Payment</th>
                    <th scope="col" className="py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {orders.map(order => (
                    <tr key={order.id}>
                      <td className="py-2 pr-3 font-semibold text-white">{order.order_number}</td>
                      <td className="whitespace-nowrap py-2 pr-3 text-ink-400">
                        {new Date(order.created_at).toLocaleString("en-KE")}
                      </td>
                      <td className="py-2 pr-3 text-ink-200">{order.status}</td>
                      <td className="py-2 pr-3 text-ink-200">{order.payment_status}</td>
                      <td className="whitespace-nowrap py-2 text-right font-semibold text-white">
                        {formatMoney(order.total_minor, order.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <h2 className="text-lg font-black text-white">Payment posture</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-ink-400">Payment mode</dt>
              <dd className="font-bold text-white">{mode ?? "unavailable"}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-ink-400">Sandbox switch</dt>
              <dd className={`font-bold ${sandboxAllowed ? "text-amber-200" : "text-emerald-200"}`}>
                {sandboxAllowed === null ? "unavailable" : sandboxAllowed ? "on" : "off"}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-ink-400">Currency</dt>
              <dd className="font-bold text-white">{checkout?.currency ?? "KES"}</dd>
            </div>
          </dl>
          {sandboxAllowed ? (
            <p className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs leading-5 text-amber-100">
              Sandbox payments are enabled. Every payment recorded in this mode is simulated. Turn the
              switch off before taking real money.
            </p>
          ) : (
            <p className="mt-3 rounded-xl border border-white/10 p-3 text-xs leading-5 text-ink-300">
              No real provider credentials are configured in this deployment unless the payment screen
              says otherwise. Checkout fails closed.
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/admin/payments" className="btn btn-secondary !px-3 !py-2 !text-xs">
              Payments
            </Link>
            <Link href="/admin/settings" className="btn btn-secondary !px-3 !py-2 !text-xs">
              Fees &amp; settings
            </Link>
            <Link href="/admin/security" className="btn btn-secondary !px-3 !py-2 !text-xs">
              Security
            </Link>
          </div>
        </section>
      </div>

      <section className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <h2 className="text-lg font-black text-white">Start here</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { href: "/admin/applications", label: "Review provider applications", body: "Approval unlocks listing creation." },
            { href: "/admin/refunds", label: "Decide refunds", body: "Moves the ledger; cannot be undone here." },
            { href: "/admin/brands", label: "Create a brand", body: "Storefronts, featuring and visibility." },
            { href: "/admin/categories", label: "Manage taxonomy", body: "Sections, slugs and public visibility." },
            { href: "/admin/payments/providers", label: "Payment methods", body: "What checkout may offer, and whether it is chargeable." },
            { href: "/admin/staff", label: "Staff capabilities", body: "Narrow, revocable grants for confirmed accounts." },
            { href: "/admin/incidents", label: "Resolve an incident", body: "Delivery problems and their recorded outcome." },
            { href: "/admin/payouts/reconciliation", label: "Reconcile payouts", body: "Commission claimed against commission posted." },
            { href: "/admin/document-requirements", label: "Set evidence rules", body: "Which documents each role must supply." },
          ].map(item => (
            <Link key={item.href} href={item.href} className="rounded-xl border border-white/10 p-3 transition-colors hover:border-brand-400/60">
              <p className="text-sm font-bold text-white">{item.label}</p>
              <p className="mt-1 text-xs leading-5 text-ink-400">{item.body}</p>
            </Link>
          ))}
        </div>
      </section>
    </AdminShell>
  );
}
