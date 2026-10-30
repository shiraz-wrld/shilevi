import "server-only";

import type { Metadata } from "next";
import { requireStaffCapability } from "@/lib/admin/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AdminShell } from "@/components/admin/AdminShell";
import { VehicleReview } from "./VehicleReview";
import { DeliveryReview } from "./DeliveryReview";

export const metadata: Metadata = {
  title: "Vehicle approval",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

type Vehicle = {
  id: string;
  user_id: string;
  mode: string;
  make_model: string;
  plate_number: string;
  seat_capacity: number;
  verification_status: string;
  reviewer_note: string | null;
  reviewed_at: string | null;
  created_at: string;
};

const statusTone: Record<string, string> = {
  approved: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
  rejected: "border-red-500/40 bg-red-500/10 text-red-200",
  suspended: "border-amber-500/40 bg-amber-500/10 text-amber-200",
  pending: "border-slate-600 bg-slate-800 text-slate-200",
};

export default async function AdminVehiclesPage() {
  const result = await requireStaffCapability("rides.manage");

  const supabase = await createSupabaseServerClient();
  const { data: canReviewDelivery } = await supabase.rpc("has_staff_capability", {
    p_capability: "delivery.manage",
  });

  const [pendingResult, decidedResult] = await Promise.all([
    supabase
      .from("transport_vehicles")
      .select("id,user_id,mode,make_model,plate_number,seat_capacity,verification_status,created_at")
      .eq("verification_status", "pending")
      .order("created_at", { ascending: true })
      .limit(50),
    supabase
      .from("transport_vehicles")
      .select("id,user_id,mode,make_model,plate_number,seat_capacity,verification_status,reviewer_note,reviewed_at,created_at")
      .neq("verification_status", "pending")
      .order("reviewed_at", { ascending: false })
      .limit(25),
  ]);

  const pending = (pendingResult.data ?? []) as unknown as Vehicle[];
  const decided = (decidedResult.data ?? []) as unknown as Vehicle[];

  const [fleetsResult, driversResult, documentsResult] = canReviewDelivery
    ? await Promise.all([
        supabase
          .from("delivery_fleets")
          .select("id,business_name,owner_user_id,status,submitted_at")
          .in("status", ["pending", "under_review"])
          .order("submitted_at", { ascending: true })
          .limit(25),
        supabase
          .from("delivery_fleet_drivers")
          .select("id,fleet_id,driver_user_id,status,created_at")
          .eq("status", "pending")
          .order("created_at", { ascending: true })
          .limit(25),
        supabase
          .from("delivery_documents")
          .select("id,doc_type,storage_path,status,expires_at,vehicle_id,application_id,fleet_id,created_at")
          .eq("status", "pending")
          .order("created_at", { ascending: true })
          .limit(50),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];

  return (
    <AdminShell
      email={result.user.email ?? null}
      mfaLevel={result.mfaLevel}
      title="Vehicle approval"
      description="Approve a vehicle only after checking registration, licence and insurance evidence through the approved process. Approval makes the vehicle eligible for passenger trips; it does not verify the driver. Every decision is written to the audit trail by the database function."
    >
      <section aria-labelledby="pending-vehicles">
        <h2 id="pending-vehicles" className="text-lg font-black text-slate-100">Awaiting approval</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
          A vehicle cannot take trips until it is approved. Rejecting requires a note so the rider can act on it.
        </p>
        {pendingResult.error ? (
          <p role="alert" className="mt-4 rounded-2xl border border-amber-800 bg-amber-950/40 p-5 text-sm text-amber-100">
            Vehicles could not be read. Nothing was changed. Reload once; if it persists, System health reports whether the cause is a missing migration, an MFA session or a missing capability.</p>
        ) : (
          <VehicleReview vehicles={pending} />
        )}
      </section>

      <section aria-labelledby="decided-vehicles" className="mt-10">
        <h2 id="decided-vehicles" className="text-lg font-black text-slate-100">Recent decisions</h2>
        {decidedResult.error ? (
          <p role="alert" className="mt-4 rounded-2xl border border-amber-800 bg-amber-950/40 p-5 text-sm text-amber-100">
            Review history could not be read. Nothing was changed. Reload once; if it persists, System health reports whether the cause is a missing migration, an MFA session or a missing capability.</p>
        ) : decided.length === 0 ? (
          <p className="mt-4 rounded-2xl border border-slate-800 bg-slate-900 p-6 text-sm text-slate-300">
            No vehicle has been decided yet. This is a true zero, not missing data.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-800 text-xs font-bold uppercase tracking-wide text-slate-400">
                <tr>
                  <th scope="col" className="px-4 py-3">Vehicle</th>
                  <th scope="col" className="px-4 py-3">Mode</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                  <th scope="col" className="px-4 py-3">Decided</th>
                  <th scope="col" className="px-4 py-3">Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {decided.map(vehicle => (
                  <tr key={vehicle.id}>
                    <td className="px-4 py-3 font-semibold text-slate-100">
                      {vehicle.make_model} · {vehicle.plate_number}
                      <span className="block break-all font-mono text-xs font-normal text-slate-500">Rider {vehicle.user_id}</span>
                    </td>
                    <td className="px-4 py-3 capitalize text-slate-300">{vehicle.mode.replaceAll("_", " ")}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${statusTone[vehicle.verification_status] ?? "border-slate-700 text-slate-300"}`}>
                        {vehicle.verification_status}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-400">
                      {vehicle.reviewed_at ? new Date(vehicle.reviewed_at).toLocaleString("en-KE") : "—"}
                    </td>
                    <td className="max-w-[20rem] px-4 py-3 text-slate-300">{vehicle.reviewer_note?.trim() ? vehicle.reviewer_note : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {canReviewDelivery && (
        <DeliveryReview
          fleets={(fleetsResult.data ?? []) as { id: string; business_name: string; owner_user_id: string; status: string; submitted_at: string | null }[]}
          drivers={(driversResult.data ?? []) as { id: string; fleet_id: string; driver_user_id: string; status: string; created_at: string }[]}
          documents={(documentsResult.data ?? []) as {
            id: string; doc_type: string; storage_path: string; status: string; expires_at: string | null;
            vehicle_id: string | null; application_id: string | null; fleet_id: string | null; created_at: string;
          }[]}
        />
      )}
    </AdminShell>
  );
}
