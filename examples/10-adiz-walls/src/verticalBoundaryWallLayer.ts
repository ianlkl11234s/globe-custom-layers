import mapboxgl, { type CustomLayerInterface, type Map as MapboxMap } from "mapbox-gl";
import * as THREE from "three";
import { buildWallVertices, type BoundaryGeometry } from "./wallGeometry";

const GLOBE_RADIUS = 8192 / (2 * Math.PI);
export const WALL_VERTEX_SHADER = /* glsl */ `
  const float GLOBE_RADIUS = ${GLOBE_RADIUS.toFixed(12)};
  uniform mat4 uGlobeToMerc; uniform float uTransition; uniform vec3 uCameraEcef; uniform float uHeightMeters;
  attribute vec3 aDirection; attribute float aHeightRatio; attribute float aMercatorMeters; attribute float aEcefMeters;
  varying float vVisibility; varying float vHeight;
  void main() {
    vec3 mercatorPosition = position; mercatorPosition.z += aHeightRatio * uHeightMeters * aMercatorMeters;
    vec3 ecef = aDirection * (GLOBE_RADIUS + aHeightRatio * uHeightMeters * aEcefMeters);
    vec3 segment = ecef - uCameraEcef;
    float nearest = clamp(dot(-uCameraEcef, segment) / max(dot(segment, segment), 0.000001), 0.0, 1.0);
    float clearance = length(uCameraEcef + segment * nearest);
    vVisibility = mix(smoothstep(GLOBE_RADIUS - 0.005, GLOBE_RADIUS, clearance), 1.0, uTransition);
    vHeight = aHeightRatio;
    vec3 globe = (uGlobeToMerc * vec4(ecef, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(mix(globe, mercatorPosition, uTransition), 1.0);
  }`;
const FRAGMENT_SHADER = /* glsl */ `
  uniform float uOpacity; varying float vVisibility; varying float vHeight;
  void main() { vec3 color = mix(vec3(0.88, 0.48, 0.10), vec3(1.0, 0.86, 0.42), pow(vHeight, 1.8)); float rim = smoothstep(0.90, 1.0, vHeight) * 0.45; gl_FragColor = vec4(color + rim, (0.18 + vHeight * 0.48) * uOpacity * vVisibility); }`;

export interface VerticalBoundaryWallControls { getDisplayHeightMeters: () => number; opacity?: number; maxSegmentMeters?: number; }
export function disposeWallResources(mesh: THREE.Mesh | null, material: THREE.Material | null, scene: THREE.Scene): void { if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); } material?.dispose(); }

/** A standalone side-wall component. Display height is visual styling, never a domain ceiling. */
export function createVerticalBoundaryWallLayer(data: BoundaryGeometry, controls: VerticalBoundaryWallControls): CustomLayerInterface {
  const scene = new THREE.Scene(), camera = new THREE.Camera(), projectionMatrix = new THREE.Matrix4(), inverseGlobeMatrix = new THREE.Matrix4(), globeMatrix = new THREE.Matrix4();
  let renderer: THREE.WebGLRenderer | null = null, map: MapboxMap | null = null, mesh: THREE.Mesh | null = null, material: THREE.ShaderMaterial | null = null, warnedRenderFailure = false;
  const height = () => { const value = controls.getDisplayHeightMeters(); if (!Number.isFinite(value) || value < 0) throw new Error("display height must be a finite value greater than or equal to zero meters."); return value; };
  function buildMesh() {
    const vertices = buildWallVertices(data, controls.maxSegmentMeters); const position = new Float32Array(vertices.length * 3), direction = new Float32Array(vertices.length * 3), ratio = new Float32Array(vertices.length), mercatorMeters = new Float32Array(vertices.length), ecefMeters = new Float32Array(vertices.length);
    vertices.forEach((vertex, index) => { const mercator = mapboxgl.MercatorCoordinate.fromLngLat([vertex.lon, vertex.lat], 0), oneMeter = mapboxgl.MercatorCoordinate.fromLngLat([vertex.lon, vertex.lat], 1).z, longitude = vertex.lon * Math.PI / 180, latitude = vertex.lat * Math.PI / 180, cosLatitude = Math.cos(latitude); position.set([mercator.x, mercator.y, 0], index * 3); direction.set([cosLatitude * Math.sin(longitude), -Math.sin(latitude), cosLatitude * Math.cos(longitude)], index * 3); ratio[index] = vertex.heightRatio; mercatorMeters[index] = oneMeter; ecefMeters[index] = oneMeter * 8192 * cosLatitude; });
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position", new THREE.BufferAttribute(position, 3)); geometry.setAttribute("aDirection", new THREE.BufferAttribute(direction, 3)); geometry.setAttribute("aHeightRatio", new THREE.BufferAttribute(ratio, 1)); geometry.setAttribute("aMercatorMeters", new THREE.BufferAttribute(mercatorMeters, 1)); geometry.setAttribute("aEcefMeters", new THREE.BufferAttribute(ecefMeters, 1));
    material = new THREE.ShaderMaterial({ vertexShader: WALL_VERTEX_SHADER, fragmentShader: FRAGMENT_SHADER, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, uniforms: { uGlobeToMerc: { value: new THREE.Matrix4() }, uTransition: { value: 1 }, uCameraEcef: { value: new THREE.Vector3(0, 0, GLOBE_RADIUS * 2) }, uHeightMeters: { value: height() }, uOpacity: { value: controls.opacity ?? 0.82 } } });
    mesh = new THREE.Mesh(geometry, material); mesh.frustumCulled = false; scene.add(mesh);
  }
  return { id: "vertical-boundary-wall", type: "custom", renderingMode: "3d",
    onAdd(mapInstance, gl) { map = mapInstance; renderer = new THREE.WebGLRenderer({ canvas: gl.canvas as HTMLCanvasElement, context: gl as WebGL2RenderingContext, antialias: true }); renderer.autoClear = false; buildMesh(); },
    render(_gl, matrix, projection, projectionToMercatorMatrix, transition) { if (!renderer || !material) return; try { material.uniforms.uHeightMeters.value = height(); const isGlobe = projection?.name === "globe" && !!projectionToMercatorMatrix; if (isGlobe) { globeMatrix.fromArray(projectionToMercatorMatrix!); material.uniforms.uGlobeToMerc.value.copy(globeMatrix); material.uniforms.uTransition.value = Math.max(0, Math.min(1, transition ?? 0)); const cameraPosition = map?.getFreeCameraOptions().position; if (cameraPosition) { inverseGlobeMatrix.copy(globeMatrix).invert(); material.uniforms.uCameraEcef.value.set(cameraPosition.x, cameraPosition.y, cameraPosition.z).applyMatrix4(inverseGlobeMatrix); } } else { material.uniforms.uGlobeToMerc.value.identity(); material.uniforms.uTransition.value = 1; } camera.projectionMatrix = projectionMatrix.fromArray(matrix); renderer.resetState(); renderer.render(scene, camera); renderer.resetState(); } catch (error) { if (!warnedRenderFailure) { warnedRenderFailure = true; console.warn("[vertical-boundary-wall] render skipped", error); } } },
    onRemove() { disposeWallResources(mesh, material, scene); mesh = null; material = null; renderer?.dispose(); renderer = null; map = null; },
  };
}
