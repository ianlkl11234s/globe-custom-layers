import * as THREE from "three";
import mapboxgl from "mapbox-gl";
import { GLOBE_PROJECT_MOVING_GLSL } from "./globeProject";
import {
  MAX_OBJECTS,
  TRAIL_SAMPLE_INTERVAL_SEC,
  generateObjectPaths,
  objectPositionAtSimTime,
  syncTrailToTick,
  type TrajectoryObject,
} from "./objectPath";
import { TrailRingBuffer } from "./trailRingBuffer";

/**
 * Two `THREE.Points` draw calls: a bright head sprite per moving object, and
 * a fading trail of ring-buffer samples behind it. Both meshes hug Mapbox's
 * globe projection via `GLOBE_PROJECT_MOVING_GLSL` -- the "derive ECEF from
 * mercator in the vertex shader every frame" branch, since (unlike
 * examples/01-points-on-globe' airports) nothing here has a fixed
 * lon/lat to precompute against once and never touch again.
 *
 * Fixed-capacity buffers throughout, same rule as the static example:
 * `MAX_OBJECTS` head slots, `MAX_OBJECTS * TRAIL_CAPACITY` trail slots,
 * allocated once. The "objects" and "trail length" sliders never resize or
 * reallocate anything -- they only change `setDrawRange` (objects) and the
 * `uTrailWindow` fade-window uniform (trail length). See this repo's
 * README, "Why the sliders never touch the buffer", for the reasoning.
 */

/** Physical ring-buffer capacity per object, in samples. The "trail length" slider's max value; the slider itself just picks how much of this is *visible* via a shader uniform, see setTrailWindow(). */
export const TRAIL_CAPACITY = 150;

const MIN_HEAD_SIZE_PX = 14;
const MAX_HEAD_SIZE_PX = 26;
const TRAIL_POINT_SIZE_PX = 9;

const HEAD_VERT = /* glsl */ `
${GLOBE_PROJECT_MOVING_GLSL}

attribute vec3 aColor;
attribute float aSize;

uniform float uPixelRatio;
uniform float uTime;
uniform float uZoomScale;
uniform float uSizeMul;

varying vec3 vColor;
varying float vCull;

void main() {
  vColor = aColor;

  float cull;
  // "position" is this head's current mercator location, rewritten every
  // frame in JS from objectPositionAtSimTime() -- globeWorldPosition derives
  // ECEF from it right here, every frame, rather than reading a precomputed
  // attribute (see GLOBE_PROJECT_MOVING_GLSL's docstring).
  vec3 world = globeWorldPosition(position, cull);
  vCull = cull;

  vec4 mvPos = modelViewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mvPos;

  float pulse = 0.9 + 0.1 * sin(uTime * 2.2 + position.x * 300.0);
  gl_PointSize = aSize * uPixelRatio * pulse * uZoomScale * uSizeMul;
}
`;

const HEAD_FRAG = /* glsl */ `
precision highp float;

uniform float uOpacity;
uniform float uCoreBoost;

varying vec3 vColor;
varying float vCull;

void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv) * 2.0;
  if (d > 1.0) discard;

  float core = smoothstep(0.18, 0.0, d);
  float mid  = smoothstep(0.55, 0.18, d) * 0.55;
  float far  = smoothstep(1.0,  0.55, d) * 0.22;

  float a = (core + mid + far) * uOpacity * vCull;
  vec3 col = mix(vColor, vec3(1.0), core * uCoreBoost);
  gl_FragColor = vec4(col, a);
}
`;

