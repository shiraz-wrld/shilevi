"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { formatMoney } from "@/lib/money";

type Mode = "motorcycle" | "car" | "tuk_tuk" | "bicycle" | "van";
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
  rider_net_minor: number;
  payment_status: string;
  created_at: string;
};
type Vehicle = {
  id: string;
  mode: Mode;
  make_model: string;
  plate_number: string;
  seat_capacity: number;
  verification_status: string;
  is_active: boolean;
};
type Payout = { id: string; amount_minor: number; status: string; created_at: string; reference: string | null };

const MODES: { value: Mode; label: string }[] = [
  { value: "motorcycle", label: "Motorcycle" },
  { value: "car", label: "Car" },
  { value: "tuk_tuk", label: "Tuk-tuk" },
  { value: "bicycle", label: "Bicycle" },
  { value: "van", label: "Van" },
];

const NEXT: Record<string, { status: string; label: string }> = {
  paid: { status: "arrived", label: "I have arrived" },
  arrived: { status: "in_progress", label: "Start trip" },
  in_progress: { status: "rider_completed", label: "Complete trip" },
};

export default function RiderRidesPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [rides, setRides] = useState<Ride[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [counters, setCounters] = useState<Record<string, string>>({});
  const [contacts, setContacts] = useState<Record<string, { display_name: string | null; phone: string | null }>>({});
  const [phone, setPhone] = useState("");
  const [withdraw, setWithdraw] = useState("");
  const [vehicle, setVehicle] = useState({ mode: "motorcycle" as Mode, make_model: "", plate_number: "", seat_capacity: "1" });

  const load = useCallback(async (id: string) => {
    const db = createSupabaseBrowserClient();
    const [rideResult, vehicleResult, payoutResult, balanceResult] = await Promise.all([
      db.from("rides")
        .select("id,ride_number,status,ride_mode,pickup_label,dropoff_label,proposed_fare_minor,counter_fare_minor,agreed_fare_minor,rider_net_minor,payment_status,created_at")
        .eq("rider_id", id).order("created_at", { ascending: false }).limit(30),
      db.from("transport_vehicles")
        .select("id,mode,make_model,plate_number,seat_capacity,verification_status,is_active")
        .eq("user_id", id).order("created_at", { ascending: true }),
      db.from("payouts").select("id,amount_minor,status,created_at,reference").eq("payee_id", id).order("created_at", { ascending: false }).limit(20),
      db.rpc("rider_available_balance", { p_rider_id: id }),
    ]);
    if (rideResult.error) throw rideResult.error;
    if (vehicleResult.error) throw vehicleResult.error;
    if (payoutResult.error) throw payoutResult.error;
    if (balanceResult.error) throw balanceResult.error;
    setRides((rideResult.data ?? []) as Ride[]);
    setVehicles((vehicleResult.data ?? []) as Vehicle[]);
    setPayouts((payoutResult.data ?? []) as Payout[]);
    setBalance(Number(balanceResult.data ?? 0));
  }, []);

  useEffect(() => {
    let active = true;
    async function boot() {
      try {
        const db = createSupabaseBrowserClient();
        const { data: auth } = await db.auth.getUser();
        if (!active) return;
        if (!auth.user) {
          window.location.replace("/login?next=%2Frider%2Frides");
          return;
        }
        setUserId(auth.user.id);
        await load(auth.user.id);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Could not load rider data. Confirm migrations 0020–0021 are applied.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void boot();
    return () => { active = false; };
  }, [load]);

  async function run(key: string, action: () => Promise<void>) {
    setBusy(key);
    setError("");
    setMessage("");
    try {
      await action();
      if (userId) await load(userId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That action could not be completed.");
    } finally {
      setBusy("");
    }
  }

  async function respond(ride: Ride, action: "accept" | "counter" | "decline") {
    await run(`${ride.id}:${action}`, async () => {
      const db = createSupabaseBrowserClient();
      const counter = Math.round(Number(counters[ride.id] ?? 0) * 100);
      if (action === "counter" && (!Number.isFinite(counter) || counter < 1000)) throw new Error("Enter a counter fare of at least KSh 10.");
      const { error: respondError } = await db.rpc("ride_respond", {
        p_ride_id: ride.id,
        p_action: action,
        p_counter_fare_minor: action === "counter" ? counter : null,
        p_note: null,
      });
      if (respondError) throw respondError;
      setMessage(action === "accept" ? "Fare accepted. The customer must pay before the trip starts." : action === "counter" ? "Counteroffer sent." : "Request declined.");
    });
  }

  async function advance(ride: Ride) {
    const next = NEXT[ride.status];
    if (!next) return;
    await run(`${ride.id}:next`, async () => {
      const db = createSupabaseBrowserClient();
      const { error: progressError } = await db.rpc("ride_rider_progress", { p_ride_id: ride.id, p_to_status: next.status });
      if (progressError) throw progressError;
      setMessage(next.status === "rider_completed" ? "Trip completed. Earnings are released after the customer confirms." : "Trip status updated.");
    });
  }

  async function showContact(ride: Ride) {
    await run(`${ride.id}:contact`, async () => {
      const db = createSupabaseBrowserClient();
      const { data, error: contactError } = await db.rpc("get_ride_contact", { p_ride_id: ride.id });
      if (contactError) throw contactError;
      const row = Array.isArray(data) ? data[0] : data;
      if (row) setContacts(current => ({ ...current, [ride.id]: { display_name: row.display_name, phone: row.phone } }));
    });
  }

  async function addVehicle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run("vehicle:add", async () => {
      const db = createSupabaseBrowserClient();
      const { error: addError } = await db.rpc("add_transport_vehicle", {
        p_mode: vehicle.mode,
        p_make_model: vehicle.make_model.trim(),
        p_plate_number: vehicle.plate_number.trim(),
        p_seat_capacity: Math.max(1, Number(vehicle.seat_capacity) || 1),
      });
      if (addError) throw addError;
      setVehicle({ mode: vehicle.mode, make_model: "", plate_number: "", seat_capacity: "1" });
      setMessage("Vehicle submitted for verification. You cannot accept passenger trips with it until an owner approves it.");
    });
  }

  async function toggleVehicle(item: Vehicle) {
    await run(`${item.id}:toggle`, async () => {
      const db = createSupabaseBrowserClient();
      const { error: toggleError } = await db.rpc("set_transport_vehicle_active", { p_vehicle_id: item.id, p_active: !item.is_active });
      if (toggleError) throw toggleError;
      setMessage(item.is_active ? "Vehicle set offline." : "Vehicle set online.");
    });
  }

  async function requestPayout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run("payout", async () => {
      const db = createSupabaseBrowserClient();
      const amount = Math.round(Number(withdraw) * 100);
      if (!Number.isFinite(amount) || amount < 10000) throw new Error("The minimum withdrawal is KSh 100.");
      const { error: payoutError } = await db.rpc("request_rider_payout", { p_amount_minor: amount, p_phone: phone.trim() });
      if (payoutError) throw payoutError;
      setWithdraw("");
      setMessage("Withdrawal requested. It stays pending until it is processed and confirmed by the payout provider.");
    });
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-4">
          <Link href="/" className="text-2xl font-black text-blue-700">shilevi</Link>
          <nav className="flex flex-wrap gap-4 text-sm font-semibold text-blue-700">
            <Link href="/rider/rides">Passenger trips</Link>
            <Link href="/rider/jobs">Delivery jobs</Link>
            <Link href="/rider">Workspace</Link>
            <Link href="/account">Account</Link>
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-5 py-10">
        <p className="text-sm font-bold uppercase tracking-widest text-blue-700">Transport partner</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Passenger trips</h1>
        <p className="mt-3 max-w-2xl leading-7 text-slate-600">
          Accept, counter or decline a proposed fare. Never start a paid trip until the customer&apos;s payment is confirmed.
          Earnings become available after both sides confirm completion.
        </p>

        {message && <p role="status" className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">{message}</p>}
        {error && <p role="alert" className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
        {loading && <p className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">Loading rider workspace…</p>}

        {!loading && (
          <>
            <section className="mt-8">
              <h2 className="text-2xl font-black">Requests and active trips</h2>
              {rides.length === 0 ? (
                <p className="mt-3 rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm leading-6 text-slate-600">
                  No passenger requests yet. Customers choose you from the approved partners for your vehicle mode.
                </p>
              ) : (
                <div className="mt-4 space-y-3">
                  {rides.map(ride => {
                    const next = NEXT[ride.status];
                    const contact = contacts[ride.id];
                    return (
                      <article key={ride.id} className="rounded-2xl border border-slate-200 bg-white p-5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{ride.ride_number} · {ride.ride_mode.replaceAll("_", " ")}</p>
                            <p className="mt-1 font-bold">{ride.pickup_label} → {ride.dropoff_label}</p>
                            <p className="mt-1 text-sm text-slate-600">
                              Proposed {formatMoney(ride.proposed_fare_minor, "KES")}
                              {ride.agreed_fare_minor ? ` · agreed ${formatMoney(ride.agreed_fare_minor, "KES")} · you receive ${formatMoney(ride.rider_net_minor, "KES")}` : ""}
                            </p>
                          </div>
                          <span className="rounded-full border border-slate-300 px-3 py-1 text-xs font-bold capitalize text-slate-700">{ride.status.replaceAll("_", " ")}</span>
                        </div>

                        {ride.status === "requested" && (
                          <div className="mt-4 flex flex-wrap items-end gap-2">
                            <button onClick={() => void respond(ride, "accept")} disabled={Boolean(busy)} className="rounded-full bg-blue-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Accept fare</button>
                            <button onClick={() => void respond(ride, "decline")} disabled={Boolean(busy)} className="rounded-full border border-slate-300 px-4 py-2 text-sm font-bold disabled:opacity-50">Decline</button>
                            <label className="text-xs font-bold text-slate-600">
                              Counter (KSh)
                              <input type="number" min={10} value={counters[ride.id] ?? ""} onChange={event => setCounters(current => ({ ...current, [ride.id]: event.target.value }))} className="mt-1 block w-32 rounded-xl border border-slate-300 px-3 py-2 font-normal" />
                            </label>
                            <button onClick={() => void respond(ride, "counter")} disabled={Boolean(busy)} className="rounded-full border border-slate-300 px-4 py-2 text-sm font-bold disabled:opacity-50">Send counter</button>
                          </div>
                        )}

                        <div className="mt-4 flex flex-wrap gap-2">
                          {next && <button onClick={() => void advance(ride)} disabled={Boolean(busy)} className="rounded-full bg-blue-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{next.label}</button>}
                          {["paid", "arrived", "in_progress", "rider_completed", "completed"].includes(ride.status) && (
                            <button onClick={() => void showContact(ride)} disabled={Boolean(busy)} className="rounded-full border border-slate-300 px-4 py-2 text-sm font-bold disabled:opacity-50">Customer contact</button>
                          )}
                          {contact && (
                            <a href={`tel:${contact.phone ?? ""}`} className="rounded-full border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-bold text-emerald-900">
                              {contact.display_name ?? "Customer"} · {contact.phone ?? "No phone on file"}
                            </a>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>

            <div className="mt-10 grid gap-6 lg:grid-cols-2">
              <section className="rounded-2xl border border-slate-200 bg-white p-6">
                <h2 className="text-xl font-black">Vehicles</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">Only owner-verified, active vehicles can receive passenger requests. A vehicle starts pending.</p>
                <ul className="mt-4 space-y-2">
                  {vehicles.length === 0 ? <li className="text-sm text-slate-500">No vehicles yet.</li> : vehicles.map(item => (
                    <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 p-3 text-sm">
                      <span><strong>{item.make_model}</strong> · {item.plate_number} · {item.mode.replaceAll("_", " ")} · {item.seat_capacity} seats</span>
                      <span className="flex items-center gap-2">
                        <span className={`rounded-full px-2 py-1 text-xs font-bold ${item.verification_status === "approved" ? "bg-emerald-50 text-emerald-800" : item.verification_status === "rejected" ? "bg-red-50 text-red-800" : "bg-amber-50 text-amber-800"}`}>{item.verification_status}</span>
                        <button onClick={() => void toggleVehicle(item)} disabled={Boolean(busy) || item.verification_status !== "approved"} className="rounded-full border border-slate-300 px-3 py-1 text-xs font-bold disabled:opacity-40">{item.is_active ? "Go offline" : "Go online"}</button>
                      </span>
                    </li>
                  ))}
                </ul>
                <form onSubmit={addVehicle} className="mt-5 space-y-3 border-t border-slate-200 pt-4">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <select value={vehicle.mode} onChange={event => setVehicle(current => ({ ...current, mode: event.target.value as Mode }))} className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
                      {MODES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
                    </select>
                    <input required maxLength={120} value={vehicle.make_model} onChange={event => setVehicle(current => ({ ...current, make_model: event.target.value }))} placeholder="Make and model" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                    <input required maxLength={24} value={vehicle.plate_number} onChange={event => setVehicle(current => ({ ...current, plate_number: event.target.value }))} placeholder="Plate or identifier" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                    <input required type="number" min={1} max={60} value={vehicle.seat_capacity} onChange={event => setVehicle(current => ({ ...current, seat_capacity: event.target.value }))} placeholder="Seats" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                  </div>
                  <button disabled={busy === "vehicle:add"} className="rounded-full bg-blue-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{busy === "vehicle:add" ? "Submitting…" : "Add vehicle for verification"}</button>
                </form>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-6">
                <h2 className="text-xl font-black">Earnings</h2>
                <p className="mt-2 text-sm text-slate-600">Available to withdraw</p>
                <p className="mt-1 text-3xl font-black">{formatMoney(balance, "KES")}</p>
                <p className="mt-2 text-xs leading-5 text-slate-500">Only completed trips count. Pending withdrawals are reserved until paid or failed.</p>

                <form onSubmit={requestPayout} className="mt-4 grid gap-2 sm:grid-cols-2">
                  <label className="text-xs font-bold text-slate-600">Amount (KSh)<input type="number" min={100} value={withdraw} onChange={event => setWithdraw(event.target.value)} className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2 font-normal" /></label>
                  <label className="text-xs font-bold text-slate-600">M-Pesa phone<input value={phone} onChange={event => setPhone(event.target.value)} placeholder="0712 345 678" inputMode="tel" className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2 font-normal" /></label>
                  <button disabled={busy === "payout" || balance < 10000} className="rounded-full bg-blue-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50 sm:col-span-2">{busy === "payout" ? "Requesting…" : "Request withdrawal"}</button>
                </form>

                <h3 className="mt-6 text-sm font-bold uppercase tracking-wide text-slate-500">Withdrawal history</h3>
                {payouts.length === 0 ? <p className="mt-2 text-sm text-slate-500">No withdrawals yet.</p> : (
                  <ul className="mt-2 space-y-2 text-sm">
                    {payouts.map(payout => (
                      <li key={payout.id} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 p-3">
                        <span>{formatMoney(payout.amount_minor, "KES")} · {new Date(payout.created_at).toLocaleDateString()}</span>
                        <span className="font-bold capitalize">{payout.status}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-4 text-xs leading-5 text-slate-500">A withdrawal is only marked paid after the configured payout provider confirms it. If payouts are not configured, requests remain pending and no money is sent.</p>
              </section>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
