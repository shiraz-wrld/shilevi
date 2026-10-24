"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { formatMoney } from "@/lib/money";

type Mode = "motorcycle" | "car" | "tuk_tuk" | "bicycle" | "van";

type Rider = {
  rider_id: string;
  display_name: string;
  vehicle_id: string;
  mode: Mode;
  make_model: string;
  plate_number: string;
  seat_capacity: number;
  rating_average: number | string;
  rating_count: number;
};

type Ride = {
  id: string;
  ride_number: string;
  status: string;
  ride_mode: Mode;
  pickup_label: string;
  dropoff_label: string;
  proposed_fare_minor: number;
  counter_fare_minor: number | null;
  agreed_fare_minor: number | null;
  commission_minor: number;
  rider_net_minor: number;
  payment_status: string;
  payment_provider: string | null;
  created_at: string;
};

const MODES: { value: Mode; label: string }[] = [
  { value: "motorcycle", label: "Motorcycle" },
  { value: "car", label: "Car" },
  { value: "tuk_tuk", label: "Tuk-tuk" },
  { value: "bicycle", label: "Bicycle" },
  { value: "van", label: "Van" },
];

const STATUS: Record<string, { label: string; tone: string }> = {
  requested: { label: "Awaiting rider response", tone: "bg-amber-50 text-amber-900 border-amber-200" },
  countered: { label: "Counteroffer received", tone: "bg-blue-50 text-blue-900 border-blue-200" },
  agreed: { label: "Fare agreed — payment due", tone: "bg-indigo-50 text-indigo-900 border-indigo-200" },
  paid: { label: "Paid — rider assigned", tone: "bg-emerald-50 text-emerald-900 border-emerald-200" },
  arrived: { label: "Rider has arrived", tone: "bg-emerald-50 text-emerald-900 border-emerald-200" },
  in_progress: { label: "Trip in progress", tone: "bg-emerald-50 text-emerald-900 border-emerald-200" },
  rider_completed: { label: "Confirm your trip", tone: "bg-amber-50 text-amber-900 border-amber-200" },
  completed: { label: "Completed", tone: "bg-slate-100 text-slate-700 border-slate-200" },
  cancelled: { label: "Cancelled", tone: "bg-slate-100 text-slate-600 border-slate-200" },
};

function shillings(value: number): string {
  return formatMoney(value, "KES");
}

