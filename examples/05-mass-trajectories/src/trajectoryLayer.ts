import type { CustomLayerInterface, Map as MapboxMap } from "mapbox-gl";
import { TrajectoryScene, type UpdateStats } from "./trajectoryScene";
import type { EvictionStrategy } from "./slotPool";

export const TRAJECTORY_LAYER_ID = "mass-trajectories";

export interface TrajectoryLayerControls {
  getSimTime: () => number;
  getActiveCount: () => number;
  getOpacity: () => number;
  getStrategy: () => EvictionStrategy;
  onFrameInfo?: (info: { isGlobe: boolean; transition: number; stats: UpdateStats; drawCalls: number }) => void;
}

/**
 * Builds the Mapbox `CustomLayerInterface` bridging Mapbox's render loop
 * into `TrajectoryScene`. Structurally the same shape as every other
 * example's layer file in this cookbook (same 7-argument `render()`
 * signature, same globe-detection rule, same camera-to-ECEF wiring) --
 * see examples/04-moving-trajectory/src/trajectoryLayer.ts, which this
 * file is closest to.
 */
export function createTrajectoryLayer(controls: TrajectoryLayerControls): CustomLayerInterface {
  const scene = new TrajectoryScene();
  let map: MapboxMap | null = null;
  let ready = false;

  return {
    id: TRAJECTORY_LAYER_ID,
    type: "custom",
    renderingMode: "3d",

    onAdd(mapInstance, gl) {
      map = mapInstance;
      scene.init(gl);
      ready = true;
    },

    render(
      _gl,
      matrix,
      projection,
      projectionToMercatorMatrix,
      projectionToMercatorTransition,
      _centerInMercator, // unused -- see examples/01-points-on-globe's glowLayer.ts for why
      _pixelsPerMeterRatio, // unused
    ) {
      if (!ready) return;

      scene.setActiveCount(controls.getActiveCount());
      scene.setOpacity(controls.getOpacity());
      scene.setStrategy(controls.getStrategy());

      // Advance every active object's leg (and write its trail into a
      // slot, acquiring/evicting as needed) BEFORE reading the globe/camera
      // parameters below -- same ordering rule as 04's trajectoryLayer.ts.
      scene.syncTime(controls.getSimTime());

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
        stats: scene.getLastStats(),
        drawCalls: scene.getDrawCallCount(),
      });

      // Same "always repaint" simplification as every other example in
      // this cookbook -- see 01/04's trajectoryLayer.ts for the production
      // alternative (throttled repaints via a shared scheduler). Here it
      // also keeps the leg-lifecycle simulation clock advancing.
      map?.triggerRepaint();
    },

    onRemove() {
      scene.dispose();
    },
  };
}
