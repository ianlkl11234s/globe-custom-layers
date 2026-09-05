import * as THREE from "three";
import mapboxgl from "mapbox-gl";
import { GLOBE_PROJECT_GLSL, lonLatToEcef } from "./globeProject";
import type { AirportPoint } from "./airports";

/**
 * A single `THREE.Points` draw call rendering every airport as a glowing dot,
 * hugging Mapbox's globe projection and fading to a flat map as you zoom in.
 *
 * Two things are combined here that are usually explained separately:
 *   1. The pseudo-bloom look: three nested radial falloffs (core/mid/far) in
 *      the fragment shader, drawn with additive blending so overlapping dots
 *      in dense regions naturally blow out to white -- like city lights seen
 *      from orbit. Zero extra render passes, zero postprocessing dependency.
 *   2. Globe-hugging: `GLOBE_PROJECT_GLSL` (see globeProject.ts) is prepended
 *      to the vertex shader and does the sphere/flat blend + backface cull.
 */

// Fixed-capacity attribute buffers, per the recipe's "Step 5: watch your
// buffer ceiling" -- growing a WebGL buffer means reallocating and re-uploading
// the whole thing, so we allocate for a reasonable ceiling once. 1174 real
// OurAirports "large_airport" rows fit comfortably under this; if you swap in
// a bigger dataset, raise this and watch console warnings for the clamp.
const MAX_POINT_COUNT = 4096;

const MIN_POINT_SIZE_PX = 10;
const MAX_POINT_SIZE_PX = 56;

const VERT = /* glsl */ `
${GLOBE_PROJECT_GLSL}

attribute vec3 aEcef;      // precomputed at data-load time, see setData()
attribute vec3 aColor;
attribute float aSize;

uniform float uPixelRatio;
uniform float uTime;
uniform float uZoomScale;  // derived from map.getZoom(), see setZoom()
uniform float uSizeMul;    // user-controlled slider, 1.0 = default

varying vec3 vColor;
varying float vCull;       // backface visibility, applied in the fragment shader

void main() {
  vColor = aColor;

  float cull;
  // "position" is this point's plain flat-mercator location (the vertex
  // attribute Three.js's BufferGeometry always provides); globeWorldPosition
  // blends it with the precomputed ECEF position per the current transition.
  vec3 world = globeWorldPosition(position, aEcef, cull);
  vCull = cull;

  vec4 mvPos = modelViewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mvPos;

  // Gentle size pulse so a screen full of static dots doesn't look inert;
  // phase-offset by position.x so points don't all pulse in lockstep.
  float pulse = 0.9 + 0.1 * sin(uTime * 1.8 + position.x * 200.0);
  gl_PointSize = aSize * uPixelRatio * pulse * uZoomScale * uSizeMul;
}
`;

const FRAG = /* glsl */ `
precision highp float;

uniform float uOpacity;
uniform float uCoreBoost;
uniform float uLightTheme;

varying vec3 vColor;
varying float vCull;

void main() {
  // gl_PointCoord is [0,1]^2 across the point sprite; recenter to [-1,1]^2
  // and take the radius so the three falloffs below are simple 1D functions.
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv) * 2.0;
  if (d > 1.0) discard; // outside the circle -- cheaper than blending a square

  // Three nested halos is the entire "bloom" trick: no separate blur pass,
  // just three overlapping smoothstep rings blended additively downstream.
  float core = smoothstep(0.18, 0.0, d);        // tight bright center
  float mid  = smoothstep(0.55, 0.18, d) * 0.55; // mid glow
  float far  = smoothstep(1.0,  0.55, d) * 0.22; // soft outer falloff

  // vCull multiplies alpha (never a hard discard) so the globe's horizon
  // fades like atmosphere instead of hard-clipping -- see globeProject.ts.
  float a = (core + mid + far) * uOpacity * vCull;

  // Push the very center toward white for a "hot core" look.
  vec3 col = mix(vColor, vec3(1.0), core * uCoreBoost);
  // On a light basemap, darken the selected palette instead of forcing every
  // ramp toward one teal. This keeps Solar/Aurora/Plasma/Ice distinguishable
  // while normal alpha blending preserves contrast against the pale map.
  col = mix(col, col * 0.44, uLightTheme);
  gl_FragColor = vec4(col, a);
}
`;

interface Instance {
  mercX: number;
  mercY: number;
  mercZ: number;
  ecef: { x: number; y: number; z: number };
  color: THREE.Color;
  sizePx: number;
}

export class GlowPointsScene {
  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.Camera();
  private points: THREE.Points | null = null;
  private geometry: THREE.BufferGeometry | null = null;
  private material: THREE.ShaderMaterial | null = null;

  private instances: Instance[] = [];
  private startTime = performance.now();

  // Scratch objects reused every frame/call so hot paths (render(), setGlobe())
  // don't allocate -- this custom layer's render() runs once per rendered
  // frame, so per-frame allocations here turn into real GC pressure.
  private projScratch = new THREE.Matrix4();
  private invScratch = new THREE.Matrix4();
  private camEcefScratch = new THREE.Vector3();

