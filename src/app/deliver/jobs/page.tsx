"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";

type Offer = {
  offer_id: string;
  delivery_id: string;
  shipment_number: string;
  order_number: string;
  pickup_county: string | null;
  dropoff_county: string | null;
  package_count: number;
  weight_kg: number | null;
  required_vehicle_class_code: string | null;
  expires_at: string;
  fee_minor: number;
};

type Job = {
  id: string;
  shipment_number: string;
  status: string;
  dropoff_address: string;
  dropoff_county: string | null;
  pickup_county: string | null;
  delivery_fee_minor: number;
  rider_fee_minor: number;
  proof_code: string | null;
  assigned_at: string | null;
  picked_up_at: string | null;
  delivered_at: string | null;
};

type Event = { id: number; delivery_id: string; status: string; created_at: string; note: string | null };

const nextStatus: Record<string, { to: string; label: string }> = {
  assigned: { to: "to_pickup", label: "Start heading to pickup" },
  to_pickup: { to: "collected", label: "Confirm pickup" },
  collected: { to: "in_transit", label: "Start delivery" },
  in_transit: { to: "delivered", label: "Mark delivered" },
};

// Mirrors the delivery_incidents.category constraint in 0029; the database rejects anything else.
const incidentCategories = [
  { value: "not_home", label: "Recipient not available" },
  { value: "wrong_address", label: "Wrong or inaccessible address" },
  { value: "failed_pickup", label: "Pickup failed" },
  { value: "vehicle_issue", label: "Vehicle breakdown" },
  { value: "late_delivery", label: "Running late" },
  { value: "damaged", label: "Package damaged" },
  { value: "missing", label: "Package missing" },
  { value: "rejected", label: "Recipient refused the delivery" },
  { value: "return_to_sender", label: "Returning to sender" },
  { value: "other", label: "Other problem" },
];

