import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { createAreasLayer } from "./areasLayer";
import type { ShapeMode } from "./areasScene";

/**
 * Wires up the map + custom layer + a handful of sliders. No framework, no
 * state management -- see 01-points-on-globe/src/main.ts, this follows the
 * same shape.
 */

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id} in index.html`);
  return el as T;
}

const tokenWarning = byId<HTMLDivElement>("token-warning");

// Requirement: never read any .env file ourselves and never hardcode a token
// -- only import.meta.env.VITE_MAPBOX_TOKEN, which Vite populates from the
// user's own .env (see .env.example). If it's missing, show a friendly
// message instead of letting mapbox-gl throw on every tile request.
const token = import.meta.env.VITE_MAPBOX_TOKEN;

if (!token) {
  tokenWarning.classList.add("visible");
} else {
  mapboxgl.accessToken = token;
  startMap();
}

function startMap() {
  const map = new mapboxgl.Map({
    container: "map",
    style: "mapbox://styles/mapbox/dark-v11",
    // mapbox-gl-js v3 already defaults to globe projection at low zoom for
    // most styles, but we set it explicitly so this example behaves the same
    // way regardless of which style you swap in.
    projection: "globe",
    zoom: 1.5,
    center: [15, 25],
    pitch: 0,
  });

  // Auth/network errors (e.g. an invalid token) surface as 'error' events
  // rather than thrown exceptions -- catch the common case and point at the
  // same fix as the "no token at all" case, rather than a blank map.
  map.on("error", (e) => {
    const status = (e.error as { status?: number } | undefined)?.status;
    if (status === 401 || status === 403) {
      tokenWarning.classList.add("visible");
    }
    console.error("[map error]", e.error);
  });

  const segmentsEl = byId<HTMLInputElement>("segments");
  const radiusKmEl = byId<HTMLInputElement>("radius-km");
  const shapeModeEl = byId<HTMLSelectElement>("shape-mode");
  const segmentsValueEl = byId<HTMLSpanElement>("segments-value");
  const radiusKmValueEl = byId<HTMLSpanElement>("radius-km-value");
  const zoomValueEl = byId<HTMLSpanElement>("zoom-value");
  const projectionValueEl = byId<HTMLSpanElement>("projection-value");
  const transitionValueEl = byId<HTMLSpanElement>("transition-value");

  const syncSliderLabels = () => {
    segmentsValueEl.textContent = segmentsEl.value;
    radiusKmValueEl.textContent = radiusKmEl.value;
  };
  syncSliderLabels();

  // Unlike glow-points (which animates every frame and so always repaints),
  // this layer's render() deliberately does NOT force a repaint on its own
  // -- see areasLayer.ts. So every control here that changes what gets
  // drawn must ask for a repaint itself.
  for (const el of [segmentsEl, radiusKmEl, shapeModeEl]) {
    el.addEventListener("input", () => {
      syncSliderLabels();
      map.triggerRepaint();
    });
  }

  const layer = createAreasLayer({
    getSegments: () => Number(segmentsEl.value),
    getRadiusKm: () => Number(radiusKmEl.value),
    getShapeMode: () => shapeModeEl.value as ShapeMode,
    // HUD readout of the exact globe state this frame.
    onFrameInfo: ({ isGlobe, transition }) => {
      projectionValueEl.textContent = isGlobe ? "globe" : "mercator";
      transitionValueEl.textContent = transition.toFixed(2);
    },
  });

  map.on("load", () => {
    map.addLayer(layer);
  });

  // Zoom changes independently of render() frames (e.g. while idle), so it
  // gets its own listener rather than piggybacking on onFrameInfo.
  const updateZoomReadout = () => {
    zoomValueEl.textContent = map.getZoom().toFixed(2);
  };
  updateZoomReadout();
  map.on("zoom", updateZoomReadout);
}