const TRAIL_VERT = /* glsl */ `
${GLOBE_PROJECT_MOVING_GLSL}

attribute vec3 aColor;
attribute float aSize;
attribute float aTick;

uniform float uPixelRatio;
uniform float uZoomScale;
uniform float uSizeMul;
uniform float uCurrentTick;
uniform float uTrailWindow;  // "trail length" slider value, in samples

varying vec3 vColor;
varying float vCull;
varying float vAlpha;

void main() {
  vColor = aColor;

  float cull;
  // Every trail vertex is frozen the instant it's written into its
  // ring-buffer slot (see trailRingBuffer.ts) -- its lon/lat never changes
  // again. This example still reprojects it through the moving-geometry
  // branch every frame anyway, for one shared shader/uniform code path with
  // the head mesh above. See this repo's README, "Deliberate
  // simplifications", for the production alternative (precompute ECEF once
  // at write time, the same way the static example does for its airports).
  vec3 world = globeWorldPosition(position, cull);
  vCull = cull;

  // age in samples since this slot was written. A slot that's never been
  // written has aTick = UNSET_TICK (trailRingBuffer.ts), an astronomically
  // large negative number, so age is astronomically large and ageFrac
  // clamps to 1 -- it fades to alpha 0 with no special-casing needed.
  //
  // Negative age (aTick ahead of uCurrentTick) would mean a "future" sample
  // is still sitting in the buffer; the sync logic in objectPath.ts's
  // syncTrailToTick always resets the whole buffer on any backward jump
  // specifically so this never happens in practice, but the shader guards
  // it anyway (alpha 0) as defense in depth.
  float age = uCurrentTick - aTick;
  float ageFrac = clamp(age / uTrailWindow, 0.0, 1.0);
  // Computed into a local first, then assigned to the varying -- reading a
  // varying/out back in the same vertex invocation that just wrote it is
  // legal GLSL, but it's exactly the kind of thing a stricter driver has
  // surprised people with, and a local costs nothing extra here.
  float alpha = (age < 0.0) ? 0.0 : (1.0 - ageFrac);
  vAlpha = alpha;

  vec4 mvPos = modelViewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mvPos;

  float shrink = 1.0 - ageFrac * 0.6;
  // Scaling point size by alpha too collapses fully-faded points to zero
  // pixels instead of leaving fully-transparent-but-full-size sprites
  // sitting around burning fill rate -- cheap with MAX_OBJECTS * TRAIL_CAPACITY
  // vertices in this draw call.
  gl_PointSize = aSize * uPixelRatio * uZoomScale * uSizeMul * shrink * alpha;
}
`;

const TRAIL_FRAG = /* glsl */ `
precision highp float;

uniform float uOpacity;

varying vec3 vColor;
varying float vCull;
varying float vAlpha;

void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv) * 2.0;
  if (d > 1.0) discard;

  // A single soft circle, not the head's three-ring bloom -- this draw call
  // has up to MAX_OBJECTS * TRAIL_CAPACITY vertices vs. the head's
  // MAX_OBJECTS, so a cheaper fragment shader here is a deliberate
  // performance trade, not an oversight.
  float falloff = smoothstep(1.0, 0.0, d);
  float a = falloff * vAlpha * vCull * uOpacity;
  gl_FragColor = vec4(vColor, a);
}
`;

export class TrajectoryScene {
  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.Camera();

  private headGeometry: THREE.BufferGeometry | null = null;
  private headMaterial: THREE.ShaderMaterial | null = null;
  private headPoints: THREE.Points | null = null;

  private trailGeometry: THREE.BufferGeometry | null = null;
  private trailMaterial: THREE.ShaderMaterial | null = null;
  private trailPoints: THREE.Points | null = null;

  private objects: TrajectoryObject[] = [];
  private rings: TrailRingBuffer[] = [];
  private prevTick: Array<number | null> = [];

  private activeCount = 0;
  private lastSimTime: number | null = null;

  private startTime = performance.now();

  private projScratch = new THREE.Matrix4();
  private invScratch = new THREE.Matrix4();
  private camEcefScratch = new THREE.Vector3();

  init(gl: WebGL2RenderingContext) {
    this.renderer = new THREE.WebGLRenderer({
      canvas: gl.canvas as HTMLCanvasElement,
      context: gl,
      antialias: true,
    });
    // Same reason as the static example: Mapbox owns and has already drawn
    // into this framebuffer this frame.
    this.renderer.autoClear = false;

    this.objects = generateObjectPaths(MAX_OBJECTS);
    this.rings = this.objects.map(() => new TrailRingBuffer(TRAIL_CAPACITY));
    this.prevTick = this.objects.map(() => null);

    this.buildHeadMesh();
    this.buildTrailMesh();
  }

