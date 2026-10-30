"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { DocumentCapture, type UploadedDocument } from "@/components/deliver/DocumentCapture";

type Mode = "individual" | "fleet";

type VehicleClass = {
  code: string;
  label: string;
  max_payload_kg: number;
  max_length_cm: number | null;
  max_width_cm: number | null;
  max_height_cm: number | null;
  supports_covered: boolean;
  supports_fragile: boolean;
  supports_temperature_controlled: boolean;
};

type Location = { id: string; county: string };

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

type Application = { id: string; status: string; submitted_at: string | null };

const steps = ["Identity", "Vehicle & routes", "Documents", "Review & submit"] as const;
const ownershipOptions = [
  { value: "owned", label: "I own it" },
  { value: "leased", label: "Leased to me" },
  { value: "authorised", label: "I am authorised to use it" },
  { value: "fleet_vehicle", label: "Assigned by a fleet" },
] as const;

const modeLabels: Record<Mode, string> = {
  individual: "Individual deliverer",
  fleet: "Fleet or transport business",
};

/** A bicycle is the only class where a driving licence and a registration do not apply. */
function requiresLicence(classCode: string) {
  return classCode !== "bicycle";
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function DeliverApplyPage() {
  const [mode, setMode] = useState<Mode>("individual");
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [existing, setExisting] = useState<Application | null>(null);

  const [classes, setClasses] = useState<VehicleClass[]>([]);
  const [counties, setCounties] = useState<Location[]>([]);
  const [checklist, setChecklist] = useState<ChecklistRow[]>([]);

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [idType, setIdType] = useState<"national_id" | "passport">("national_id");
  const [idNumber, setIdNumber] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [representative, setRepresentative] = useState("");
  const [operatingArea, setOperatingArea] = useState("");
  const [availability, setAvailability] = useState("");
  const [goodsHandled, setGoodsHandled] = useState("");

  const [classCode, setClassCode] = useState("motorbike");
  const [makeModel, setMakeModel] = useState("");
  const [plate, setPlate] = useState("");
  const [ownership, setOwnership] = useState("owned");
  const [licenceNumber, setLicenceNumber] = useState("");
  const [licenceClass, setLicenceClass] = useState("");
  const [licenceExpiry, setLicenceExpiry] = useState("");
  const [payload, setPayload] = useState("");
  const [length, setLength] = useState("");
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [covered, setCovered] = useState(false);
  const [fragile, setFragile] = useState(false);
  const [temperature, setTemperature] = useState(false);
  const [originId, setOriginId] = useState("");
  const [destinationId, setDestinationId] = useState("");

  const [files, setFiles] = useState<Record<string, UploadedDocument | null>>({});
  const [terms, setTerms] = useState(false);

  const selectedClass = useMemo(() => classes.find(item => item.code === classCode), [classes, classCode]);
  const motorised = requiresLicence(classCode);
  const providerDocuments = checklist.filter(row => row.applies_to === "provider");
  const otherDocuments = checklist.filter(row => row.applies_to !== "provider");

  useEffect(() => {
    let alive = true;
    async function init() {
      try {
        const db = createSupabaseBrowserClient();
        const { data: auth } = await db.auth.getUser();
        if (!auth.user) {
          window.location.replace("/login?next=%2Fdeliver%2Fapply");
          return;
        }
        if (!alive) return;
        setUserId(auth.user.id);

        const [classRows, countyRows, draftRow, applicationRow] = await Promise.all([
          db.from("delivery_vehicle_classes").select("*").eq("is_active", true).order("sort_order"),
          db.from("service_locations").select("id,county").order("county_code"),
          db.from("delivery_application_drafts").select("mode,payload").maybeSingle(),
          db
            .from("provider_applications")
            .select("id,status,submitted_at")
            .eq("user_id", auth.user.id)
            .eq("activity_type", "transport_partner")
            .in("status", ["draft", "pending", "under_review", "approved"])
            .order("created_at", { ascending: false })
            .limit(1),
        ]);

        if (classRows.error) throw classRows.error;
        setClasses((classRows.data ?? []) as VehicleClass[]);
        setCounties((countyRows.data ?? []) as Location[]);
        setExisting(((applicationRow.data?.[0] as Application) ?? null) || null);

        const draft = draftRow.data as { mode: Mode; payload: Record<string, unknown> } | null;
        if (draft) {
          setMode(draft.mode);
          const saved = draft.payload ?? {};
          setFullName(String(saved.full_name ?? ""));
          setPhone(String(saved.phone ?? ""));
          if (saved.id_type === "passport") setIdType("passport");
          setIdNumber(String(saved.id_number ?? ""));
          setBusinessName(String(saved.business_name ?? ""));
          setRepresentative(String(saved.representative ?? ""));
          setOperatingArea(String(saved.operating_area ?? ""));
          setAvailability(String(saved.availability ?? ""));
          setGoodsHandled(String(saved.goods_handled ?? ""));

          const vehicle = (saved.vehicle ?? {}) as Record<string, unknown>;
          if (typeof vehicle.class_code === "string") setClassCode(vehicle.class_code);
          setMakeModel(String(vehicle.make_model ?? ""));
          setPlate(String(vehicle.plate_number ?? ""));
          if (typeof vehicle.ownership_status === "string") setOwnership(vehicle.ownership_status);
          setLicenceNumber(String(vehicle.licence_number ?? ""));
          setLicenceClass(String(vehicle.licence_class ?? ""));
          setLicenceExpiry(String(vehicle.licence_expiry ?? ""));
          setPayload(vehicle.payload_kg ? String(vehicle.payload_kg) : "");
          setLength(vehicle.length_cm ? String(vehicle.length_cm) : "");
          setWidth(vehicle.width_cm ? String(vehicle.width_cm) : "");
          setHeight(vehicle.height_cm ? String(vehicle.height_cm) : "");
          setCovered(Boolean(vehicle.supports_covered));
          setFragile(Boolean(vehicle.supports_fragile));
          setTemperature(Boolean(vehicle.supports_temperature_controlled));
          setOriginId(String(saved.origin_location_id ?? ""));
          setDestinationId(String(saved.destination_location_id ?? ""));

          const savedDocuments = Array.isArray(saved.documents) ? saved.documents : [];
          const restored: Record<string, UploadedDocument | null> = {};
          for (const entry of savedDocuments) {
            const doc = entry as { doc_type?: string; storage_path?: string };
            if (doc.doc_type && doc.storage_path) {
              restored[doc.doc_type] = { path: doc.storage_path, name: "saved upload" };
            }
          }
          setFiles(restored);
          setNotice("Your saved draft has been restored.");
        }
      } catch (caught) {
        if (alive) {
          setError(
            caught instanceof Error
              ? caught.message
              : "The application form could not be loaded. Sign in again and retry.",
          );
        }
      } finally {
        if (alive) setLoading(false);
      }
    }
    void init();
    return () => {
      alive = false;
    };
  }, []);

  // The required-document list comes from the database, so the form and the server agree on what a
  // bicycle courier and a van driver must each supply.
  const loadChecklist = useCallback(async (nextMode: Mode, nextClass: string) => {
    try {
      const db = createSupabaseBrowserClient();
      const { data, error: rpcError } = await db.rpc("my_delivery_document_checklist", {
        p_mode: nextMode,
        p_vehicle_class: nextClass,
      });
      if (rpcError) throw rpcError;
      setChecklist((data ?? []) as ChecklistRow[]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The document requirements could not be loaded.");
    }
  }, []);

  useEffect(() => {
    if (!userId) return;
    void loadChecklist(mode, classCode);
  }, [userId, mode, classCode, loadChecklist]);

  function documentsPayload() {
    return Object.entries(files)
      .filter(([, value]) => Boolean(value))
      .map(([docType, value]) => ({ doc_type: docType, storage_path: value?.path }));
  }

  function payloadObject() {
    return {
      full_name: fullName.trim(),
      phone: phone.trim(),
      id_type: idType,
      id_number: idNumber.trim(),
      business_name: mode === "fleet" ? businessName.trim() : null,
      representative: mode === "fleet" ? representative.trim() : null,
      operating_area: operatingArea.trim(),
      availability: availability.trim(),
      goods_handled: goodsHandled.trim(),
      origin_location_id: originId || null,
      destination_location_id: destinationId || null,
      mode,
      vehicle: {
        class_code: classCode,
        make_model: makeModel.trim(),
        plate_number: plate.trim().toUpperCase(),
        ownership_status: ownership,
        licence_number: motorised ? licenceNumber.trim() : null,
        licence_class: motorised ? licenceClass.trim() : null,
        licence_expiry: motorised ? licenceExpiry || null : null,
        payload_kg: payload ? Number(payload) : null,
        length_cm: length ? Number(length) : null,
        width_cm: width ? Number(width) : null,
        height_cm: height ? Number(height) : null,
        supports_covered: covered,
        supports_fragile: fragile,
        supports_temperature_controlled: temperature,
      },
      documents: documentsPayload(),
    };
  }

  function missingRequired(rows: ChecklistRow[]) {
    return rows.filter(row => row.is_required && !files[row.doc_type]);
  }

  function validateStepAt(stepIndex: number): string | null {
    if (stepIndex === 0) {
      if (fullName.trim().length < 2) return "Enter the name that appears on your identification.";
      if (phone.trim().length < 7) return "Enter a reachable phone number.";
      if (idNumber.trim().length < 4) return "Enter the identity document number.";
      if (mode === "fleet" && businessName.trim().length < 2) return "Enter the registered business name.";
      if (mode === "fleet" && representative.trim().length < 2) {
        return "Name the person authorised to represent the business.";
      }
      if (operatingArea.trim().length < 2) return "Describe the area you can realistically serve.";
      const missing = missingRequired(providerDocuments);
      if (missing.length) return `Attach the required identity documents: ${missing.map(row => row.label).join(", ")}.`;
    }
    if (stepIndex === 1) {
      if (!selectedClass) return "Choose a vehicle class.";
      if (makeModel.trim().length < 2) return "Describe the vehicle.";
      if (plate.trim().length < 2) return "Enter the plate or identifier.";
      if (!ownership) return "State whether you own, lease or are authorised to use the vehicle.";
      if (mode === "individual" && ownership === "fleet_vehicle") {
        return "A fleet-assigned vehicle needs a fleet application.";
      }
      if (motorised) {
        if (licenceNumber.trim().length < 4) return "Enter your driving licence number.";
        if (!licenceClass.trim()) return "Enter the licence class or category.";
        if (!licenceExpiry) return "Enter the licence expiry date.";
        if (licenceExpiry < todayIso()) return "That licence has expired. Renew it before applying.";
      }
      if (originId && destinationId && originId === destinationId) {
        return "A route needs different pickup and destination counties.";
      }
      const numeric = [payload, length, width, height].filter(Boolean).map(Number);
      if (numeric.some(value => !Number.isFinite(value) || value <= 0)) return "Capacities must be positive numbers.";
      if (payload && selectedClass && Number(payload) > selectedClass.max_payload_kg) {
        return `This class carries up to ${selectedClass.max_payload_kg} kg.`;
      }
    }
    if (stepIndex === 2) {
      const missing = missingRequired(otherDocuments);
      if (missing.length) return `Attach the required documents: ${missing.map(row => row.label).join(", ")}.`;
    }
    return null;
  }

  function validateStep(): string | null {
    return validateStepAt(step);
  }

  async function saveDraft() {
    const problem = validateStep();
    if (problem) {
      setError(problem);
      return false;
    }
    setBusy("draft");
    setError("");
    try {
      const db = createSupabaseBrowserClient();
      const { error: rpcError } = await db.rpc("save_delivery_application_draft", {
        p_mode: mode,
        p_payload: payloadObject(),
      });
      if (rpcError) throw rpcError;
      setNotice("Progress saved. Your uploaded files stay on this account, so you can resume later.");
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Your draft could not be saved.");
      return false;
    } finally {
      setBusy("");
    }
  }

  async function next() {
    const problem = validateStep();
    if (problem) {
      setError(problem);
      return;
    }
    setError("");
    if (step < steps.length - 1) {
      const saved = await saveDraft();
      if (!saved) return;
      setStep(step + 1);
    }
  }

  async function submit() {
    if (!terms) {
      setError("Accept the deliverer terms before submitting.");
      return;
    }
    for (let index = 0; index < steps.length - 1; index += 1) {
      const problem = validateStepAt(index);
      if (problem) {
        setStep(index);
        setError(problem);
        return;
      }
    }
    setBusy("submit");
    setError("");
    setNotice("");
    try {
      const db = createSupabaseBrowserClient();
      const { error: draftError } = await db.rpc("save_delivery_application_draft", {
        p_mode: mode,
        p_payload: payloadObject(),
      });
      if (draftError) throw draftError;

      const { data: submitted, error: submitError } = await db.rpc("submit_delivery_application_draft", {
        p_terms_version: "deliverer-terms-v2",
      });
      if (submitError) throw submitError;

      const row = Array.isArray(submitted) ? submitted[0] : submitted;
      setNotice(
        row
          ? "Application submitted. Nothing is approved until a reviewer checks your identity, vehicle and documents."
          : "Application submitted for review.",
      );
      window.setTimeout(() => window.location.assign("/deliver"), 1400);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The application could not be submitted.");
    } finally {
      setBusy("");
    }
  }

  if (existing) {
    return (
      <div className="min-h-screen bg-ink-950 text-white">
        <SiteHeader />
        <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
          <Link href="/deliver" className="text-sm font-semibold text-brand-300 hover:text-brand-200">
            ← Delivery account
          </Link>
          <h1 className="mt-3 text-3xl font-black">You already have an application</h1>
          <p className="mt-3 text-sm leading-6 text-ink-300">
            One delivery application is allowed per account. Its current status is{" "}
            <span className="font-bold text-white">{existing.status.replaceAll("_", " ")}</span>. You can add or
            replace documents from your delivery account while it is reviewed.
          </p>
          <Link href="/deliver" className="btn btn-primary mt-6">
            Open your delivery account
          </Link>
        </main>
        <SiteFooter />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ink-950 text-white">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <Link href="/deliver" className="text-sm font-semibold text-brand-300 hover:text-brand-200">
          ← Delivery network
        </Link>
        <h1 className="mt-3 text-3xl font-black">Become a deliverer</h1>
        <p className="mt-2 text-sm leading-6 text-ink-300">
          Four short steps. What you are asked for depends on the activity you choose — a bicycle courier is
          never asked for a driving licence. Your progress is saved as a draft, and submitting does not
          approve you: a reviewer checks your identity, the vehicle and every document.
        </p>

        <ol className="mt-6 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4" aria-label="Application progress">
          {steps.map((label, index) => (
            <li
              key={label}
              aria-current={index === step ? "step" : undefined}
              className={`rounded-xl border p-2 text-center font-bold ${
                index === step
                  ? "border-brand-400 bg-brand-600/20 text-white"
                  : index < step
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                    : "border-white/10 text-ink-400"
              }`}
            >
              {index + 1}. {label}
            </li>
          ))}
        </ol>

        {loading ? (
          <p className="mt-8 text-sm text-ink-300">Loading the application form…</p>
        ) : (
          <div className="mt-6 space-y-5 rounded-2xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
            {step === 0 && (
              <div className="space-y-4">
                <fieldset>
                  <legend className="text-sm font-bold text-white">How will you deliver?</legend>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {(Object.keys(modeLabels) as Mode[]).map(option => (
                      <label
                        key={option}
                        className={`cursor-pointer rounded-xl border p-3 text-sm ${
                          mode === option ? "border-brand-400 bg-brand-600/15" : "border-white/10"
                        }`}
                      >
                        <input
                          type="radio"
                          name="mode"
                          className="mr-2 accent-brand-500"
                          checked={mode === option}
                          onChange={() => setMode(option)}
                        />
                        <span className="font-bold">{modeLabels[option]}</span>
                        <span className="mt-1 block text-xs leading-5 text-ink-400">
                          {option === "individual"
                            ? "You drive your own approved vehicle."
                            : "A business with several vehicles and authorised drivers."}
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                <label className="block text-sm font-bold text-ink-200">
                  Full legal name
                  <input
                    value={fullName}
                    onChange={event => setFullName(event.target.value)}
                    maxLength={120}
                    autoComplete="name"
                    className="field mt-1.5 font-normal"
                  />
                </label>
                <label className="block text-sm font-bold text-ink-200">
                  Contact phone
                  <input
                    value={phone}
                    onChange={event => setPhone(event.target.value)}
                    maxLength={32}
                    inputMode="tel"
                    autoComplete="tel"
                    className="field mt-1.5 font-normal"
                  />
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm font-bold text-ink-200">
                    Identity document
                    <select
                      value={idType}
                      onChange={event => setIdType(event.target.value as "national_id" | "passport")}
                      className="field mt-1.5 font-normal"
                    >
                      <option value="national_id">National ID</option>
                      <option value="passport">Passport</option>
                    </select>
                  </label>
                  <label className="block text-sm font-bold text-ink-200">
                    Document number
                    <input
                      value={idNumber}
                      onChange={event => setIdNumber(event.target.value)}
                      maxLength={40}
                      className="field mt-1.5 font-normal"
                    />
                  </label>
                </div>

                {mode === "fleet" && (
                  <>
                    <label className="block text-sm font-bold text-ink-200">
                      Registered business name
                      <input value={businessName} onChange={event => setBusinessName(event.target.value)} maxLength={160} className="field mt-1.5 font-normal" />
                    </label>
                    <label className="block text-sm font-bold text-ink-200">
                      Authorised representative
                      <input value={representative} onChange={event => setRepresentative(event.target.value)} maxLength={120} className="field mt-1.5 font-normal" />
                    </label>
                  </>
                )}

                <label className="block text-sm font-bold text-ink-200">
                  Area you can serve
                  <input
                    value={operatingArea}
                    onChange={event => setOperatingArea(event.target.value)}
                    maxLength={200}
                    placeholder="e.g. Nairobi and Machakos; Nairobi–Mombasa corridor"
                    className="field mt-1.5 font-normal"
                  />
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm font-bold text-ink-200">
                    Availability
                    <input value={availability} onChange={event => setAvailability(event.target.value)} maxLength={200} placeholder="e.g. Mon–Sat, 8am–6pm" className="field mt-1.5 font-normal" />
                  </label>
                  <label className="block text-sm font-bold text-ink-200">
                    Goods you can safely carry
                    <input value={goodsHandled} onChange={event => setGoodsHandled(event.target.value)} maxLength={300} placeholder="e.g. General parcels; no liquids" className="field mt-1.5 font-normal" />
                  </label>
                </div>

                <div className="space-y-3 rounded-xl border border-white/10 p-3">
                  <p className="text-sm font-bold text-white">Identity evidence</p>
                  <p className="text-xs leading-5 text-ink-400">
                    A clear photograph of the document and of you. Files are stored in a private bucket and are
                    opened only by you and authorised reviewers.
                  </p>
                  {providerDocuments.length === 0 && (
                    <p className="text-xs text-ink-400">The required documents could not be loaded. Retry before submitting.</p>
                  )}
                  {providerDocuments.map(row => (
                    <DocumentCapture
                      key={row.doc_type}
                      userId={userId}
                      docType={row.doc_type}
                      label={row.label}
                      hint={
                        row.doc_type === "profile_photo"
                          ? "Face the camera in good light; no filter, hat or sunglasses."
                          : "All four corners visible, no glare, readable text."
                      }
                      required={row.is_required}
                      status={row.status}
                      reviewerNote={row.reviewer_note}
                      facing={row.doc_type === "profile_photo" ? "user" : "environment"}
                      value={files[row.doc_type] ?? null}
                      onChange={value => setFiles(previous => ({ ...previous, [row.doc_type]: value }))}
                      onError={setError}
                    />
                  ))}
                </div>
              </div>
            )}

            {step === 1 && (
              <div className="space-y-4">
                <label className="block text-sm font-bold text-ink-200">
                  Vehicle class
                  <select value={classCode} onChange={event => setClassCode(event.target.value)} className="field mt-1.5 font-normal">
                    {classes.map(item => (
                      <option key={item.code} value={item.code}>
                        {item.label} — up to {item.max_payload_kg} kg
                      </option>
                    ))}
                  </select>
                </label>
                <p className="text-xs leading-5 text-ink-400">
                  {motorised
                    ? "A motor vehicle needs a valid driving licence and its registration document."
                    : "A bicycle needs no licence or registration; your identity evidence is enough."}
                </p>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm font-bold text-ink-200">
                    Make, model and year
                    <input value={makeModel} onChange={event => setMakeModel(event.target.value)} maxLength={120} className="field mt-1.5 font-normal" />
                  </label>
                  <label className="block text-sm font-bold text-ink-200">
                    Plate or identifier
                    <input value={plate} onChange={event => setPlate(event.target.value)} maxLength={24} className="field mt-1.5 font-normal" />
                  </label>
                </div>

                <label className="block text-sm font-bold text-ink-200">
                  How do you have this vehicle?
                  <select value={ownership} onChange={event => setOwnership(event.target.value)} className="field mt-1.5 font-normal">
                    {ownershipOptions.map(option => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>

                {motorised && (
                  <div className="space-y-3 rounded-xl border border-white/10 p-3">
                    <p className="text-sm font-bold text-white">Driving licence</p>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <label className="block text-sm font-bold text-ink-200">
                        Licence number
                        <input value={licenceNumber} onChange={event => setLicenceNumber(event.target.value)} maxLength={40} className="field mt-1.5 font-normal" />
                      </label>
                      <label className="block text-sm font-bold text-ink-200">
                        Class / category
                        <input value={licenceClass} onChange={event => setLicenceClass(event.target.value)} maxLength={20} placeholder="e.g. A, B, BCE" className="field mt-1.5 font-normal" />
                      </label>
                      <label className="block text-sm font-bold text-ink-200">
                        Expiry
                        <input type="date" value={licenceExpiry} onChange={event => setLicenceExpiry(event.target.value)} className="field mt-1.5 font-normal" />
                      </label>
                    </div>
                    <p className="text-xs leading-5 text-ink-400">
                      An expired licence is refused by the server, not just by this form.
                    </p>
                  </div>
                )}

                <div className="grid gap-3 sm:grid-cols-2">
                  {[
                    { label: "Payload (kg)", value: payload, set: setPayload, max: selectedClass?.max_payload_kg },
                    { label: "Length (cm)", value: length, set: setLength, max: selectedClass?.max_length_cm },
                    { label: "Width (cm)", value: width, set: setWidth, max: selectedClass?.max_width_cm },
                    { label: "Height (cm)", value: height, set: setHeight, max: selectedClass?.max_height_cm },
                  ].map(field => (
                    <label key={field.label} className="block text-sm font-bold text-ink-200">
                      {field.label}
                      <input
                        value={field.value}
                        onChange={event => field.set(event.target.value)}
                        inputMode="numeric"
                        className="field mt-1.5 font-normal"
                        placeholder={field.max ? `up to ${field.max}` : "optional"}
                      />
                    </label>
                  ))}
                </div>
                <div className="grid gap-2 text-sm sm:grid-cols-3">
                  <label className="flex items-center gap-2"><input type="checkbox" checked={covered} onChange={event => setCovered(event.target.checked)} className="accent-brand-500" /> Covered cargo</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={fragile} onChange={event => setFragile(event.target.checked)} className="accent-brand-500" /> Fragile goods</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={temperature} onChange={event => setTemperature(event.target.checked)} className="accent-brand-500" /> Cold chain</label>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm font-bold text-ink-200">
                    Route from
                    <select value={originId} onChange={event => setOriginId(event.target.value)} className="field mt-1.5 font-normal">
                      <option value="">No fixed route</option>
                      {counties.map(county => <option key={county.id} value={county.id}>{county.county}</option>)}
                    </select>
                  </label>
                  <label className="block text-sm font-bold text-ink-200">
                    Route to
                    <select value={destinationId} onChange={event => setDestinationId(event.target.value)} className="field mt-1.5 font-normal">
                      <option value="">No fixed route</option>
                      {counties.map(county => <option key={county.id} value={county.id}>{county.county}</option>)}
                    </select>
                  </label>
                </div>
                <p className="text-xs leading-5 text-ink-400">
                  A route is published after approval, because only an approved delivery partner may publish
                  routes. Matching offers shipments on your published route or inside your approved service areas.
                </p>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-4">
                <p className="text-sm leading-6 text-ink-300">
                  These are the documents this activity needs. JPEG, PNG, WebP or PDF, up to 5 MB each, stored in
                  a private bucket. Optional items are listed because the owner may request them later.
                </p>
                {otherDocuments.length === 0 && (
                  <p className="text-sm text-ink-400">No further documents are required for this activity.</p>
                )}
                {otherDocuments.map(row => (
                  <DocumentCapture
                    key={row.doc_type}
                    userId={userId}
                    docType={row.doc_type}
                    label={row.label}
                    hint={
                      row.applies_to === "vehicle"
                        ? "The document for this vehicle, with the plate number visible where applicable."
                        : row.applies_to === "fleet"
                          ? "A document for the business, not for you personally."
                          : "Your driving licence, front and photo page."
                    }
                    required={row.is_required}
                    status={row.status}
                    reviewerNote={row.reviewer_note}
                    value={files[row.doc_type] ?? null}
                    onChange={value => setFiles(previous => ({ ...previous, [row.doc_type]: value }))}
                    onError={setError}
                  />
                ))}
              </div>
            )}

            {step === 3 && (
              <div className="space-y-3 text-sm">
                <h2 className="text-lg font-black text-white">Review</h2>
                <dl className="grid gap-2 sm:grid-cols-2">
                  {[
                    ["Mode", modeLabels[mode]],
                    ["Name", fullName],
                    ["Phone", phone],
                    ["Identity", idNumber ? `${idType.replaceAll("_", " ")} · ${idNumber}` : ""],
                    ...(mode === "fleet" ? [["Business", businessName] as [string, string]] : []),
                    ["Area", operatingArea],
                    ["Vehicle", `${makeModel} · ${plate}`],
                    ["Class", `${selectedClass?.label ?? classCode}${payload ? ` · ${payload} kg` : ""}`],
                    ["Ownership", ownershipOptions.find(option => option.value === ownership)?.label ?? ownership],
                    ...(motorised
                      ? [["Licence", `${licenceNumber} · ${licenceClass} · expires ${licenceExpiry}`] as [string, string]]
                      : []),
                    [
                      "Route",
                      originId && destinationId
                        ? `${counties.find(c => c.id === originId)?.county} → ${counties.find(c => c.id === destinationId)?.county}`
                        : "No fixed route",
                    ],
                    ["Documents", `${documentsPayload().length} attached`],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-xl border border-white/10 p-3">
                      <dt className="text-xs font-bold uppercase tracking-wide text-ink-500">{label}</dt>
                      <dd className="mt-1 break-words text-ink-100">{value || "—"}</dd>
                    </div>
                  ))}
                </dl>
                <label className="flex items-start gap-3 rounded-xl border border-white/10 p-3 text-sm leading-6 text-ink-200">
                  <input type="checkbox" checked={terms} onChange={event => setTerms(event.target.checked)} className="mt-1 accent-brand-500" />
                  <span>
                    I confirm the information is accurate, that I am authorised to operate this vehicle, and I
                    accept the deliverer terms and privacy notice. I understand that submitting does not approve
                    me, that taking a photograph does not prove a document is authentic, and that Shilevi does not
                    employ me or guarantee work.
                  </span>
                </label>
              </div>
            )}

            {error && <p role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-100">{error}</p>}
            {notice && <p role="status" className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-100">{notice}</p>}

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
              <button
                type="button"
                onClick={() => setStep(Math.max(0, step - 1))}
                disabled={step === 0 || Boolean(busy)}
                className="btn btn-secondary disabled:opacity-40"
              >
                Back
              </button>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => void saveDraft()} disabled={Boolean(busy)} className="btn btn-secondary">
                  {busy === "draft" ? "Saving…" : "Save draft"}
                </button>
                {step < steps.length - 1 ? (
                  <button type="button" onClick={() => void next()} disabled={Boolean(busy)} className="btn btn-primary">
                    {busy === "draft" ? "Saving…" : "Continue"}
                  </button>
                ) : (
                  <button type="button" onClick={() => void submit()} disabled={Boolean(busy)} className="btn btn-primary">
                    {busy === "submit" ? "Submitting…" : "Submit application"}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
