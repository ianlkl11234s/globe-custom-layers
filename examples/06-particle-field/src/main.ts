import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { createParticleFieldLayer } from "./particleFieldLayer";

/**
 * Wires up the map + custom layer + a handful of sliders and one toggle.
 * No framework, no state management -- same minimal-glue philosophy as
 * every other example in this repo (see 01-points-on-globe/src/main.ts).
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
    projection: "globe",
    zoom: 1.6,
    center: [0, 15],
    pitch: 0,
  });

  map.on("error", (e) => {
    const status = (e.error as { status?: number } | undefined)?.status;
    if (status === 401 || status === 403) {
      tokenWarning.classList.add("visible");
    }
    console.error("[map error]", e.error);
  });

  const particleCountEl = byId<HTMLInputElement>("particle-count");
  const trailLengthEl = byId<HTMLInputElement>("trail-length");
  const speedEl = byId<HTMLInputElement>("speed");
  const lineWidthEl = byId<HTMLInputElement>("line-width");
  const opacityEl = byId<HTMLInputElement>("opacity");
  const quantizeDensityEl = byId<HTMLInputElement>("quantize-density");

  const particleCountValueEl = byId<HTMLSpanElement>("particle-count-value");
  const trailLengthValueEl = byId<HTMLSpanElement>("trail-length-value");
  const speedValueEl = byId<HTMLSpanElement>("speed-value");
  const lineWidthValueEl = byId<HTMLSpanElement>("line-width-value");
  const opacityValueEl = byId<HTMLSpanElement>("opacity-value");

  const zoomValueEl = byId<HTMLSpanElement>("zoom-value");
  const projectionValueEl = byId<HTMLSpanElement>("projection-value");
  const transitionValueEl = byId<HTMLSpanElement>("transition-value");
  const particlesValueEl = byId<HTMLSpanElement>("particles-value");
  const segmentsValueEl = byId<HTMLSpanElement>("segments-value");
  const msValueEl = byId<HTMLSpanElement>("ms-value");
  const msRowEl = byId<HTMLDivElement>("ms-row");

  const syncSliderLabels = () => {
    particleCountValueEl.textContent = Number(particleCountEl.value).toLocaleString();
    trailLengthValueEl.textContent = trailLengthEl.value;
    speedValueEl.textContent = Number(speedEl.value).toFixed(1);
    lineWidthValueEl.textContent = Number(lineWidthEl.value).toFixed(1);
    opacityValueEl.textContent = Number(opacityEl.value).toFixed(2);
  };
  syncSliderLabels();
  for (const el of [particleCountEl, trailLengthEl, speedEl, lineWidthEl, opacityEl]) {
    el.addEventListener("input", syncSliderLabels);
  }

  // Rolling average so the ms-per-update readout is legible rather than
  // flickering a new number every single frame -- and colored red above a
  // rough "this would drop frames" threshold, most visible with the
  // "quantize zoom density" toggle off while zooming continuously.
  let msEma = 0;
  const EMA_ALPHA = 0.15;

  const layer = createParticleFieldLayer({
    id: "06-particle-field",
    getIsVisible: () => true,
    getOpacity: () => Number(opacityEl.value),
    getParticleCount: () => Number(particleCountEl.value),
    getTrailLength: () => Number(trailLengthEl.value),
    getAnimationSpeed: () => Number(speedEl.value),
    getLineWidth: () => Number(lineWidthEl.value),
    getQuantizeDensity: () => quantizeDensityEl.checked,
    // Synthetic field speeds are ~5-25 m/s; at a global viewing scale that's
    // visually glacial unless simulated time runs much faster than real
    // time. 1 real second == this many simulated seconds, at speed x1.
    //
    // Sized by calculation, not by looking at it (no token was available
    // while writing this -- see the Status line): at the initial zoom
    // (1.6, ~2.16 px/degree in mercator-world terms) and a typical 10 m/s
    // sample, this constant works out to roughly 60fps * 0.77 deg/frame,
    // i.e. ~100 px/s of on-screen motion -- in the "visibly flowing, not
    // a snapped-across-the-screen streak" range this kind of demo usually
    // aims for. Adjust first if visual verification says otherwise.
    timeScaleSeconds: 400_000,
    onFrameInfo: ({ zoom, isGlobe, transition, particleCount, segmentsUploaded, msPerUpdate }) => {
      zoomValueEl.textContent = zoom.toFixed(2);
      projectionValueEl.textContent = isGlobe ? "globe" : "mercator";
      transitionValueEl.textContent = transition.toFixed(2);
      particlesValueEl.textContent = particleCount.toLocaleString();
      segmentsValueEl.textContent = segmentsUploaded.toLocaleString();

      msEma = msEma ? msEma + EMA_ALPHA * (msPerUpdate - msEma) : msPerUpdate;
      msValueEl.textContent = msEma.toFixed(2);
      msRowEl.classList.toggle("warn", msEma > 4);
    },
  });

  map.on("load", () => {
    map.addLayer(layer);
  });
}
