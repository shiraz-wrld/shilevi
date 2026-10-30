"use client";

import { useMemo, useState } from "react";

/**
 * A small raster-tile map built from real coordinates.
 *
 * There is no map SDK here on purpose: adding one would pull a large client bundle and an API key
 * into a page whose only job is to put a handful of genuine pins on a street grid. OpenStreetMap
 * raster tiles are used with the attribution their usage policy requires.
 *
 * Two rules the callers rely on:
 *   * Every marker comes from a coordinate the server returned. Nothing is placed at a guessed or
 *     randomised position, and this component never invents a route, a distance or an ETA.
 *   * When there are no coordinates it renders an honest empty state instead of a decorative map.
 */

export type MapPoint = {
  id: string;
  latitude: number;
  longitude: number;
  label: string;
  detail?: string | null;
  tone?: "brand" | "sun" | "emerald" | "ink";
  pulse?: boolean;
};

const TILE_SIZE = 256;
const MIN_ZOOM = 11;
const MAX_ZOOM = 17;

const TONE_CLASSES: Record<NonNullable<MapPoint["tone"]>, string> = {
  brand: "border-white bg-brand-600",
  sun: "border-white bg-sun-500",
  emerald: "border-white bg-emerald-600",
  ink: "border-white bg-ink-900",
};

