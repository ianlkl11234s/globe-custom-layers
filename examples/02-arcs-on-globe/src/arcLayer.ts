import type { CustomLayerInterface, Map as MapboxMap } from "mapbox-gl";
import { ArcsScene } from "./arcsScene";
import { loadHubs } from "./airports";
import { buildArcRoutes } from "./arcs";

export const ARC_LAYER_ID = "arcs-on-globe";

export interface ArcLayerControls {
  getSegmentsPerArc: () => number;
  getArcHeightMercZ: () => number;
  /**
   * Called once per render() frame with the current globe/geometry state --
   * purely for main.ts's HUD readout, not needed for the projection
   * technique itself. `arcCount`/`vertexCount` are 0 until hub data has
   * loaded (see ArcsScene.arcCount/liveVertexCount).
   */
  onFrameInfo?: (info: { isGlobe: boolean; transition: number; arcCount: number; vertexCount: number }) => void;
}

/**
 * Builds the Mapbox `CustomLayerInterface` that bridges Mapbox's render loop
 * into `ArcsScene`. Structurally identical to 01-points-on-globe'
 * `glowLayer.ts` -- see that file's docstring for the 7-argument render()
 * signature this receives in globe projection.
 */
export function createArcLayer(controls: ArcLayerControls): CustomLayerInterface {
  const scene = new ArcsScene();
  let map: MapboxMap | null = null;
  let dataReady = false;

  return {
    id: ARC_LAYER_ID,
    type: "custom",
    renderingMode: "3d",

    onAdd(mapInstance, gl) {
      map = mapInstance;
      scene.init(gl);
      loadHubs()
        .then((hubs) => {
          const routes = buildArcRoutes(hubs);
          scene.setRoutes(routes);
          scene.setParams(controls.getSegmentsPerArc(), controls.getArcHeightMercZ());
          dataReady = true;
          map?.triggerRepaint();
        })
        .catch((err) => {
          console.error("[arcLayer] failed to load hub/airport data:", err);
        });
    },

    render(
      _gl,
      matrix,
      projection,
      projectionToMercatorMatrix,
      projectionToMercatorTransition,
      _centerInMercator, // unused here -- see glowLayer.ts's note on the same unused args
      _pixelsPerMeterRatio,
    ) {
      if (!dataReady) return;

      // Picking up slider values here (rather than dedicated 'input'
      // listeners in main.ts) keeps main.ts framework-free -- ArcsScene's own
      // setParams() only actually rebuilds when a value changed, so calling
      // it every frame costs nothing once the sliders are idle.
      scene.setParams(controls.getSegmentsPerArc(), controls.getArcHeightMercZ());

      // Same globe-detection rule as glowLayer.ts: projection?.name === "globe"
      // is the authoritative check, not zoom level.
      const isGlobe = projection?.name === "globe" && !!projectionToMercatorMatrix;

      let cameraMerc: { x: number; y: number; z: number } | null = null;
      if (isGlobe && map) {
        const cam = map.getFreeCameraOptions().position;
        if (cam) cameraMerc = { x: cam.x, y: cam.y, z: cam.z };
      }

      const transition = projectionToMercatorTransition ?? 1;
      scene.setGlobe(isGlobe ? projectionToMercatorMatrix! : null, transition, cameraMerc);

      scene.render(matrix);
      controls.onFrameInfo?.({
        isGlobe,
        transition,
        arcCount: scene.arcCount,
        vertexCount: scene.liveVertexCount,
      });

      // Simplification note (same one glowLayer.ts documents): production
      // code throttles repaints while idle. This example always requests the
      // next frame so slider changes (segments, arcHeight) show up
      // immediately with no extra wiring -- don't copy this into something
      // with a real GPU budget.
      map?.triggerRepaint();
    },

    onRemove() {
      scene.dispose();
    },
  };
}
