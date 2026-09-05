import mapboxgl from "mapbox-gl";
import { createTrajectoryLayer } from "./trajectoryLayer";
import type { EvictionStrategy } from "./slotPool";

/**
 * Wires up the map + custom layer + HUD. Same "smallest amount of glue
 * code" philosophy as every other example in this cookbook -- no
 * framework, no state management library.
 *
 * Unlike examples/04-moving-trajectory, there is no scrubber here: legs
 * (leg.ts) are generated forward-only and never stop, so there is no
 * fixed-length timeline to seek within, and no backward-time determinism
 * to support -- this example's whole point is what happens when demand for
 * a FIXED render capacity keeps growing, not scrubbing. See this repo's
 * README, "Deliberate simplifications".
 */

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id} in index.html`);
  return el as T;
}

const tokenWarning = byId<HTMLDivElement>("token-warning");

// Never read any .env file ourselves, never hardcode a token -- only
// import.meta.env.VITE_MAPBOX_TOKEN, same rule as every example here.
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
    center: [10, 15],
    pitch: 0,
  });

  map.on("error", (e) => {
    const status = (e.error as { status?: number } | undefined)?.status;
    if (status === 401 || status === 403) {
      tokenWarning.classList.add("visible");
    }
    console.error("[map error]", e.error);
  });

  // --- HUD elements -------------------------------------------------------
  const objectsEl = byId<HTMLInputElement>("objects");
  const strategyEl = byId<HTMLSelectElement>("strategy");
  const speedEl = byId<HTMLInputElement>("speed");
  const opacityEl = byId<HTMLInputElement>("opacity");

  const objectsValueEl = byId<HTMLSpanElement>("objects-value");
  const speedValueEl = byId<HTMLSpanElement>("speed-value");
  const opacityValueEl = byId<HTMLSpanElement>("opacity-value");

  const zoomValueEl = byId<HTMLSpanElement>("zoom-value");
  const projectionValueEl = byId<HTMLSpanElement>("projection-value");
  const transitionValueEl = byId<HTMLSpanElement>("transition-value");

  const statObjectsEl = byId<HTMLSpanElement>("stat-objects");
  const statSlotsEl = byId<HTMLSpanElement>("stat-slots");
  const statDrawsEl = byId<HTMLSpanElement>("stat-draws");
  const statEvictionsEl = byId<HTMLSpanElement>("stat-evictions");
  const statMsEl = byId<HTMLSpanElement>("stat-ms");

  const playPauseEl = byId<HTMLButtonElement>("play-pause");

  const syncSliderLabels = () => {
    objectsValueEl.textContent = objectsEl.value;
    speedValueEl.textContent = Number(speedEl.value).toFixed(1);
    opacityValueEl.textContent = Number(opacityEl.value).toFixed(2);
  };
  syncSliderLabels();
  for (const el of [objectsEl, speedEl, opacityEl]) {
    el.addEventListener("input", syncSliderLabels);
  }

  // --- Playback clock -------------------------------------------------------
  // Forward-only wall-clock-driven simulation time -- no scrubber, see this
  // file's module docstring for why.
  let simTime = 0;
  let isPlaying = true;
  let lastWallMs: number | null = null;

  function setPlaying(playing: boolean) {
    isPlaying = playing;
    playPauseEl.textContent = isPlaying ? "Pause" : "Play";
  }
  setPlaying(true);
  playPauseEl.addEventListener("click", () => setPlaying(!isPlaying));

  function getSimTime(): number {
    const now = performance.now();
    if (lastWallMs === null) lastWallMs = now;
    // Clamp so a backgrounded tab resumes with one bounded catch-up step
    // instead of every object's leg jumping arbitrarily far past its own
    // endTime at once -- same rule as 04's getSimTime().
    const dtMs = Math.min(now - lastWallMs, 100);
    lastWallMs = now;
    if (isPlaying) simTime += (dtMs / 1000) * Number(speedEl.value);
    return simTime;
  }

  // --- Evictions/sec: derived from the cumulative eviction counter --------
  let evictionWindowStartMs = performance.now();
  let evictionCountAtWindowStart = 0;
  let evictionsPerSecEma = 0;

  const layer = createTrajectoryLayer({
    getSimTime,
    getActiveCount: () => Number(objectsEl.value),
    getOpacity: () => Number(opacityEl.value),
    getStrategy: () => strategyEl.value as EvictionStrategy,
    onFrameInfo: ({ isGlobe, transition, stats, drawCalls }) => {
      projectionValueEl.textContent = isGlobe ? "globe" : "mercator";
      transitionValueEl.textContent = transition.toFixed(2);

      statObjectsEl.textContent = String(stats.activeCount);
      statSlotsEl.textContent = `${stats.slotsUsed} / ${stats.slotCapacity}`;
      statDrawsEl.textContent = String(drawCalls);
      statMsEl.textContent = `${stats.msPerUpdate.toFixed(3)} ms`;

      const nowMs = performance.now();
      const elapsedSec = (nowMs - evictionWindowStartMs) / 1000;
      if (elapsedSec >= 0.5) {
        const rate = (stats.evictionCountTotal - evictionCountAtWindowStart) / elapsedSec;
        evictionsPerSecEma = evictionsPerSecEma === 0 ? rate : evictionsPerSecEma * 0.5 + rate * 0.5;
        evictionWindowStartMs = nowMs;
        evictionCountAtWindowStart = stats.evictionCountTotal;
      }
      statEvictionsEl.textContent = evictionsPerSecEma.toFixed(0);
    },
  });

  map.on("load", () => {
    map.addLayer(layer);
  });

  const updateZoomReadout = () => {
    zoomValueEl.textContent = map.getZoom().toFixed(2);
  };
  updateZoomReadout();
  map.on("zoom", updateZoomReadout);
}
