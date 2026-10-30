import "server-only";

import type { Metadata } from "next";
import Link from "next/link";
import { requireStaffCapability } from "@/lib/admin/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AdminShell } from "@/components/admin/AdminShell";
import { formatMoney } from "@/lib/money";

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

export default async function AdminRidesPage() {
  const result = await requireStaffCapability("rides.manage");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("rides")
    .select(
      "id,ride_number,status,ride_mode,pickup_label,dropoff_label,proposed_fare_minor,agreed_fare_minor,payment_status,payment_provider,created_at",
    )
    .order("created_at", { ascending: false })
    .limit(100);

  const rides = (data ?? []) as Ride[];

  return (
    <AdminShell
      email={result.user.email ?? null}
      mfaLevel={result.mfaLevel}
      title="Passenger transport"
      description="Owner oversight of passenger trips. A ride is a separate entity from a delivery; do not resolve a passenger dispute using delivery rules. Vehicle approval lives in its own queue."
    >
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm leading-6 text-slate-400">
          Fares, commission and rider net are snapshotted on the trip when it is agreed.
        </p>
        <Link href="/admin/vehicles" className="rounded-xl border border-slate-600 px-4 py-2 text-sm font-bold text-slate-100 hover:border-slate-400">
          Vehicle approval →
        </Link>
      </div>

      {error ? (
        <p role="alert" className="rounded-2xl border border-amber-800 bg-amber-950/40 p-5 text-sm leading-6 text-amber-100">
          Trips could not be read. Nothing was changed. Reload once; if it persists, System health reports whether the cause is a missing migration, an MFA session or a missing capability.</p>
      ) : rides.length === 0 ? (
        <p className="rounded-2xl border border-slate-800 bg-slate-900 p-6 text-sm leading-6 text-slate-300">
          No passenger trips recorded yet. This is a true zero, not missing data.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900">
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
                  <td className="whitespace-nowrap px-4 py-3 font-semibold text-slate-100">
                    {ride.ride_number}
                    <span className="block text-xs font-normal text-slate-500">
                      {new Date(ride.created_at).toLocaleString("en-KE")}
                    </span>
                  </td>
                  <td className="max-w-xs px-4 py-3 text-slate-300">{ride.pickup_label} → {ride.dropoff_label}</td>
                  <td className="px-4 py-3 capitalize text-slate-300">{ride.ride_mode.replaceAll("_", " ")}</td>
                  <td className="px-4 py-3 text-slate-300">
                    {ride.payment_status}
                    {ride.payment_provider ? ` · ${ride.payment_provider}` : ""}
                  </td>
                  <td className="px-4 py-3 capitalize text-slate-300">{ride.status.replaceAll("_", " ")}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-100">
                    {formatMoney(ride.agreed_fare_minor ?? ride.proposed_fare_minor, "KES")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-4 text-xs leading-6 text-slate-500">
        Showing the most recent 100 trips. Exact pickup coordinates stay with the participants; this
        view shows the agreed area labels only.
      </p>
    </AdminShell>
  );
}
