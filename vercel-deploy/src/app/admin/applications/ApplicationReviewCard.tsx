"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ActivationPanel, { type CategoryOption } from "./ActivationPanel";

export type ApplicationRow = {
  id: string;
  user_id: string;
  activity_type: string;
  status: string;
  business_name: string | null;
  public_reference: string | null;
  country_code: string;
  application_data: Record<string, unknown> | null;
  submitted_at: string | null;
  created_at: string;
  reviewed_at: string | null;
  reviewer_note: string | null;
  rejection_reason: string | null;
};

export type ApplicationDetail = {
  applicant: {
    display_name: string | null;
    phone: string | null;
    email: string | null;
    email_confirmed: boolean;
    account_created_at: string | null;
    last_sign_in_at: string | null;
    roles: string[];
  };
  documents: {
    id: string;
    doc_type: string;
    status: string;
    expires_at: string | null;
    reviewer_note: string | null;
    reviewed_at: string | null;
    created_at: string;
  }[];
  vehicles: {
    id: string;
    mode: string;
    make_model: string;
    plate_number: string;
    seat_capacity: number;
    verification_status: string;
    is_active: boolean;
  }[];
  fleets: { id: string; business_name: string; status: string; reviewer_note: string | null }[];
  service_areas: { county: string; county_code: number; is_active: boolean }[];
  history: { action: string; outcome: string; actor_id: string | null; created_at: string }[];
};

const ACTIVITY_LABELS: Record<string, string> = {
  product_seller: "Product seller",
  service_provider: "Service provider",
  transport_partner: "Transport & delivery",
  property_provider: "Property & places",
};

const STATUS_STYLES: Record<string, string> = {
  pending: "border-amber-400/40 bg-amber-500/10 text-amber-100",
  under_review: "border-sky-400/40 bg-sky-500/10 text-sky-100",
  approved: "border-emerald-400/40 bg-emerald-500/10 text-emerald-100",
  rejected: "border-rose-400/40 bg-rose-500/10 text-rose-100",
};

function when(value: string | null): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not recorded" : date.toLocaleString("en-KE");
}

function Field({ label, value, missing }: { label: string; value: string; missing?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] font-bold uppercase tracking-wide text-ink-500">{label}</dt>
      <dd className={`mt-1 break-words text-sm ${missing ? "italic text-amber-200/80" : "text-ink-100"}`}>
        {value}
      </dd>
    </div>
  );
}

const APPLICATION_DATA_LABELS: Record<string, string> = {
  introduction: "Introduction",
  phone: "Contact number",
  county: "County",
  service_areas: "Service areas",
  years_experience: "Years of experience",
  transport_mode: "Transport mode",
  vehicle_registration: "Vehicle registration",
  property_address: "Property address",
  business_address: "Business address",
  website: "Website",
  licence_number: "Licence number",
};

