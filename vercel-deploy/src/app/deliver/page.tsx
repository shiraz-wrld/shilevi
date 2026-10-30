"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { DocumentCapture, type UploadedDocument } from "@/components/deliver/DocumentCapture";

type Application = {
  id: string;
  status: string;
  business_name: string | null;
  submitted_at: string | null;
  reviewer_note: string | null;
};

type Vehicle = {
  id: string;
  make_model: string;
  plate_number: string;
  vehicle_class_code: string | null;
  verification_status: string;
};

type DocumentRow = {
  id: string;
  doc_type: string;
  status: string;
  reviewer_note: string | null;
};

type ChecklistRow = {
  doc_type: string;
  label: string;
  applies_to: "provider" | "vehicle" | "driver" | "fleet";
  is_required: boolean;
  status: string;
  document_id: string | null;
  expires_at: string | null;
  reviewer_note: string | null;
};

type RouteIntent = {
  origin_location_id: string;
  destination_location_id: string;
  published_at: string | null;
};

type ProviderRoute = {
  id: string;
  origin_location_id: string;
  destination_location_id: string;
  is_active: boolean;
};

const statusCopy: Record<string, { label: string; tone: string }> = {
  draft: { label: "Draft — not submitted", tone: "bg-slate-100 text-slate-700" },
  pending: { label: "Submitted — awaiting review", tone: "bg-amber-50 text-amber-800" },
  under_review: { label: "Under review", tone: "bg-blue-50 text-blue-800" },
  approved: { label: "Approved", tone: "bg-emerald-50 text-emerald-800" },
  rejected: { label: "Rejected", tone: "bg-red-50 text-red-800" },
  suspended: { label: "Suspended", tone: "bg-red-50 text-red-800" },
  withdrawn: { label: "Withdrawn", tone: "bg-slate-100 text-slate-700" },
};

