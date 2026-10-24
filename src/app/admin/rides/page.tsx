import "server-only";

import type { Metadata } from "next";
import { requireStaffCapability } from "@/lib/admin/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AdminAccessDenied, AdminShell } from "@/components/admin/AdminShell";
import { formatMoney } from "@/lib/money";
import { VehicleReview } from "./VehicleReview";

export const metadata: Metadata = {
  title: "Passenger transport",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

type Ride = {
  id: string;
  ride_number: string;
  status: string;
  ride_mode: string;
  pickup_label: string;
  dropoff_label: string;
  proposed_fare_minor: number;
  agreed_fare_minor: number | null;
  payment_status: string;
  payment_provider: string | null;
  created_at: string;
};

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

export default async function AdminRidesPage() {
  const result = await requireStaffCapability("rides.manage");
  if (!result.authorized) return <AdminAccessDenied reason={result.reason} />;

  const supabase = await createSupabaseServerClient();
  const [ridesResult, vehiclesResult] = await Promise.all([
    supabase.from("rides")
      .select("id,ride_number,status,ride_mode,pickup_label,dropoff_label,proposed_fare_minor,agreed_fare_minor,payment_status,payment_provider,created_at")
      .order("created_at", { ascending: false }).limit(100),
    supabase.from("transport_vehicles")
      .select("id,user_id,mode,make_model,plate_number,seat_capacity,verification_status,created_at")
      .eq("verification_status", "pending").order("created_at", { ascending: true }).limit(50),
  ]);

  const rides = (ridesResult.data ?? []) as Ride[];
  const vehicles = (vehiclesResult.data ?? []) as Vehicle[];

  return (
    <AdminShell
      email={result.user.email ?? null}
      mfaLevel={result.mfaLevel}
      title="Passenger transport"
      description="Owner oversight of passenger trips and vehicle approval. A ride is a separate entity from a delivery; do not resolve a passenger dispute using delivery rules."
    >
      <section>
        <h2 className="text-xl font-black">Vehicles awaiting approval</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
          Approve only after checking the vehicle registration, licence and insurance evidence through the approved
          process. Approval here makes the vehicle eligible for passenger requests; it does not verify the driver.
        </p>
        {vehiclesResult.error ? (
          <p role="alert" className="mt-4 rounded-2xl border border-amber-800 bg-amber-950/40 p-5 text-sm text-amber-100">Vehicles could not be read. Apply migration 0020 and confirm your session has MFA.</p>
        ) : (
          <VehicleReview vehicles={vehicles} />
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-black">Recent trips</h2>
        {ridesResult.error ? (
          <p role="alert" className="mt-4 rounded-2xl border border-amber-800 bg-amber-950/40 p-5 text-sm text-amber-100">Trips could not be read. Apply migration 0020.</p>
        ) : rides.length === 0 ? (
          <p className="mt-4 rounded-2xl border border-slate-800 bg-slate-900 p-6 text-sm text-slate-300">No passenger trips recorded yet.</p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-800 text-xs font-bold uppercase tracking-wide text-slate-400">
                <tr>
                  <th scope="col" className="px-4 py-3">Trip</th>
                  <th scope="col" className="px-4 py-3">Route</th>
                  <th scope="col" className="px-4 py-3">Mode</th>
                  <th scope="col" className="px-4 py-3">Payment</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                  <th scope="col" className="px-4 py-3 text-right">Agreed fare</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {rides.map(ride => (
                  <tr key={ride.id}>
                    <td className="whitespace-nowrap px-4 py-3 font-semibold text-slate-100">{ride.ride_number}<span className="block text-xs font-normal text-slate-500">{new Date(ride.created_at).toLocaleString("en-KE")}</span></td>
                    <td className="max-w-xs px-4 py-3 text-slate-300">{ride.pickup_label} → {ride.dropoff_label}</td>
                    <td className="px-4 py-3 capitalize text-slate-300">{ride.ride_mode.replaceAll("_", " ")}</td>
                    <td className="px-4 py-3 text-slate-300">{ride.payment_status}{ride.payment_provider ? ` · ${ride.payment_provider}` : ""}</td>
                    <td className="px-4 py-3 capitalize text-slate-300">{ride.status.replaceAll("_", " ")}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-100">{formatMoney(ride.agreed_fare_minor ?? ride.proposed_fare_minor, "KES")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-4 text-xs leading-6 text-slate-500">Showing the most recent 100 trips. Exact pickup addresses are visible to the owner for dispute resolution; they are never included in public pages.</p>
      </section>
    </AdminShell>
  );
}
