"use client";

import { useState } from "react";
import { MapCanvas } from "./MapCanvas";

/**
 * An explicit point picker: the person clicks the exact spot, or asks the device for one fix.
 *
 * Nothing is ever inferred. The initial view is Nairobi city centre simply so the map has somewhere
 * to open; it is not a claim about where the user is, and no pin exists until they place one. Asking
 * for a device fix is a button, never a page-load prompt.
 */

export type PickedPoint = {
  latitude: number;
  longitude: number;
  accuracy_m: number | null;
  source: "map" | "device";
};

const INITIAL_VIEW = { latitude: -1.2864, longitude: 36.8172 };

function format(value: number) {
  return value.toFixed(5);
}

export function MapPinPicker({
  value,
  onChange,
  landmark,
  onLandmarkChange,
  landmarkLabel = "Landmark or directions",
  disabled = false,
}: {
  value: PickedPoint | null;
  onChange: (point: PickedPoint | null) => void;
  landmark?: string;
  onLandmarkChange?: (value: string) => void;
  landmarkLabel?: string;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchNote, setSearchNote] = useState("");

  async function lookUpAddress() {
    setError("");
    setSearchNote("");
    if (search.trim().length < 5) {
      setError("Type at least five characters of the address.");
      return;
    }
    setSearchBusy(true);
    try {
      const response = await fetch("/api/geocode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: search.trim() }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        latitude?: number; longitude?: number; label?: string; error?: string;
      };
      if (!response.ok) {
        setError(payload.error ?? "That address could not be looked up. Tap the map instead.");
        return;
      }
      if (typeof payload.latitude !== "number" || typeof payload.longitude !== "number") {
        setError("The lookup returned no usable point. Tap the map instead.");
        return;
      }
      onChange({ latitude: payload.latitude, longitude: payload.longitude, accuracy_m: null, source: "map" });
      setSearchNote(`Placed from \u201c${payload.label ?? search.trim()}\u201d. Check the point and tap the exact spot if it is off.`);
    } catch {
      setError("Address lookup is unreachable right now. Tap the map to place the point.");
    } finally {
      setSearchBusy(false);
    }
  }

  function useDeviceLocation() {
    setError("");
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setError("This browser cannot read a device location. Tap the map to place the point instead.");
      return;
    }
    if (!window.isSecureContext) {
      setError("A device location needs a secure (https) page. Tap the map to place the point instead.");
      return;
    }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      fix => {
        setBusy(false);
        onChange({
          latitude: fix.coords.latitude,
          longitude: fix.coords.longitude,
          accuracy_m: Number.isFinite(fix.coords.accuracy) ? fix.coords.accuracy : null,
          source: "device",
        });
      },
      failure => {
        setBusy(false);
        setError(
          failure.code === failure.PERMISSION_DENIED
            ? "Location permission was refused. Tap the map to place the point instead — nothing else is sent."
            : "Your device could not provide a position. Tap the map to place the point instead.",
        );
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }

  const points = value
    ? [{
        id: "picked",
        latitude: value.latitude,
        longitude: value.longitude,
        label: value.source === "device" ? "Device location" : "Selected point",
        detail: value.accuracy_m ? `±${Math.round(value.accuracy_m)} m` : null,
        tone: "brand" as const,
        pulse: true,
      }]
    : [];

  return (
    <div className="rounded-2xl border border-line bg-white p-4">
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <label className="field-label flex-1">
          Find an address (optional)
          <input
            value={search}
            onChange={event => setSearch(event.target.value)}
            maxLength={200}
            disabled={disabled || searchBusy}
            placeholder="e.g. Kimathi Street, Nairobi"
            className="field mt-1.5 font-normal"
          />
        </label>
        <button type="button" onClick={() => void lookUpAddress()} disabled={disabled || searchBusy} className="btn btn-secondary text-sm">
          {searchBusy ? "Looking up…" : "Find"}
        </button>
      </div>
      {searchNote && <p className="notice mb-3 text-sm">{searchNote}</p>}

      <MapCanvas
        points={points}
        center={value ? { latitude: value.latitude, longitude: value.longitude } : INITIAL_VIEW}
        zoom={value ? 16 : 13}
        height="h-56"
        onPick={disabled ? undefined : picked => onChange({ ...picked, accuracy_m: null, source: "map" })}
        emptyMessage="Tap the map to place the point."
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={useDeviceLocation} disabled={busy || disabled} className="btn btn-secondary text-sm">
          {busy ? "Reading device…" : "Use my current location"}
        </button>
        {value && (
          <button type="button" onClick={() => onChange(null)} disabled={disabled} className="btn btn-quiet text-sm">
            Clear point
          </button>
        )}
        <span className="text-xs text-ink-500">
          {value
            ? `${format(value.latitude)}, ${format(value.longitude)}${value.accuracy_m ? ` · ±${Math.round(value.accuracy_m)} m` : ""}`
            : "No point selected. Tap the map at your exact gate or entrance."}
        </span>
      </div>

      {error && <p className="notice notice-warn mt-3 text-sm">{error}</p>}

      {onLandmarkChange && (
        <label className="field-label mt-3">
          {landmarkLabel}
          <input
            maxLength={200}
            value={landmark ?? ""}
            onChange={event => onLandmarkChange(event.target.value)}
            placeholder="e.g. blue gate opposite the petrol station"
            disabled={disabled}
            className="field mt-1.5 font-normal"
          />
          <span className="mt-1 block text-xs font-normal text-ink-400">
            Shown only to the rider or driver on this job. Do not include passwords or payment details.
          </span>
        </label>
      )}
    </div>
  );
}
