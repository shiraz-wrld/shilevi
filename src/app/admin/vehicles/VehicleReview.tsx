"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Vehicle = {
  id: string;
  user_id: string;
  mode: string;
  make_model: string;
  plate_number: string;
  seat_capacity: number;
  verification_status: string;
  created_at: string;
};

export function VehicleReview({ vehicles }: { vehicles: Vehicle[] }) {
  const router = useRouter();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function review(vehicle: Vehicle, approve: boolean) {
    setBusy(vehicle.id);
    setError("");
    try {
      const db = createSupabaseBrowserClient();
      const { error: reviewError } = await db.rpc("admin_review_transport_vehicle", {
        p_vehicle_id: vehicle.id,
        p_approve: approve,
        p_note: notes[vehicle.id] ?? null,
      });
      if (reviewError) throw reviewError;
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The vehicle decision could not be saved.");
    } finally {
      setBusy("");
    }
  }

  if (vehicles.length === 0) {
    return <p className="mt-4 rounded-2xl border border-slate-800 bg-slate-900 p-6 text-sm text-slate-300">No vehicles are waiting for approval.</p>;
  }

  return (
    <div className="mt-4 space-y-3">
      {error && <p role="alert" className="rounded-2xl border border-red-800 bg-red-950/40 p-4 text-sm text-red-100">{error}</p>}
      {vehicles.map(vehicle => (
        <article key={vehicle.id} className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-bold text-slate-100">{vehicle.make_model} · {vehicle.plate_number}</h3>
              <p className="mt-1 text-sm capitalize text-slate-300">{vehicle.mode.replaceAll("_", " ")} · {vehicle.seat_capacity} seats</p>
              <p className="mt-1 break-all font-mono text-xs text-slate-500">Rider {vehicle.user_id}</p>
            </div>
            <span className="rounded-full border border-amber-800 px-3 py-1 text-xs font-bold uppercase text-amber-200">Pending</span>
          </div>
          <label className="mt-4 block text-sm font-semibold text-slate-300">
            Review note
            <textarea rows={2} maxLength={1000} value={notes[vehicle.id] ?? ""} onChange={event => setNotes(current => ({ ...current, [vehicle.id]: event.target.value }))} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 font-normal text-white" placeholder="Record what evidence was checked. Required for rejection." />
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={() => void review(vehicle, true)} disabled={Boolean(busy)} className="rounded-full bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Approve vehicle</button>
            <button onClick={() => void review(vehicle, false)} disabled={Boolean(busy) || !(notes[vehicle.id] ?? "").trim()} className="rounded-full border border-red-700 px-4 py-2 text-sm font-bold text-red-200 disabled:opacity-40">Reject</button>
          </div>
        </article>
      ))}
    </div>
  );
}
