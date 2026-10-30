"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { MapCanvas, type MapPoint } from "./MapCanvas";

/**
 * Live delivery or ride tracking for the customer.
 *
 * Everything shown here comes from `delivery_tracking()` / `ride_tracking()`, which decide server
 * side whether this account may see the position at all. The card therefore has three honest
 * states and no fourth: a real position, "assigned but not sharing", or "tracking has not started".
 * It never falls back to a placeholder pin, a guessed address or a computed ETA.
 */

type TrackingPosition = {
  latitude: number;
  longitude: number;
  accuracy_m: number | null;
  heading_deg: number | null;
  updated_at: string;
  age_seconds: number | null;
  stale: boolean;
};

type TrackingDocument = {
  delivery_id?: string;
  ride_id?: string;
  status: string;
  live: boolean;
  pickup_label?: string | null;
  dropoff_label?: string | null;
  pickup_point?: { latitude: number; longitude: number } | null;
  dropoff_point?: { latitude: number; longitude: number } | null;
  rider: { display_name: string; vehicle: string | null } | null;
  position: TrackingPosition | null;
  notice: string | null;
};

const STATUS_LABELS: Record<string, string> = {
  assigned: "Rider assigned",
  to_pickup: "Heading to pickup",
  collected: "Collected",
  in_transit: "On the way to you",
  delivered: "Delivered",
  failed: "Delivery failed",
  cancelled: "Cancelled",
  agreed: "Fare agreed",
  paid: "Paid",
  arrived: "Driver arrived",
  in_progress: "Trip in progress",
  rider_completed: "Completed by driver",
  completed: "Completed",
};

/** Seconds since the position was reported, recomputed locally so the age never freezes. */
function useAgeSeconds(updatedAt: string | null) {
  const [age, setAge] = useState<number | null>(null);

  useEffect(() => {
    if (!updatedAt) {
      setAge(null);
      return;
    }
    const parsed = new Date(updatedAt).getTime();
    if (Number.isNaN(parsed)) {
      setAge(null);
      return;
    }
    const tick = () => setAge(Math.max(0, Math.round((Date.now() - parsed) / 1000)));
    tick();
    const timer = window.setInterval(tick, 5000);
    return () => window.clearInterval(timer);
  }, [updatedAt]);

  return age;
}

export function LiveTrackingCard({
  kind,
  id,
  title,
}: {
  kind: "delivery" | "ride";
  id: string;
  title?: string;
}) {
  const [tracking, setTracking] = useState<TrackingDocument | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const alive = useRef(true);

  const load = useCallback(async () => {
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      setError("Tracking is unavailable for this reference.");
      setLoading(false);
      return;
    }
    try {
      const db = createSupabaseBrowserClient();
      const result = kind === "delivery"
        ? await db.rpc("delivery_tracking", { p_delivery_id: id })
        : await db.rpc("ride_tracking", { p_ride_id: id });
      if (!alive.current) return;
      if (result.error) throw result.error;
      setTracking((result.data as unknown as TrackingDocument) ?? null);
      setError("");
    } catch (caught) {
      if (!alive.current) return;
      setError(caught instanceof Error ? caught.message : "We could not load live tracking right now.");
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [id, kind]);

  useEffect(() => {
    alive.current = true;
    void load();
    const timer = window.setInterval(() => { void load(); }, 20000);
    const onFocus = () => { void load(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      alive.current = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [load]);

  const age = useAgeSeconds(tracking?.position?.updated_at ?? null);
  const heading = title ?? (kind === "delivery" ? "Live rider tracking" : "Live driver tracking");

  if (loading && !tracking && !error) {
    return (
      <section className="surface p-6" aria-busy="true">
        <h2 className="text-xl font-black">{heading}</h2>
        <p role="status" className="mt-2 text-sm text-ink-500">Checking for a live position…</p>
      </section>
    );
  }

  if (error && !tracking) {
    return (
      <section className="surface p-6">
        <h2 className="text-xl font-black">{heading}</h2>
        <p role="alert" className="notice notice-error mt-3">{error}</p>
        <button type="button" onClick={() => { setLoading(true); void load(); }} className="btn btn-secondary mt-3">
          Try again
        </button>
      </section>
    );
  }

  if (!tracking) return null;

  const points: MapPoint[] = [];
  if (tracking.position) {
    points.push({
      id: "provider",
      latitude: tracking.position.latitude,
      longitude: tracking.position.longitude,
      label: tracking.rider?.display_name ?? (kind === "delivery" ? "Rider" : "Driver"),
      detail: tracking.position.stale ? "last known" : "live",
      tone: "brand",
      pulse: !tracking.position.stale,
    });
  }
  if (tracking.pickup_point) {
    points.push({
      id: "pickup",
      latitude: tracking.pickup_point.latitude,
      longitude: tracking.pickup_point.longitude,
      label: "Pickup",
      detail: tracking.pickup_label ?? null,
      tone: "sun",
    });
  }
  if (tracking.dropoff_point) {
    points.push({
      id: "dropoff",
      latitude: tracking.dropoff_point.latitude,
      longitude: tracking.dropoff_point.longitude,
      label: "Destination",
      detail: tracking.dropoff_label ?? null,
      tone: "ink",
    });
  }

  const stale = tracking.position?.stale ?? false;

  return (
    <section className="surface p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-black">{heading}</h2>
          <p className="mt-1 text-sm font-semibold text-ink-600">
            {STATUS_LABELS[tracking.status] ?? tracking.status}
          </p>
        </div>
        <span className={`chip ${stale ? "" : "chip-brand"}`}>
          {tracking.position ? (stale ? "Last known position" : "Live") : tracking.live ? "Assigned" : "Not started"}
        </span>
      </div>

      {tracking.rider && (
        <div className="mt-4 rounded-2xl bg-mist-50 p-4">
          <p className="text-sm font-bold text-ink-900">{tracking.rider.display_name}</p>
          {tracking.rider.vehicle && <p className="mt-1 text-sm text-ink-600">{tracking.rider.vehicle}</p>}
        </div>
      )}

      {tracking.position ? (
        <>
          <div className="mt-4">
            <MapCanvas
              points={points}
              center={{ latitude: tracking.position.latitude, longitude: tracking.position.longitude }}
              zoom={15}
              height="h-56"
            />
          </div>
          <p className="mt-3 text-xs leading-5 text-ink-500">
            {age === null
              ? "Position reported by your provider's device."
              : `Updated ${age < 5 ? "just now" : `${age} seconds ago`}.`}{" "}
            {tracking.position.accuracy_m ? `Reported accuracy about ${Math.round(tracking.position.accuracy_m)} m. ` : ""}
            The map shows the reported point only; Shilevi does not draw a route or estimate an arrival time
            without a routing service.
          </p>
        </>
      ) : (
        <p className="notice mt-4">{tracking.notice ?? "Live tracking is not available for this stage."}</p>
      )}

      {stale && (
        <p className="notice notice-warn mt-3 text-sm">
          {tracking.notice ?? "The position is out of date."}
        </p>
      )}

      <button type="button" onClick={() => { void load(); }} className="btn btn-quiet mt-3 px-0 text-sm">
        Refresh now
      </button>
    </section>
  );
}
