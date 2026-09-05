import type { Map as MapboxMap, PointLike, ExpressionSpecification } from "mapbox-gl";
import type { AirportFeatureCollection } from "./airportsGeoJSON";

/**
 * Strategy 1: companion native layer.
 *
 * The visible dots are drawn entirely by the custom Three.js layer
 * (glowLayer.ts / glowPointsScene.ts) -- this layer draws nothing you can
 * see (`circle-opacity: 0`). Its only job is to exist as a REAL native
 * `circle` layer so `queryRenderedFeatures` (and therefore a layer-scoped
 * `click` listener) can find it. Mapbox projects and hit-tests native layers
 * onto the globe itself, including culling ones on the far side -- so this
 * strategy gets correct globe backface behavior for free, without writing
 * any ECEF math. Compare with screenSpacePicking.ts, which has to do that
 * work by hand precisely because it does NOT go through a native layer.
 *
 * The two must share the same source of truth for position (same lon/lat)
 * or you get a real bug: the thing you SEE and the thing you can CLICK
 * drift apart. This example shares it by construction -- both this layer's
 * GeoJSON and the custom layer's buffers come from the same `loadAirports()`
 * call in main.ts, converted via the one `airportsToGeoJSON` (see
 * airportsGeoJSON.ts) already used for this in examples/00.
 */

export const COMPANION_SOURCE_ID = "airports-companion-src";
export const COMPANION_LAYER_ID = "airports-companion-circle";

// Must track glowPointsScene.ts's MIN_POINT_SIZE_PX / MAX_POINT_SIZE_PX and
// setZoom()'s `referenceZoom = 3` -- this is the "keep the click radius
// aligned with the visible radius" requirement from the README, expressed as
// a style-spec paint expression instead of a shader uniform.
const MIN_POINT_PX = 10;
const MAX_POINT_PX = 56;

/**
 * `circle-radius`, combining a per-point size (from `sizeNorm`) with a
 * zoom-dependent multiplier -- Mapbox's style spec calls this shape a
 * "zoom-and-property" / composite expression.
 *
 * THE NESTING ORDER IS NOT ARBITRARY. An earlier draft of this function
 * wrote `["*", <get-sizeNorm interpolate>, <zoom interpolate>]` -- i.e. the
 * zoom expression nested *inside* a `"*"`. Mapbox's style spec rejects that
 * at `addLayer()` time with `"zoom" expression may only be used as input to
 * a top-level "step" or "interpolate" expression` (confirmed against the
 * pinned mapbox-gl 3.18.1 bundle, not just the docs). `["zoom"]` may ONLY
 * appear as the input to a `interpolate`/`step` that is itself at the top of
 * the expression tree -- never nested inside `*`, `+`, `case`, or anything
 * else. The fix is to invert the nesting: the OUTER expression interpolates
 * on zoom, and each zoom stop's *output* is itself an expression (here,
 * `["*", <constant>, <sizeNorm interpolate>]`) -- `get`/data expressions,
 * unlike `zoom`, are allowed anywhere, including inside another
 * expression's output. This is exactly the shape Mapbox's own style-spec
 * examples use for "zoom-and-property functions". See
 * nativeCompanionLayer.test.ts for a structural test that pins this down
 * (`expr[0] === "interpolate" && expr[2] deep-equals ["zoom"]`) so a future
 * edit can't quietly reintroduce the invalid nesting.
 *
 * The per-stop multipliers are a PIECEWISE-LINEAR APPROXIMATION of
 * `glowPointsScene.ts`'s zoom scaling, `clamp(pow(1.4, zoom - 3), 0.35, 4)`.
 * The stops below are pow(1.4, zoom-3) evaluated by hand at a few zoom
 * levels (0 -> 0.36, 3 -> 1, 5 -> 1.96, 7 -> 3.84), then held flat at 4 from
 * zoom 9 onward once the true curve would already have blown past the
 * shader's ceiling clamp. `interpolate` connects consecutive stops with a
 * STRAIGHT LINE, not the true exponential curve, so this only approximates
 * the real per-frame value -- it does not reproduce the shader's continuous
 * pulse animation (0.8x-1.0x size wobble, `0.9 + 0.1 * sin(...)` in
 * glowPointsScene.ts's vertex shader) at all, since that lives entirely on
 * the GPU side and has no native-layer equivalent. Good enough for a click
 * radius; do not mistake it for the exact rendered size. See the README's
 * "Deliberate simplifications".
 */
export function companionCircleRadiusExpression(): ExpressionSpecification {
  const sizeFromNorm: ExpressionSpecification = [
    "interpolate",
    ["linear"],
    ["get", "sizeNorm"],
    0,
    MIN_POINT_PX,
    1,
    MAX_POINT_PX,
  ];

  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    0,
    ["*", 0.36, sizeFromNorm],
    3,
    ["*", 1, sizeFromNorm],
    5,
    ["*", 1.96, sizeFromNorm],
    7,
    ["*", 3.84, sizeFromNorm],
    9,
    ["*", 4, sizeFromNorm],
    22,
    ["*", 4, sizeFromNorm],
  ];
}

export function addCompanionLayer(map: MapboxMap, data: AirportFeatureCollection): void {
  map.addSource(COMPANION_SOURCE_ID, { type: "geojson", data });

  map.addLayer({
    id: COMPANION_LAYER_ID,
    type: "circle",
    source: COMPANION_SOURCE_ID,
    paint: {
      "circle-radius": companionCircleRadiusExpression(),
      // The entire trick, in one line: invisible to the eye, fully present
      // to queryRenderedFeatures. A 'none' layout visibility would ALSO hide
      // it from hit-testing (see examples/00's nativeLayer.ts comment on
      // this exact distinction) -- opacity is the one that keeps it
      // clickable while drawing nothing.
      "circle-opacity": 0,
    },
  });
}

export interface CompanionHit {
  ident: string;
  name: string;
}

/**
 * Runs the companion strategy's hit test for one click point. Kept as a
 * plain function (not a bound event listener) so main.ts can wrap the call
 * in its own `performance.now()` timing -- see the README's "hit-test time"
 * HUD row -- and so both strategies report through the same code shape.
 *
 * Guards against the layer not existing yet: `loadAirports()` in main.ts is
 * async, so a user can switch to "native companion" and click before
 * `addCompanionLayer()` has run. `queryRenderedFeatures` with an unknown
 * layer id fires a style/console error rather than just returning
 * empty -- checking `map.getLayer()` first turns "not ready yet" into a
 * quiet "no hit" instead.
 */
export function queryCompanionAt(map: MapboxMap, point: PointLike): CompanionHit | null {
  if (!map.getLayer(COMPANION_LAYER_ID)) return null;
  const features = map.queryRenderedFeatures(point, { layers: [COMPANION_LAYER_ID] });
  const feature = features[0];
  if (!feature) return null;
  const props = feature.properties as { ident: string; name: string } | null;
  if (!props) return null;
  return { ident: props.ident, name: props.name };
}
