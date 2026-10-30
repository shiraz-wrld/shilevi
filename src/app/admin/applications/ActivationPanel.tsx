"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export type CategoryOption = {
  id: string;
  name: string;
  division: string;
  slug: string;
};

const DIVISION_BY_ACTIVITY: Record<string, string> = {
  product_seller: "products",
  service_provider: "services",
  transport_partner: "transport_delivery",
  property_provider: "property_places",
};

const DEFAULT_TRANSACTIONS: Record<string, string[]> = {
  products: ["sale"],
  services: ["service", "booking", "quote"],
  transport_delivery: ["delivery", "ride"],
  property_places: ["rent", "booking", "viewing", "lease"],
};

const ALL_TRANSACTIONS = [
  "sale",
  "rent",
  "short_stay",
  "booking",
  "quote",
  "viewing",
  "delivery",
  "ride",
  "hire",
  "lease",
];

/**
 * Category activation for an approved provider.
 *
 * Approval is a decision about a person; an activity is a permission to trade in one category. The
 * two are deliberately separate: `provider_activities` was unreachable before migration 0033, so an
 * approved provider had no category permission and the console could not grant one. This panel calls
 * `admin_grant_provider_activity`, which re-checks the owner allowlist, MFA level 2, the approved
 * application and the category's division inside the database.
 */
export default function ActivationPanel({
  applicationId,
  activityType,
  categories,
}: {
  applicationId: string;
  activityType: string;
  categories: CategoryOption[];
}) {
  const router = useRouter();
  const division = DIVISION_BY_ACTIVITY[activityType] ?? "";
  const options = categories.filter(category => category.division === division);
  const defaults = DEFAULT_TRANSACTIONS[division] ?? ["sale"];
  const [categoryId, setCategoryId] = useState(options[0]?.id ?? "");
  const [types, setTypes] = useState<string[]>(defaults);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);

  function toggleType(value: string) {
    setTypes(current =>
      current.includes(value) ? current.filter(item => item !== value) : [...current, value],
    );
  }

  async function activate() {
    if (!categoryId) {
      setFailed(true);
      setMessage("Choose a category first. An active category in this activity is required.");
      return;
    }
    if (types.length === 0) {
      setFailed(true);
      setMessage("Choose at least one transaction type.");
      return;
    }
    setBusy(true);
    setMessage("");
    setFailed(false);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.rpc("admin_grant_provider_activity", {
        p_application_id: applicationId,
        p_category_id: categoryId,
        p_transaction_types: types,
        p_verification_tier: 1,
      });
      if (error) {
        const missing = error.code === "PGRST202" || error.code === "42883";
        setFailed(true);
        setMessage(
          missing
            ? "Category activation is not installed on this database yet (migration 0033). Nothing was changed."
            : /not authorized/i.test(error.message)
              ? "The database refused this activation for this session. Verify your authenticator and retry."
              : /different provider activity|inactive category|approved provider application|transaction type/i.test(
                    error.message,
                  )
                ? error.message
                : "The activation could not be recorded. Nothing was changed.",
        );
        return;
      }
      setMessage("Category activated. The provider can now publish in it, and the grant is audited.");
      router.refresh();
    } catch {
      setFailed(true);
      setMessage("The activation could not be sent. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
      <h3 className="text-[11px] font-bold uppercase tracking-wide text-emerald-200/80">
        Category activation
      </h3>
      <p className="mt-1 text-xs leading-5 text-ink-300">
        Approval alone authorises nothing for sale. Activate exactly the categories this provider may
        trade in — a division mismatch is refused by the database, and every grant is audited.
      </p>

      {options.length === 0 ? (
        <p className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs leading-5 text-amber-100">
          No active category exists in this division yet. Activate a category under Categories, then
          return here.
        </p>
      ) : (
        <>
          <label className="mt-3 block text-xs font-bold text-ink-100">
            Category
            <select
              value={categoryId}
              onChange={event => setCategoryId(event.target.value)}
              className="mt-1 w-full rounded-lg border border-white/15 bg-ink-950/60 px-3 py-2 text-sm font-normal text-white"
            >
              {options.map(option => (
                <option key={option.id} value={option.id}>
                  {option.name} ({option.slug})
                </option>
              ))}
            </select>
          </label>

          <fieldset className="mt-3">
            <legend className="text-xs font-bold text-ink-100">Transaction types</legend>
            <div className="mt-1 flex flex-wrap gap-2">
              {ALL_TRANSACTIONS.map(value => (
                <label
                  key={value}
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-2.5 py-1 text-[11px] font-semibold text-ink-200"
                >
                  <input
                    type="checkbox"
                    checked={types.includes(value)}
                    onChange={() => toggleType(value)}
                    className="accent-emerald-500"
                  />
                  {value.replace("_", " ")}
                </label>
              ))}
            </div>
          </fieldset>

          <button
            type="button"
            disabled={busy}
            onClick={() => void activate()}
            className="mt-3 rounded-full bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
          >
            {busy ? "Activating…" : "Activate category"}
          </button>
        </>
      )}

      {message ? (
        <p
          role={failed ? "alert" : "status"}
          className={`mt-3 rounded-lg border p-3 text-xs leading-5 ${
            failed
              ? "border-rose-500/40 bg-rose-500/10 text-rose-100"
              : "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
          }`}
        >
          {message}
        </p>
      ) : null}
    </section>
  );
}