  private buildHeadMesh() {
    this.headGeometry = new THREE.BufferGeometry();
    const position = new Float32Array(MAX_OBJECTS * 3);
    const aColor = new Float32Array(MAX_OBJECTS * 3);
    const aSize = new Float32Array(MAX_OBJECTS);

    for (let o = 0; o < MAX_OBJECTS; o++) {
      const color = objectColor(o);
      aColor[o * 3] = color.r;
      aColor[o * 3 + 1] = color.g;
      aColor[o * 3 + 2] = color.b;
      aSize[o] = MIN_HEAD_SIZE_PX + (MAX_HEAD_SIZE_PX - MIN_HEAD_SIZE_PX) * ((o % 7) / 6);
    }

    this.headGeometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
    this.headGeometry.setAttribute("aColor", new THREE.BufferAttribute(aColor, 3));
    this.headGeometry.setAttribute("aSize", new THREE.BufferAttribute(aSize, 1));
    this.headGeometry.setDrawRange(0, 0);
    // Same reasoning as the static example: custom layers get no automatic
    // frustum culling, and a mercator-space bounding sphere is meaningless
    // once points are projected onto/around a globe.
    this.headGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);

    this.headMaterial = new THREE.ShaderMaterial({
      vertexShader: HEAD_VERT,
      fragmentShader: HEAD_FRAG,
      uniforms: {
        uOpacity: { value: 0.95 },
        uCoreBoost: { value: 0.7 },
        uTime: { value: 0 },
        uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
        uZoomScale: { value: 1 },
        uSizeMul: { value: 1 },
        uGlobeToMerc: { value: new THREE.Matrix4() },
        uTransition: { value: 1 },
        uCameraEcef: { value: new THREE.Vector3() },
      },
      transparent: true,
      // Recipe Step 3: Mapbox has already drawn a solid, depth-writing
      // sphere into the shared framebuffer by the time this layer runs --
      // depth-testing against it would silently clip both the near AND far
      // side of this mesh. See docs/01-hugging-the-globe/mapbox.md.
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.headPoints = new THREE.Points(this.headGeometry, this.headMaterial);
    this.headPoints.frustumCulled = false;
    this.scene.add(this.headPoints);
  }

  private buildTrailMesh() {
    const capacity = MAX_OBJECTS * TRAIL_CAPACITY;
    this.trailGeometry = new THREE.BufferGeometry();
    const position = new Float32Array(capacity * 3);
    const aColor = new Float32Array(capacity * 3);
    const aSize = new Float32Array(capacity).fill(TRAIL_POINT_SIZE_PX);
    const aTick = new Float32Array(capacity).fill(-1e9); // UNSET_TICK, see trailRingBuffer.ts

    for (let o = 0; o < MAX_OBJECTS; o++) {
      const color = objectColor(o);
      for (let s = 0; s < TRAIL_CAPACITY; s++) {
        const i = o * TRAIL_CAPACITY + s;
        aColor[i * 3] = color.r;
        aColor[i * 3 + 1] = color.g;
        aColor[i * 3 + 2] = color.b;
      }
    }

    this.trailGeometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
    this.trailGeometry.setAttribute("aColor", new THREE.BufferAttribute(aColor, 3));
    this.trailGeometry.setAttribute("aSize", new THREE.BufferAttribute(aSize, 1));
    this.trailGeometry.setAttribute("aTick", new THREE.BufferAttribute(aTick, 1));
    this.trailGeometry.setDrawRange(0, 0);
    this.trailGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);

    this.trailMaterial = new THREE.ShaderMaterial({
      vertexShader: TRAIL_VERT,
      fragmentShader: TRAIL_FRAG,
      uniforms: {
        uOpacity: { value: 0.85 },
        uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
        uZoomScale: { value: 1 },
        uSizeMul: { value: 1 },
        uCurrentTick: { value: 0 },
        uTrailWindow: { value: 80 },
        uGlobeToMerc: { value: new THREE.Matrix4() },
        uTransition: { value: 1 },
        uCameraEcef: { value: new THREE.Vector3() },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.trailPoints = new THREE.Points(this.trailGeometry, this.trailMaterial);
    this.trailPoints.frustumCulled = false;
    this.scene.add(this.trailPoints);
  }

  setActiveCount(n: number) {
    const next = Math.max(0, Math.min(MAX_OBJECTS, Math.round(n)));
    if (next !== this.activeCount) {
      this.activeCount = next;
      this.headGeometry?.setDrawRange(0, this.activeCount);
      this.trailGeometry?.setDrawRange(0, this.activeCount * TRAIL_CAPACITY);
      // A newly-widened draw range exposes head slots that syncTime() may
      // not have written yet (they default to mercator (0,0,0)). syncTime()
      // itself early-returns when simTimeSec hasn't changed since last
      // call -- which is exactly the paused case, i.e. exactly when raising
      // "objects" wouldn't otherwise trigger a rewrite. Forcing the next
      // syncTime() call through by invalidating lastSimTime fixes newly-
      // activated heads (already-active ones just see delta === 0 for their
      // trail and write nothing extra) without needing a separate
      // "did the active count change" check inside syncTime() itself.
      this.lastSimTime = null;
    }
  }

  setTrailWindow(n: number) {
    if (!this.trailMaterial) return;
    this.trailMaterial.uniforms.uTrailWindow!.value = Math.max(1, Math.min(TRAIL_CAPACITY, n));
  }

  setOpacity(o: number) {
    const v = Math.max(0, Math.min(1, o));
    if (this.headMaterial) this.headMaterial.uniforms.uOpacity!.value = v;
    if (this.trailMaterial) this.trailMaterial.uniforms.uOpacity!.value = v;
  }

  setSizeMul(m: number) {
    const v = Math.max(0.1, Math.min(5, m));
    if (this.headMaterial) this.headMaterial.uniforms.uSizeMul!.value = v;
    if (this.trailMaterial) this.trailMaterial.uniforms.uSizeMul!.value = v;
  }

  setZoom(zoom: number, referenceZoom = 3) {
    const raw = Math.pow(1.4, zoom - referenceZoom);
    const v = Math.max(0.35, Math.min(4, raw));
    if (this.headMaterial) this.headMaterial.uniforms.uZoomScale!.value = v;
    if (this.trailMaterial) this.trailMaterial.uniforms.uZoomScale!.value = v;
  }

  /** Same contract as the static example's GlowPointsScene.setGlobe() -- see that file's docstring for the load-then-invert ordering and the "never let uCameraEcef fall back to (0,0,0)" rule. */
  setGlobe(globeToMerc: number[] | null, transition: number, cameraMerc: { x: number; y: number; z: number } | null) {
    for (const material of [this.headMaterial, this.trailMaterial]) {
      if (!material) continue;
      const globeToMercUniform = material.uniforms.uGlobeToMerc!.value as THREE.Matrix4;

      if (!globeToMerc || globeToMerc.length < 16) {
        globeToMercUniform.identity();
        material.uniforms.uTransition!.value = 1;
        continue;
      }

      globeToMercUniform.fromArray(globeToMerc);
      material.uniforms.uTransition!.value = Math.max(0, Math.min(1, transition));

      if (cameraMerc) {
        this.invScratch.copy(globeToMercUniform).invert();
        this.camEcefScratch.set(cameraMerc.x, cameraMerc.y, cameraMerc.z).applyMatrix4(this.invScratch);
        (material.uniforms.uCameraEcef!.value as THREE.Vector3).copy(this.camEcefScratch);
      }
    }
  }

  /**
   * The one per-frame update call. Given the current simulation time:
   *   1. Recomputes every active object's head position (always -- the head
   *      moves continuously, every frame, whether or not a trail sample
   *      tick boundary was crossed).
   *   2. Syncs every active object's trail ring buffer to this tick via
   *      `syncTrailToTick` (objectPath.ts) -- which transparently does an
   *      incremental single-slot push during normal playback, or a bounded
   *      rebuild of just that object's block after a scrub. Both playback
   *      and scrubbing call this exact same method; see objectPath.ts's
   *      docstring for why that unification matters.
   *
   * Uses `needsUpdate` + `addUpdateRange` for both buffers, NOT a full
   * geometry rebuild -- and, critically, only sets `needsUpdate = true` when
   * at least one `addUpdateRange` call actually happened this frame. Three's
   * `WebGLAttributes` uploader falls back to a full `bufferSubData` of the
   * ENTIRE array whenever `needsUpdate` is set but `updateRanges` is empty
   * (see node_modules/three/src/renderers/webgl/WebGLAttributes.js) -- so
   * setting `needsUpdate` unconditionally every frame, "just in case", would
   * silently defeat the entire point of this method and re-upload the whole
   * fixed-capacity buffer 60 times a second even while paused.
   */
  syncTime(simTimeSec: number) {
    if (this.lastSimTime === simTimeSec) return; // paused, or called twice for the same frame: nothing changed
    this.lastSimTime = simTimeSec;

    if (!this.headGeometry || !this.trailGeometry) return;

    const headPosAttr = this.headGeometry.getAttribute("position") as THREE.BufferAttribute;
    const trailPosAttr = this.trailGeometry.getAttribute("position") as THREE.BufferAttribute;
    const trailTickAttr = this.trailGeometry.getAttribute("aTick") as THREE.BufferAttribute;

    trailPosAttr.clearUpdateRanges();
    trailTickAttr.clearUpdateRanges();
    let trailTouched = false;

    const currentTick = Math.floor(simTimeSec / TRAIL_SAMPLE_INTERVAL_SEC);

    for (let o = 0; o < this.activeCount; o++) {
      const obj = this.objects[o]!;

      // 1. Head: continuous position, every frame.
      const headPos = objectPositionAtSimTime(obj, simTimeSec);
      const headMerc = mapboxgl.MercatorCoordinate.fromLngLat([headPos.lon, headPos.lat], 0);
      headPosAttr.setXYZ(o, headMerc.x, headMerc.y, headMerc.z);

      // 2. Trail: quantized ring-buffer sync (see syncTrailToTick's docstring).
      const ring = this.rings[o]!;
      const { newTick, writtenTicks } = syncTrailToTick(ring, obj, this.prevTick[o] ?? null, simTimeSec);
      this.prevTick[o] = newTick;

      if (writtenTicks.length === 0) continue;
      trailTouched = true;

      if (writtenTicks.length === ring.capacity) {
        // Full rebuild: every slot in this object's block changed, so one
        // range covering the whole block is cheaper than one call per slot.
        for (const tick of writtenTicks) {
          const slot = ring.slotForTick(tick);
          const sample = ring.readSlot(slot);
          const i = o * TRAIL_CAPACITY + slot;
          trailPosAttr.setXY(i, sample.mercX, sample.mercY);
          trailTickAttr.setX(i, sample.tick);
        }
        trailPosAttr.addUpdateRange(o * TRAIL_CAPACITY * 3, TRAIL_CAPACITY * 3);
        trailTickAttr.addUpdateRange(o * TRAIL_CAPACITY, TRAIL_CAPACITY);
      } else {
        // Incremental: usually exactly one tick per frame -- write just that
        // slot and mark just that slot's range dirty.
        for (const tick of writtenTicks) {
          const slot = ring.slotForTick(tick);
          const sample = ring.readSlot(slot);
          const i = o * TRAIL_CAPACITY + slot;
          trailPosAttr.setXY(i, sample.mercX, sample.mercY);
          trailTickAttr.setX(i, sample.tick);
          trailPosAttr.addUpdateRange(i * 3, 3);
          trailTickAttr.addUpdateRange(i, 1);
        }
      }
    }

    // Head position changed for every active object this frame (continuous
    // motion) -- one contiguous range covering the active block, still
    // partial relative to the MAX_OBJECTS-sized buffer.
    if (this.activeCount > 0) {
      headPosAttr.clearUpdateRanges();
      headPosAttr.addUpdateRange(0, this.activeCount * 3);
      headPosAttr.needsUpdate = true;
    }

    if (trailTouched) {
      trailPosAttr.needsUpdate = true;
      trailTickAttr.needsUpdate = true;
    }

    if (this.trailMaterial) this.trailMaterial.uniforms.uCurrentTick!.value = currentTick;
  }

  render(matrix: number[]) {
    if (!this.headMaterial || !this.trailMaterial) return;

    // Custom layers share Mapbox's GL context -- reset before and after so
    // our blend/depth state doesn't leak into Mapbox's next draw call.
    this.renderer.resetState();

    this.camera.projectionMatrix = this.projScratch.fromArray(matrix);
    const t = (performance.now() - this.startTime) / 1000;
    this.headMaterial.uniforms.uTime!.value = t;

    this.renderer.render(this.scene, this.camera);
    this.renderer.resetState();
  }

  dispose() {
    if (this.headPoints) this.scene.remove(this.headPoints);
    if (this.trailPoints) this.scene.remove(this.trailPoints);
    this.headGeometry?.dispose();
    this.headMaterial?.dispose();
    this.trailGeometry?.dispose();
    this.trailMaterial?.dispose();
    this.renderer?.dispose();
  }
}

/** Deterministic per-object hue spread (rainbow, fixed saturation/lightness) -- same color for an object's head and its entire trail block, set once at buffer-build time and never touched again. */
function objectColor(index: number): THREE.Color {
  const hue = (index / MAX_OBJECTS) % 1;
  return new THREE.Color().setHSL(hue, 0.75, 0.6);
}
