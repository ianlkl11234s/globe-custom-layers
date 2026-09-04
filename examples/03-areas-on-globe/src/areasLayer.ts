import type { CustomLayerInterface, Map as MapboxMap } from "mapbox-gl";
import { AreasScene, type ShapeMode } from "./areasScene";

export const AREAS_LAYER_ID = "areas-on-globe";

export interface AreasLayerControls {
  getSegments: () => number;
  getRadiusKm: () => number;
  getShapeMode: () => ShapeMode;
  /** Called once per render() frame with the raw globe state -- HUD readout only. */
  onFrameInfo?: (info: { isGlobe: boolean; transition: number }) => void;
}

/**
 * Builds the Mapbox `CustomLayerInterface` that bridges Mapbox's render loop
 * into `AreasScene`. Structurally this mirrors `glowLayer.ts` in the
 * companion `01-points-on-globe` example (same 7-argument `render()`
 * signature, same isGlobe/transition/cameraMerc plumbing) -- see that
 * file's comments, and the recipe doc, for why each piece is here. The
 * difference is entirely inside `AreasScene`: this file just adds
 * "rebuild the geometry when segments/radius change" on top.
 */
export function createAreasLayer(controls: AreasLayerControls): CustomLayerInterface {
  const scene = new AreasScene();
  let map: MapboxMap | null = null;
  let lastSegments = -1;
  let lastRadiusKm = -1;

  return {
    id: AREAS_LAYER_ID,
    type: "custom",
    renderingMode: "3d",

    onAdd(mapInstance, gl) {
      map = mapInstance;
      scene.init(gl);
      lastSegments = controls.getSegments();
      lastRadiusKm = controls.getRadiusKm();
      scene.rebuild(lastSegments, lastRadiusKm);
    },

    render(
      _gl,
      matrix,
      projection,
      projectionToMercatorMatrix,
      projectionToMercatorTransition,
      _centerInMercator, // unused -- see the doc's "The undocumented render arguments"
      _pixelsPerMeterRatio, // unused -- same
    ) {
      // Geometry only gets rebuilt when the sliders actually change, not
      // every frame -- see AreasScene.rebuild()'s docstring.
      const segments = controls.getSegments();
      const radiusKm = controls.getRadiusKm();
      if (segments !== lastSegments || radiusKm !== lastRadiusKm) {
        lastSegments = segments;
        lastRadiusKm = radiusKm;
        scene.rebuild(segments, radiusKm);
      }
      scene.setShapeMode(controls.getShapeMode());

      // `projection?.name === "globe"` is the authoritative check for "are
      // we actually in globe projection right now" -- see the recipe doc.
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

      // Deliberately NOT calling map.triggerRepaint() here, unlike
      // glowLayer.ts in the companion example. That example animates a
      // size pulse every frame and so must force continuous repaints; these
      // shapes are static once drawn. Mapbox already calls render() on its
      // own for every camera move (pan/zoom/rotate/globe-spin), and
      // main.ts's slider 'input' listeners call map.triggerRepaint()
      // explicitly when segments/radius/shape-mode change -- so a repaint
      // happens exactly when something could have changed, not every frame
      // an idle map isn't even drawing.
    },

    onRemove() {
      scene.dispose();
    },
  };
}
