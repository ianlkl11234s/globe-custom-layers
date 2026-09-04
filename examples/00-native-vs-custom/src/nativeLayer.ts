import mapboxgl from "mapbox-gl";
import type { Map as MapboxMap, MapMouseEvent } from "mapbox-gl";
import type { AirportFeatureCollection } from "./airportsGeoJSON";

// `MapMouseEvent` (imported above) already types `features?: Array<GeoJSONFeature>`
// on itself -- populated only when the listener was registered with a layer
// id, exactly as it is below via `map.on("click", NATIVE_LAYER_ID, ...)`. No
// extra type plumbing needed for that part.

export const NATIVE_SOURCE_ID = "airports-native-src";
export const NATIVE_LAYER_ID = "airports-native-circle";

/**
 * The entire "native" side of this comparison: a GeoJSON source plus a
 * `circle` layer. Mapbox projects circle layers onto the globe internally,
 * in its own shaders -- there is no ECEF math, no custom shader, and no
 * `render()` plumbing to write here. This genuinely is all the code a
 * `circle` layer needs to hug the globe; compare against globeProject.ts +
 * glowPointsScene.ts + glowLayer.ts (680 lines combined) for the custom
 * layer that reproduces the same globe-hugging behavior by hand.
 */
export function addNativeAirportsLayer(map: MapboxMap, data: AirportFeatureCollection): void {
  map.addSource(NATIVE_SOURCE_ID, { type: "geojson", data });

  map.addLayer({
    id: NATIVE_LAYER_ID,
    type: "circle",
    source: NATIVE_SOURCE_ID,
    paint: {
      // sizeNorm/colorHex come straight from GeoJSON feature properties via
      // style expressions -- no JS glue, no per-frame uniform updates.
      "circle-radius": ["interpolate", ["linear"], ["get", "sizeNorm"], 0, 3, 1, 9],
      "circle-color": ["get", "colorHex"],
      "circle-opacity": 0.85,
      "circle-stroke-width": 1,
      "circle-stroke-color": "rgba(255, 255, 255, 0.45)",
    },
  });
}

/**
 * Wires the one thing native layers get "for free" that custom layers
 * structurally cannot: hit-testing. A layer-scoped `click` listener like
 * this one is backed by `queryRenderedFeatures`, which inspects Mapbox's
 * own rendered tile/feature buffers -- buffers a `CustomLayerInterface`
 * never writes into, because it draws straight to the shared WebGL context
 * with its own draw calls. See docs/01-hugging-the-globe/mapbox.md's "Step
 * 5" note and this example's README for the workaround (an invisible native
 * layer kept alongside the custom one, purely to own interaction).
 */
export function bindNativeClickPopup(map: MapboxMap, onHit: (name: string, ident: string) => void): void {
  map.on("click", NATIVE_LAYER_ID, (e: MapMouseEvent) => {
    const feature = e.features?.[0];
    if (!feature) return;
    const props = feature.properties as { name: string; ident: string } | null;
    if (!props) return;

    onHit(props.name, props.ident);

    new mapboxgl.Popup({ closeButton: true, closeOnClick: true })
      .setLngLat(e.lngLat)
      .setHTML(
        `<strong>${escapeHtml(props.name)}</strong><br>` +
          `<span style="opacity:.7">${escapeHtml(props.ident)}</span>`,
      )
      .addTo(map);
  });

  // Native layers can also honestly reflect "there's something clickable
  // here" in the cursor -- another thing a custom layer would have to
  // reimplement its own picking to do.
  map.on("mouseenter", NATIVE_LAYER_ID, () => {
    map.getCanvas().style.cursor = "pointer";
  });
  map.on("mouseleave", NATIVE_LAYER_ID, () => {
    map.getCanvas().style.cursor = "";
  });
}

function escapeHtml(s: string): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return s.replace(/[&<>"']/g, (c) => map[c]!);
}
