import mapboxgl from "mapbox-gl";
import { createArcLayer } from "./arcLayer";

/**
 * Wires up the map + custom layer + a handful of sliders. No framework, no
 * state management -- this is deliberately the smallest amount of glue code
 * that lets you see globe-hugging (and the under-subdivided-arc bug) working
 * and poke at its parameters. Same shape as 01-points-on-globe' main.ts.
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
    zoom: 1.2,
    center: [30, 15],
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
  const arcHeightEl = byId<HTMLInputElement>("arc-height");
  const segmentsValueEl = byId<HTMLSpanElement>("segments-value");
  const arcHeightValueEl = byId<HTMLSpanElement>("arc-height-value");
  const zoomValueEl = byId<HTMLSpanElement>("zoom-value");
  const projectionValueEl = byId<HTMLSpanElement>("projection-value");
  const transitionValueEl = byId<HTMLSpanElement>("transition-value");
  const arcsValueEl = byId<HTMLSpanElement>("arcs-value");
  const verticesValueEl = byId<HTMLSpanElement>("vertices-value");

  const syncSliderLabels = () => {
    segmentsValueEl.textContent = segmentsEl.value;
    arcHeightValueEl.textContent = Number(arcHeightEl.value).toFixed(3);
  };
  syncSliderLabels();
  for (const el of [segmentsEl, arcHeightEl]) {
    el.addEventListener("input", syncSliderLabels);
  }

  const layer = createArcLayer({
    getSegmentsPerArc: () => Number(segmentsEl.value),
    getArcHeightMercZ: () => Number(arcHeightEl.value),
    // HUD readout of the exact globe state + geometry cost this frame -- see
    // arcLayer's render() for where these values come from.
    onFrameInfo: ({ isGlobe, transition, arcCount, vertexCount }) => {
      projectionValueEl.textContent = isGlobe ? "globe" : "mercator";
      transitionValueEl.textContent = transition.toFixed(2);
      arcsValueEl.textContent = String(arcCount);
      verticesValueEl.textContent = vertexCount.toLocaleString();
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
