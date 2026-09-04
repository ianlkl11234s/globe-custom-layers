import mapboxgl from "mapbox-gl";
import { createGlowLayer } from "./glowLayer";

/**
 * Wires up the map + custom layer + a handful of sliders. No framework, no
 * state management -- this is deliberately the smallest amount of glue code
 * that lets you see globe-hugging working and poke at its parameters.
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
    zoom: 1.3,
    center: [10, 15],
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

  const sizeMulEl = byId<HTMLInputElement>("size-mul");
  const opacityEl = byId<HTMLInputElement>("opacity");
  const coreBoostEl = byId<HTMLInputElement>("core-boost");
  const sizeMulValueEl = byId<HTMLSpanElement>("size-mul-value");
  const opacityValueEl = byId<HTMLSpanElement>("opacity-value");
  const coreBoostValueEl = byId<HTMLSpanElement>("core-boost-value");
  const zoomValueEl = byId<HTMLSpanElement>("zoom-value");
  const projectionValueEl = byId<HTMLSpanElement>("projection-value");
  const transitionValueEl = byId<HTMLSpanElement>("transition-value");

  const syncSliderLabels = () => {
    sizeMulValueEl.textContent = Number(sizeMulEl.value).toFixed(2);
    opacityValueEl.textContent = Number(opacityEl.value).toFixed(2);
    coreBoostValueEl.textContent = Number(coreBoostEl.value).toFixed(2);
  };
  syncSliderLabels();
  for (const el of [sizeMulEl, opacityEl, coreBoostEl]) {
    el.addEventListener("input", syncSliderLabels);
  }

  const layer = createGlowLayer({
    getSizeMul: () => Number(sizeMulEl.value),
    getOpacity: () => Number(opacityEl.value),
    getCoreBoost: () => Number(coreBoostEl.value),
    // HUD readout of the exact globe state this frame -- see globeLayer's
    // render() for where isGlobe/transition actually come from.
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