/** Web-mercator projection of a coordinate to world pixels at one zoom level. */
function project(latitude: number, longitude: number, zoom: number) {
  const scale = TILE_SIZE * 2 ** zoom;
  const clampedLat = Math.max(-85.0511, Math.min(85.0511, latitude));
  const sin = Math.sin((clampedLat * Math.PI) / 180);
  return {
    x: ((longitude + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
}

/** Inverse of `project`: world pixels back to a coordinate. */
function unproject(x: number, y: number, zoom: number) {
  const scale = TILE_SIZE * 2 ** zoom;
  const lng = (x / scale) * 360 - 180;
  const n = Math.PI - 2 * Math.PI * (y / scale);
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { latitude: lat, longitude: lng };
}

function isValidPoint(point: MapPoint) {
  return Number.isFinite(point.latitude)
    && Number.isFinite(point.longitude)
    && point.latitude >= -90
    && point.latitude <= 90
    && point.longitude >= -180
    && point.longitude <= 180;
}

export function MapCanvas({
  points,
  center,
  zoom: initialZoom = 14,
  height = "h-64",
  emptyMessage = "No coordinates have been recorded yet, so there is nothing to place on a map.",
  onPick,
}: {
  points: MapPoint[];
  center?: { latitude: number; longitude: number };
  zoom?: number;
  height?: string;
  emptyMessage?: string;
  /** When provided, a click on the map reports the coordinate under the pointer. */
  onPick?: (point: { latitude: number; longitude: number }) => void;
}) {
  const [zoom, setZoom] = useState(initialZoom);
  const usable = points.filter(isValidPoint);

  // A single point is centred on itself; several points are centred on their mean. Both come from
  // real data, so the view never implies a location the server did not report.
  const anchor = useMemo(() => {
    if (center) return center;
    if (usable.length === 0) return null;
    return {
      latitude: usable.reduce((sum, point) => sum + point.latitude, 0) / usable.length,
      longitude: usable.reduce((sum, point) => sum + point.longitude, 0) / usable.length,
    };
  }, [center, usable]);

  const tiles = useMemo(() => {
    if (!anchor) return [];
    const { x, y } = project(anchor.latitude, anchor.longitude, zoom);
    const centerX = Math.floor(x / TILE_SIZE);
    const centerY = Math.floor(y / TILE_SIZE);
    const list: { key: string; url: string; left: number; top: number }[] = [];
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const tileX = centerX + dx;
        const tileY = centerY + dy;
        const max = 2 ** zoom;
        const wrappedX = ((tileX % max) + max) % max;
        if (tileY < 0 || tileY >= max) continue;
        list.push({
          key: `${zoom}/${wrappedX}/${tileY}`,
          url: `https://tile.openstreetmap.org/${zoom}/${wrappedX}/${tileY}.png`,
          left: tileX * TILE_SIZE,
          top: tileY * TILE_SIZE,
        });
      }
    }
    return list;
  }, [anchor, zoom]);

  if (!anchor) {
    return (
      <div className={`grid place-items-center rounded-2xl border border-line bg-mist-50 px-5 py-10 text-center text-sm leading-6 text-ink-500 ${height}`}>
        <p className="max-w-sm">{emptyMessage}</p>
      </div>
    );
  }

  const anchorPixels = project(anchor.latitude, anchor.longitude, zoom);

  // The tile layer is centred on the anchor, so the container's midpoint is the anchor's pixel
  // position. A click is converted back through the inverse projection — the same arithmetic the
  // markers use, which is why a picked point lands exactly under the pointer.
  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!onPick) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const worldX = anchorPixels.x + (event.clientX - (rect.left + rect.width / 2));
    const worldY = anchorPixels.y + (event.clientY - (rect.top + rect.height / 2));
    const picked = unproject(worldX, worldY, zoom);
    if (!Number.isFinite(picked.latitude) || !Number.isFinite(picked.longitude)) return;
    onPick(picked);
  };

  return (
    <div
      onClick={handleClick}
      className={`relative w-full overflow-hidden rounded-2xl border border-line bg-mist-100 ${height} ${onPick ? "cursor-crosshair" : ""}`}
    >
      <div
        aria-hidden="true"
        className="absolute left-1/2 top-1/2"
        style={{ transform: `translate(${-anchorPixels.x}px, ${-anchorPixels.y}px)` }}
      >
        {tiles.map(tile => (
          // eslint-disable-next-line @next/next/no-img-element -- raster tiles cannot use next/image
          <img
            key={tile.key}
            src={tile.url}
            alt=""
            width={TILE_SIZE}
            height={TILE_SIZE}
            decoding="async"
            draggable={false}
            className="absolute select-none"
            style={{ left: tile.left, top: tile.top, width: TILE_SIZE, height: TILE_SIZE }}
          />
        ))}

        {usable.map(point => {
          const { x, y } = project(point.latitude, point.longitude, zoom);
          return (
            <div key={point.id} className="absolute" style={{ left: x, top: y }}>
              <div
                className={`absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 shadow ${TONE_CLASSES[point.tone ?? "brand"]} ${point.pulse ? "animate-pulse" : ""}`}
              />
            </div>
          );
        })}
      </div>

      {/* The legend is DOM, not tile, so a label is always readable and never baked into an image. */}
      <ul className="pointer-events-none absolute inset-x-2 top-2 flex flex-wrap gap-1.5">
        {usable.map(point => (
          <li key={point.id} className="pointer-events-auto rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-bold text-ink-800 shadow-sm">
            <span className={`mr-1.5 inline-block h-2 w-2 rounded-full ${TONE_CLASSES[point.tone ?? "brand"].split(" ")[1]}`} aria-hidden="true" />
            {point.label}
            {point.detail ? <span className="font-normal text-ink-500"> · {point.detail}</span> : null}
          </li>
        ))}
      </ul>

      <div className="absolute bottom-2 right-2 flex flex-col gap-1">
        <button
          type="button"
          onClick={() => setZoom(current => Math.min(MAX_ZOOM, current + 1))}
          disabled={zoom >= MAX_ZOOM}
          aria-label="Zoom in"
          className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-white text-lg font-black leading-none text-ink-700 shadow-sm disabled:opacity-40"
        >
          +
        </button>
        <button
          type="button"
          onClick={() => setZoom(current => Math.max(MIN_ZOOM, current - 1))}
          disabled={zoom <= MIN_ZOOM}
          aria-label="Zoom out"
          className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-white text-lg font-black leading-none text-ink-700 shadow-sm disabled:opacity-40"
        >
          −
        </button>
      </div>

      <a
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noreferrer noopener"
        className="absolute bottom-1 left-2 rounded bg-white/85 px-1.5 py-0.5 text-[10px] font-semibold text-ink-600"
      >
        © OpenStreetMap contributors
      </a>
    </div>
  );
}
