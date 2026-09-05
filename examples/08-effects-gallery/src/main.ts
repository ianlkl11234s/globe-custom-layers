import mapboxgl from "mapbox-gl";

// The 68 effects + the two core modules are plain, untranslated-logic JS
// (see README "TypeScript choice"). Static imports are enough here -- unlike
// the original demo (which had no bundler and dynamic-imported each category
// so the browser could fetch them independently), Vite bundles everything
// for us, so there's no benefit to deferring these.
import basicEffects from "./showcase/effects/basic.js";
import lightEffects from "./showcase/effects/light.js";
import animationEffects from "./showcase/effects/animation.js";
import shaderEffects from "./showcase/effects/shader.js";
import particlesEffects from "./showcase/effects/particles.js";
import lineEffects from "./showcase/effects/line.js";
import vizEffects from "./showcase/effects/viz.js";
import atmosphericEffects from "./showcase/effects/atmospheric.js";
import sceneEffects from "./showcase/effects/scene.js";
import { createShowcaseLayer } from "./showcase/core/layer.js";
import { setupUI } from "./showcase/core/ui.js";

/**
 * Wires up the map + the shared Three.js custom layer + the sidebar. No
 * framework, no state management -- state lives on one plain `state` object
 * that layer.js and ui.js both read/write, exactly like the original demo.
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
  const EFFECTS = [
    ...basicEffects,
    ...lightEffects,
    ...animationEffects,
    ...shaderEffects,
    ...particlesEffects,
    ...lineEffects,
    ...vizEffects,
    ...atmosphericEffects,
    ...sceneEffects,
  ];

  // Shared by the custom layer (layer.js) and the sidebar (ui.js).
  const state = {
    selected: null as string | null,
    showAll: true,
    paused: false,
  };

  const map = new mapboxgl.Map({
    container: "map",
    style: "mapbox://styles/mapbox/dark-v11",
    center: [120.9, 23.7],
    zoom: 6.6,
    pitch: 50,
    bearing: 0,
    antialias: true,
    // Deliberately mercator, not globe -- see the "Why mercator, not globe?"
    // panel in index.html and the README. These 68 effects each place
    // themselves with a single absolute MercatorCoordinate computed once in
    // onAdd(); none of them read Mapbox's globe render arguments, so they'd
    // drift from their intended location under globe projection.
    projection: "mercator",
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

  // createShowcaseLayer() is untyped JS (see README "TypeScript choice"), so
  // tsc infers a plain `string` for `type`/`renderingMode` instead of the
  // literal types CustomLayerInterface requires. Checked by hand against
  // node_modules/mapbox-gl/dist/mapbox-gl.d.ts's `interface CustomLayerInterface`:
  // the object has id/type:'custom'/renderingMode:'3d'/onAdd/render, which is
  // exactly what that interface requires (plus extra fields it doesn't
  // forbid, since this is a cast, not a fresh object literal) -- this cast
  // just tells tsc what was already confirmed by hand.
  const showcaseLayer = createShowcaseLayer({ effects: EFFECTS, state, mapboxgl }) as unknown as mapboxgl.CustomLayerInterface;

  map.on("load", () => {
    map.addLayer(showcaseLayer);
    setupUI({ effects: EFFECTS, state, map });
  });
}
