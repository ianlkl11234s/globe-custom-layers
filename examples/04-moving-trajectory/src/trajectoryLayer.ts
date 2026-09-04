import type { CustomLayerInterface, Map as MapboxMap } from "mapbox-gl";
import { TrajectoryScene } from "./trajectoryScene";

export const TRAJECTORY_LAYER_ID = "moving-trajectory";

export interface TrajectoryLayerControls {
  /** Current simulation time in seconds -- see main.ts for how this is derived from wall-clock time, play/pause, speed, and the scrubber. */
  getSimTime: () => number;
  getActiveCount: () => number;
  getTrailWindow: () => number;
  getOpacity: () => number;
  getSizeMul: () => number;
  onFrameInfo?: (info: { isGlobe: boolean; transition: number }) => void;
}

/**
 * Builds the Mapbox `CustomLayerInterface` bridging Mapbox's render loop
 * into `TrajectoryScene`. Structurally identical to
 * examples/01-points-on-globe/src/glowLayer.ts -- same 7-argument
 * `render()` signature, same globe-detection rule
 * (`projection?.name === "globe"`), same camera-to-ECEF wiring. The only
 * difference from that file is what happens once we have those globe
 * parameters: instead of just handing them to a static scene, this layer
 * also drives the moving simulation forward (or backward, on a scrub) every
 * frame via `scene.syncTime()`.
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
      _centerInMercator, // unused -- see glowLayer.ts's identical comment
      _pixelsPerMeterRatio, // unused
    ) {
      if (!ready) return;

      scene.setActiveCount(controls.getActiveCount());
      scene.setTrailWindow(controls.getTrailWindow());
      scene.setOpacity(controls.getOpacity());
      scene.setSizeMul(controls.getSizeMul());
      if (map) scene.setZoom(map.getZoom());

      // Advance (or rebuild, on a scrub) the simulation to this frame's time
      // BEFORE reading the globe/camera parameters below -- syncTime() is
      // what actually moves the objects and pushes/rebuilds their trails.
      scene.syncTime(controls.getSimTime());

      // Same rule as the static example: `projection?.name === "globe"` is
      // the authoritative check, not zoom level -- see glowLayer.ts.
      const isGlobe = projection?.name === "globe" && !!projectionToMercatorMatrix;

      let cameraMerc: { x: number; y: number; z: number } | null = null;
      if (isGlobe && map) {
        const cam = map.getFreeCameraOptions().position;
        if (cam) cameraMerc = { x: cam.x, y: cam.y, z: cam.z };
      }

      const transition = projectionToMercatorTransition ?? 1;
      scene.setGlobe(isGlobe ? projectionToMercatorMatrix! : null, transition, cameraMerc);

      scene.render(matrix);
      controls.onFrameInfo?.({ isGlobe, transition });

      // Same "always repaint" simplification as the static example -- see
      // glowLayer.ts's docstring for what production code does instead
      // (throttled repaints via a shared scheduler). Here it also keeps the
      // simulation clock advancing.
      map?.triggerRepaint();
    },

    onRemove() {
      scene.dispose();
    },
  };
}
