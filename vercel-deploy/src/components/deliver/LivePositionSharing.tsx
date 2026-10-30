"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { MapCanvas } from "@/components/tracking/MapCanvas";

/**
 * Rider-side location sharing.
 *
 * Nothing is sent until the rider presses the button: there is no background GPS, no permission
 * prompt on page load and no inferring a position from anything other than the device fix. The
 * server decides whether the account may publish at all (`may_publish_provider_position`), and the
 * position is only ever read back by the customer on the assignment the rider is actually
 * performing.
 *
 * Going off duty deletes the stored row, so "stop sharing" means the last known point stops being
 * served rather than being left behind as a stale dot.
 */

type Position = {
  latitude: number;
  longitude: number;
  accuracy_m: number | null;
  updated_at: string;
};

const PUBLISH_INTERVAL_MS = 15000;

export function LivePositionSharing() {
  const [sharing, setSharing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [position, setPosition] = useState<Position | null>(null);
  const watchId = useRef<number | null>(null);
  const lastPublish = useRef(0);

  const publish = useCallback(async (coords: GeolocationCoordinates) => {
    const now = Date.now();
    if (now - lastPublish.current < PUBLISH_INTERVAL_MS) return;
    lastPublish.current = now;
    try {
      const db = createSupabaseBrowserClient();
      const result = await db.rpc("publish_provider_position", {
        p_lat: coords.latitude,
        p_lng: coords.longitude,
        p_accuracy_m: Number.isFinite(coords.accuracy) ? Math.min(coords.accuracy, 100000) : null,
        p_heading_deg: Number.isFinite(coords.heading) && coords.heading !== null ? coords.heading : null,
        p_speed_mps: Number.isFinite(coords.speed) && coords.speed !== null ? coords.speed : null,
      });
      if (result.error) throw result.error;
      const data = result.data as { latitude?: number; longitude?: number; updated_at?: string } | null;
      setPosition({
        latitude: Number(data?.latitude ?? coords.latitude),
        longitude: Number(data?.longitude ?? coords.longitude),
        accuracy_m: Number.isFinite(coords.accuracy) ? coords.accuracy : null,
        updated_at: data?.updated_at ?? new Date().toISOString(),
      });
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Your position could not be sent.");
    }
  }, []);

  // Reflect the server's view on mount: a reload must not claim sharing that was stopped elsewhere.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const db = createSupabaseBrowserClient();
        const auth = await db.auth.getUser();
        if (!alive || !auth.data.user) return;
        const result = await db.rpc("my_provider_position");
        if (!alive || result.error) return;
        const data = result.data as { sharing?: boolean; position?: Position | null } | null;
        if (data?.sharing && data.position) {
          setSharing(true);
          setPosition(data.position);
        }
      } catch {
        // A missing session simply means there is nothing to restore here.
      }
    })();
    return () => { alive = false; };
  }, []);

  const stopWatch = useCallback(() => {
    if (watchId.current !== null && typeof navigator !== "undefined" && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
  }, []);

  useEffect(() => stopWatch, [stopWatch]);

  async function start() {
    setError("");
    setNotice("");
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setError("This browser does not provide a location service, so live sharing is unavailable here.");
      return;
    }
    if (!window.isSecureContext) {
      setError("Location sharing needs a secure (https) page. Open Shilevi over https and try again.");
      return;
    }
    setBusy(true);
    try {
      const permission = await navigator.permissions?.query({ name: "geolocation" }).catch(() => null);
      if (permission && permission.state === "denied") {
        setError("Location permission is blocked for this site. Allow it in your browser settings, then try again.");
        return;
      }

      watchId.current = navigator.geolocation.watchPosition(
        fix => { void publish(fix.coords); },
        failure => {
          setSharing(false);
          stopWatch();
          setError(
            failure.code === failure.PERMISSION_DENIED
              ? "Location permission was denied. You can still work the job board; the customer will see that you are not sharing."
              : "Your device could not provide a position. Move somewhere with a clearer signal and try again.",
          );
        },
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
      );
      setSharing(true);
      setNotice("Sharing your position. Only the customer on a delivery you are actually performing can see it.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Location sharing could not be started.");
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    setBusy(true);
    setError("");
    stopWatch();
    try {
      const db = createSupabaseBrowserClient();
      const result = await db.rpc("stop_provider_position_sharing");
      if (result.error) throw result.error;
      setSharing(false);
      setPosition(null);
      setNotice("Location sharing stopped. The stored position was deleted.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sharing could not be stopped. Try again before going off duty.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="surface p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-black">Your working position</h2>
          <p className="mt-1 text-sm leading-6 text-ink-600">
            Turn this on when you start a shift. It powers the customer&apos;s live tracking screen and stops the
            moment you switch it off.
          </p>
        </div>
        <span className={`chip ${sharing ? "chip-brand" : ""}`}>{sharing ? "Sharing" : "Off duty"}</span>
      </div>

      {position ? (
        <div className="mt-4">
          <MapCanvas
            points={[{
              id: "me",
              latitude: position.latitude,
              longitude: position.longitude,
              label: "You",
              detail: position.accuracy_m ? `±${Math.round(position.accuracy_m)} m` : null,
              tone: "emerald",
              pulse: true,
            }]}
            center={{ latitude: position.latitude, longitude: position.longitude }}
            zoom={15}
            height="h-56"
          />
        </div>
      ) : (
        <p className="notice mt-4">
          Your position is not being shared. The map appears here once your device reports a fix.
        </p>
      )}

      {notice && <p className="notice notice-success mt-3 text-sm">{notice}</p>}
      {error && <p className="notice notice-error mt-3 text-sm">{error}</p>}

      <div className="mt-4 flex flex-wrap gap-2">
        {sharing ? (
          <button type="button" onClick={() => void stop()} disabled={busy} className="btn btn-secondary">
            {busy ? "Stopping…" : "Stop sharing"}
          </button>
        ) : (
          <button type="button" onClick={() => void start()} disabled={busy} className="btn btn-primary">
            {busy ? "Starting…" : "Share my location"}
          </button>
        )}
      </div>

      <p className="mt-4 text-xs leading-5 text-ink-500">
        Shilevi stores only your latest reported point. It is deleted when you stop sharing and is never shown to
        another rider, to a seller, or to a customer who is not on your current assignment.
      </p>
    </section>
  );
}