function money(minor: number) {
  return `KSh ${(Number(minor) / 100).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function DeliverJobsPage() {
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [events, setEvents] = useState<Record<string, Event[]>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [proofCodes, setProofCodes] = useState<Record<string, string>>({});
  const [incidentCategory, setIncidentCategory] = useState<Record<string, string>>({});
  const [incidentText, setIncidentText] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const db = createSupabaseBrowserClient();
      const { data: auth } = await db.auth.getUser();
      if (!auth.user) {
        setSignedIn(false);
        return;
      }
      setSignedIn(true);

      const [offerResult, jobResult] = await Promise.all([
        db.rpc("list_my_delivery_offers"),
        db
          .from("deliveries")
          .select("id,shipment_number,status,dropoff_address,dropoff_county,pickup_county,delivery_fee_minor,rider_fee_minor,assigned_at,picked_up_at,delivered_at")
          .eq("rider_id", auth.user.id)
          .order("created_at", { ascending: false })
          .limit(50),
      ]);

      if (offerResult.error) throw offerResult.error;
      if (jobResult.error) throw jobResult.error;

      const offerRows = (offerResult.data ?? []) as Offer[];
      const jobRows = (jobResult.data ?? []) as Job[];
      setOffers(offerRows);
      setJobs(jobRows);

      const activeIds = jobRows.filter(job => ["assigned", "to_pickup", "collected", "in_transit"].includes(job.status)).map(job => job.id);
      if (activeIds.length > 0) {
        const { data: eventRows } = await db
          .from("delivery_events")
          .select("id,delivery_id,status,created_at,note")
          .in("delivery_id", activeIds)
          .order("created_at", { ascending: true })
          .limit(200);
        const grouped: Record<string, Event[]> = {};
        for (const event of (eventRows ?? []) as Event[]) {
          grouped[event.delivery_id] = [...(grouped[event.delivery_id] ?? []), event];
        }
        setEvents(grouped);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Your delivery jobs could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function accept(offer: Offer) {
    setBusy(offer.offer_id);
    setError("");
    setNotice("");
    try {
      const db = createSupabaseBrowserClient();
      const { error: rpcError } = await db.rpc("accept_delivery_offer", { p_offer_id: offer.offer_id });
      if (rpcError) throw rpcError;
      setNotice(`Shipment ${offer.shipment_number} assigned to you. Pickup details are now visible below.`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The offer could not be accepted.");
      await load();
    } finally {
      setBusy("");
    }
  }

  async function decline(offer: Offer) {
    setBusy(offer.offer_id);
    setError("");
    try {
      const db = createSupabaseBrowserClient();
      const { error: rpcError } = await db.rpc("decline_delivery_offer", {
        p_offer_id: offer.offer_id,
        p_reason: notes[offer.offer_id] ?? null,
      });
      if (rpcError) throw rpcError;
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The offer could not be declined.");
    } finally {
      setBusy("");
    }
  }

  async function advance(job: Job, to: string) {
    setBusy(job.id);
    setError("");
    setNotice("");
    try {
      const db = createSupabaseBrowserClient();

      // The code is verified first, in its own call, because a wrong guess must be counted and
      // committed. The status change only accepts a verification recorded moments earlier.
      if (to === "delivered") {
        const code = (proofCodes[job.id] ?? "").trim();
        if (!code) {
          setError("Ask the customer for the confirmation code before completing this delivery.");
          return;
        }
        const { data: outcome, error: verifyError } = await db.rpc("verify_delivery_proof_code", {
          p_delivery_id: job.id,
          p_code: code,
        });
        if (verifyError) throw verifyError;
        if (outcome !== "verified") {
          setError(
            outcome === "locked"
              ? "Too many incorrect codes. This delivery is locked for 15 minutes; contact support if the customer cannot find the code."
              : outcome === "used"
                ? "This delivery has already been confirmed."
                : "That confirmation code is not correct. Ask the customer to read it again.",
          );
          return;
        }
      }

      const { error: rpcError } = await db.rpc("rider_update_delivery", {
        p_delivery_id: job.id,
        p_to_status: to,
        p_proof_code: null,
        p_note: notes[job.id] ?? null,
      });
      if (rpcError) throw rpcError;
      setNotice(`Shipment ${job.shipment_number} updated to ${to.replaceAll("_", " ")}.`);
      setNotes(current => ({ ...current, [job.id]: "" }));
      setProofCodes(current => ({ ...current, [job.id]: "" }));
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The status could not be updated.");
    } finally {
      setBusy("");
    }
  }

  async function fail(job: Job) {
    setBusy(job.id);
    setError("");
    try {
      const db = createSupabaseBrowserClient();
      const { error: rpcError } = await db.rpc("rider_update_delivery", {
        p_delivery_id: job.id,
        p_to_status: "failed",
        p_note: notes[job.id] ?? null,
      });
      if (rpcError) throw rpcError;
      setNotice(`Shipment ${job.shipment_number} recorded as failed. Support can review it.`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The failure could not be recorded.");
    } finally {
      setBusy("");
    }
  }

  async function reportIncident(job: Job) {
    const description = (incidentText[job.id] ?? "").trim();
    setBusy(`incident-${job.id}`);
    setError("");
    setNotice("");
    try {
      if (description.length < 10) throw new Error("Describe the problem in at least 10 characters so support can act on it.");
      const db = createSupabaseBrowserClient();
      const { data: user } = await db.auth.getUser();
      if (!user.user) throw new Error("Sign in required.");
      const { error: insertError } = await db.from("delivery_incidents").insert({
        delivery_id: job.id,
        category: incidentCategory[job.id] ?? "other",
        description,
        opened_by: user.user.id,
      });
      if (insertError) throw insertError;
      setNotice(`Incident reported for ${job.shipment_number}. Support will review it against the shipment record.`);
      setIncidentText(current => ({ ...current, [job.id]: "" }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The incident could not be reported.");
    } finally {
      setBusy("");
    }
  }

  const active = jobs.filter(job => ["assigned", "to_pickup", "collected", "in_transit"].includes(job.status));
  const history = jobs.filter(job => !["assigned", "to_pickup", "collected", "in_transit"].includes(job.status));

  return (
    <div className="min-h-screen bg-ink-950 text-white">
      <SiteHeader />
      <main className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
        <Link href="/deliver" className="text-sm font-semibold text-brand-300 hover:text-brand-200">
          ← Delivery account
        </Link>
        <h1 className="mt-3 text-3xl font-black">Delivery jobs</h1>
        <p className="mt-2 text-sm leading-6 text-ink-300">
          Only shipments matched to your approved vehicle appear here. The customer address is shown only
          after you accept. Update each milestone as you complete it; a delivery cannot be marked complete
          without the recipient&apos;s confirmation code when one was issued.
        </p>

        {loading ? (
          <p className="mt-8 text-sm text-ink-300">Loading jobs…</p>
        ) : !signedIn ? (
          <p className="mt-8 rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-sm text-ink-300">
            <Link href="/login?next=%2Fdeliver%2Fjobs" className="font-bold text-brand-300 underline">
              Sign in
            </Link>{" "}
            to see matched delivery jobs.
          </p>
        ) : (
          <div className="mt-6 space-y-8">
            {error && <p role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-100">{error}</p>}
            {notice && <p role="status" className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-100">{notice}</p>}

            <section>
              <h2 className="text-lg font-black">Matched offers</h2>
              {offers.length === 0 ? (
                <p className="mt-2 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-ink-300">
                  No offer is open. Offers appear when a shipment matches your vehicle, routes and cargo
                  capability, and expire if not accepted.
                </p>
              ) : (
                <ul className="mt-3 space-y-3">
                  {offers.map(offer => (
                    <li key={offer.offer_id} className="rounded-2xl border border-brand-500/30 bg-brand-600/10 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="font-bold">{offer.shipment_number}</p>
                          <p className="mt-1 text-sm text-ink-200">
                            {offer.pickup_county ?? "Pickup county not recorded"} → {offer.dropoff_county ?? "Destination county not recorded"}
                          </p>
                          <p className="mt-1 text-xs text-ink-400">
                            {offer.package_count} package(s)
                            {offer.weight_kg !== null ? ` · ${offer.weight_kg} kg` : ""}
                            {offer.required_vehicle_class_code ? ` · ${offer.required_vehicle_class_code}` : ""}
                            {" · "}expires {new Date(offer.expires_at).toLocaleTimeString("en-KE")}
                          </p>
                        </div>
                        <p className="text-lg font-black">{money(offer.fee_minor)}</p>
                      </div>
                      <input
                        value={notes[offer.offer_id] ?? ""}
                        onChange={event => setNotes(current => ({ ...current, [offer.offer_id]: event.target.value }))}
                        placeholder="Reason if declining (optional)"
                        maxLength={500}
                        className="field mt-3 text-sm"
                      />
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void accept(offer)}
                          disabled={Boolean(busy)}
                          className="btn btn-primary"
                        >
                          {busy === offer.offer_id ? "Working…" : "Accept shipment"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void decline(offer)}
                          disabled={Boolean(busy)}
                          className="btn btn-secondary"
                        >
                          Decline
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h2 className="text-lg font-black">Active shipments</h2>
              {active.length === 0 ? (
                <p className="mt-2 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-ink-300">
                  No active assignment. Accepted shipments appear here with their milestones.
                </p>
              ) : (
                <ul className="mt-3 space-y-4">
                  {active.map(job => (
                    <li key={job.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="font-bold">{job.shipment_number}</p>
                          <p className="mt-1 text-sm text-ink-200">{job.dropoff_address}</p>
                          <p className="mt-1 text-xs text-ink-400">
                            {job.pickup_county ?? "—"} → {job.dropoff_county ?? "—"} · your fee {money(job.rider_fee_minor)}
                          </p>
                        </div>
                        <span className="rounded-full bg-brand-600/20 px-3 py-1 text-xs font-bold text-brand-200">
                          {job.status.replaceAll("_", " ")}
                        </span>
                      </div>

                      {events[job.id]?.length ? (
                        <ol className="mt-3 space-y-1 border-l border-white/10 pl-3 text-xs text-ink-400">
                          {events[job.id].map(event => (
                            <li key={event.id}>
                              <span className="font-bold text-ink-200">{event.status.replaceAll("_", " ")}</span>{" "}
                              {new Date(event.created_at).toLocaleString("en-KE")}
                              {event.note ? ` — ${event.note}` : ""}
                            </li>
                          ))}
                        </ol>
                      ) : null}

                      <input
                        value={notes[job.id] ?? ""}
                        onChange={event => setNotes(current => ({ ...current, [job.id]: event.target.value }))}
                        placeholder="Note for this step (optional; required for a failure)"
                        maxLength={500}
                        className="field mt-3 text-sm"
                      />

                      {job.status === "in_transit" && (
                        <input
                          value={proofCodes[job.id] ?? ""}
                          onChange={event => setProofCodes(current => ({ ...current, [job.id]: event.target.value.replace(/[^0-9]/g, "").slice(0, 4) }))}
                          inputMode="numeric"
                          placeholder="Recipient 4-digit confirmation code (if issued)"
                          maxLength={4}
                          className="field mt-2 text-sm"
                        />
                      )}

                      <div className="mt-3 flex flex-wrap gap-2">
                        {nextStatus[job.status] && (
                          <button
                            type="button"
                            onClick={() => void advance(job, nextStatus[job.status].to)}
                            disabled={Boolean(busy)}
                            className="btn btn-primary"
                          >
                            {busy === job.id ? "Saving…" : nextStatus[job.status].label}
                          </button>
                        )}
                        {["assigned", "to_pickup", "collected"].includes(job.status) && (
                          <button
                            type="button"
                            onClick={() => void fail(job)}
                            disabled={Boolean(busy) || !(notes[job.id] ?? "").trim()}
                            className="btn btn-secondary !text-red-200"
                          >
                            Report failed delivery
                          </button>
                        )}
                      </div>

                      <details className="mt-3 rounded-xl border border-white/10 bg-ink-950/40 p-3">
                        <summary className="cursor-pointer text-xs font-bold text-ink-200">
                          Report an incident (damage, delay, access problem)
                        </summary>
                        <label className="mt-3 block text-xs font-semibold text-ink-300" htmlFor={`incident-category-${job.id}`}>
                          What happened
                        </label>
                        <select
                          id={`incident-category-${job.id}`}
                          value={incidentCategory[job.id] ?? "other"}
                          onChange={event => setIncidentCategory(current => ({ ...current, [job.id]: event.target.value }))}
                          className="field mt-1 text-sm"
                        >
                          {incidentCategories.map(category => (
                            <option key={category.value} value={category.value}>
                              {category.label}
                            </option>
                          ))}
                        </select>
                        <label className="mt-2 block text-xs font-semibold text-ink-300" htmlFor={`incident-text-${job.id}`}>
                          Details (at least 10 characters)
                        </label>
                        <textarea
                          id={`incident-text-${job.id}`}
                          value={incidentText[job.id] ?? ""}
                          onChange={event => setIncidentText(current => ({ ...current, [job.id]: event.target.value }))}
                          rows={3}
                          maxLength={2000}
                          className="field mt-1 text-sm"
                        />
                        <button
                          type="button"
                          onClick={() => void reportIncident(job)}
                          disabled={Boolean(busy)}
                          className="btn btn-secondary mt-2"
                        >
                          {busy === `incident-${job.id}` ? "Reporting…" : "Submit incident report"}
                        </button>
                      </details>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h2 className="text-lg font-black">Completed and failed</h2>
              {history.length === 0 ? (
                <p className="mt-2 text-sm text-ink-400">No finished shipment yet.</p>
              ) : (
                <ul className="mt-3 space-y-2 text-sm">
                  {history.map(job => (
                    <li key={job.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 p-3">
                      <span className="text-ink-200">
                        {job.shipment_number} · {job.dropoff_county ?? "destination"}
                      </span>
                      <span className="text-xs uppercase tracking-wide text-ink-400">{job.status.replaceAll("_", " ")}</span>
                      <span className="text-ink-300">{money(job.rider_fee_minor)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-xs leading-5 text-ink-500">
                Earnings shown are the fee recorded on the shipment, not a payout. Withdrawals are requested
                separately and settle only through a verified provider result.
              </p>
            </section>
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
