import mapboxgl from "mapbox-gl";
import { loadAirports } from "./airports";
import { airportsToGeoJSON } from "./airportsGeoJSON";
import { addCompanionLayer, queryCompanionAt, type CompanionHit } from "./nativeCompanionLayer";
import { createGlowLayer } from "./glowLayer";
import { buildPickingCandidates, type PickingCandidate } from "./pickingCandidates";
import { pickScreenSpace } from "./screenSpacePicking";
import { showAirportPopup } from "./popup";
import type { Vec3 } from "./globeProject";

/**
 * Wires up: one map, one visible custom layer (the glow points, unchanged
 * from examples/00/01), and TWO independent ways of answering "what did the
 * user click": a companion native layer (strategy 1) and screen-space
 * projection + a manual backface test (strategy 2). A HUD switch picks
 * which one answers the next click; both end up at the same
 * `showAirportPopup` call (popup.ts) so the only difference visible in the
 * code is "how the hit was found", not "what happens once you have one".
 *
 * See README.md for strategy 3 (a GPU ID buffer) -- described, not
 * implemented here.
 */

// Click tolerance for strategy 2, in CSS pixels. Deliberately a flat
// constant, not zoom-adaptive like the actual rendered dot radius (which
// ranges 10-56px * a zoom-dependent scale -- see glowPointsScene.ts's
// setZoom()). A real app would want to scale this with zoom too; this
// example fixes it so the "does screen-space picking work at all" story
// isn't tangled up with "is the radius tuned correctly at every zoom".
const PICK_RADIUS_PX = 14;

type Strategy = "companion" | "screen-space";

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
    zoom: 1.3,
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

  const zoomValueEl = byId<HTMLSpanElement>("zoom-value");
  const projectionValueEl = byId<HTMLSpanElement>("projection-value");
  const transitionValueEl = byId<HTMLSpanElement>("transition-value");
  const consideredValueEl = byId<HTMLSpanElement>("considered-value");
  const msValueEl = byId<HTMLSpanElement>("ms-value");
  const clickInfoEl = byId<HTMLDivElement>("click-info");
  const backfaceToggleEl = byId<HTMLInputElement>("backface-toggle");
  const strategyButtons: Record<Strategy, HTMLButtonElement> = {
    companion: byId<HTMLButtonElement>("strategy-btn-companion"),
    "screen-space": byId<HTMLButtonElement>("strategy-btn-screen-space"),
  };

  let strategy: Strategy = "companion";
  let candidates: PickingCandidate[] = [];
  // Updated every render() frame via the custom layer's onFrameInfo -- see
  // glowLayer.ts's MODIFIED docstring for why this is the same cameraEcef
  // the visual layer's own shader cull uses, not a second computation of it.
  let latestCameraEcef: Vec3 | null = null;

  function applyStrategy(next: Strategy) {
    strategy = next;
    for (const [s, btn] of Object.entries(strategyButtons) as Array<[Strategy, HTMLButtonElement]>) {
      btn.classList.toggle("active", s === strategy);
    }
  }
  applyStrategy(strategy);

  for (const [s, btn] of Object.entries(strategyButtons) as Array<[Strategy, HTMLButtonElement]>) {
    btn.addEventListener("click", () => applyStrategy(s));
  }

  function reportResult(
    hit: { name: string; ident: string } | null,
    ms: number,
    consideredCount: number | null,
  ) {
    clickInfoEl.className = hit ? "hit" : "no-hit";
    clickInfoEl.textContent = hit ? `Hit: "${hit.name}" (${hit.ident})` : "No hit.";
    msValueEl.textContent = ms.toFixed(2);
    consideredValueEl.textContent =
      consideredCount === null ? "n/a (native hit-test)" : `${consideredCount} / ${candidates.length}`;
  }

  const glowLayer = createGlowLayer({
    getSizeMul: () => 1,
    getOpacity: () => 0.9,
    getCoreBoost: () => 0.7,
    onFrameInfo: ({ isGlobe, transition, cameraEcef }) => {
      projectionValueEl.textContent = isGlobe ? "globe" : "mercator";
      transitionValueEl.textContent = transition.toFixed(2);
      latestCameraEcef = cameraEcef;
    },
  });

  map.on("load", () => {
    loadAirports()
      .then((rows) => {
        addCompanionLayer(map, airportsToGeoJSON(rows));
        candidates = buildPickingCandidates(rows);
      })
      .catch((err) => {
        console.error("[main] failed to load airport data:", err);
      });

    map.addLayer(glowLayer);
  });

  // Single click handler for both strategies -- see the file docstring for
  // why the branching lives here rather than as two separate listener
  // registrations. Both branches end at reportResult() + showAirportPopup().
  map.on("click", (e) => {
    if (strategy === "companion") {
      const t0 = performance.now();
      const hit: CompanionHit | null = queryCompanionAt(map, e.point);
      const ms = performance.now() - t0;
      reportResult(hit, ms, null);
      if (hit) showAirportPopup(map, e.lngLat, hit.name, hit.ident);
    } else {
      // Passing `null` instead of latestCameraEcef when the toggle is off is
      // the entire "backface culling in picking: on/off" HUD control -- see
      // ScreenSpacePickParams.cameraEcef's docstring in screenSpacePicking.ts.
      const cameraEcef = backfaceToggleEl.checked ? latestCameraEcef : null;
      const result = pickScreenSpace({
        map,
        candidates,
        clickPoint: e.point,
        cameraEcef,
        radiusPx: PICK_RADIUS_PX,
      });
      reportResult(result.hit, result.ms, result.consideredCount);
      if (result.hit) {
        showAirportPopup(map, [result.hit.lon, result.hit.lat], result.hit.name, result.hit.ident);
      }
    }
  });

  const updateZoomReadout = () => {
    zoomValueEl.textContent = map.getZoom().toFixed(2);
  };
  updateZoomReadout();
  map.on("zoom", updateZoomReadout);
}