function readable(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (Array.isArray(value)) return value.map(item => readable(item)).filter(Boolean).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * One application, its evidence and its decision controls.
 *
 * The decision is posted to a server route that re-checks the owner allowlist and MFA level, then
 * reports the real outcome. Nothing here decides authorization, and a failure never removes the row
 * from the screen — the previous design did both.
 */
export default function ApplicationReviewCard({
  row,
  detail,
  detailProblem,
  isOwnApplication,
  categories,
}: {
  row: ApplicationRow;
  detail: ApplicationDetail | null;
  detailProblem: string | null;
  isOwnApplication: boolean;
  categories: CategoryOption[];
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"approved" | "rejected" | null>(null);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);

  const reviewable = row.status === "pending" || row.status === "under_review";

  async function decide(decision: "approved" | "rejected") {
    if (!reviewable || busy) return;
    if (decision === "rejected" && note.trim().length < 5) {
      setFailed(true);
      setMessage("Write at least a short rejection reason before rejecting.");
      return;
    }
    if (
      decision === "approved" &&
      !window.confirm(
        `Approve this application? The applicant gains listing creation for ${ACTIVITY_LABELS[row.activity_type] ?? row.activity_type}. Review the evidence above first; this is recorded in the audit log.`,
      )
    ) {
      return;
    }

    setBusy(decision);
    setMessage("");
    setFailed(false);

    try {
      const response = await fetch("/api/admin/applications/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId: row.id, decision, note: note.trim() }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; ok?: boolean };

      if (!response.ok) {
        setFailed(true);
        setMessage(payload.error ?? "The review could not be recorded. Nothing was changed.");
        if (response.status === 409) router.refresh();
        return;
      }

      setMessage(
        decision === "approved"
          ? "Application approved and recorded in the audit log."
          : "Application rejected and the reason recorded.",
      );
      setNote("");
      router.refresh();
    } catch {
      setFailed(true);
      setMessage("The review could not be sent. Check your connection and try again. Nothing was changed.");
    } finally {
      setBusy(null);
    }
  }

  const applicant = detail?.applicant ?? null;
  const documents = detail?.documents ?? [];
  const vehicles = detail?.vehicles ?? [];
  const fleets = detail?.fleets ?? [];
  const serviceAreas = detail?.service_areas ?? [];
  const history = detail?.history ?? [];
  const data = row.application_data ?? {};
  const submittedFields = Object.entries(APPLICATION_DATA_LABELS)
    .map(([key, label]) => ({ label, value: readable(data[key]) }))
    .filter(entry => entry.value);

  return (
    <article className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-black text-white">
            {ACTIVITY_LABELS[row.activity_type] ?? row.activity_type}
          </h2>
          <p className="mt-1 text-sm text-ink-300">
            {row.business_name || "No business name supplied"}
            {row.public_reference ? (
              <span className="ml-2 font-mono text-xs text-ink-500">{row.public_reference}</span>
            ) : null}
          </p>
        </div>
        <span
          className={`rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-wide ${STATUS_STYLES[row.status] ?? "border-white/20 text-ink-200"}`}
        >
          {row.status.replace("_", " ")}
        </span>
      </header>

      {detailProblem ? (
        <p className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm leading-6 text-amber-100">
          {detailProblem}
        </p>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Field
          label="Applicant email"
          value={applicant?.email ?? "Not available"}
          missing={!applicant?.email}
        />
        <Field
          label="Email confirmed"
          value={
            applicant ? (applicant.email_confirmed ? "Yes" : "No — unconfirmed account") : "Not available"
          }
          missing={applicant ? !applicant.email_confirmed : true}
        />
        <Field label="Name on account" value={applicant?.display_name || "Not provided"} missing={!applicant?.display_name} />
        <Field label="Contact number" value={applicant?.phone || "Not provided"} missing={!applicant?.phone} />
        <Field label="Submitted" value={when(row.submitted_at)} missing={!row.submitted_at} />
        <Field label="Account created" value={when(applicant?.account_created_at ?? null)} />
        <Field label="Last sign-in" value={when(applicant?.last_sign_in_at ?? null)} />
        <Field label="Declared county" value={readable(data.county) || "Not provided"} missing={!readable(data.county)} />
        <Field
          label="Roles on record"
          value={applicant?.roles?.length ? applicant.roles.join(", ") : "Not available"}
          missing={!applicant?.roles?.length}
        />
      </div>

      {submittedFields.length ? (
        <section className="mt-4 rounded-xl border border-white/10 bg-ink-950/40 p-4">
          <h3 className="text-[11px] font-bold uppercase tracking-wide text-ink-500">
            What the applicant declared
          </h3>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2">
            {submittedFields.map(entry => (
              <Field key={entry.label} label={entry.label} value={entry.value} />
            ))}
          </dl>
        </section>
      ) : (
        <p className="mt-4 rounded-xl border border-white/10 p-4 text-sm text-ink-300">
          The applicant supplied no structured details beyond the fields above. Ask for the missing
          evidence instead of approving on a name alone.
        </p>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-white/10 p-4">
          <h3 className="text-[11px] font-bold uppercase tracking-wide text-ink-500">
            Private documents ({documents.length})
          </h3>
          {documents.length ? (
            <ul className="mt-2 space-y-2 text-sm">
              {documents.map(document => (
                <li key={document.id} className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-mono text-xs text-ink-200">{document.doc_type}</span>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${
                      document.status === "approved"
                        ? "border-emerald-400/40 text-emerald-200"
                        : document.status === "rejected"
                          ? "border-rose-400/40 text-rose-200"
                          : "border-amber-400/40 text-amber-200"
                    }`}
                  >
                    {document.status}
                  </span>
                  <span className="text-xs text-ink-500">
                    {document.expires_at ? `expires ${document.expires_at}` : when(document.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-ink-400">
              No private documents are attached to this application. Files are reviewed under Vehicle
              approval; nothing is listed here if the applicant uploaded none.
            </p>
          )}
        </section>

        <section className="rounded-xl border border-white/10 p-4">
          <h3 className="text-[11px] font-bold uppercase tracking-wide text-ink-500">
            Vehicles ({vehicles.length}) · Fleets ({fleets.length})
          </h3>
          {vehicles.length ? (
            <ul className="mt-2 space-y-1 text-sm text-ink-200">
              {vehicles.map(vehicle => (
                <li key={vehicle.id}>
                  {vehicle.mode} · {vehicle.make_model} · {vehicle.plate_number} —{" "}
                  <span className="text-ink-400">{vehicle.verification_status}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-ink-400">No vehicle is registered to this account.</p>
          )}
          {fleets.length ? (
            <ul className="mt-2 space-y-1 text-sm text-ink-200">
              {fleets.map(fleet => (
                <li key={fleet.id}>
                  {fleet.business_name} — <span className="text-ink-400">{fleet.status}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <h3 className="mt-4 text-[11px] font-bold uppercase tracking-wide text-ink-500">
            Service coverage ({serviceAreas.length})
          </h3>
          <p className="mt-1 text-sm text-ink-300">
            {serviceAreas.length
              ? serviceAreas.map(area => `${area.county}${area.is_active ? "" : " (paused)"}`).join(", ")
              : "No service area is recorded for this account."}
          </p>
        </section>
      </div>

      {history.length ? (
        <section className="mt-4 rounded-xl border border-white/10 p-4">
          <h3 className="text-[11px] font-bold uppercase tracking-wide text-ink-500">Decision history</h3>
          <ol className="mt-2 space-y-1 text-xs text-ink-300">
            {history.slice(0, 8).map((entry, index) => (
              <li key={`${entry.action}-${index}`}>
                {when(entry.created_at)} · {entry.action} · {entry.outcome}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {row.reviewed_at ? (
        <p className="mt-4 rounded-xl border border-white/10 bg-ink-950/40 p-3 text-xs leading-5 text-ink-300">
          Decided {when(row.reviewed_at)}
          {row.reviewer_note ? ` — note: ${row.reviewer_note}` : ""}
          {row.rejection_reason ? ` — reason: ${row.rejection_reason}` : ""}
        </p>
      ) : null}

      {row.status === "approved" ? (
        <ActivationPanel
          applicationId={row.id}
          activityType={row.activity_type}
          categories={categories}
        />
      ) : null}

      {isOwnApplication ? (
        <p className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm leading-6 text-amber-100">
          This is your own application. The database blocks self-review, so the other owner account
          must decide it.
        </p>
      ) : reviewable ? (
        <div className="mt-4">
          <label className="block text-sm font-bold text-ink-100">
            Review note / rejection reason
            <textarea
              rows={3}
              maxLength={1000}
              value={note}
              onChange={event => setNote(event.target.value)}
              placeholder="Required for rejection. Record what you checked and why."
              className="mt-2 w-full rounded-xl border border-white/15 bg-ink-950/60 px-4 py-3 font-normal text-white"
            />
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void decide("approved")}
              className="btn btn-primary !px-4 !py-2 !text-sm disabled:opacity-50"
            >
              {busy === "approved" ? "Approving…" : "Approve"}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void decide("rejected")}
              className="rounded-full border border-rose-500/50 px-4 py-2 text-sm font-bold text-rose-200 disabled:opacity-50"
            >
              {busy === "rejected" ? "Rejecting…" : "Reject"}
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-4 text-sm text-ink-400">
          This application is closed. Reload with the Approved or Rejected filter to review it again.
        </p>
      )}

      {message ? (
        <p
          role={failed ? "alert" : "status"}
          className={`mt-3 rounded-xl border p-3 text-sm leading-6 ${
            failed
              ? "border-rose-500/40 bg-rose-500/10 text-rose-100"
              : "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
          }`}
        >
          {message}
        </p>
      ) : null}
    </article>
  );
}
