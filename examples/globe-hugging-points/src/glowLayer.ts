import type { CustomLayerInterface, Map as MapboxMap } from "mapbox-gl";
import { GlowPointsScene } from "./glowPointsScene";
import { loadAirports } from "./airports";

export const GLOW_LAYER_ID = "globe-hugging-points";

export interface GlowLayerControls {
  getSizeMul: () => number;
  getOpacity: () => number;
  getCoreBoost: () => number;
  /**
   * Called once per render() frame with the raw globe state Mapbox reported
   * this frame. Purely for main.ts's HUD readout -- not needed for the
   * projection technique itself, just handy for seeing it work.
   */
  onFrameInfo?: (info: { isGlobe: boolean; transition: number }) => void;
}

/**
 * Builds the Mapbox `CustomLayerInterface` that bridges Mapbox's render loop
 * into `GlowPointsScene`. This is the file that actually receives the 7
 * arguments `render()` can be called with -- see the recipe doc's "The
 * undocumented render arguments" section for the full type.
 */
export function createGlowLayer(controls: GlowLayerControls): CustomLayerInterface {
  const scene = new GlowPointsScene();
  let map: MapboxMap | null = null;
  let dataReady = false;

  return {
    id: GLOW_LAYER_ID,
    type: "custom",
    // "3d" tells Mapbox this layer wants the 3D render pass (depth buffer
    // bound, terrain/globe already drawn) rather than the simpler 2D pass.
    // Custom layers that hug the globe need this.
    renderingMode: "3d",

    onAdd(mapInstance, gl) {
      map = mapInstance;
      scene.init(gl);
      loadAirports()
        .then((rows) => {
          scene.setData(rows);
          dataReady = true;
          map?.triggerRepaint();
        })
        .catch((err) => {
          console.error("[glowLayer] failed to load airport data:", err);
        });
    },

    render(
      _gl,
      matrix,
      projection,
      projectionToMercatorMatrix,
      projectionToMercatorTransition,
      _centerInMercator, // unused here -- see the doc's "The undocumented render arguments"
      _pixelsPerMeterRatio, // unused here -- same
    ) {
      if (!dataReady) return;

      scene.setOpacity(controls.getOpacity());
      scene.setCoreBoost(controls.getCoreBoost());
      scene.setSizeMul(controls.getSizeMul());
      if (map) scene.setZoom(map.getZoom());

      // This is the crux of the whole technique. Mapbox calls render() with
      // up to 7 arguments when the active style supports globe projection;
      // an older mapbox-gl build, or a style pinned to plain mercator, calls
      // it with just (gl, matrix) -- projection, projectionToMercatorMatrix
      // etc. all come through as `undefined` in that case.
      //
      // `projection?.name === "globe"` is the authoritative check for
      // "are we actually in globe projection right now" -- don't try to
      // infer it from zoom level yourself; Mapbox owns exactly where the
      // globe<->flat threshold sits (around z5-z6) and that's also exactly
      // what projectionToMercatorTransition already encodes for you.
      const isGlobe = projection?.name === "globe" && !!projectionToMercatorMatrix;

      // The camera is only meaningful (and only needed) in globe mode, for
      // backface culling -- skip fetching it entirely in flat mode.
      let cameraMerc: { x: number; y: number; z: number } | null = null;
      if (isGlobe && map) {
        // getFreeCameraOptions().position is in the SAME mercator-world
        // space projectionToMercatorMatrix maps into -- that's what lets
        // GlowPointsScene.setGlobe() invert the matrix and land the camera
        // in ECEF space alongside every point's precomputed aEcef.
        const cam = map.getFreeCameraOptions().position;
        if (cam) cameraMerc = { x: cam.x, y: cam.y, z: cam.z };
      }

      const transition = projectionToMercatorTransition ?? 1;
      scene.setGlobe(
        isGlobe ? projectionToMercatorMatrix! : null,
        // Mercator fallback: default to 1 (fully flat) when Mapbox doesn't
        // send a transition at all, matching the recipe's "render() got
        // only 2 arguments" rule. When isGlobe is true this is always a
        // real number from Mapbox, so the ?? never actually applies there.
        transition,
        cameraMerc,
      );

      scene.render(matrix);
      controls.onFrameInfo?.({ isGlobe, transition });

      // Simplification note: production code in this recipe's source repo
      // throttles repaints (e.g. 20fps while idle, stop entirely after 30s
      // of no activity) via a shared scheduler across multiple layers. That
      // infrastructure is orthogonal to globe-hugging itself, so this
      // example just always requests the next frame to keep the size-pulse
      // animation and globe<->flat transition smooth. Don't copy this
      // "always repaint" line into a production layer with real GPU budgets.
      map?.triggerRepaint();
    },

    onRemove() {
      scene.dispose();
    },
  };
}
