"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export type DocumentType = {
  code: string;
  label: string;
  applies_to: string;
  is_required: boolean;
  is_active: boolean;
  sort_order: number;
};

const APPLIES_TO = [
  { value: "provider", label: "Individual provider / deliverer" },
  { value: "vehicle", label: "Vehicle" },
  { value: "driver", label: "Fleet driver" },
  { value: "fleet", label: "Fleet business" },
];

const EMPTY = {
  code: "",
  label: "",
  applies_to: "provider",
  is_required: false,
  is_active: true,
  sort_order: "100",
};

/**
 * Document requirement configuration.
 *
 * These rows are the policy the onboarding wizard and the review screens read. Deciding that a
 * driving licence or insurance certificate is mandatory is the owner's legal/policy call, so every
 * requirement starts off and nothing here is pre-ticked. The table's RLS policy already restricts
 * writes to an allowlisted owner at aal2; this component only proves the input is well formed.
 */
export default function DocumentRequirementsClient({ rows }: { rows: DocumentType[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);

  function startEdit(row: DocumentType) {
    setEditing(row.code);
    setForm({
      code: row.code,
      label: row.label,
      applies_to: row.applies_to,
      is_required: row.is_required,
      is_active: row.is_active,
      sort_order: String(row.sort_order),
    });
    setMessage("");
    setFailed(false);
  }

  function reset() {
    setEditing(null);
    setForm(EMPTY);
    setMessage("");
    setFailed(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setFailed(false);

    const code = form.code.trim().toLowerCase();
    const label = form.label.trim();
    const sortOrder = Number(form.sort_order);

    if (!/^[a-z0-9_]{2,60}$/.test(code)) {
      setFailed(true);
      setMessage("Use a lowercase code of 2–60 characters: letters, numbers and underscores.");
      return;
    }
    if (label.length < 1 || label.length > 120) {
      setFailed(true);
      setMessage("The label must be 1–120 characters.");
      return;
    }
    if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 100000) {
      setFailed(true);
      setMessage("Sort order must be a whole number between 0 and 100,000.");
      return;
    }

    setBusy(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const values = {
        code,
        label,
        applies_to: form.applies_to,
        is_required: form.is_required,
        is_active: form.is_active,
        sort_order: sortOrder,
      };
      const { error } = await supabase.from("delivery_document_types").upsert(values, { onConflict: "code" });
      if (error) throw error;
      setMessage(editing ? "Requirement updated." : "Requirement added.");
      setEditing(null);
      setForm(EMPTY);
      router.refresh();
    } catch {
      setFailed(true);
      setMessage(
        "Save failed. Only an allowlisted owner at MFA level 2 may change requirements, and codes cannot be renamed once documents use them.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function toggle(row: DocumentType, field: "is_required" | "is_active") {
    const next = !row[field];
    if (
      field === "is_required" &&
      next &&
      !window.confirm(
        `Make “${row.label}” mandatory? New applicants in this scope will have to supply it before they can be approved. Existing approved documents are not re-reviewed automatically.`,
      )
    ) {
      return;
    }
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase
        .from("delivery_document_types")
        .update({ [field]: next })
        .eq("code", row.code);
      if (error) throw error;
      router.refresh();
    } catch {
      setFailed(true);
      setMessage("That change was refused. Requirements can only be changed by an owner at MFA level 2.");
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <section>
        {message ? (
          <p
            role={failed ? "alert" : "status"}
            className={`mb-4 rounded-xl border p-4 text-sm leading-6 ${
              failed
                ? "border-rose-500/40 bg-rose-500/10 text-rose-100"
                : "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
            }`}
          >
            {message}
          </p>
        ) : null}

        {rows.length === 0 ? (
          <p className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-sm leading-6 text-ink-300">
            No document types exist yet. Add the ones your policy actually requires — an empty
            catalogue means no applicant is asked for evidence, which is a real state, not a load
            failure.
          </p>
        ) : (
          <ul className="space-y-2">
            {rows.map(row => (
              <li
                key={row.code}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4"
              >
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-white">{row.label}</span>
                    <span className="rounded-full border border-white/15 px-2 py-0.5 font-mono text-[10px] text-ink-300">
                      {row.code}
                    </span>
                    {row.is_required ? (
                      <span className="rounded-full border border-amber-400/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-100">
                        Required
                      </span>
                    ) : (
                      <span className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] font-bold uppercase text-ink-400">
                        Optional
                      </span>
                    )}
                    {!row.is_active ? (
                      <span className="rounded-full border border-rose-400/40 bg-rose-500/10 px-2 py-0.5 text-[10px] font-bold uppercase text-rose-100">
                        Hidden
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-1 text-xs text-ink-400">
                    {APPLIES_TO.find(option => option.value === row.applies_to)?.label ?? row.applies_to} ·
                    order {row.sort_order}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void toggle(row, "is_required")}
                    className="rounded-full border border-white/20 px-3 py-1.5 text-xs font-bold text-ink-100 hover:border-white/40"
                  >
                    {row.is_required ? "Make optional" : "Make required"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void toggle(row, "is_active")}
                    className="rounded-full border border-white/20 px-3 py-1.5 text-xs font-bold text-ink-100 hover:border-white/40"
                  >
                    {row.is_active ? "Hide" : "Show"}
                  </button>
                  <button
                    type="button"
                    onClick={() => startEdit(row)}
                    className="rounded-full border border-white/20 px-3 py-1.5 text-xs font-bold text-ink-100 hover:border-white/40"
                  >
                    Edit
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <aside className="h-fit rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <h2 className="text-lg font-black text-white">{editing ? "Edit requirement" : "Add requirement"}</h2>
        <form onSubmit={submit} className="mt-4 space-y-3">
          <label className="block text-sm font-bold text-ink-100">
            Code
            <input
              required
              maxLength={60}
              readOnly={editing !== null}
              value={form.code}
              onChange={event => setForm({ ...form, code: event.target.value.toLowerCase() })}
              placeholder="vehicle_insurance"
              className="mt-1 w-full rounded-xl border border-white/15 bg-ink-950/60 px-3 py-2 font-mono text-sm text-white read-only:opacity-60"
            />
          </label>
          <label className="block text-sm font-bold text-ink-100">
            Label
            <input
              required
              maxLength={120}
              value={form.label}
              onChange={event => setForm({ ...form, label: event.target.value })}
              placeholder="Vehicle insurance certificate"
              className="mt-1 w-full rounded-xl border border-white/15 bg-ink-950/60 px-3 py-2 text-sm font-normal text-white"
            />
          </label>
          <label className="block text-sm font-bold text-ink-100">
            Applies to
            <select
              value={form.applies_to}
              onChange={event => setForm({ ...form, applies_to: event.target.value })}
              className="mt-1 w-full rounded-xl border border-white/15 bg-ink-950/60 px-3 py-2 text-sm font-normal text-white"
            >
              {APPLIES_TO.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-bold text-ink-100">
            Sort order
            <input
              type="number"
              min={0}
              max={100000}
              step={1}
              value={form.sort_order}
              onChange={event => setForm({ ...form, sort_order: event.target.value })}
              className="mt-1 w-full rounded-xl border border-white/15 bg-ink-950/60 px-3 py-2 text-sm font-normal text-white"
            />
          </label>
          <label className="flex items-center gap-2 text-sm font-semibold text-ink-100">
            <input
              type="checkbox"
              checked={form.is_required}
              onChange={event => setForm({ ...form, is_required: event.target.checked })}
              className="accent-brand-500"
            />
            Mandatory before approval
          </label>
          <label className="flex items-center gap-2 text-sm font-semibold text-ink-100">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={event => setForm({ ...form, is_active: event.target.checked })}
              className="accent-brand-500"
            />
            Shown to applicants
          </label>
          <div className="flex gap-2">
            <button
              disabled={busy}
              className="btn btn-primary flex-1 !py-2.5 !text-sm disabled:opacity-60"
            >
              {busy ? "Saving…" : editing ? "Save changes" : "Add requirement"}
            </button>
            {editing ? (
              <button
                type="button"
                onClick={reset}
                className="rounded-xl border border-white/20 px-4 py-2.5 text-sm font-semibold text-ink-100"
              >
                Cancel
              </button>
            ) : null}
          </div>
        </form>
        <p className="mt-4 text-xs leading-5 text-ink-500">
          Marking a document mandatory changes what new applicants must supply. It never re-opens or
          invalidates an approved document, and it does not by itself suspend anyone.
        </p>
      </aside>
    </div>
  );
}
