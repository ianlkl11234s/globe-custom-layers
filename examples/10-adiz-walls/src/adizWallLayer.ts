import mapboxgl, { type CustomLayerInterface, type Map as MapboxMap } from "mapbox-gl";
import * as THREE from "three";
import { TAIWAN_ADIZ_SCHEMATIC_RING } from "./adizBoundary";
import { buildWallVertices } from "./wallGeometry";

const GLOBE_RADIUS = 8192 / (2 * Math.PI);

const VERTEX_SHADER = /* glsl */ `
  uniform mat4 uGlobeToMerc;
  uniform float uTransition;
  uniform vec3 uCameraEcef;
  uniform float uHeightMeters;
  attribute vec3 aDirection;
  attribute float aHeightRatio;
  attribute float aMercatorMeters;
  attribute float aEcefMeters;
  varying float vVisibility;
  varying float vHeight;
  void main() {
    vec3 flat = position;
    flat.z += aHeightRatio * uHeightMeters * aMercatorMeters;
    vec3 ecef = aDirection * (GLOBE_RADIUS + aHeightRatio * uHeightMeters * aEcefMeters);
    if (uTransition >= 1.0) {
      vVisibility = 1.0;
      vHeight = aHeightRatio;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(flat, 1.0);
      return;
    }
    vec3 globe = (uGlobeToMerc * vec4(ecef, 1.0)).xyz;
    vec3 surface = aDirection * GLOBE_RADIUS;
    float d = dot(aDirection, normalize(uCameraEcef - surface));
    vVisibility = mix(smoothstep(-0.08, 0.02, d), 1.0, uTransition);
    vHeight = aHeightRatio;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(mix(globe, flat, uTransition), 1.0);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform float uOpacity;
  varying float vVisibility;
  varying float vHeight;
  void main() {
    vec3 base = vec3(0.88, 0.48, 0.10);
    vec3 crest = vec3(1.0, 0.86, 0.42);
    vec3 color = mix(base, crest, pow(vHeight, 1.8));
    float rim = smoothstep(0.90, 1.0, vHeight) * 0.45;
    gl_FragColor = vec4(color + rim, (0.18 + vHeight * 0.48) * uOpacity * vVisibility);
  }
`;

export interface AdizWallControls { getHeightMeters: () => number; }

/** A single static Three custom layer; it owns and disposes every GPU resource it creates. */
export function createAdizWallLayer(controls: AdizWallControls): CustomLayerInterface {
  const scene = new THREE.Scene();
  const camera = new THREE.Camera();
  const projectionMatrix = new THREE.Matrix4();
  const inverseGlobeMatrix = new THREE.Matrix4();
  const globeMatrix = new THREE.Matrix4();
  let renderer: THREE.WebGLRenderer | null = null;
  let map: MapboxMap | null = null;
  let mesh: THREE.Mesh | null = null;
  let material: THREE.ShaderMaterial | null = null;
  let warnedRenderFailure = false;

  function buildMesh() {
    const vertices = buildWallVertices(TAIWAN_ADIZ_SCHEMATIC_RING);
    const position = new Float32Array(vertices.length * 3);
    const direction = new Float32Array(vertices.length * 3);
    const heightRatio = new Float32Array(vertices.length);
    const mercatorMeters = new Float32Array(vertices.length);
    const ecefMeters = new Float32Array(vertices.length);

    vertices.forEach((vertex, index) => {
      const mercator = mapboxgl.MercatorCoordinate.fromLngLat([vertex.lon, vertex.lat], 0);
      const oneMeter = mapboxgl.MercatorCoordinate.fromLngLat([vertex.lon, vertex.lat], 1).z;
      const longitude = vertex.lon * Math.PI / 180;
      const latitude = vertex.lat * Math.PI / 180;
      const cosLatitude = Math.cos(latitude);
      position.set([mercator.x, mercator.y, 0], index * 3);
      direction.set([cosLatitude * Math.sin(longitude), -Math.sin(latitude), cosLatitude * Math.cos(longitude)], index * 3);
      heightRatio[index] = vertex.heightRatio;
      mercatorMeters[index] = oneMeter;
      ecefMeters[index] = oneMeter * 8192 * cosLatitude;
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
    geometry.setAttribute("aDirection", new THREE.BufferAttribute(direction, 3));
    geometry.setAttribute("aHeightRatio", new THREE.BufferAttribute(heightRatio, 1));
    geometry.setAttribute("aMercatorMeters", new THREE.BufferAttribute(mercatorMeters, 1));
    geometry.setAttribute("aEcefMeters", new THREE.BufferAttribute(ecefMeters, 1));
    material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uGlobeToMerc: { value: new THREE.Matrix4() }, uTransition: { value: 1 },
        uCameraEcef: { value: new THREE.Vector3(0, 0, GLOBE_RADIUS * 2) },
        uHeightMeters: { value: controls.getHeightMeters() }, uOpacity: { value: 0.82 },
      },
    });
    mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    scene.add(mesh);
  }

  return {
    id: "taiwan-adiz-schematic-wall", type: "custom", renderingMode: "3d",
    onAdd(mapInstance, gl) {
      map = mapInstance;
      renderer = new THREE.WebGLRenderer({ canvas: gl.canvas as HTMLCanvasElement, context: gl as WebGL2RenderingContext, antialias: true });
      renderer.autoClear = false;
      buildMesh();
    },
    render(_gl, matrix, projection, projectionToMercatorMatrix, transition) {
      if (!renderer || !material) return;
      try {
        material.uniforms["uHeightMeters"]!.value = controls.getHeightMeters();
        const isGlobe = projection?.name === "globe" && !!projectionToMercatorMatrix;
        if (isGlobe) {
          globeMatrix.fromArray(projectionToMercatorMatrix!);
          material.uniforms["uGlobeToMerc"]!.value.copy(globeMatrix);
          material.uniforms["uTransition"]!.value = Math.max(0, Math.min(1, transition ?? 0));
          const cameraPosition = map?.getFreeCameraOptions().position;
          if (cameraPosition) {
            inverseGlobeMatrix.copy(globeMatrix).invert();
            material.uniforms["uCameraEcef"]!.value.set(cameraPosition.x, cameraPosition.y, cameraPosition.z).applyMatrix4(inverseGlobeMatrix);
          }
        } else {
          material.uniforms["uGlobeToMerc"]!.value.identity();
          material.uniforms["uTransition"]!.value = 1;
        }
        camera.projectionMatrix = projectionMatrix.fromArray(matrix);
        renderer.resetState();
        renderer.render(scene, camera);
        renderer.resetState();
      } catch (error) {
        if (!warnedRenderFailure) { warnedRenderFailure = true; console.warn("[adiz-wall] render skipped", error); }
      }
    },
    onRemove() {
      if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); }
      material?.dispose();
      mesh = null; material = null; renderer = null; map = null;
    },
  };
}
