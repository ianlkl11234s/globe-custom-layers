import type { CustomLayerInterface, CustomRenderMethodInput, Map as MapLibreMap } from "maplibre-gl";
import * as THREE from "three";
import { GlowPointsScene } from "../examples/01-points-on-globe/src/glowPointsScene";
import { ArcsScene, DEFAULT_ARC_HEIGHT_MERC_Z, DEFAULT_SEGMENTS_PER_ARC } from "../examples/02-arcs-on-globe/src/arcsScene";
import { buildArcRoutes } from "../examples/02-arcs-on-globe/src/arcs";
import { TrajectoryScene, type TrailPalette } from "../examples/05-mass-trajectories/src/trajectoryScene";

export type CustomSceneName = "points" | "arcs" | "tracks";
export type CustomTheme = "light" | "dark";
export type TrajectoryPalette = TrailPalette;

export interface AirportFixture {
  airports: Array<[string, string, number, number]>;
}

export interface FrameInfo {
  scene: CustomSceneName;
  projection: string;
  transition: number;
  arcCount?: number;
  vertexCount?: number;
  activeCount?: number;
  slotsUsed?: number;
  slotCapacity?: number;
  drawCalls?: number;
  msPerUpdate?: number;
}

export interface CustomLayerOptions {
  theme: CustomTheme;
  airports?: AirportFixture;
  height?: number;
  segments?: number;
  paused?: boolean;
  speed?: number;
  activeCount?: number;
  opacity?: number;
  palette?: TrajectoryPalette;
  onFrameInfo?: (info: FrameInfo) => void;
}

export interface CustomLayerControls {
  setTheme(theme: CustomTheme): void;
  setOptions(options: Partial<{ segments: number; height: number; paused: boolean; speed: number; activeCount: number; opacity: number }>): void;
  setPalette(palette: TrajectoryPalette): void;
}

export type GlobeCustomLayer = CustomLayerInterface & CustomLayerControls;

const HUB_IDENTS = [
  "RCTP", "RJAA", "RKSI", "ZBAA", "WSSS", "OMDB", "EGLL", "LFPG", "EDDF", "LTFJ",
  "FAOR", "KJFK", "KATL", "KORD", "KLAX", "CYYZ", "CYVR", "MMMX", "SBGR", "YSSY",
] as const;
const MAPLIBRE_RADIUS_METERS = 6371008.8;
const MAPBOX_ECEF_RADIUS = 8192 / (2 * Math.PI);
const ECEF_UNIT_TO_METERS = MAPLIBRE_RADIUS_METERS / MAPBOX_ECEF_RADIUS;
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

type SceneInternals = {
  scene: THREE.Scene;
  setTheme(theme: CustomTheme): void;
  init(gl: WebGL2RenderingContext): void;
  render(matrix: number[]): void;
  dispose(): void;
};

/**
 * Rewrites the Mapbox-only vertex position path after a cookbook scene has
 * built its unchanged geometry/material. MapLibre owns globe/mercator
 * interpolation through its runtime prelude; this adapter only supplies the
 * existing mercator position and altitude to projectTileWithElevation.
 */
