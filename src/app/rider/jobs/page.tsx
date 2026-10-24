"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { formatMoney } from "@/lib/money";
import { DELIVERY_STATUS_LABELS } from "@/lib/order-status";

type AvailableJob = {
  delivery_id: string;
  order_id: string;
  dropoff_county: string | null;
  distance_km: number | null;
  rider_fee_minor: number;
  created_at: string;
};
type AssignedJob = {
  id: string;
  order_id: string;
  status: string;
  dropoff_address: string;
  rider_fee_minor: number;
  created_at: string;
  orders: { order_number: string; status: string; delivery_method: string } | { order_number: string; status: string; delivery_method: string }[] | null;
};

export default function RiderJobsPage() {
  const [eligible, setEligible] = useState<boolean | null>(null);
  const [available, setAvailable] = useState<AvailableJob[]>([]);
  const [assigned, setAssigned] = useState<AssignedJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const db = createSupabaseBrowserClient();
      const auth = await db.auth.getUser();
      if (auth.error) throw auth.error;
      if (!auth.data.user) { window.location.replace("/login?next=%2Frider%2Fjobs"); return; }
      const user = auth.data.user;

      const role = await db.from("user_roles").select("role").eq("user_id", user.id).eq("role", "transport_partner").maybeSingle();
      if (role.error) throw role.error;
      let isEligible = Boolean(role.data);
      if (!isEligible) {
        const application = await db.from("provider_applications").select("id").eq("user_id", user.id).eq("activity_type", "transport_partner").eq("status", "approved").maybeSingle();
        if (application.error) throw application.error;
        isEligible = Boolean(application.data);
      }
      setEligible(isEligible);
      if (!isEligible) { setAvailable([]); setAssigned([]); return; }

      const [availableResult, assignedResult] = await Promise.all([
        db.rpc("list_available_deliveries"),
        db.from("deliveries")
          .select("id,order_id,status,dropoff_address,rider_fee_minor,created_at,orders(order_number,status,delivery_method)")
          .eq("rider_id", user.id)
          .in("status", ["assigned", "to_pickup", "collected", "in_transit"])
          .order("created_at", { ascending: false }),
      ]);
      if (availableResult.error) throw availableResult.error;
      if (assignedResult.error) throw assignedResult.error;
      setAvailable((availableResult.data ?? []) as AvailableJob[]);
      setAssigned((assignedResult.data ?? []) as unknown as AssignedJob[]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "We could not load delivery jobs. Confirm migrations 0016-0018 have been applied.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function accept(job: AvailableJob) {
    if (!window.confirm("Accept this delivery? Only accept a job you can complete.")) return;
    setBusy(job.delivery_id); setError(""); setMessage("");
    try {
      const db = createSupabaseBrowserClient();
      const result = await db.rpc("accept_delivery", { p_delivery_id: job.delivery_id });
      if (result.error) throw result.error;
      setMessage("Delivery accepted. Open the active job to see the pickup and drop-off details.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "This delivery could not be accepted. It may have been claimed by another rider.");
    } finally { setBusy(""); }
  }

  return <main className="min-h-screen bg-slate-50 text-slate-950">
    <header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-5 py-5"><Link href="/" className="text-2xl font-black text-blue-700">shilevi</Link><div className="flex gap-4 text-sm font-semibold text-blue-700"><Link href="/rider/jobs">Jobs</Link><Link href="/provider/transport-details">Transport profile</Link><Link href="/account">Account</Link></div></div></header>
    <div className="mx-auto max-w-5xl px-5 py-8 sm:py-12">
      <p className="text-sm font-bold uppercase tracking-wide text-blue-700">Rider workspace</p>
      <h1 className="mt-2 text-3xl font-black sm:text-4xl">Delivery jobs</h1>
      <p className="mt-3 max-w-2xl leading-7 text-slate-600">Claim an eligible delivery, follow its status, and complete the handover with the customer&apos;s code. Full addresses are revealed only after you accept a job.</p>
      <p className="mt-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-blue-900">Live map tracking is not connected yet. This build records every delivery status change in the order timeline; it does not claim a live GPS location.</p>

      {message && <p role="status" className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">{message}</p>}
      {error && <p role="alert" className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}

      {loading ? <p role="status" className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 text-slate-600">Loading jobs…</p> : eligible === false ? <section className="mt-8 rounded-3xl border border-amber-200 bg-white p-8"><h2 className="text-2xl font-black">Transport partner approval required</h2><p className="mt-3 max-w-xl leading-7 text-slate-600">Only approved transport partners can see and accept delivery jobs. Apply for transport and delivery, provide the required vehicle and identity details, and wait for review.</p><div className="mt-5 flex flex-wrap gap-3"><Link href="/provider/apply" className="rounded-xl bg-blue-700 px-5 py-3 font-bold text-white">Apply as a transport partner →</Link><Link href="/provider/transport-details" className="rounded-xl border border-slate-300 px-5 py-3 font-bold">Transport details</Link></div></section> : <>
        <section className="mt-8">
          <div className="flex flex-wrap items-end justify-between gap-3"><h2 className="text-2xl font-black">Active jobs</h2><p className="text-sm text-slate-500">{assigned.length} active</p></div>
          {assigned.length === 0 ? <p className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm leading-6 text-slate-600">No active delivery. Accept an available job below when you are ready to work.</p> : <div className="mt-4 space-y-3">{assigned.map(job => {
            const order = Array.isArray(job.orders) ? job.orders[0] : job.orders;
            return <article key={job.id} className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wide text-slate-500">{order?.order_number ?? "Order"}</p><p className="mt-1 text-lg font-bold">{DELIVERY_STATUS_LABELS[job.status] ?? job.status}</p><p className="mt-1 text-sm text-slate-600">{job.dropoff_address}</p></div><div className="text-right"><p className="text-lg font-black">{formatMoney(job.rider_fee_minor, "KES")}</p><Link href={`/rider/jobs/${job.id}`} className="mt-2 inline-block rounded-xl bg-blue-700 px-4 py-2 text-sm font-bold text-white">Open job →</Link></div></div></article>;
          })}</div>}
        </section>

        <section className="mt-9">
          <div className="flex flex-wrap items-end justify-between gap-3"><h2 className="text-2xl font-black">Available jobs</h2><p className="text-sm text-slate-500">{available.length} waiting</p></div>
          {available.length === 0 ? <p className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm leading-6 text-slate-600">No unclaimed deliveries right now. New paid orders with Shilevi delivery will appear here.</p> : <div className="mt-4 space-y-3">{available.map(job => <article key={job.delivery_id} className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Delivery job</p><p className="mt-1 text-lg font-bold">{job.dropoff_county ?? "Area shared after acceptance"}</p><p className="mt-1 text-sm text-slate-500">{job.distance_km ? `${job.distance_km} km` : "Distance not calculated"} · requested {new Date(job.created_at).toLocaleString()}</p></div><p className="text-lg font-black">{formatMoney(job.rider_fee_minor, "KES")}</p></div><p className="mt-3 text-xs leading-5 text-slate-500">The exact pickup and drop-off addresses are released after you accept. Only accept a job you can complete.</p><button onClick={() => void accept(job)} disabled={busy === job.delivery_id} className="mt-4 rounded-xl bg-blue-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{busy === job.delivery_id ? "Accepting…" : "Accept delivery"}</button></article>)}</div>}
        </section>
      </>}
    </div>
  </main>;
}
