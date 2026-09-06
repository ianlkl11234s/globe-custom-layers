import type { CustomLayerInterface, Map as MapboxMap } from "mapbox-gl";
import { OrbitScene } from "./orbitScene";
import { validateOrbitDefinitions, type OrbitDefinition } from "./orbitMath";

export function createOrbitLayer(orbits: readonly OrbitDefinition[], controls: { getSimSec: () => number; getAltitudeScale: () => number; onFrame: (globe: boolean) => void }): CustomLayerInterface {
  validateOrbitDefinitions(orbits);
  const scene = new OrbitScene(orbits); let map: MapboxMap | null = null; let ready = false;
  return { id: "schematic-satellite-orbits", type: "custom", renderingMode: "3d", onAdd(instance, gl) { map = instance; scene.init(gl); ready = true; }, render(_gl, matrix, projection, globeToMercator, transition) { if (!ready) return; const globe = projection?.name === "globe" && !!globeToMercator; const cam = globe && map?.getFreeCameraOptions().position; scene.setFrame(matrix, globe ? globeToMercator! : null, transition ?? 1, cam ? { x: cam.x, y: cam.y, z: cam.z } : null, controls.getSimSec(), controls.getAltitudeScale()); scene.render(); controls.onFrame(globe); map?.triggerRepaint(); }, onRemove() { ready = false; map = null; scene.dispose(); } };
}
