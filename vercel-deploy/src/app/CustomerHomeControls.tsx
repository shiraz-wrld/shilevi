"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Props = {
  counties: string[];
  area: string | null;
  personalizationEnabled: boolean;
};

/**
 * Area and privacy controls for the signed-in home.
 *
 * Both writes go through `set_customer_area` / `clear_my_marketplace_history`, which validate the
 * county against `service_locations` and scope everything to `auth.uid()` in the database. The
 * component only *reports* what the database returned: it never shows "saved" for a failed call.
 *
 * Discovery is ranked by the county chosen here. Shilevi does not read the device GPS, because
 * listings carry no coordinates and the platform has no geocoder — a "nearby" claim computed from
 * nothing would be a lie. The copy says so.
 */
export function CustomerHomeControls({ counties, area, personalizationEnabled }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState(area ?? "");
  const [enabled, setEnabled] = useState(personalizationEnabled);
  const [message, setMessage] = useState("");
  const [tone, setTone] = useState<"ok" | "error">("ok");
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  async function save(nextCounty: string, nextEnabled: boolean) {
    setBusy(true);
    setMessage("");
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.rpc("set_customer_area", {
        p_county: nextCounty.trim() === "" ? null : nextCounty.trim(),
        p_personalization_enabled: nextEnabled,
      });
      if (error) throw error;
      setTone("ok");
      setMessage(nextCounty.trim() ? `Area saved as ${nextCounty.trim()}.` : "Area cleared.");
      startTransition(() => router.refresh());
    } catch (error) {
      setTone("error");
      setMessage(error instanceof Error ? error.message : "That change could not be saved.");
      // Put the controls back to the last state the server confirmed.
      setSelected(area ?? "");
      setEnabled(personalizationEnabled);
    } finally {
      setBusy(false);
    }
  }

  async function clearHistory() {
    setBusy(true);
    setMessage("");
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.rpc("clear_my_marketplace_history");
      if (error) throw error;
      setTone("ok");
      setMessage("Your browsing history and saved area were cleared.");
      setSelected("");
      setEnabled(true);
      startTransition(() => router.refresh());
    } catch (error) {
      setTone("error");
      setMessage(error instanceof Error ? error.message : "Your history could not be cleared.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="surface p-5">
      <h2 className="text-sm font-bold uppercase tracking-[0.12em] text-ink-400">Area &amp; personalisation</h2>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="field-label">
          Discovery area
          <select
            value={selected}
            onChange={event => setSelected(event.target.value)}
            className="field mt-1.5 font-normal"
            disabled={busy || pending}
          >
            <option value="">No area chosen</option>
            {counties.map(county => (
              <option key={county} value={county}>
                {county}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-start gap-3 rounded-2xl border border-line p-4 text-sm leading-6 text-ink-600">
          <input
            type="checkbox"
            checked={enabled}
            onChange={event => setEnabled(event.target.checked)}
            className="mt-1"
            disabled={busy || pending}
          />
          <span>
            <span className="block font-semibold text-ink-900">Personalise my home</span>
            Use my searches, views, saved items and past orders to rank what I see. Turning this off
            keeps area and newest listings only.
          </span>
        </label>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void save(selected, enabled)}
          disabled={busy || pending}
          className="btn btn-primary"
        >
          {busy || pending ? "Saving…" : "Save preferences"}
        </button>
        <button type="button" onClick={() => void clearHistory()} disabled={busy || pending} className="btn btn-secondary">
          Clear my history
        </button>
      </div>

      {message && (
        <p role={tone === "error" ? "alert" : "status"} className={tone === "error" ? "notice notice-error mt-4" : "notice notice-success mt-4"}>
          {message}
        </p>
      )}

      <p className="mt-4 text-xs leading-5 text-ink-400">
        Discovery is ranked by the county you choose. Shilevi does not read your device location, and
        no listing is described as “nearby” unless its own county is known and matches yours.
      </p>
    </div>
  );
}
