import type { CustomLayerInterface, CustomRenderMethodInput, Map as MapLibreMap } from "maplibre-gl";
import * as THREE from "three";
import { EARTH_RADIUS_METERS, MAPBOX_GLOBE_RADIUS } from "../examples/09-satellite-orbits/src/orbitMath";
import { SCHEMATIC_ORBITS, orbitPointAt, sampleOrbit } from "../examples/09-satellite-orbits/src/orbitFixture";
import { TAIWAN_ADIZ_SCHEMATIC_FIXTURE } from "../examples/10-adiz-walls/src/adizBoundary";
import { buildWallVertices } from "../examples/10-adiz-walls/src/wallGeometry";

export type SpecialSceneName = "satelliteOrbits" | "boundaryWalls";

export interface SpecialFrameInfo {
  scene: SpecialSceneName;
  projection: string;
  transition: number;
  orbitCount?: number;
  satelliteCount?: number;
  wallSegments?: number;
  displayHeightKm?: number;
}

export interface SpecialLayerControls extends CustomLayerInterface {
  setTheme(theme: "light" | "dark"): void;
  setOptions(options: Partial<{ paused: boolean; orbitSpeed: number; orbitAltitudeScale: number; boundaryWallHeightKm: number }>): void;
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function projectionUniforms() {
  return {
    u_projection_matrix: { value: new THREE.Matrix4() },
    u_projection_tile_mercator_coords: { value: new THREE.Vector4() },
    u_projection_clipping_plane: { value: new THREE.Vector4() },
    u_projection_transition: { value: 1 },
    u_projection_fallback_matrix: { value: new THREE.Matrix4() },
  };
}

function updateProjection(materials: THREE.ShaderMaterial[], input: CustomRenderMethodInput, transition: number) {
  const data = input.defaultProjectionData;
  for (const material of materials) {
    (material.uniforms.u_projection_matrix.value as THREE.Matrix4).fromArray(data.mainMatrix);
    (material.uniforms.u_projection_tile_mercator_coords.value as THREE.Vector4).fromArray(data.tileMercatorCoords);
    (material.uniforms.u_projection_clipping_plane.value as THREE.Vector4).fromArray(data.clippingPlane);
    material.uniforms.u_projection_transition.value = transition;
    (material.uniforms.u_projection_fallback_matrix.value as THREE.Matrix4).fromArray(data.fallbackMatrix);
  }
}

function installProjection(material: THREE.ShaderMaterial, input: CustomRenderMethodInput, body: string) {
  material.vertexShader = `${input.shaderData.vertexShaderPrelude}\n${input.shaderData.define}
attribute float aElevation;
${body}`;
  Object.assign(material.uniforms, projectionUniforms());
  material.needsUpdate = true;
}

function orbitElevationMeters(radius: number): number {
  return Math.max(0, (radius / MAPBOX_GLOBE_RADIUS - 1) * EARTH_RADIUS_METERS);
}

function createOrbitLayer(initialTheme: "light" | "dark", onFrameInfo?: (info: SpecialFrameInfo) => void): SpecialLayerControls {
  let theme = initialTheme;
  let paused = false;
  let orbitSpeed = 1;
  let altitudeScale = 1;
  let simulationTime = 0;
  let lastClock = 0;
  let map: MapLibreMap | null = null;
  let renderer: THREE.WebGLRenderer | null = null;
  const scene = new THREE.Scene();
  const camera = new THREE.Camera();
  const lines: Array<{ geometry: THREE.BufferGeometry; material: THREE.ShaderMaterial; color: string }> = [];
  let satelliteGeometry: THREE.BufferGeometry | null = null;
  let satelliteMaterial: THREE.ShaderMaterial | null = null;
  let variant: string | null = null;

  const recolor = () => {
    for (const line of lines) line.material.uniforms.uColor.value.set(theme === "dark" ? line.color : "#1b6279");
    satelliteMaterial?.uniforms.uColor.value.set(theme === "dark" ? "#ffffff" : "#8b3f00");
  };
  const rebuildGeometry = () => {
    SCHEMATIC_ORBITS.forEach((orbit, orbitIndex) => {
      const samples = sampleOrbit(orbit, 180, altitudeScale);
      const position = lines[orbitIndex]!.geometry.getAttribute("position") as THREE.BufferAttribute;
      const elevation = lines[orbitIndex]!.geometry.getAttribute("aElevation") as THREE.BufferAttribute;
      samples.forEach((point, index) => {
        position.setXYZ(index, point.mercator[0], point.mercator[1], 0);
        elevation.setX(index, orbitElevationMeters(point.radius));
      });
      position.needsUpdate = true;
      elevation.needsUpdate = true;
    });
  };

  return {
    id: "maplibre-special-satellite-orbits", type: "custom", renderingMode: "3d",
    onAdd(mapInstance, gl) {
      map = mapInstance;
      renderer = new THREE.WebGLRenderer({ canvas: gl.canvas as HTMLCanvasElement, context: gl as WebGL2RenderingContext, antialias: true });
      renderer.autoClear = false;
      for (const orbit of SCHEMATIC_ORBITS) {
        const samples = sampleOrbit(orbit, 180, altitudeScale);
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(samples.flatMap(point => [point.mercator[0], point.mercator[1], 0]), 3));
        geometry.setAttribute("aElevation", new THREE.Float32BufferAttribute(samples.map(point => orbitElevationMeters(point.radius)), 1));
        geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
        const material = new THREE.ShaderMaterial({
          vertexShader: "void main(){gl_Position=vec4(position,1.);}",
          fragmentShader: "precision highp float; uniform vec3 uColor; uniform float uOpacity; void main(){gl_FragColor=vec4(uColor,uOpacity);}",
          uniforms: { uColor: { value: new THREE.Color(orbit.color) }, uOpacity: { value: .82 } },
          transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
        });
        const line = new THREE.Line(geometry, material); line.frustumCulled = false; scene.add(line);
        lines.push({ geometry, material, color: orbit.color });
      }
      satelliteGeometry = new THREE.BufferGeometry();
      satelliteGeometry.setAttribute("position", new THREE.Float32BufferAttribute(SCHEMATIC_ORBITS.flatMap(() => [0, 0, 0]), 3));
      satelliteGeometry.setAttribute("aElevation", new THREE.Float32BufferAttribute(SCHEMATIC_ORBITS.map(() => 0), 1));
      satelliteGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
      satelliteMaterial = new THREE.ShaderMaterial({
        vertexShader: "void main(){gl_Position=vec4(position,1.);}",
        fragmentShader: "precision highp float; uniform vec3 uColor; void main(){float d=length(gl_PointCoord-.5)*2.;if(d>1.)discard;float a=smoothstep(1.,.08,d);gl_FragColor=vec4(uColor,a);}",
        uniforms: { uColor: { value: new THREE.Color("#ffffff") }, uPointSize: { value: 16 * Math.min(devicePixelRatio || 1, 2) } },
        transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const points = new THREE.Points(satelliteGeometry, satelliteMaterial); points.frustumCulled = false; scene.add(points);
      recolor(); lastClock = performance.now();
    },
    render(_gl, input) {
      if (!renderer || !map || !satelliteGeometry || !satelliteMaterial) return;
      const transition = map.transform.getProjectionData({ overscaledTileID: null, applyGlobeMatrix: true }).projectionTransition;
      input = { ...input, defaultProjectionData: { ...input.defaultProjectionData, projectionTransition: transition } };
      if (variant !== input.shaderData.variantName) {
        for (const { material } of lines) installProjection(material, input, "void main(){gl_Position=projectTileWithElevation(position.xy,aElevation);}");
        installProjection(satelliteMaterial, input, "uniform float uPointSize; void main(){gl_PointSize=uPointSize;gl_Position=projectTileWithElevation(position.xy,aElevation);}");
        variant = input.shaderData.variantName;
      }
      updateProjection([...lines.map(line => line.material), satelliteMaterial], input, transition);
      const now = performance.now(); if (!paused) simulationTime += Math.min(now - lastClock, 100) / 1000 * orbitSpeed; lastClock = now;
      const positions = satelliteGeometry.getAttribute("position") as THREE.BufferAttribute;
      const elevations = satelliteGeometry.getAttribute("aElevation") as THREE.BufferAttribute;
      SCHEMATIC_ORBITS.forEach((orbit, index) => {
        const point = orbitPointAt(orbit, simulationTime / orbit.periodSec * 360, altitudeScale);
        positions.setXYZ(index, point.mercator[0], point.mercator[1], 0); elevations.setX(index, orbitElevationMeters(point.radius));
      });
      positions.needsUpdate = true; elevations.needsUpdate = true;
      camera.projectionMatrix.fromArray(IDENTITY); renderer.resetState(); renderer.render(scene, camera); renderer.resetState();
      onFrameInfo?.({ scene: "satelliteOrbits", projection: input.shaderData.variantName, transition, orbitCount: lines.length, satelliteCount: SCHEMATIC_ORBITS.length });
      map.triggerRepaint();
    },
    onRemove() {
      scene.traverse(object => { const mesh = object as THREE.Object3D & { geometry?: THREE.BufferGeometry; material?: THREE.Material }; mesh.geometry?.dispose(); mesh.material?.dispose(); });
      renderer?.dispose(); renderer = null; map = null; variant = null; lines.length = 0; satelliteGeometry = null; satelliteMaterial = null;
    },
    setTheme(next) { theme = next; recolor(); map?.triggerRepaint(); },
    setOptions(next) {
      if (typeof next.paused === "boolean") paused = next.paused;
      if (typeof next.orbitSpeed === "number") orbitSpeed = Math.max(.1, Math.min(4, next.orbitSpeed));
      if (typeof next.orbitAltitudeScale === "number" && next.orbitAltitudeScale !== altitudeScale) { altitudeScale = Math.max(.5, Math.min(3, next.orbitAltitudeScale)); rebuildGeometry(); }
      map?.triggerRepaint();
    },
  };
}

function createBoundaryWallLayer(initialTheme: "light" | "dark", initialHeightKm: number, onFrameInfo?: (info: SpecialFrameInfo) => void): SpecialLayerControls {
  let theme = initialTheme;
  let heightKm = initialHeightKm;
  let map: MapLibreMap | null = null;
  let renderer: THREE.WebGLRenderer | null = null;
  const scene = new THREE.Scene(); const camera = new THREE.Camera();
  let geometry: THREE.BufferGeometry | null = null; let material: THREE.ShaderMaterial | null = null; let variant: string | null = null;
  return {
    id: "maplibre-special-boundary-walls", type: "custom", renderingMode: "3d",
    onAdd(mapInstance, gl) {
      map = mapInstance; renderer = new THREE.WebGLRenderer({ canvas: gl.canvas as HTMLCanvasElement, context: gl as WebGL2RenderingContext, antialias: true }); renderer.autoClear = false;
      const vertices = buildWallVertices(TAIWAN_ADIZ_SCHEMATIC_FIXTURE);
      geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices.flatMap(vertex => {
        const x = vertex.lon / 360 + .5; const lat = vertex.lat * Math.PI / 180; const y = (1 - Math.log(Math.tan(Math.PI / 4 + lat / 2)) / Math.PI) / 2; return [x, y, 0];
      }), 3));
      geometry.setAttribute("aElevation", new THREE.Float32BufferAttribute(vertices.map(vertex => vertex.heightRatio), 1));
      geometry.setAttribute("aHeightRatio", new THREE.Float32BufferAttribute(vertices.map(vertex => vertex.heightRatio), 1));
      geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
      material = new THREE.ShaderMaterial({
        vertexShader: "void main(){gl_Position=vec4(position,1.);}",
        fragmentShader: "precision highp float;uniform vec3 uBase;uniform vec3 uCrest;uniform float uOpacity;varying float vHeight;void main(){vec3 color=mix(uBase,uCrest,pow(vHeight,1.8));float rim=smoothstep(.9,1.,vHeight)*.45;gl_FragColor=vec4(color+rim,(.18+vHeight*.48)*uOpacity);}",
        uniforms: { uBase: { value: new THREE.Color() }, uCrest: { value: new THREE.Color() }, uOpacity: { value: .82 }, uHeightMeters: { value: heightKm * 1000 } },
        transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(geometry, material); mesh.frustumCulled = false; scene.add(mesh); this.setTheme(theme);
    },
    render(_gl, input) {
      if (!renderer || !map || !geometry || !material) return;
      const transition = map.transform.getProjectionData({ overscaledTileID: null, applyGlobeMatrix: true }).projectionTransition;
      input = { ...input, defaultProjectionData: { ...input.defaultProjectionData, projectionTransition: transition } };
      if (variant !== input.shaderData.variantName) { installProjection(material, input, "attribute float aHeightRatio;uniform float uHeightMeters;varying float vHeight;void main(){vHeight=aHeightRatio;gl_Position=projectTileWithElevation(position.xy,aElevation*uHeightMeters);}"); variant = input.shaderData.variantName; }
      material.uniforms.uHeightMeters.value = heightKm * 1000; updateProjection([material], input, transition);
      camera.projectionMatrix.fromArray(IDENTITY); renderer.resetState(); renderer.render(scene, camera); renderer.resetState();
      onFrameInfo?.({ scene: "boundaryWalls", projection: input.shaderData.variantName, transition, wallSegments: geometry.getAttribute("position").count / 6, displayHeightKm: heightKm });
    },
    onRemove() { geometry?.dispose(); material?.dispose(); renderer?.dispose(); geometry = null; material = null; renderer = null; map = null; variant = null; },
    setTheme(next) { theme = next; material?.uniforms.uBase.value.set(theme === "dark" ? "#e17a1a" : "#a64f00"); material?.uniforms.uCrest.value.set(theme === "dark" ? "#ffdc6b" : "#e2a620"); if (material) material.blending = theme === "dark" ? THREE.AdditiveBlending : THREE.NormalBlending; map?.triggerRepaint(); },
    setOptions(next) { if (typeof next.boundaryWallHeightKm === "number") heightKm = Math.max(50, Math.min(1500, next.boundaryWallHeightKm)); map?.triggerRepaint(); },
  };
}

export function createSpecialLayer(scene: SpecialSceneName, options: { theme: "light" | "dark"; boundaryWallHeightKm?: number; onFrameInfo?: (info: SpecialFrameInfo) => void }): SpecialLayerControls {
  return scene === "satelliteOrbits" ? createOrbitLayer(options.theme, options.onFrameInfo) : createBoundaryWallLayer(options.theme, options.boundaryWallHeightKm ?? 500, options.onFrameInfo);
}