  init(gl: WebGL2RenderingContext) {
    this.renderer = new THREE.WebGLRenderer({
      canvas: gl.canvas as HTMLCanvasElement,
      context: gl,
      antialias: true,
    });
    // Mapbox owns the framebuffer and has already cleared/drawn into it this
    // frame; a Three.js renderer that auto-clears would wipe the basemap out
    // from under us.
    this.renderer.autoClear = false;
    this.buildMesh();
  }

  private buildMesh() {
    this.geometry = new THREE.BufferGeometry();
    const position = new Float32Array(MAX_POINT_COUNT * 3);
    const aEcef = new Float32Array(MAX_POINT_COUNT * 3);
    const aColor = new Float32Array(MAX_POINT_COUNT * 3);
    const aSize = new Float32Array(MAX_POINT_COUNT);
    this.geometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
    this.geometry.setAttribute("aEcef", new THREE.BufferAttribute(aEcef, 3));
    this.geometry.setAttribute("aColor", new THREE.BufferAttribute(aColor, 3));
    this.geometry.setAttribute("aSize", new THREE.BufferAttribute(aSize, 1));
    this.geometry.setDrawRange(0, 0);
    // Custom layers don't participate in Mapbox's frustum culling, and a
    // finite bounding sphere computed from mercator-space positions would be
    // meaningless once points are projected onto/around a globe -- so tell
    // Three.js to never cull this mesh itself.
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uOpacity: { value: 0.9 },
        uCoreBoost: { value: 0.7 },
        uLightTheme: { value: 0 },
        uTime: { value: 0 },
        uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
        uZoomScale: { value: 1 },
        uSizeMul: { value: 1 },
        uGlobeToMerc: { value: new THREE.Matrix4() },
        uTransition: { value: 1 }, // 1 = flat mercator until the first setGlobe() call
        uCameraEcef: { value: new THREE.Vector3() },
      },
      transparent: true,
      // THIS IS THE PART THAT'S EASY TO MISS (recipe Step 3): by the time
      // this layer's render() runs, Mapbox has already drawn a SOLID sphere
      // into the shared framebuffer with depth writes on (globe basemap
      // terrain). If this material depth-tested against that, our points --
      // near side AND far side alike, because the sphere uses an infinite far
      // plane and this geometry doesn't -- would be silently depth-clipped
      // away. Backface visibility is handled entirely by vCull in the
      // fragment shader instead (see GLOBE_PROJECT_GLSL's culling step).
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending, // overlapping glows add up -> "bloom"
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false; // see boundingSphere note above
    this.scene.add(this.points);
  }

  /** Converts airport points into GPU buffers, precomputing ECEF once per point. */
  setData(rows: AirportPoint[]) {
    if (!this.geometry) return;
    if (rows.length > MAX_POINT_COUNT) {
      console.warn(
        `[GlowPointsScene] ${rows.length} points exceeds MAX_POINT_COUNT=${MAX_POINT_COUNT}; ` +
          `clamping. Raise MAX_POINT_COUNT if you need more.`,
      );
    }

    this.instances = rows.slice(0, MAX_POINT_COUNT).map((r) => {
      const mc = mapboxgl.MercatorCoordinate.fromLngLat([r.lon, r.lat], 0);
      const norm = Math.max(0, Math.min(1, r.sizeNorm));
      return {
        mercX: mc.x,
        mercY: mc.y,
        mercZ: mc.z,
        // Precomputed here, once, at data-load time -- NOT in the shader per
        // frame. This is the whole point of Step 1 in the recipe: avoid
        // running sin/cos/exp/atan per vertex per frame.
        ecef: lonLatToEcef(r.lon, r.lat, mc.z),
        color: new THREE.Color(r.colorHex),
        sizePx: MIN_POINT_SIZE_PX + (MAX_POINT_SIZE_PX - MIN_POINT_SIZE_PX) * norm,
      };
    });

    const posAttr = this.geometry.getAttribute("position") as THREE.BufferAttribute;
    const ecefAttr = this.geometry.getAttribute("aEcef") as THREE.BufferAttribute;
    const colAttr = this.geometry.getAttribute("aColor") as THREE.BufferAttribute;
    const sizeAttr = this.geometry.getAttribute("aSize") as THREE.BufferAttribute;

    for (let i = 0; i < this.instances.length; i++) {
      const p = this.instances[i]!;
      posAttr.setXYZ(i, p.mercX, p.mercY, p.mercZ);
      ecefAttr.setXYZ(i, p.ecef.x, p.ecef.y, p.ecef.z);
      colAttr.setXYZ(i, p.color.r, p.color.g, p.color.b);
      sizeAttr.setX(i, p.sizePx);
    }
    posAttr.needsUpdate = true;
    ecefAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    sizeAttr.needsUpdate = true;
    this.geometry.setDrawRange(0, this.instances.length);
  }

  setOpacity(o: number) {
    if (!this.material) return;
    this.material.uniforms.uOpacity!.value = Math.max(0, Math.min(1, o));
  }

  setCoreBoost(b: number) {
    if (!this.material) return;
    this.material.uniforms.uCoreBoost!.value = Math.max(0, Math.min(1, b));
  }

  setTheme(theme: "light" | "dark") {
    if (!this.material) return;
    this.material.uniforms.uLightTheme!.value = theme === "light" ? 1 : 0;
    // Additive RGB is always added to the already-light basemap, so it
    // cannot produce a dark teal point there. Keep alpha and the glow shader
    // intact, but use ordinary source-over compositing for the light theme.
    this.material.blending = theme === "light" ? THREE.NormalBlending : THREE.AdditiveBlending;
  }

  setSizeMul(m: number) {
    if (!this.material) return;
    this.material.uniforms.uSizeMul!.value = Math.max(0.1, Math.min(5, m));
  }

  /** Scales the glow with map zoom so points don't dwarf the whole globe at low zoom. */
  setZoom(zoom: number, referenceZoom = 3) {
    if (!this.material) return;
    const raw = Math.pow(1.4, zoom - referenceZoom);
    this.material.uniforms.uZoomScale!.value = Math.max(0.35, Math.min(4, raw));
  }

  setVisible(v: boolean) {
    if (this.points) this.points.visible = v;
  }

  /**
   * Feeds this frame's globe parameters into the shader. Called every frame
   * from glowLayer.ts's render(), even in flat/mercator mode (in which case
   * pass `globeToMerc: null` and this resets to the identity/transition=1
   * fallback the recipe describes for "render() got only 2 arguments").
   *
   * Camera and matrix are taken together, on purpose: computing uCameraEcef
   * needs `inverse(globeToMerc)`, and the recipe's most expensive-to-debug
   * trap is doing that inversion in the wrong order or against a stale
   * matrix. Bundling both into one call makes "load matrix, then invert it"
   * the only order this code can express.
   */
  setGlobe(
    globeToMerc: number[] | null,
    transition: number,
    cameraMerc: { x: number; y: number; z: number } | null,
  ) {
    if (!this.material) return;
    const globeToMercUniform = this.material.uniforms.uGlobeToMerc!.value as THREE.Matrix4;

    if (!globeToMerc || globeToMerc.length < 16) {
      // Mercator-only fallback: no globe projection active (or render() was
      // called with only the first two arguments, e.g. an older mapbox-gl).
      // Identity matrix is never actually used in this branch (uTransition=1
      // makes globeWorldPosition() early-out before touching uGlobeToMerc),
      // but setting it anyway keeps the uniform in a sane, inspectable state.
      globeToMercUniform.identity();
      this.material.uniforms.uTransition!.value = 1;
      return;
    }

    globeToMercUniform.fromArray(globeToMerc);
    this.material.uniforms.uTransition!.value = Math.max(0, Math.min(1, transition));

    if (cameraMerc) {
      // load the matrix (just above), THEN invert it -- see this method's
      // docstring for why the order matters.
      this.invScratch.copy(globeToMercUniform).invert();
      this.camEcefScratch.set(cameraMerc.x, cameraMerc.y, cameraMerc.z).applyMatrix4(this.invScratch);
      (this.material.uniforms.uCameraEcef!.value as THREE.Vector3).copy(this.camEcefScratch);
    }
    // If cameraMerc is null (e.g. getFreeCameraOptions().position wasn't
    // available yet), uCameraEcef is left at its last value rather than
    // reset to (0,0,0) -- see globeProject.ts's cull docstring for why
    // uCameraEcef=(0,0,0) (the globe's center) makes the ENTIRE layer
    // disappear: dot(dir, toCam) is -1 everywhere in that case.
  }

  /** Renders one frame. `matrix` is whatever Mapbox's render() received as its projection matrix. */
  render(matrix: number[]) {
    if (!this.material) return;

    // Custom layers share a single GL context with Mapbox's own renderer, so
    // we must leave GL state exactly as we found it -- resetState() before
    // AND after, or Mapbox's next draw call inherits our blend/depth state.
    this.renderer.resetState();

    this.camera.projectionMatrix = this.projScratch.fromArray(matrix);
    this.material.uniforms.uTime!.value = (performance.now() - this.startTime) / 1000;

    this.renderer.render(this.scene, this.camera);
    this.renderer.resetState();
  }

  dispose() {
    if (this.points) this.scene.remove(this.points);
    this.geometry?.dispose();
    this.material?.dispose();
    // Frees Three.js's internal render-list/program caches. This does NOT
    // tear down the underlying WebGL context -- Mapbox owns that -- it only
    // releases the THREE.WebGLRenderer wrapper object created in init().
    this.renderer?.dispose();
  }
}