function installMapLibreProjection(scene: SceneInternals, input: CustomRenderMethodInput, dynamic: boolean): void {
  scene.scene.traverse((object) => {
    const material = (object as { material?: unknown }).material;
    if (!(material instanceof THREE.ShaderMaterial)) return;

    const original = material.userData.maplibreCustomOriginalVertex ?? material.vertexShader;
    material.userData.maplibreCustomOriginalVertex = original;
    const attributesAt = original.indexOf("attribute ");
    const mainAt = original.indexOf("void main() {");
    if (attributesAt < 0 || mainAt < 0) throw new Error("Expected cookbook ShaderMaterial vertex declarations");
    const declarations = original.slice(attributesAt, mainAt);
    const main = dynamic
      ? `
  vColor = aColor;
  vOpacity = aOpacity;
  vProgress = progress;
  float elevation = mix(elevationFromStatic(aEcef), elevationFromMercator(position), step(0.5, aDynamic));
  // MapLibre's projection prelude clips the far hemisphere in clip space.
  // Keep the source fragment contract explicit rather than leaving vCull undefined.
  vCull = 1.0;
  gl_Position = projectTileWithElevation(position.xy, elevation);`
      : original.includes("gl_PointSize")
        ? `
  vColor = aColor;
  float elevation = elevationFromStatic(aEcef);
  vCull = 1.0;
  gl_Position = projectTileWithElevation(position.xy, elevation);
  // Unchanged cookbook point-size/pulse algorithm.
  float pulse = 0.9 + 0.1 * sin(uTime * 1.8 + position.x * 200.0);
  gl_PointSize = aSize * uPixelRatio * pulse * uZoomScale * uSizeMul;`
        : `
  float elevation = elevationFromStatic(aEcef);
  vCull = 1.0;
  gl_Position = projectTileWithElevation(position.xy, elevation);`;

    material.vertexShader = `${input.shaderData.vertexShaderPrelude}\n${input.shaderData.define}\n${declarations}
const float MAPBOX_ECEF_RADIUS = ${MAPBOX_ECEF_RADIUS.toFixed(12)};
const float ECEF_UNIT_TO_METERS = ${ECEF_UNIT_TO_METERS.toFixed(12)};
float elevationFromStatic(vec3 ecef) { return max(0.0, length(ecef) - MAPBOX_ECEF_RADIUS) * ECEF_UNIT_TO_METERS; }
float elevationFromMercator(vec3 mercator) {
  float latitude = 2.0 * atan(exp(3.141592653589793 * (1.0 - 2.0 * mercator.y))) - 1.5707963267948966;
  return mercator.z * 40030228.88407185 * cos(latitude);
}
void main() {
  ${main}
}`;
    material.uniforms.u_projection_matrix = { value: new THREE.Matrix4() };
    material.uniforms.u_projection_tile_mercator_coords = { value: new THREE.Vector4() };
    material.uniforms.u_projection_clipping_plane = { value: new THREE.Vector4() };
    material.uniforms.u_projection_transition = { value: 1 };
    material.uniforms.u_projection_fallback_matrix = { value: new THREE.Matrix4() };
    // MapLibre rewrites clip-space Z for horizon clipping. The basemap depth
    // must not cut point sprites or additive lines; clipping owns occlusion.
    material.depthTest = false;
    material.depthWrite = false;
    material.needsUpdate = true;
  });
}

function updateProjectionUniforms(scene: SceneInternals, input: CustomRenderMethodInput): void {
  const data = input.defaultProjectionData;
  scene.scene.traverse((object) => {
    const material = (object as { material?: unknown }).material;
    if (!(material instanceof THREE.ShaderMaterial)) return;
    (material.uniforms.u_projection_matrix.value as THREE.Matrix4).fromArray(data.mainMatrix);
    (material.uniforms.u_projection_tile_mercator_coords.value as THREE.Vector4).fromArray(data.tileMercatorCoords);
    (material.uniforms.u_projection_clipping_plane.value as THREE.Vector4).fromArray(data.clippingPlane);
    material.uniforms.u_projection_transition.value = data.projectionTransition;
    (material.uniforms.u_projection_fallback_matrix.value as THREE.Matrix4).fromArray(data.fallbackMatrix);
  });
}

function pointRows(airports: AirportFixture) {
  return airports.airports.map(([ident, , lon, lat]) => {
    let hash = 0x811c9dc5;
    for (let i = 0; i < ident.length; i++) { hash ^= ident.charCodeAt(i); hash = Math.imul(hash, 0x01000193); }
    const sizeNorm = Math.sqrt((hash >>> 0) / 0xffffffff);
    const t = Math.max(0, Math.min(1, sizeNorm));
    const [from, to, local] = t < 0.5
      ? [[255, 255, 255], [255, 140, 26], t * 2]
      : [[255, 140, 26], [255, 30, 30], (t - 0.5) * 2];
    const color = from.map((value, index) => Math.round(value + (to[index]! - value) * local));
    return { lon, lat, sizeNorm, colorHex: `rgb(${color[0]},${color[1]},${color[2]})` };
  });
}

function hubs(airports: AirportFixture) {
  const byIdent = new globalThis.Map(airports.airports.map(([ident, name, lon, lat]) => [ident, { ident, name, lon, lat }]));
  return HUB_IDENTS.flatMap((ident) => {
    const hub = byIdent.get(ident);
    return hub ? [hub] : [];
  });
}

