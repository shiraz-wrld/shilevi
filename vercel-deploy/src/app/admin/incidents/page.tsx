import "server-only";

import type { Metadata } from "next";
import Link from "next/link";
import { requireOwnerAdmin } from "@/lib/admin/auth";
import { AdminShell } from "@/components/admin/AdminShell";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { describeAdminReadFailure } from "@/lib/admin/errors";
import IncidentResolution, { type IncidentRow } from "./IncidentResolution";

export const metadata: Metadata = {
  title: "Delivery incidents",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

const TABS = [
  { key: "open", label: "Open", statuses: ["open", "investigating"] },
  { key: "resolved", label: "Resolved", statuses: ["resolved"] },
  { key: "rejected", label: "Dismissed", statuses: ["rejected"] },
] as const;

const CATEGORY_LABELS: Record<string, string> = {
  not_home: "Customer not home",
  wrong_address: "Wrong address",
  failed_pickup: "Pickup failed",
  vehicle_issue: "Vehicle problem",
  late_delivery: "Late delivery",
  damaged: "Parcel damaged",
  missing: "Parcel missing",
  wrong_item: "Wrong item",
  rejected: "Parcel refused",
  return_to_sender: "Return to sender",
  provider_cancelled: "Delivery provider cancelled",
  fee_dispute: "Delivery fee dispute",
  suspected_fraud: "Suspected fraud",
  other: "Other",
};

function when(value: string | null): string {
  if (!value) return "Not recorded";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Not recorded" : parsed.toLocaleString("en-KE");
}

export default async function AdminIncidentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const access = await requireOwnerAdmin();
  const params = await searchParams;
  const tab = TABS.find(entry => entry.key === params.status) ?? TABS[0];

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("delivery_incidents")
    .select("id,reference,delivery_id,category,description,status,resolution_note,resolved_at,created_at")
    .in("status", [...tab.statuses])
    .order("created_at", { ascending: false })
    .limit(50);

  const incidents = (data ?? []) as IncidentRow[];

  // Delivery and order context is read separately rather than through an embedded join, so a
  // missing relationship shows as "unavailable" instead of failing the whole queue.
  const deliveryIds = [...new Set(incidents.map(incident => incident.delivery_id))];
  const deliveries = deliveryIds.length
    ? await supabase
        .from("deliveries")
        .select("id,order_id,status,dropoff_county")
        .in("id", deliveryIds)
        .limit(deliveryIds.length)
    : { data: [], error: null };

  const deliveryRows = (deliveries.data ?? []) as {
    id: string;
    order_id: string;
    status: string;
    dropoff_county: string | null;
  }[];

  const orderIds = [...new Set(deliveryRows.map(row => row.order_id))];
  const orders = orderIds.length
    ? await supabase.from("orders").select("id,order_number").in("id", orderIds).limit(orderIds.length)
    : { data: [], error: null };

  const orderNumbers = new Map(
    ((orders.data ?? []) as { id: string; order_number: string }[]).map(row => [row.id, row.order_number]),
  );
  const deliveryById = new Map(deliveryRows.map(row => [row.id, row]));

  const readProblem = error ? describeAdminReadFailure("Delivery incidents", error) : null;

  return (
    <AdminShell
      email={access.user.email ?? null}
      mfaLevel={access.mfaLevel}
      title="Delivery incidents"
      description="Problems reported against a specific delivery. Resolution records who decided, when and why; it never moves money, and a fee dispute is only settled by a refund decision on the refunds screen."
    >
      <nav aria-label="Incident status" className="flex flex-wrap items-center gap-2">
        {TABS.map(entry => {
          const active = entry.key === tab.key;
          return (
            <Link
              key={entry.key}
              href={entry.key === "open" ? "/admin/incidents" : `/admin/incidents?status=${entry.key}`}
              aria-current={active ? "page" : undefined}
              className={
                active
                  ? "rounded-full border border-brand-400 bg-brand-500/20 px-3 py-1.5 text-sm font-bold text-brand-100"
                  : "rounded-full border border-white/15 px-3 py-1.5 text-sm font-semibold text-ink-300 hover:border-white/30"
              }
            >
              {entry.label}
            </Link>
          );
        })}
        <Link href="/admin/deliveries" className="ml-auto text-sm font-semibold text-brand-300 hover:text-brand-200">
          Deliveries →
        </Link>
      </nav>

      {readProblem ? (
        <p role="alert" className="mt-5 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-5 text-sm leading-6 text-amber-100">
          {readProblem}
        </p>
      ) : incidents.length === 0 ? (
        <p className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-sm leading-6 text-ink-300">
          No incident matches this filter. This is a true zero: incident rows are created only when a
          customer, provider or rider reports a problem on a real delivery.
        </p>
      ) : (
        <div className="mt-5 space-y-4">
          {incidents.map(incident => {
            const delivery = deliveryById.get(incident.delivery_id) ?? null;
            const orderNumber = delivery ? (orderNumbers.get(delivery.order_id) ?? null) : null;
            return (
              <article
                key={incident.id}
                className="rounded-2xl border border-white/10 bg-white/[0.03] p-5"
              >
                <header className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-lg font-black text-white">
                      {CATEGORY_LABELS[incident.category] ?? incident.category}
                    </h2>
                    <p className="mt-1 font-mono text-xs text-ink-400">{incident.reference}</p>
                  </div>
                  <p className="text-xs text-ink-400">Reported {when(incident.created_at)}</p>
                </header>

                <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-[11px] font-bold uppercase tracking-wide text-ink-500">Order</dt>
                    <dd className="mt-1 text-ink-100">{orderNumber ?? "Not available"}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-bold uppercase tracking-wide text-ink-500">Delivery state</dt>
                    <dd className="mt-1 text-ink-100">{delivery?.status ?? "Not available"}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-bold uppercase tracking-wide text-ink-500">Drop-off county</dt>
                    <dd className="mt-1 text-ink-100">{delivery?.dropoff_county ?? "Not recorded"}</dd>
                  </div>
                </dl>

                <p className="mt-3 whitespace-pre-wrap rounded-xl border border-white/10 bg-ink-950/40 p-4 text-sm leading-6 text-ink-200">
                  {incident.description}
                </p>

                {incident.resolved_at ? (
                  <p className="mt-3 text-xs text-ink-400">
                    Closed {when(incident.resolved_at)}
                    {incident.resolution_note ? ` — ${incident.resolution_note}` : ""}
                  </p>
                ) : null}

                <IncidentResolution incident={incident} />
              </article>
            );
          })}
        </div>
      )}
    </AdminShell>
  );
}
