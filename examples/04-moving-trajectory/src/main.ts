import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { createTrajectoryLayer } from "./trajectoryLayer";
import { TIMELINE_DURATION_SEC, mod1 } from "./objectPath";

/**
 * Wires up the map + custom layer + playback controls. Same "smallest
 * amount of glue code" philosophy as the static example's main.ts -- no
 * framework, no state management library.
 *
 * The one thing worth reading closely here is `getSimTime()`: it's a
 * pull-based clock, called once per `render()` frame by trajectoryLayer.ts.
 * There's no separate `requestAnimationFrame` loop in this file -- Mapbox's
 * own `render()` schedule (kept alive by `map.triggerRepaint()`, see
 * trajectoryLayer.ts) is already ticking at display refresh rate, so
 * `getSimTime()` just measures the wall-clock gap since it was last called
 * and folds that into the simulation clock. A scrubber drag overrides the
 * next call's result directly, which is what makes scrubbing (forward AND
 * backward) and normal playback go through the exact same clock.
 */

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id} in index.html`);
  return el as T;
}

const tokenWarning = byId<HTMLDivElement>("token-warning");

// Same requirement as the static example: never read any .env file
// ourselves, never hardcode a token -- only import.meta.env.VITE_MAPBOX_TOKEN.
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
  const trailLengthEl = byId<HTMLInputElement>("trail-length");
  const speedEl = byId<HTMLInputElement>("speed");
  const sizeMulEl = byId<HTMLInputElement>("size-mul");
  const opacityEl = byId<HTMLInputElement>("opacity");

  const objectsValueEl = byId<HTMLSpanElement>("objects-value");
  const trailLengthValueEl = byId<HTMLSpanElement>("trail-length-value");
  const speedValueEl = byId<HTMLSpanElement>("speed-value");
  const sizeMulValueEl = byId<HTMLSpanElement>("size-mul-value");
  const opacityValueEl = byId<HTMLSpanElement>("opacity-value");

  const zoomValueEl = byId<HTMLSpanElement>("zoom-value");
  const projectionValueEl = byId<HTMLSpanElement>("projection-value");
  const transitionValueEl = byId<HTMLSpanElement>("transition-value");

  const playPauseEl = byId<HTMLButtonElement>("play-pause");
  const scrubberEl = byId<HTMLInputElement>("scrubber");
  const timeReadoutEl = byId<HTMLSpanElement>("time-readout");

  const syncSliderLabels = () => {
    objectsValueEl.textContent = objectsEl.value;
    trailLengthValueEl.textContent = trailLengthEl.value;
    speedValueEl.textContent = Number(speedEl.value).toFixed(1);
    sizeMulValueEl.textContent = Number(sizeMulEl.value).toFixed(2);
    opacityValueEl.textContent = Number(opacityEl.value).toFixed(2);
  };
  syncSliderLabels();
  for (const el of [objectsEl, trailLengthEl, speedEl, sizeMulEl, opacityEl]) {
    el.addEventListener("input", syncSliderLabels);
  }

  // --- Playback clock -------------------------------------------------------
  let simTime = 0;
  let isPlaying = true;
  let pendingScrubTime: number | null = null;
  let lastWallMs: number | null = null;

  function setPlaying(playing: boolean) {
    isPlaying = playing;
    playPauseEl.textContent = isPlaying ? "Pause" : "Play";
  }
  setPlaying(true);

  playPauseEl.addEventListener("click", () => setPlaying(!isPlaying));

  scrubberEl.addEventListener("input", () => {
    const pct = Number(scrubberEl.value);
    pendingScrubTime = (pct / 100) * TIMELINE_DURATION_SEC;
    // Pausing on scrub is a deliberate UX choice, not a technical necessity
    // -- getSimTime() below would handle a scrub while playing just as
    // correctly (syncTrailToTick treats it as a jump either way), but a
    // seek bar that keeps advancing out from under a drag reads as broken.
    setPlaying(false);
  });

  /**
   * Pull-based simulation clock -- see this file's module docstring. Clamps
   * the wall-clock delta to 100ms so a backgrounded tab (which can starve
   * `render()` for seconds) resumes with one bounded catch-up step instead
   * of the trail ring buffers seeing (and rebuilding over) a huge tick jump.
   */
  function getSimTime(): number {
    const now = performance.now();

    if (pendingScrubTime !== null) {
      simTime = pendingScrubTime;
      pendingScrubTime = null;
      lastWallMs = now;
      return simTime;
    }

    if (lastWallMs === null) lastWallMs = now;
    const dtMs = Math.min(now - lastWallMs, 100);
    lastWallMs = now;

    if (isPlaying) {
      simTime += (dtMs / 1000) * Number(speedEl.value);
    }
    return simTime;
  }

  const layer = createTrajectoryLayer({
    getSimTime,
    getActiveCount: () => Number(objectsEl.value),
    getTrailWindow: () => Number(trailLengthEl.value),
    getOpacity: () => Number(opacityEl.value),
    getSizeMul: () => Number(sizeMulEl.value),
    onFrameInfo: ({ isGlobe, transition }) => {
      projectionValueEl.textContent = isGlobe ? "globe" : "mercator";
      transitionValueEl.textContent = transition.toFixed(2);

      // Reflect the clock back onto the scrubber/readout. Only when the user
      // isn't actively mid-drag (an `input` event on scrubberEl already set
      // pendingScrubTime and paused playback for this frame's getSimTime()
      // call, so simTime already matches -- writing it back here is a no-op
      // in that case, not a fight with the drag).
      const loopT = mod1(simTime / TIMELINE_DURATION_SEC) * TIMELINE_DURATION_SEC;
      scrubberEl.value = String((loopT / TIMELINE_DURATION_SEC) * 100);
      timeReadoutEl.textContent = `${loopT.toFixed(1)}s / ${TIMELINE_DURATION_SEC}s`;
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