export function createCustomLayer(sceneName: CustomSceneName, initial: CustomLayerOptions): GlobeCustomLayer {
  let theme = initial.theme;
  let segments = initial.segments ?? DEFAULT_SEGMENTS_PER_ARC;
  let height = initial.height ?? DEFAULT_ARC_HEIGHT_MERC_Z;
  let activeCount = initial.activeCount ?? 1500;
  let opacity = initial.opacity ?? 0.9;
  let speed = initial.speed ?? 1;
  let palette: TrajectoryPalette = initial.palette ?? "multicolor";
  let paused = initial.paused ?? false;
  // A reduced-motion / initially paused view needs an existing trail window,
  // not time zero where every synthetic leg has only one point.
  let simulationTime = initial.paused ? 5 : 0;
  let lastClockMs = 0;
  let scene: SceneInternals | null = null;
  let map: MapLibreMap | null = null;
  let projectionVariant: string | null = null;

  const layer: GlobeCustomLayer = {
    id: `maplibre-custom-${sceneName}`,
    type: "custom",
    renderingMode: "3d",
    onAdd(mapInstance, gl) {
      map = mapInstance;
      scene = (sceneName === "points" ? new GlowPointsScene() : sceneName === "arcs" ? new ArcsScene() : new TrajectoryScene()) as unknown as SceneInternals;
      scene.init(gl as WebGL2RenderingContext);
      scene.setTheme(theme);
      lastClockMs = performance.now();

      if (!initial.airports && sceneName !== "tracks") throw new Error("MapLibre custom points/arcs require options.airports");
      if (sceneName === "points") (scene as unknown as GlowPointsScene).setData(pointRows(initial.airports!));
      if (sceneName === "arcs") {
        const arcs = scene as unknown as ArcsScene;
        arcs.setRoutes(buildArcRoutes(hubs(initial.airports!)));
        arcs.setParams(segments, height);
      }
      if (sceneName === "tracks") (scene as unknown as TrajectoryScene).setPalette(palette);
    },
    render(_gl, input) {
      if (!scene) return;
      // MapLibre 5.24's custom-layer callback reports a binary globe factor.
      // The tile projection path carries the actual blend used by the basemap.
      // Keep its matrices in the custom [0,1] coordinate convention; only take
      // the coefficient. This transform method is pinned-version integration.
      const transition = map!.transform.getProjectionData({
        overscaledTileID: null, applyGlobeMatrix: true,
      }).projectionTransition;
      input = { ...input, defaultProjectionData: { ...input.defaultProjectionData, projectionTransition: transition } };
      if (projectionVariant !== input.shaderData.variantName) {
        installMapLibreProjection(scene, input, sceneName === "tracks");
        projectionVariant = input.shaderData.variantName;
      }
      updateProjectionUniforms(scene, input);
      scene.setTheme(theme);

      if (sceneName === "points") {
        const points = scene as unknown as GlowPointsScene;
        points.setOpacity(opacity);
        points.setZoom(map?.getZoom() ?? 0);
      } else if (sceneName === "arcs") {
        const arcs = scene as unknown as ArcsScene;
        arcs.setParams(segments, height);
      } else {
        const tracks = scene as unknown as TrajectoryScene;
        tracks.setOpacity(opacity);
        tracks.setActiveCount(activeCount);
        const now = performance.now();
        if (!paused) simulationTime += Math.min(now - lastClockMs, 100) / 1000 * speed;
        lastClockMs = now;
        // A paused initial scene must still populate its fixed trail buffers.
        tracks.syncTime(simulationTime);
      }

      // The replacement shader writes clip-space itself via MapLibre's prelude;
      // the legacy scene renderer remains useful for its shared-context reset.
      scene.render(IDENTITY);
      if (sceneName === "arcs") {
        const arcs = scene as unknown as ArcsScene;
        initial.onFrameInfo?.({ scene: sceneName, projection: input.shaderData.variantName, transition, arcCount: arcs.arcCount, vertexCount: arcs.liveVertexCount });
      } else if (sceneName === "tracks") {
        const tracks = scene as unknown as TrajectoryScene;
        const stats = tracks.getLastStats();
        initial.onFrameInfo?.({ scene: sceneName, projection: input.shaderData.variantName, transition, activeCount: stats.activeCount, slotsUsed: stats.slotsUsed, slotCapacity: stats.slotCapacity, drawCalls: tracks.getDrawCallCount(), msPerUpdate: stats.msPerUpdate });
      } else initial.onFrameInfo?.({ scene: sceneName, projection: input.shaderData.variantName, transition });
      map?.triggerRepaint();
    },
    onRemove() { scene?.dispose(); scene = null; map = null; projectionVariant = null; },
    setTheme(next) { theme = next === "dark" ? "dark" : "light"; scene?.setTheme(theme); map?.triggerRepaint(); },
    setOptions(next) {
      if (typeof next.segments === "number") segments = Math.max(2, Math.min(128, Math.round(next.segments)));
      if (typeof next.height === "number") height = Math.max(0, Math.min(0.08, next.height));
      if (typeof next.activeCount === "number") activeCount = Math.max(100, Math.min(12000, Math.round(next.activeCount)));
      if (typeof next.opacity === "number") opacity = Math.max(0.1, Math.min(1, next.opacity));
      if (typeof next.speed === "number") speed = Math.max(0.1, Math.min(4, next.speed));
      if (typeof next.paused === "boolean") { paused = next.paused; lastClockMs = performance.now(); }
      map?.triggerRepaint();
    },
    setPalette(next) {
      palette = next === "cool" || next === "warm" ? next : "multicolor";
      (scene as unknown as TrajectoryScene | null)?.setPalette(palette);
      map?.triggerRepaint();
    },
  };
  return layer;
}