export function TransportClient() {
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<Mode>("motorcycle");
  const [pickup, setPickup] = useState("");
  const [dropoff, setDropoff] = useState("");
  const [fare, setFare] = useState("2000");
  const [riders, setRiders] = useState<Rider[]>([]);
  const [selectedRider, setSelectedRider] = useState("");
  const [rides, setRides] = useState<Ride[]>([]);
  const [reviewedRideIds, setReviewedRideIds] = useState<Set<string>>(new Set());
  const [paymentMode, setPaymentMode] = useState("mock");
  const [phone, setPhone] = useState("");
  const [ratings, setRatings] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [contacts, setContacts] = useState<Record<string, { display_name: string | null; phone: string | null }>>({});

  const loadRides = useCallback(async (id: string) => {
    const db = createSupabaseBrowserClient();
    const { data, error: rideError } = await db
      .from("rides")
      .select("id,ride_number,status,ride_mode,pickup_label,dropoff_label,proposed_fare_minor,counter_fare_minor,agreed_fare_minor,commission_minor,rider_net_minor,payment_status,payment_provider,created_at")
      .eq("customer_id", id)
      .order("created_at", { ascending: false })
      .limit(20);
    if (rideError) throw rideError;
    setRides((data ?? []) as Ride[]);

    const { data: reviews } = await db.from("ride_reviews").select("ride_id").eq("customer_id", id);
    setReviewedRideIds(new Set(((reviews ?? []) as { ride_id: string }[]).map(row => row.ride_id)));
  }, []);

  const loadRiders = useCallback(async (nextMode: Mode) => {
    const db = createSupabaseBrowserClient();
    const { data, error: riderError } = await db.rpc("list_available_riders", { p_mode: nextMode });
    if (riderError) throw riderError;
    const rows = (data ?? []) as Rider[];
    setRiders(rows);
    setSelectedRider(current => (rows.some(row => row.rider_id === current) ? current : rows[0]?.rider_id ?? ""));
  }, []);

  useEffect(() => {
    let active = true;
    async function boot() {
      try {
        const db = createSupabaseBrowserClient();
        const { data: settings } = await db.rpc("get_checkout_settings");
        if (active && settings && typeof settings === "object" && "payment_mode" in settings) {
          setPaymentMode(String((settings as { payment_mode: string }).payment_mode ?? "mock"));
        }
        const { data: auth } = await db.auth.getUser();
        if (!active) return;
        if (!auth.user) {
          setLoading(false);
          return;
        }
        setUserId(auth.user.id);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "We could not load transport data. Confirm migrations 0020–0021 have been applied.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void boot();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!userId) return;
    loadRides(userId).catch(cause => setError(cause instanceof Error ? cause.message : "Could not load your trips."));
  }, [userId, loadRides]);

  useEffect(() => {
    if (!userId) return;
    loadRiders(mode).catch(cause => setError(cause instanceof Error ? cause.message : "Could not load available riders."));
  }, [mode, userId, loadRiders]);

  async function refresh() {
    if (!userId) return;
    await loadRides(userId);
  }

  async function requestRide(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    if (!userId) {
      setError("Sign in to request a trip.");
      return;
    }
    if (!selectedRider) {
      setError("Choose an available transport partner. If none is listed, no approved vehicle is available for this mode.");
      return;
    }
    const proposedMinor = Math.round(Number(fare) * 100);
    if (!Number.isFinite(proposedMinor) || proposedMinor < 1000) {
      setError("Propose a fare of at least KSh 10.");
      return;
    }
    setBusy("request");
    try {
      const db = createSupabaseBrowserClient();
      const { error: requestError } = await db.rpc("request_ride", {
        p_payload: {
          rider_id: selectedRider,
          ride_mode: mode,
          pickup_label: pickup.trim(),
          dropoff_label: dropoff.trim(),
          proposed_fare_minor: proposedMinor,
        },
      });
      if (requestError) throw requestError;
      setMessage("Trip requested. The transport partner can accept, counter or decline your fare.");
      setPickup("");
      setDropoff("");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The trip could not be requested.");
    } finally {
      setBusy("");
    }
  }

  async function act(ride: Ride, action: "accept_counter" | "decline_counter" | "cancel" | "confirm" | "rate" | "contact" | "pay_mock" | "pay_mpesa") {
    setBusy(`${ride.id}:${action}`);
    setError("");
    setMessage("");
    try {
      const db = createSupabaseBrowserClient();
      if (action === "accept_counter" || action === "decline_counter") {
        const { error: responseError } = await db.rpc("ride_customer_respond", {
          p_ride_id: ride.id,
          p_accept: action === "accept_counter",
        });
        if (responseError) throw responseError;
        setMessage(action === "accept_counter" ? "Counteroffer accepted. Pay to confirm the trip." : "Counteroffer declined.");
      } else if (action === "cancel") {
        const { error: cancelError } = await db.rpc("cancel_ride", { p_ride_id: ride.id, p_reason: "Cancelled by customer" });
        if (cancelError) throw cancelError;
        setMessage("Trip cancelled before payment.");
      } else if (action === "confirm") {
        const { error: confirmError } = await db.rpc("ride_customer_confirm", { p_ride_id: ride.id });
        if (confirmError) throw confirmError;
        setMessage("Trip confirmed. Thank you.");
      } else if (action === "rate") {
        const rating = Number(ratings[ride.id] ?? 5);
        const { error: rateError } = await db.rpc("rate_ride", { p_ride_id: ride.id, p_rating: rating, p_comment: null });
        if (rateError) throw rateError;
        setMessage("Rating saved.");
      } else if (action === "contact") {
        const { data, error: contactError } = await db.rpc("get_ride_contact", { p_ride_id: ride.id });
        if (contactError) throw contactError;
        const row = Array.isArray(data) ? data[0] : data;
        if (row) setContacts(current => ({ ...current, [ride.id]: { display_name: row.display_name, phone: row.phone } }));
      } else if (action === "pay_mock") {
        const { error: payError } = await db.rpc("confirm_mock_ride_payment", { p_ride_id: ride.id, p_reference: null });
        if (payError) throw payError;
        setMessage("Sandbox payment recorded. No real money moved.");
      } else {
        if (!phone.trim()) throw new Error("Enter the M-Pesa phone number to charge.");
        const response = await fetch("/api/payments/mpesa/initiate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ purpose: "ride", targetId: ride.id, phone: phone.trim(), idempotencyKey: `ride-${ride.id}` }),
        });
        const payload = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
        if (!response.ok) throw new Error(payload.error ?? "The M-Pesa request could not be started.");
        setMessage(payload.message ?? "Check your phone and enter your M-Pesa PIN.");
      }
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That action could not be completed.");
    } finally {
      setBusy("");
    }
  }

  const selected = useMemo(() => riders.find(rider => rider.rider_id === selectedRider) ?? null, [riders, selectedRider]);

  return (
    <section id="book" className="mx-auto max-w-7xl scroll-mt-8 px-5 py-12 sm:px-6">
      <div className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-2xl font-black tracking-tight">Request a trip</h2>
            <span className={`rounded-full border px-3 py-1 text-xs font-bold ${paymentMode === "mock" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`}>
              {paymentMode === "mock" ? "Sandbox payments" : "M-Pesa enabled"}
            </span>
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            The fare is a proposal until the rider accepts or counteroffers and you accept the final amount.
          </p>

          {!userId && !loading ? (
            <div className="mt-6 rounded-2xl border border-blue-200 bg-blue-50 p-5">
              <p className="font-bold text-blue-950">Sign in to book and pay</p>
              <p className="mt-1 text-sm leading-6 text-blue-900">Browsing is open to everyone. Requesting a trip needs an account so both sides can confirm it.</p>
              <Link href="/login?next=%2Ftransport" className="mt-3 inline-flex rounded-full bg-blue-700 px-5 py-2 text-sm font-bold text-white">Sign in</Link>
            </div>
          ) : (
            <form onSubmit={requestRide} className="mt-6 space-y-5">
              <fieldset>
                <legend className="text-sm font-bold">Transport mode</legend>
                <div className="mt-2 flex flex-wrap gap-2">
                  {MODES.map(item => (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => setMode(item.value)}
                      aria-pressed={mode === item.value}
                      className={`rounded-full border px-4 py-2 text-sm font-semibold ${mode === item.value ? "border-blue-700 bg-blue-700 text-white" : "border-slate-300 text-slate-700 hover:border-slate-400"}`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </fieldset>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm font-bold">
                  Pickup
                  <input required minLength={3} maxLength={300} value={pickup} onChange={event => setPickup(event.target.value)} placeholder="e.g. Kenyatta Avenue, Nairobi CBD" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal outline-none focus:border-blue-600" />
                </label>
                <label className="block text-sm font-bold">
                  Destination
                  <input required minLength={3} maxLength={300} value={dropoff} onChange={event => setDropoff(event.target.value)} placeholder="e.g. Mlolongo, Machakos" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal outline-none focus:border-blue-600" />
                </label>
              </div>

              <label className="block text-sm font-bold">
                Your fare proposal (KSh)
                <input required type="number" min={10} max={100000} step={1} value={fare} onChange={event => setFare(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal outline-none focus:border-blue-600" />
                <span className="mt-1 block text-xs font-normal text-slate-500">The rider can accept, counter or decline. Nothing is charged until you accept the final fare.</span>
              </label>

              <fieldset>
                <legend className="text-sm font-bold">Available transport partners</legend>
                {riders.length === 0 ? (
                  <p className="mt-2 rounded-xl border border-dashed border-slate-300 p-4 text-sm leading-6 text-slate-600">
                    No approved, active vehicle is listed for this mode right now. We do not show invented riders.
                  </p>
                ) : (
                  <div className="mt-2 space-y-2">
                    {riders.map(rider => (
                      <label key={rider.vehicle_id} className={`flex cursor-pointer gap-3 rounded-2xl border p-4 ${selectedRider === rider.rider_id ? "border-blue-600 bg-blue-50" : "border-slate-200"}`}>
                        <input type="radio" name="rider" checked={selectedRider === rider.rider_id} onChange={() => setSelectedRider(rider.rider_id)} className="mt-1 accent-blue-700" />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-bold">{rider.display_name}</span>
                            <span className="text-sm font-semibold text-slate-600">
                              {Number(rider.rating_average) > 0 ? `${Number(rider.rating_average).toFixed(1)} ★ (${rider.rating_count})` : "New partner"}
                            </span>
                          </span>
                          <span className="mt-1 block text-sm text-slate-600">{rider.make_model} · {rider.plate_number} · {rider.seat_capacity} seat{rider.seat_capacity === 1 ? "" : "s"}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </fieldset>

              <button disabled={busy === "request" || !userId || riders.length === 0} className="w-full rounded-xl bg-blue-700 px-5 py-3 font-bold text-white hover:bg-blue-800 disabled:opacity-50">
                {busy === "request" ? "Requesting…" : selected ? `Request with ${selected.display_name}` : "Request trip"}
              </button>
            </form>
          )}

          {message && <p role="status" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">{message}</p>}
          {error && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
        </div>

        <div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-2xl font-black tracking-tight">Your trips</h2>
            {userId && <button onClick={() => void refresh()} className="rounded-full border border-slate-300 px-4 py-2 text-sm font-bold">Refresh</button>}
          </div>
          {loading ? (
            <p className="mt-4 rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">Loading your trips…</p>
          ) : rides.length === 0 ? (
            <p className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm leading-6 text-slate-600">
              No trips yet. Once you request one, its fare negotiation, payment and completion status appear here.
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              {rides.map(ride => {
                const status = STATUS[ride.status] ?? { label: ride.status.replaceAll("_", " "), tone: "bg-slate-100 text-slate-700 border-slate-200" };
                const contact = contacts[ride.id];
                return (
                  <article key={ride.id} className="rounded-2xl border border-slate-200 bg-white p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{ride.ride_number}</p>
                        <p className="mt-1 font-bold">{ride.pickup_label} → {ride.dropoff_label}</p>
                        <p className="mt-1 text-sm capitalize text-slate-600">{ride.ride_mode.replaceAll("_", " ")} · proposed {shillings(ride.proposed_fare_minor)}</p>
                      </div>
                      <span className={`rounded-full border px-3 py-1 text-xs font-bold ${status.tone}`}>{status.label}</span>
                    </div>

                    {ride.agreed_fare_minor ? (
                      <dl className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-3 text-sm">
                        <div><dt className="text-slate-500">Agreed fare</dt><dd className="font-bold">{shillings(ride.agreed_fare_minor)}</dd></div>
                        <div><dt className="text-slate-500">{ride.payment_status === "paid" ? "Rider receives" : "Platform fee (10%)"}</dt><dd className="font-bold">{ride.payment_status === "paid" ? shillings(ride.rider_net_minor) : shillings(Math.floor(ride.agreed_fare_minor * 0.1))}</dd></div>
                      </dl>
                    ) : ride.status === "countered" && ride.counter_fare_minor ? (
                      <p className="mt-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950">
                        Rider countered with <strong>{shillings(ride.counter_fare_minor)}</strong>. Accepting sets the final fare.
                      </p>
                    ) : null}

                    <div className="mt-4 flex flex-wrap gap-2">
                      {ride.status === "countered" && (
                        <>
                          <button onClick={() => void act(ride, "accept_counter")} disabled={Boolean(busy)} className="rounded-full bg-blue-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Accept counter</button>
                          <button onClick={() => void act(ride, "decline_counter")} disabled={Boolean(busy)} className="rounded-full border border-slate-300 px-4 py-2 text-sm font-bold disabled:opacity-50">Decline</button>
                        </>
                      )}
                      {ride.status === "agreed" && paymentMode === "mock" && (
                        <button onClick={() => void act(ride, "pay_mock")} disabled={Boolean(busy)} className="rounded-full bg-emerald-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Pay in sandbox</button>
                      )}
                      {ride.status === "agreed" && paymentMode !== "mock" && (
                        <div className="flex w-full flex-wrap items-end gap-2">
                          <label className="min-w-40 flex-1 text-xs font-bold text-slate-600">
                            M-Pesa phone
                            <input value={phone} onChange={event => setPhone(event.target.value)} placeholder="0712 345 678" inputMode="tel" className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 font-normal text-slate-900" />
                          </label>
                          <button onClick={() => void act(ride, "pay_mpesa")} disabled={Boolean(busy)} className="rounded-full bg-emerald-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Pay with M-Pesa</button>
                        </div>
                      )}
                      {["requested", "countered", "agreed"].includes(ride.status) && (
                        <button onClick={() => void act(ride, "cancel")} disabled={Boolean(busy)} className="rounded-full border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 disabled:opacity-50">Cancel</button>
                      )}
                      {["paid", "arrived", "in_progress", "rider_completed", "completed"].includes(ride.status) && (
                        <button onClick={() => void act(ride, "contact")} disabled={Boolean(busy)} className="rounded-full border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 disabled:opacity-50">Show rider contact</button>
                      )}
                      {contact && (
                        <a href={`tel:${contact.phone ?? ""}`} className="rounded-full border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-bold text-emerald-900">
                          {contact.display_name ?? "Rider"} · {contact.phone ?? "No phone on file"}
                        </a>
                      )}
                      {ride.status === "rider_completed" && (
                        <button onClick={() => void act(ride, "confirm")} disabled={Boolean(busy)} className="rounded-full bg-blue-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Confirm trip completed</button>
                      )}
                      {ride.status === "completed" && !reviewedRideIds.has(ride.id) && (
                        <div className="flex items-end gap-2">
                          <label className="text-xs font-bold text-slate-600">
                            Rating
                            <select value={ratings[ride.id] ?? "5"} onChange={event => setRatings(current => ({ ...current, [ride.id]: event.target.value }))} className="mt-1 block rounded-xl border border-slate-300 px-3 py-2 font-normal">
                              {["5", "4", "3", "2", "1"].map(value => <option key={value} value={value}>{value} ★</option>)}
                            </select>
                          </label>
                          <button onClick={() => void act(ride, "rate")} disabled={Boolean(busy)} className="rounded-full border border-slate-300 px-4 py-2 text-sm font-bold disabled:opacity-50">Submit rating</button>
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
