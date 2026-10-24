"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const activities = [
  { value: "product_seller", label: "Product seller", detail: "Sell approved physical goods." },
  { value: "service_provider", label: "Service provider", detail: "Offer professional, local or salon services." },
  { value: "transport_partner", label: "Transport & delivery partner", detail: "Provide passenger transport or delivery." },
  { value: "property_provider", label: "Property & places provider", detail: "List property, accommodation or venues." },
] as const;

type Activity = (typeof activities)[number]["value"];
type ProviderApplication = { id: string; activity_type: Activity; status: string; submitted_at: string | null; created_at: string };
type Field = {
  key: string;
  label: string;
  placeholder: string;
  required: boolean;
  type?: "text" | "textarea" | "select";
  options?: string[];
  help?: string;
};

const extraFields: Record<Activity, Field[]> = {
  product_seller: [
    { key: "product_categories", label: "What will you sell?", placeholder: "e.g. Clothing, phone accessories, home goods", required: true, help: "List the main product groups. Restricted goods need separate approval." },
    { key: "fulfilment", label: "How will orders be fulfilled?", placeholder: "", required: true, type: "select", options: ["Seller delivery", "Platform delivery", "Customer pickup", "Delivery and pickup"] },
    { key: "stock_location", label: "Where is your stock held?", placeholder: "Town or county", required: true },
    { key: "returns_policy", label: "Your returns approach", placeholder: "e.g. 7-day return for unused items with tags", required: true, type: "textarea" },
  ],
  service_provider: [
    { key: "services_offered", label: "Services you offer", placeholder: "e.g. Hair braiding, bridal makeup, home styling", required: true, type: "textarea", help: "Salons can list treatments, styling and beauty services here." },
    { key: "service_area", label: "Where will you serve customers?", placeholder: "e.g. Nairobi CBD and Kilimani; mobile within 15 km", required: true },
    { key: "availability", label: "Usual availability", placeholder: "e.g. Mon–Sat, 9am–7pm; appointment only", required: true },
    { key: "qualifications", label: "Relevant qualifications or licences", placeholder: "Describe any professional registration. Do not paste ID or licence numbers here.", required: false, type: "textarea" },
  ],
  transport_partner: [
    { key: "modes", label: "Which modes will you operate?", placeholder: "", required: true, type: "select", options: ["Motorcycle", "Car", "Tuk-tuk", "Bicycle", "Van", "More than one mode"] },
    { key: "operating_area", label: "Operating area", placeholder: "e.g. Nairobi and Machakos; inter-town by arrangement", required: true },
    { key: "passenger_work", label: "Will you carry passengers?", placeholder: "", required: true, type: "select", options: ["Yes — passenger trips", "No — deliveries only", "Both passengers and deliveries"] },
    { key: "licence_status", label: "Driving licence and vehicle documents", placeholder: "", required: true, type: "select", options: ["Valid and available for review", "In renewal — will provide later", "Not yet obtained"] },
    { key: "insurance_status", label: "Passenger or goods insurance", placeholder: "", required: true, type: "select", options: ["Insured and available for review", "Arranging cover", "Not insured"] },
    { key: "vehicle_summary", label: "Vehicle summary", placeholder: "e.g. 2016 Toyota Axio, 4 seats", required: true, help: "Add exact plate and capacity in your rider workspace after approval." },
  ],
  property_provider: [
    { key: "property_scope", label: "Where are your properties?", placeholder: "e.g. Nairobi — Kilimani and Kileleshwa", required: true },
    { key: "units_managed", label: "How many units do you manage?", placeholder: "", required: true, type: "select", options: ["1 unit", "2–5 units", "6–20 units", "More than 20 units"] },
    { key: "property_types", label: "Property types", placeholder: "e.g. Apartments, bedsitters, townhouses", required: true },
    { key: "authority", label: "Your authority to advertise", placeholder: "", required: true, type: "select", options: ["I own the property", "I am an authorised manager", "A mix of owned and managed property"] },
    { key: "authority_note", label: "How can ownership or authority be verified?", placeholder: "e.g. title or lease and a utility bill in the owner's name", required: true, type: "textarea", help: "Do not paste document numbers or attach documents here. Reviewers will request evidence through a secure channel." },
  ],
};

const statusLabels: Record<string, string> = {
  draft: "Draft",
  pending: "Submitted — awaiting review",
  under_review: "Under review",
  approved: "Approved",
  rejected: "Rejected",
  suspended: "Suspended",
  withdrawn: "Withdrawn",
};

