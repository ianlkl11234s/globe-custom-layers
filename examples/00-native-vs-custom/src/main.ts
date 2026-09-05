import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { loadAirports } from "./airports";
import { airportsToGeoJSON } from "./airportsGeoJSON";
import { addNativeAirportsLayer, bindNativeClickPopup, NATIVE_LAYER_ID } from "./nativeLayer";
import { createGlowLayer } from "./glowLayer";

/**
 * Wires up: one map, two layers drawing the SAME airport data, and a mode
 * switch that toggles which one(s) are visible. No framework, no state
 * management -- this is deliberately the smallest amount of glue code that
 * lets you flip between "native circle layer" and "custom Three.js layer"
 * and see both the visual result and the interaction gap.
 */

type Mode = "native" | "custom" | "both";

// Hardcoded, not computed at runtime -- but kept honest by actually running
// `wc -l` on the files being described (checked when this example was
// written; re-run `wc -l src/nativeLayer.ts` etc. if you edit them).
//
// NATIVE_LOC covers the ENTIRE native side: the source + circle layer
// (addNativeAirportsLayer) AND the click/popup/cursor wiring
// (bindNativeClickPopup), all in src/nativeLayer.ts -- because writing that
// interaction code is optional-but-easy for a native layer, so it's fair to
// count it.
//
// CUSTOM_LOC covers ONLY drawing: globeProject.ts (229 lines) is genuinely
// not optional if you want a custom layer to hug the globe at all, and
// glowPointsScene.ts (330) + glowLayer.ts (121) are the Three.js scene +
// CustomLayerInterface glue. It does NOT include any interaction code,
// because there isn't any to count -- see the "custom mode" click handler
// below for why.
const NATIVE_LOC = 89; // wc -l src/nativeLayer.ts
const CUSTOM_LOC = 229 + 330 + 121; // globeProject.ts + glowPointsScene.ts + glowLayer.ts

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

  const modeValueEl = byId<HTMLSpanElement>("mode-value");
  const zoomValueEl = byId<HTMLSpanElement>("zoom-value");
  const projectionValueEl = byId<HTMLSpanElement>("projection-value");
  const transitionValueEl = byId<HTMLSpanElement>("transition-value");
  const clickInfoEl = byId<HTMLDivElement>("click-info");
  const nativeLocEl = byId<HTMLTableCellElement>("native-loc");
  const customLocEl = byId<HTMLTableCellElement>("custom-loc");
  const modeButtons: Record<Mode, HTMLButtonElement> = {
    native: byId<HTMLButtonElement>("mode-btn-native"),
    custom: byId<HTMLButtonElement>("mode-btn-custom"),
    both: byId<HTMLButtonElement>("mode-btn-both"),
  };

  nativeLocEl.textContent = String(NATIVE_LOC);
  customLocEl.textContent = String(CUSTOM_LOC);

  // No sliders in this example (unlike 01-points-on-globe) -- the point
  // here is the mode switch, not tunable glow parameters, so the custom
  // layer's controls are fixed constants instead of HUD inputs.
  //
  // customVisible is read by getOpacity() below instead of calling some
  // `customLayer.setVisible()` -- CustomLayerInterface (glowLayer.ts's
  // return type) has no such method, and glowLayer.ts is copied unmodified
  // from 01-points-on-globe on purpose. Driving opacity to 0 achieves the
  // same visible result with zero edits to the copied files: with
  // THREE.AdditiveBlending, alpha 0 means `srcColor * 0 + dstColor` --
  // genuinely no pixels change, even though Mapbox still calls render()
  // every frame (see the applyMode() comment on why that's actually useful
  // here, not just a workaround).
  let customVisible = true;
  const customLayer = createGlowLayer({
    getSizeMul: () => 1,
    getOpacity: () => (customVisible ? 0.9 : 0),
    getCoreBoost: () => 0.7,
    onFrameInfo: ({ isGlobe, transition }) => {
      projectionValueEl.textContent = isGlobe ? "globe" : "mercator";
      transitionValueEl.textContent = transition.toFixed(2);
    },
  });

  let mode: Mode = "both";

  function applyMode(next: Mode) {
    mode = next;
    modeValueEl.textContent = mode;
    for (const [m, btn] of Object.entries(modeButtons) as Array<[Mode, HTMLButtonElement]>) {
      btn.classList.toggle("active", m === mode);
    }

    const showNative = mode === "native" || mode === "both";
    const showCustom = mode === "custom" || mode === "both";

    // Native: layout visibility. Mapbox excludes 'none' layers from both
    // rendering AND queryRenderedFeatures/layer-scoped click hit-testing, so
    // this one line also disables native's popups whenever it's hidden.
    if (map.getLayer(NATIVE_LAYER_ID)) {
      map.setLayoutProperty(NATIVE_LAYER_ID, "visibility", showNative ? "visible" : "none");
    }

    // Custom: CustomLayerInterface has no built-in visibility toggle --
    // Mapbox always calls render() on every added custom layer every frame,
    // regardless of whether you'd call it "hidden". Setting customVisible
    // just drives getOpacity() to 0 (see above), which is why the
    // projection/transition readout keeps updating even in "native" mode:
    // the custom layer's render() -- and therefore onFrameInfo -- never
    // stops running, it just draws fully transparent.
    customVisible = showCustom;

    // Reset the click panel to a neutral hint on every mode switch, rather
    // than leaving a stale "you clicked X" message from the previous mode.
    clickInfoEl.className = "";
    clickInfoEl.textContent =
      mode === "custom"
        ? "Click a point -- nothing will happen. See below."
        : "Click a point on the map to see the difference.";
  }

  for (const [m, btn] of Object.entries(modeButtons) as Array<[Mode, HTMLButtonElement]>) {
    btn.addEventListener("click", () => applyMode(m));
  }

  // NOTE: applyMode() touches map.getLayer()/setLayoutProperty(), which
  // require the style to be loaded -- so the very first call happens inside
  // 'load' below, not here. Before that, modeButtons/modeValueEl already
  // show sane defaults from index.html's initial markup ("--" / no
  // ".active" class), so there's nothing broken to see for the brief moment
  // before 'load' fires.

  map.on("load", () => {
    loadAirports()
      .then((rows) => {
        addNativeAirportsLayer(map, airportsToGeoJSON(rows));
        bindNativeClickPopup(map, (name, ident) => {
          clickInfoEl.className = "native-hit";
          clickInfoEl.textContent = `Native hit: "${name}" (${ident}) -- queryRenderedFeatures found this circle feature.`;
        });
        applyMode(mode); // now that the native layer exists, sync its visibility
      })
      .catch((err) => {
        console.error("[main] failed to load airport data:", err);
      });

    map.addLayer(customLayer);
    applyMode(mode); // custom layer visibility can be set immediately
  });

  // THE most important click handler in this example. It is deliberately a
  // generic, layer-UNSCOPED map click -- not a layer-scoped one -- because
  // that is the whole point: there is no `NATIVE_LAYER_ID`-style id to scope
  // a click listener to for the custom layer. `queryRenderedFeatures` only
  // ever sees Mapbox's own native layers; a CustomLayerInterface draws
  // pixels straight into the shared WebGL context via its own draw calls,
  // so nothing about where you clicked relative to a glowing dot is
  // knowable through Mapbox's API. This handler doesn't even try -- it just
  // reports that fact whenever the custom layer is the one currently "in
  // the way" of your click. Compare with docs/01-hugging-the-globe/mapbox.md's
  // "Step 5" note and see recipe 3.x / a future hit-testing example (07) for
  // the real workaround: keep an invisible native circle layer alongside
  // the custom one and let IT own interaction.
  map.on("click", (e) => {
    if (mode === "custom") {
      clickInfoEl.className = "custom-blind";
      clickInfoEl.textContent =
        `You clicked (${e.lngLat.lng.toFixed(2)}, ${e.lngLat.lat.toFixed(2)}) -- the custom layer received nothing. ` +
        `Custom layers do not participate in queryRenderedFeatures -- see recipe 3.x / example 07.`;
    } else if (mode === "both") {
      // In "both" mode a click that lands on a circle also fires the
      // layer-scoped handler in bindNativeClickPopup (both listeners run
      // for the same click) -- this one just adds the reminder that the
      // custom layer, stacked at the exact same spot, got nothing either
      // way, hit or miss.
      const hitNative = map.queryRenderedFeatures(e.point, { layers: [NATIVE_LAYER_ID] }).length > 0;
      if (!hitNative) {
        clickInfoEl.className = "custom-blind";
        clickInfoEl.textContent =
          "No native circle under this click, and the custom layer beneath it never participates in hit-testing either way.";
      }
      // else: leave the native-hit message from bindNativeClickPopup's
      // callback alone -- it already fired for this same click.
    }
  });

  // Zoom changes independently of render() frames (e.g. while idle), so it
  // gets its own listener rather than piggybacking on onFrameInfo.
  const updateZoomReadout = () => {
    zoomValueEl.textContent = map.getZoom().toFixed(2);
  };
  updateZoomReadout();
  map.on("zoom", updateZoomReadout);
}