export default function DeliverPage() {
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [userId, setUserId] = useState("");
  const [application, setApplication] = useState<Application | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [checklist, setChecklist] = useState<ChecklistRow[]>([]);
  const [counties, setCounties] = useState<{ id: string; county: string }[]>([]);
  const [routeIntent, setRouteIntent] = useState<RouteIntent | null>(null);
  const [routes, setRoutes] = useState<ProviderRoute[]>([]);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

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

      setUserId(auth.user.id);

      const [applications, vehicleRows, documentRows, checklistRpc, countyRows, intentRow, routeRows] = await Promise.all([
        db
          .from("provider_applications")
          .select("id,status,business_name,submitted_at,reviewer_note")
          .eq("user_id", auth.user.id)
          .eq("activity_type", "transport_partner")
          .order("created_at", { ascending: false })
          .limit(1),
        db
          .from("transport_vehicles")
          .select("id,make_model,plate_number,vehicle_class_code,verification_status")
          .eq("user_id", auth.user.id)
          .order("created_at", { ascending: false })
          .limit(20),
        db
          .from("delivery_documents")
          .select("id,doc_type,status,reviewer_note")
          .eq("user_id", auth.user.id)
          .order("created_at", { ascending: false })
          .limit(30),
        db.rpc("my_delivery_document_checklist"),
        db.from("service_locations").select("id,county").order("county_code"),
        db
          .from("delivery_application_route_intents")
          .select("origin_location_id,destination_location_id,published_at")
          .maybeSingle(),
        db
          .from("delivery_provider_routes")
          .select("id,origin_location_id,destination_location_id,is_active")
          .eq("provider_user_id", auth.user.id),
      ]);

      if (applications.error) throw applications.error;
      setApplication((applications.data?.[0] as Application) ?? null);
      setVehicles((vehicleRows.data ?? []) as Vehicle[]);
      setDocuments((documentRows.data ?? []) as DocumentRow[]);
      setChecklist((checklistRpc.data ?? []) as ChecklistRow[]);
      setCounties((countyRows.data ?? []) as { id: string; county: string }[]);
      setRouteIntent((intentRow.data as RouteIntent) ?? null);
      setRoutes((routeRows.data ?? []) as ProviderRoute[]);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Your delivery account could not be loaded. Check your connection and try again.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const approved = application?.status === "approved";
  const outstanding = checklist.filter(row => row.is_required && row.status !== "approved");

  async function attachDocument(docType: string, file: UploadedDocument | null) {
    if (!file) return;
    setBusy(docType);
    setError("");
    setNotice("");
    try {
      const db = createSupabaseBrowserClient();
      const { error: rpcError } = await db.rpc("attach_my_delivery_document", {
        p_doc_type: docType,
        p_storage_path: file.path,
      });
      if (rpcError) throw rpcError;
      setNotice("Document attached. It is pending review — uploading approves nothing.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The document could not be attached.");
    } finally {
      setBusy("");
    }
  }

  async function publishRoute() {
    setBusy("route");
    setError("");
    setNotice("");
    try {
      const db = createSupabaseBrowserClient();
      const { error: rpcError } = await db.rpc("publish_my_delivery_route");
      if (rpcError) throw rpcError;
      setNotice("Route published. Shipments on this route may now be offered to you.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The route could not be published.");
    } finally {
      setBusy("");
    }
  }

  function countyName(id: string | null | undefined) {
    return counties.find(county => county.id === id)?.county ?? "Unknown county";
  }

  return (
    <div className="min-h-screen bg-ink-950 text-white">
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
        <p className="text-sm font-bold uppercase tracking-[0.16em] text-brand-300">Shilevi delivery network</p>
        <h1 className="mt-3 text-3xl font-black sm:text-4xl">Deliver with Shilevi</h1>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-ink-300">
          Shilevi coordinates deliveries with approved independent couriers and transport businesses. It does
          not own a fleet and does not guarantee work. You receive only shipments that match your approved
          vehicle, your verified routes and the cargo you can safely carry.
        </p>

        <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-sm leading-6 text-ink-300">
          <p className="font-bold text-white">What approval requires</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>A transport partner application reviewed by Shilevi staff.</li>
            <li>Each vehicle approved separately, with capacity and cargo rules that match the class.</li>
            <li>Private documents (identity, licence, registration, insurance) — never public.</li>
            <li>Fleet accounts additionally require an approved fleet and approved drivers.</li>
          </ul>
          <p className="mt-3 text-xs text-ink-400">
            Document requirements are configured by Shilevi rather than invented by this page; only upload
            what the application asks for.
          </p>
        </div>

        {!loading && !signedIn && (
          <section className="mt-8 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <h2 className="text-lg font-black text-white">Apply with your existing account</h2>
            <p className="mt-2 text-sm leading-6 text-ink-300">
              Your customer account, orders and saved items stay exactly as they are. Applying adds a
              deliverer application; it does not create a second account.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link href="/login?next=%2Fdeliver%2Fapply" className="btn btn-primary">
                Sign in to apply
              </Link>
              <Link href="/signup" className="btn btn-secondary">
                Create an account
              </Link>
            </div>
          </section>
        )}

        {loading && <p className="mt-8 text-sm text-ink-300">Loading your delivery account…</p>}
        {error && (
          <p role="alert" className="mt-8 rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-100">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="mt-8 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm text-emerald-100">
            {notice}
          </p>
        )}

        {signedIn && !loading && (
          <section className="mt-8 space-y-4">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-black text-white">Your application</h2>
                  {application ? (
                    <p className="mt-1 text-sm text-ink-300">
                      {application.business_name ?? "Individual deliverer"} ·{" "}
                      {application.submitted_at
                        ? `submitted ${new Date(application.submitted_at).toLocaleString("en-KE")}`
                        : "not submitted yet"}
                    </p>
                  ) : (
                    <p className="mt-1 text-sm text-ink-300">No delivery application exists on this account yet.</p>
                  )}
                </div>
                {application && (
                  <span className={`rounded-full px-3 py-1 text-xs font-bold ${(statusCopy[application.status] ?? statusCopy.draft).tone}`}>
                    {(statusCopy[application.status] ?? statusCopy.draft).label}
                  </span>
                )}
              </div>

              {application?.reviewer_note && (
                <p className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm leading-6 text-amber-100">
                  Reviewer note: {application.reviewer_note}
                </p>
              )}

              <div className="mt-4 flex flex-wrap gap-3">
                {approved && (
                  <Link href="/deliver/jobs" className="btn btn-primary">
                    Open delivery jobs
                  </Link>
                )}
                <Link href="/account/notifications" className="btn btn-secondary">
                  Notifications
                </Link>
                {!application && (
                  <Link href="/deliver/apply" className="btn btn-primary">
                    Start your application
                  </Link>
                )}
                {application && ["rejected", "withdrawn"].includes(application.status) && (
                  <Link href="/deliver/apply" className="btn btn-primary">
                    Submit a new application
                  </Link>
                )}
                {application && ["pending", "under_review", "draft"].includes(application.status) && (
                  <Link href="/deliver/apply" className="btn btn-secondary">
                    Continue or edit your application
                  </Link>
                )}
              </div>

              {approved ? (
                <p className="mt-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm leading-6 text-emerald-100">
                  Approved. Vehicles and fleet drivers still need their own approval, and offers appear only
                  when a shipment matches your route, capacity and cargo capabilities.
                </p>
              ) : (
                <p className="mt-4 rounded-xl border border-white/10 p-3 text-sm leading-6 text-ink-300">
                  Applying does not grant delivery eligibility. Until the application, your vehicle and your
                  documents are approved, no shipment can be offered to you.
                </p>
              )}
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
              <h2 className="text-lg font-black text-white">Vehicles</h2>
              {vehicles.length === 0 ? (
                <p className="mt-2 text-sm text-ink-300">No vehicle registered yet.</p>
              ) : (
                <ul className="mt-3 space-y-2 text-sm">
                  {vehicles.map(vehicle => (
                    <li key={vehicle.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 p-3">
                      <span className="text-ink-100">
                        {vehicle.make_model} · {vehicle.plate_number}
                        <span className="ml-2 text-ink-400">{vehicle.vehicle_class_code ?? "class not set"}</span>
                      </span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                        vehicle.verification_status === "approved"
                          ? "bg-emerald-500/15 text-emerald-200"
                          : vehicle.verification_status === "rejected"
                            ? "bg-red-500/15 text-red-200"
                            : "bg-amber-500/15 text-amber-200"
                      }`}>
                        {vehicle.verification_status}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
              <h2 className="text-lg font-black text-white">Service routes</h2>
              <p className="mt-1 text-xs leading-5 text-ink-400">
                A route you declared when applying is kept as an intent until your application is approved.
                Only an approved delivery partner can publish one.
              </p>
              {routes.length > 0 ? (
                <ul className="mt-3 space-y-2 text-sm">
                  {routes.map(route => (
                    <li key={route.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 p-3">
                      <span className="text-ink-100">
                        {countyName(route.origin_location_id)} → {countyName(route.destination_location_id)}
                      </span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                        route.is_active ? "bg-emerald-500/15 text-emerald-200" : "bg-slate-500/15 text-slate-300"
                      }`}>
                        {route.is_active ? "active" : "inactive"}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : routeIntent ? (
                <p className="mt-3 rounded-xl border border-white/10 p-3 text-sm text-ink-200">
                  Declared route: {countyName(routeIntent.origin_location_id)} →{" "}
                  {countyName(routeIntent.destination_location_id)}
                  {routeIntent.published_at ? " · published" : " · not published yet"}
                </p>
              ) : (
                <p className="mt-3 text-sm text-ink-300">No fixed route was declared in the application.</p>
              )}
              {approved && routeIntent && routes.length === 0 && (
                <button
                  type="button"
                  onClick={() => void publishRoute()}
                  disabled={Boolean(busy)}
                  className="btn btn-primary mt-3 text-sm"
                >
                  {busy === "route" ? "Publishing…" : "Publish the route from my application"}
                </button>
              )}
              {!approved && routeIntent && (
                <p className="mt-2 text-xs text-ink-400">
                  Your declared route becomes publishable once the application is approved.
                </p>
              )}
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="text-lg font-black text-white">Documents</h2>
                  <p className="mt-1 text-xs leading-5 text-ink-400">
                    Stored privately. Only you, the Shilevi owner and staff with delivery review permission can
                    open them; they are never public links. Replacing a document always sends it back for
                    review.
                  </p>
                </div>
                {checklist.length > 0 && (
                  <span className={`rounded-full px-3 py-1 text-xs font-bold ${
                    outstanding.length === 0
                      ? "bg-emerald-500/15 text-emerald-200"
                      : "bg-amber-500/15 text-amber-200"
                  }`}>
                    {outstanding.length === 0 ? "All required documents approved" : `${outstanding.length} outstanding`}
                  </span>
                )}
              </div>

              {checklist.length === 0 ? (
                <p className="mt-3 text-sm text-ink-300">
                  No document requirements are configured for this account yet.
                </p>
              ) : (
                <div className="mt-3 space-y-2">
                  {checklist.map(row => (
                    <div key={row.doc_type}>
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 p-3 text-sm">
                        <span className="text-ink-100">
                          {row.label}
                          {row.is_required && <span className="ml-1 text-red-300">*</span>}
                        </span>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                          row.status === "approved"
                            ? "bg-emerald-500/15 text-emerald-200"
                            : row.status === "rejected"
                              ? "bg-red-500/15 text-red-200"
                              : row.status === "missing"
                                ? "bg-slate-500/15 text-slate-300"
                                : "bg-amber-500/15 text-amber-200"
                        }`}>
                          {row.status === "missing" ? "not supplied" : row.status}
                        </span>
                      </div>
                      {row.status === "rejected" && row.reviewer_note && (
                        <p className="mt-1 rounded-lg bg-red-500/10 p-2 text-xs leading-5 text-red-100">
                          {row.reviewer_note}
                        </p>
                      )}
                      {application && row.status !== "approved" && (
                        <div className="mt-2">
                          <DocumentCapture
                            userId={userId}
                            docType={row.doc_type}
                            label={`Upload ${row.label.toLowerCase()}`}
                            required={row.is_required}
                            status={row.status}
                            reviewerNote={row.reviewer_note}
                            facing={row.doc_type === "profile_photo" ? "user" : "environment"}
                            value={null}
                            onChange={value => {
                              if (value) void attachDocument(row.doc_type, value);
                            }}
                            onError={setError}
                          />
                        </div>
                      )}
                      {row.status === "approved" && row.expires_at && (
                        <p className="mt-1 text-xs text-ink-400">Valid until {row.expires_at}.</p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {documents.length > 0 && (
                <p className="mt-3 text-xs text-ink-500">
                  {documents.length} document record{documents.length === 1 ? "" : "s"} on file, including
                  replaced versions.
                </p>
              )}
            </div>
          </section>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