export default function ProviderApplyPage() {
  const [activity, setActivity] = useState<Activity>("product_seller");
  const [businessName, setBusinessName] = useState("");
  const [introduction, setIntroduction] = useState("");
  const [details, setDetails] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);
  const [applications, setApplications] = useState<ProviderApplication[]>([]);

  const refreshApplications = useCallback(async (id: string) => {
    const supabase = createSupabaseBrowserClient();
    const { data, error } = await supabase
      .from("provider_applications")
      .select("id,activity_type,status,submitted_at,created_at")
      .eq("user_id", id)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    setApplications((data ?? []) as ProviderApplication[]);
  }, []);

  useEffect(() => {
    let alive = true;
    async function checkSession() {
      try {
        const supabase = createSupabaseBrowserClient();
        const { data, error } = await supabase.auth.getUser();
        if (error) throw error;
        if (!data.user) {
          window.location.replace("/login?next=%2Fprovider%2Fapply");
          return;
        }
        if (alive) setUserId(data.user.id);
        await refreshApplications(data.user.id);
      } catch (error) {
        if (alive) setMessage(error instanceof Error ? error.message : "Could not verify your session.");
      } finally {
        if (alive) setLoading(false);
      }
    }
    void checkSession();
    return () => {
      alive = false;
    };
  }, [refreshApplications]);

  function chooseActivity(next: Activity) {
    setActivity(next);
    setDetails({});
    setFieldErrors({});
    setMessage("");
  }

  function validate(): boolean {
    const errors: Record<string, string> = {};
    if (introduction.trim().length < 20) errors.introduction = "Write at least 20 characters so reviewers can assess the application.";
    if (introduction.length > 2000) errors.introduction = "Keep the introduction under 2,000 characters.";
    for (const field of extraFields[activity]) {
      if (field.required && !(details[field.key] ?? "").trim()) errors[field.key] = `${field.label} is required.`;
      if ((details[field.key] ?? "").length > 1000) errors[field.key] = "Keep this answer under 1,000 characters.";
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function saveDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setSuccess(false);
    if (!validate()) {
      setMessage("Check the highlighted answers. Your work has not been lost.");
      return;
    }
    setBusy("save");
    try {
      const supabase = createSupabaseBrowserClient();
      const payload: Record<string, string> = {};
      for (const field of extraFields[activity]) {
        const value = (details[field.key] ?? "").trim();
        if (value) payload[field.key] = value.slice(0, 1000);
      }
      const { error } = await supabase.from("provider_applications").insert({
        user_id: userId,
        activity_type: activity,
        status: "draft",
        business_name: businessName.trim() || null,
        application_data: { introduction: introduction.trim(), details: payload },
        country_code: "KE",
      });
      if (error) {
        if (error.code === "23505") throw new Error("You already have an application for this activity. Submit or review the existing one below.");
        if (error.code === "23514") throw new Error("The application is too large or contains an invalid value. Shorten your answers and try again.");
        throw error;
      }
      setSuccess(true);
      setMessage("Draft saved. Review it below and submit it for review when you are ready.");
      setBusinessName("");
      setIntroduction("");
      setDetails({});
      setFieldErrors({});
      if (userId) await refreshApplications(userId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save your draft application.");
    } finally {
      setBusy("");
    }
  }

  async function submitApplication(applicationId: string) {
    setBusy(applicationId);
    setMessage("");
    setSuccess(false);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase
        .from("provider_applications")
        .update({ status: "pending", submitted_at: new Date().toISOString() })
        .eq("id", applicationId)
        .eq("status", "draft");
      if (error) throw error;
      if (userId) await refreshApplications(userId);
      setSuccess(true);
      setMessage("Application submitted. It is now read-only while the owner reviews it.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not submit this application. Confirm migration 0006 is applied.");
    } finally {
      setBusy("");
    }
  }

  const currentFields = extraFields[activity];

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-12 text-slate-950">
      <section className="mx-auto max-w-3xl rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-9">
        <Link href="/" className="text-xl font-black text-blue-700">shilevi</Link>
        <h1 className="mt-8 text-3xl font-black tracking-tight">Become a provider</h1>
        <p className="mt-3 leading-7 text-slate-600">
          One account can apply for more than one activity. Each activity is reviewed separately, and approval for one
          never authorises another. These questions are specific to the activity you choose.
        </p>

        {loading ? (
          <p className="mt-8 text-slate-600">Checking your session…</p>
        ) : (
          <form onSubmit={saveDraft} className="mt-8 space-y-6" noValidate>
            <fieldset className="space-y-3">
              <legend className="mb-3 text-sm font-bold">What would you like to do?</legend>
              {activities.map(item => (
                <label key={item.value} className={`flex cursor-pointer gap-3 rounded-2xl border p-4 ${activity === item.value ? "border-blue-600 bg-blue-50" : "border-slate-200"}`}>
                  <input type="radio" name="activity" value={item.value} checked={activity === item.value} onChange={() => chooseActivity(item.value)} className="mt-1 accent-blue-700" />
                  <span><span className="block font-semibold">{item.label}</span><span className="mt-1 block text-sm text-slate-600">{item.detail}</span></span>
                </label>
              ))}
            </fieldset>

            <label className="block text-sm font-semibold">
              Business or public name (optional)
              <input maxLength={160} value={businessName} onChange={event => setBusinessName(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal outline-none focus:border-blue-600" placeholder="Name customers may recognise" />
            </label>

            <label className="block text-sm font-semibold">
              Short introduction
              <textarea
                maxLength={2000}
                rows={4}
                value={introduction}
                onChange={event => setIntroduction(event.target.value)}
                aria-invalid={Boolean(fieldErrors.introduction)}
                aria-describedby={fieldErrors.introduction ? "introduction-error" : undefined}
                className={`mt-2 w-full rounded-xl border px-4 py-3 font-normal outline-none focus:border-blue-600 ${fieldErrors.introduction ? "border-red-500" : "border-slate-300"}`}
                placeholder="Tell us about your experience and what you want to offer."
              />
              {fieldErrors.introduction && <span id="introduction-error" role="alert" className="mt-1 block text-sm font-normal text-red-700">{fieldErrors.introduction}</span>}
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              {currentFields.map(field => (
                <label key={field.key} className={`block text-sm font-semibold ${field.type === "textarea" ? "sm:col-span-2" : ""}`}>
                  {field.label}{field.required ? "" : " (optional)"}
                  {field.type === "select" ? (
                    <select
                      value={details[field.key] ?? ""}
                      onChange={event => setDetails(current => ({ ...current, [field.key]: event.target.value }))}
                      aria-invalid={Boolean(fieldErrors[field.key])}
                      className={`mt-2 w-full rounded-xl border px-4 py-3 font-normal outline-none focus:border-blue-600 ${fieldErrors[field.key] ? "border-red-500" : "border-slate-300"}`}
                    >
                      <option value="">Select an option</option>
                      {field.options?.map(option => <option key={option} value={option}>{option}</option>)}
                    </select>
                  ) : field.type === "textarea" ? (
                    <textarea
                      rows={3}
                      maxLength={1000}
                      value={details[field.key] ?? ""}
                      onChange={event => setDetails(current => ({ ...current, [field.key]: event.target.value }))}
                      aria-invalid={Boolean(fieldErrors[field.key])}
                      className={`mt-2 w-full rounded-xl border px-4 py-3 font-normal outline-none focus:border-blue-600 ${fieldErrors[field.key] ? "border-red-500" : "border-slate-300"}`}
                      placeholder={field.placeholder}
                    />
                  ) : (
                    <input
                      maxLength={1000}
                      value={details[field.key] ?? ""}
                      onChange={event => setDetails(current => ({ ...current, [field.key]: event.target.value }))}
                      aria-invalid={Boolean(fieldErrors[field.key])}
                      className={`mt-2 w-full rounded-xl border px-4 py-3 font-normal outline-none focus:border-blue-600 ${fieldErrors[field.key] ? "border-red-500" : "border-slate-300"}`}
                      placeholder={field.placeholder}
                    />
                  )}
                  {field.help && <span className="mt-1 block text-xs font-normal leading-5 text-slate-500">{field.help}</span>}
                  {fieldErrors[field.key] && <span role="alert" className="mt-1 block text-sm font-normal text-red-700">{fieldErrors[field.key]}</span>}
                </label>
              ))}
            </div>

            <p className="rounded-xl bg-amber-50 p-4 text-sm leading-6 text-amber-900">
              This creates a draft only. It does not approve your provider account or permit publishing. Do not include ID
              numbers, passwords, bank details, or other sensitive information here.
            </p>

            <button disabled={busy === "save" || !userId} className="w-full rounded-xl bg-blue-700 px-5 py-3 font-bold text-white hover:bg-blue-800 disabled:opacity-60">
              {busy === "save" ? "Saving draft…" : "Save draft application"}
            </button>
            {message && (
              <p role={success ? "status" : "alert"} className={success ? "text-sm leading-6 text-green-700" : "text-sm leading-6 text-red-700"}>
                {message}
                {success && activity === "transport_partner" && <> <Link href="/provider/transport-details" className="font-semibold underline">Add transport service details</Link></>}
              </p>
            )}
          </form>
        )}

        <section className="mt-8 border-t border-slate-200 pt-6">
          <h2 className="text-xl font-black">Your applications</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">Submit a draft when ready. Submitted applications are read-only while the owner reviews them.</p>
          {applications.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">No applications found yet.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {applications.map(application => (
                <li key={application.id} className="flex flex-col gap-3 rounded-xl border border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-bold">{activities.find(item => item.value === application.activity_type)?.label ?? application.activity_type}</p>
                    <p className="mt-1 text-sm text-slate-600">Status: <span className="font-semibold">{statusLabels[application.status] ?? application.status.replaceAll("_", " ")}</span></p>
                    <p className="mt-1 text-xs text-slate-500">Created {new Date(application.created_at).toLocaleDateString()}</p>
                  </div>
                  {application.status === "draft" ? (
                    <button type="button" disabled={Boolean(busy)} onClick={() => void submitApplication(application.id)} className="rounded-full bg-blue-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-60">
                      {busy === application.id ? "Submitting…" : "Submit for review"}
                    </button>
                  ) : application.status === "approved" ? (
                    <p className="text-sm font-semibold text-green-700">Approved</p>
                  ) : (
                    <p className="text-sm text-slate-600">{statusLabels[application.status] ?? "Status updated"}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
        <p className="mt-6 text-sm text-slate-600"><Link href="/account" className="font-semibold text-blue-700">Return to your account</Link></p>
      </section>
    </main>
  );
}
