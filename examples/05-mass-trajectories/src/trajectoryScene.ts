import * as THREE from "three";
import { GLOBE_PROJECT_HYBRID_GLSL, mercatorToLonLat } from "./globeProject";
import { generateLeg, mulberry32, randomLonLat, sliceWindow, type Leg } from "./leg";
import { SlotPool, type EvictionStrategy } from "./slotPool";
import {
  SLOT_VERTS,
  clearSlot,
  clearTrailingResidue,
  createTrailBuffers,
  writeSlotVertices,
  type TrailBuffers,
} from "./trailWriter";

/**
 * Batches thousands of independently-moving great-circle "legs" (see
 * leg.ts) into a SINGLE `THREE.Line` draw call --
 * docs/03-scaling-up/batched-trails.md's recipe, wired to Mapbox's globe
 * projection the way examples/01 and examples/04 do it. This file is the
 * "glue": everything reusable/testable without WebGL already lives in
 * leg.ts (great-circle + window slicing), slotPool.ts + evictionHeap.ts
 * (slot/eviction bookkeeping), and trailWriter.ts (raw buffer layout) --
 * this file owns the THREE.js objects those pure pieces get poured into,
 * plus the per-object population lifecycle (which legs exist, when they
 * renew) that isn't quite generic enough to belong in any of them.
 *
 * Fixed-capacity throughout: `MAX_OBJECTS` logical trajectories, each
 * cycling through back-to-back legs forever; `SLOT_CAPACITY` GPU render
 * slots, which is deliberately SMALLER than `MAX_OBJECTS`'s upper range so
 * the "objects" HUD slider can push demand past supply and exercise
 * eviction -- see this repo's README for the numbers and what you should
 * expect to see at each tier.
 */

/** Logical population ceiling -- the "objects" slider's max. Each of these has its own seeded RNG and cycles through legs forever, whether or not it currently holds a render slot. */
export const MAX_OBJECTS = 12000;

/** Fixed GPU render capacity -- deliberately less than MAX_OBJECTS, so demand can exceed supply at the slider's upper tiers and force eviction. Never resized at runtime (see README, "Deliberate simplifications" -- no dynamic ensureCapacity unlike the production source). */
export const SLOT_CAPACITY = 4096;

const SEED = 20260905;

export type TrailPalette = "multicolor" | "cool" | "warm";

interface ObjectState {
  rand: () => number;
  leg: Leg;
  /** Real vertices written last frame this object held a slot -- lets clearTrailingResidue zero exactly the stale tail when a slice shrinks. Reset to 0 whenever the object loses (or gives up) its slot. */
  prevCount: number;
}

const TRAIL_VERT = /* glsl */ `
${GLOBE_PROJECT_HYBRID_GLSL}

attribute vec3 aEcef;
attribute float aDynamic;
attribute vec3 aColor;
attribute float aOpacity;
attribute float progress;

varying vec3 vColor;
varying float vOpacity;
varying float vProgress;
varying float vCull;

void main() {
  vColor = aColor;
  vOpacity = aOpacity;
  vProgress = progress;

  float cull;
  // "position" is this vertex's mercator coordinate -- for a static
  // (aDynamic=0) vertex it was written once when its leg was generated and
  // never touched again; for a dynamic (aDynamic=1, head/tail) vertex it
  // was overwritten THIS frame by leg.ts's sliceWindow. globeWorldPosition
  // (GLOBE_PROJECT_HYBRID_GLSL, prepended above) picks per-vertex whether
  // to trust aEcef or derive ECEF from position.xy right here -- see
  // globeProject.ts's module docstring for the full explanation.
  vec3 world = globeWorldPosition(position, aEcef, aDynamic, cull);
  vCull = cull;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 1.0);
}
`;

const TRAIL_FRAG = /* glsl */ `
precision highp float;

uniform float uGlobalOpacity;
uniform float uLightTheme;
uniform float uPaletteMode;

varying vec3 vColor;
varying float vOpacity;
varying float vProgress;
varying float vCull;

vec3 paletteColor(vec3 source) {
  if (uPaletteMode < 0.5) return source;
  // Derive a stable per-object gradient coordinate from the existing color
  // attribute. Palette changes stay GPU-only and never rewrite trail buffers.
  float t = fract(dot(source, vec3(12.9898, 78.233, 37.719)));
  if (uPaletteMode < 1.5) return mix(vec3(0.03, 0.31, 0.72), vec3(0.25, 0.92, 0.86), t);
  return mix(vec3(0.72, 0.08, 0.12), vec3(1.0, 0.72, 0.10), t);
}

void main() {
  // Dark mode keeps plan-art's fast tail fade and additive head glow.
  // Light mode keeps more of the colored tail visible against pale land.
  // vOpacity is 0 for guard vertices (see trailWriter.ts) and 1
  // for every real vertex -- the "opacity" HUD control is a separate,
  // whole-layer uniform multiplier instead, so raising/lowering it never
  // requires rewriting any slot's per-vertex data.
  float fade = mix(pow(vProgress, 2.0), pow(vProgress, 0.65), uLightTheme);
  float alpha = fade * vOpacity * vCull * uGlobalOpacity;
  float glow = smoothstep(0.85, 1.0, vProgress) * 0.5;
  vec3 base = paletteColor(vColor);
  // Saturated ink hues stay distinct on white; do not whiten their heads.
  float low = min(base.r, min(base.g, base.b));
  float high = max(base.r, max(base.g, base.b));
  vec3 hue = (base - vec3(low)) / max(high - low, 0.0001);
  vec3 ink = vec3(0.025) + hue * 0.48;
  vec3 color = mix(base + vec3(glow), ink, uLightTheme);
  gl_FragColor = vec4(color, alpha);
}
`;

/** Deterministic hue spacing across any active object prefix. */
function objectColor(index: number): { r: number; g: number; b: number } {
  // Golden-angle spacing keeps even a small active prefix multi-colored.
  const hue = (index * 0.618033988749895) % 1;
  return new THREE.Color().setHSL(hue, 0.75, 0.6);
}

/** Wraps a longitude into (-180, 180] -- used only at leg-renewal boundaries, to stop the antimeridian-unwrapping drift inside a single leg (leg.ts) from accumulating without bound across thousands of consecutive legs over a long session. */
function wrapLon(lon: number): number {
  let l = lon % 360;
  if (l > 180) l -= 360;
  if (l <= -180) l += 360;
  return l;
}

export interface UpdateStats {
  activeCount: number;
  slotsUsed: number;
  slotCapacity: number;
  evictionCountTotal: number;
  msPerUpdate: number;
}

export class TrajectoryScene {
  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.Camera();

  private geometry: THREE.BufferGeometry | null = null;
  private material: THREE.ShaderMaterial | null = null;
  private line: THREE.Line | null = null;

  private buffers!: TrailBuffers;
  private pool = new SlotPool(SLOT_CAPACITY);
  private objects: ObjectState[] = [];
  private strategy: EvictionStrategy = "heap";

  private activeCount = 0;
  private maxEverUsedSlot = -1;
  private lastSimTime: number | null = null;

  private msPerUpdateEma = 0;
  private lastStats: UpdateStats = {
    activeCount: 0,
    slotsUsed: 0,
    slotCapacity: SLOT_CAPACITY,
    evictionCountTotal: 0,
    msPerUpdate: 0,
  };

  private projScratch = new THREE.Matrix4();

  init(gl: WebGL2RenderingContext) {
    this.renderer = new THREE.WebGLRenderer({
      canvas: gl.canvas as HTMLCanvasElement,
      context: gl,
      antialias: true,
    });
    this.renderer.autoClear = false;

    for (let i = 0; i < MAX_OBJECTS; i++) {
      const rand = mulberry32(SEED + i * 2654435761);
      const start = randomLonLat(rand);
      this.objects.push({ rand, leg: generateLeg(rand, start, 0), prevCount: 0 });
    }

    this.buildMesh();
  }

  private buildMesh() {
    this.buffers = createTrailBuffers(SLOT_CAPACITY);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.buffers.position, 3));
    this.geometry.setAttribute("aEcef", new THREE.BufferAttribute(this.buffers.ecef, 3));
    this.geometry.setAttribute("aDynamic", new THREE.BufferAttribute(this.buffers.dynamic, 1));
    this.geometry.setAttribute("aColor", new THREE.BufferAttribute(this.buffers.color, 3));
    this.geometry.setAttribute("aOpacity", new THREE.BufferAttribute(this.buffers.opacity, 1));
    this.geometry.setAttribute("progress", new THREE.BufferAttribute(this.buffers.progress, 1));
    this.geometry.setDrawRange(0, 0);
    // Custom layers get no automatic frustum culling, and a mercator-space
    // bounding sphere is meaningless once points are projected onto/around
    // a globe -- same rationale as every other example in this cookbook.
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);

    this.material = new THREE.ShaderMaterial({
      vertexShader: TRAIL_VERT,
      fragmentShader: TRAIL_FRAG,
      uniforms: {
        uGlobalOpacity: { value: 0.9 },
        uLightTheme: { value: 0 },
        uPaletteMode: { value: 0 },
        uGlobeToMerc: { value: new THREE.Matrix4() },
        uTransition: { value: 1 },
        uCameraEcef: { value: new THREE.Vector3() },
      },
      transparent: true,
      // Recipe Step 3: Mapbox has already drawn a solid, depth-writing
      // sphere into the shared framebuffer by the time this layer runs.
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.line = new THREE.Line(this.geometry, this.material);
    this.line.frustumCulled = false;
    this.scene.add(this.line);
  }

  setStrategy(strategy: EvictionStrategy) {
    this.strategy = strategy;
  }

  getStrategy(): EvictionStrategy {
    return this.strategy;
  }

  setOpacity(o: number) {
    if (!this.material) return;
    this.material.uniforms.uGlobalOpacity!.value = Math.max(0, Math.min(1, o));
  }

  setTheme(theme: "light" | "dark") {
    if (!this.material) return;
    this.material.uniforms.uLightTheme!.value = theme === "light" ? 1 : 0;
    // The trail alpha (including guard vertices and the tail fade) remains
    // shader-owned. Only light-mode compositing changes so teal trails are
    // visible over the light Mapbox style; dark keeps additive accumulation.
    this.material.blending = theme === "light" ? THREE.NormalBlending : THREE.AdditiveBlending;
  }

  setPalette(palette: TrailPalette) {
    if (!this.material) return;
    this.material.uniforms.uPaletteMode!.value = palette === "cool" ? 1 : palette === "warm" ? 2 : 0;
  }

  /** How many objects (of MAX_OBJECTS) are currently simulated/eligible for a render slot -- the "objects" HUD slider. Lowering this releases slots for objects that just dropped out of range; raising it does NOT reallocate anything, only widens which indices get visited each frame. */
  setActiveCount(n: number) {
    const next = Math.max(0, Math.min(MAX_OBJECTS, Math.round(n)));
    if (next < this.activeCount) {
      for (let i = next; i < this.activeCount; i++) {
        const slot = this.pool.getSlot(i);
        if (slot !== undefined) {
          this.pool.release(i);
          clearSlot(this.buffers, slot);
          this.pool.markDirty(slot);
          this.objects[i]!.prevCount = 0;
        }
      }
    }
    if (next !== this.activeCount) this.lastSimTime = null;
    this.activeCount = next;
  }

  getLastStats(): UpdateStats {
    return this.lastStats;
  }

  /**
   * The one per-frame update call: advances every active object's leg
   * (renewing it if expired), slices its trailing window, and writes it
   * into a slot -- acquiring (possibly evicting) one first if it doesn't
   * currently hold one. This loop is intentionally simple and uniform: it
   * does NOT special-case "objects that already have a stable slot" vs
   * "objects fighting for one" -- see this repo's README, "What you'll
   * actually see", for why that single design choice is what makes the
   * eviction-strategy toggle's cost difference show up at all once
   * `activeCount` exceeds `SLOT_CAPACITY`.
   *
   * Wrapped in performance.now() timestamps per the task's explicit ask:
   * this measured span is what "ms per update" in the HUD reports (see
   * this repo's README for why this number, not FPS, is this example's
   * reason to exist).
   */
  syncTime(simTime: number) {
    if (this.lastSimTime === simTime) return;
    this.lastSimTime = simTime;
    if (!this.geometry) return;

    const t0 = performance.now();

    for (let i = 0; i < this.activeCount; i++) {
      const obj = this.objects[i]!;

      if (simTime > obj.leg.endTime) {
        const heldSlot = this.pool.getSlot(i);
        if (heldSlot !== undefined) {
          this.pool.release(i);
          clearSlot(this.buffers, heldSlot);
          this.pool.markDirty(heldSlot);
        }
        obj.prevCount = 0;

        // Chain the next leg's start to this leg's end point, so the
        // population reads as continuously-flying traffic rather than
        // teleporting between unrelated legs. mercX may be unwrapped (see
        // leg.ts's antimeridian docstring); wrapLon resets it to a normal
        // range at this leg boundary so the drift doesn't accumulate
        // without bound across thousands of consecutive legs.
        const last = obj.leg.samples[obj.leg.samples.length - 1]!;
        const endLonLat = mercatorToLonLat(last.mercX, last.mercY);
        const nextStart = { lon: wrapLon(endLonLat.lon), lat: endLonLat.lat };
        obj.leg = generateLeg(obj.rand, nextStart, obj.leg.endTime);
      }

      const slice = sliceWindow(obj.leg, simTime);
      if (!slice) continue; // leg just started this instant -- fewer than 2 vertices to draw yet

      let slot = this.pool.getSlot(i);
      if (slot === undefined) {
        slot = this.pool.acquire(i, obj.leg.endTime, this.strategy);
        if (slot === -1) continue; // pool exhausted with no valid victim -- shouldn't happen, see slotPool.ts
      }
      if (slot > this.maxEverUsedSlot) this.maxEverUsedSlot = slot;

      const newCount = writeSlotVertices(this.buffers, slot, slice.vertices, objectColor(i), 1);
      clearTrailingResidue(this.buffers, slot, newCount, obj.prevCount);
      obj.prevCount = newCount;
      this.pool.markDirty(slot);
    }

    this.commitDirtyRange();

    const elapsed = performance.now() - t0;
    // EMA smoothing -- a single frame's raw value is too noisy to read on
    // the HUD (GC pauses, browser jitter); alpha=0.1 settles in ~1s at 60fps.
    this.msPerUpdateEma = this.msPerUpdateEma === 0 ? elapsed : this.msPerUpdateEma * 0.9 + elapsed * 0.1;

    this.lastStats = {
      activeCount: this.activeCount,
      slotsUsed: this.pool.getOccupiedCount(),
      slotCapacity: SLOT_CAPACITY,
      evictionCountTotal: this.pool.getEvictionCount(),
      msPerUpdate: this.msPerUpdateEma,
    };
  }

  private commitDirtyRange() {
    if (!this.geometry) return;
    const range = this.pool.takeDirtyRange();
    if (!range) return;

    const startV = range.startSlot * SLOT_VERTS;
    const countV = range.slotCount * SLOT_VERTS;

    this.applyRange(this.geometry.getAttribute("position") as THREE.BufferAttribute, startV, countV, 3);
    this.applyRange(this.geometry.getAttribute("aEcef") as THREE.BufferAttribute, startV, countV, 3);
    this.applyRange(this.geometry.getAttribute("aDynamic") as THREE.BufferAttribute, startV, countV, 1);
    this.applyRange(this.geometry.getAttribute("aColor") as THREE.BufferAttribute, startV, countV, 3);
    this.applyRange(this.geometry.getAttribute("aOpacity") as THREE.BufferAttribute, startV, countV, 1);
    this.applyRange(this.geometry.getAttribute("progress") as THREE.BufferAttribute, startV, countV, 1);

    if (this.maxEverUsedSlot >= 0) {
      this.geometry.setDrawRange(0, (this.maxEverUsedSlot + 1) * SLOT_VERTS);
    }
  }

  private applyRange(attr: THREE.BufferAttribute, startV: number, countV: number, itemSize: number) {
    attr.clearUpdateRanges();
    attr.addUpdateRange(startV * itemSize, countV * itemSize);
    attr.needsUpdate = true;
  }

  /** Same contract as every other example's setGlobe(): load the matrix, then invert it, never let uCameraEcef default to (0,0,0) -- see docs/01-hugging-the-globe/mapbox.md, "the trap that costs the most time". */
  setGlobe(globeToMerc: number[] | null, transition: number, cameraMerc: { x: number; y: number; z: number } | null) {
    if (!this.material) return;
    const globeToMercUniform = this.material.uniforms.uGlobeToMerc!.value as THREE.Matrix4;

    if (!globeToMerc || globeToMerc.length < 16) {
      globeToMercUniform.identity();
      this.material.uniforms.uTransition!.value = 1;
      return;
    }

    globeToMercUniform.fromArray(globeToMerc);
    this.material.uniforms.uTransition!.value = Math.max(0, Math.min(1, transition));

    if (cameraMerc) {
      const inv = new THREE.Matrix4().copy(globeToMercUniform).invert();
      const camEcef = new THREE.Vector3(cameraMerc.x, cameraMerc.y, cameraMerc.z).applyMatrix4(inv);
      (this.material.uniforms.uCameraEcef!.value as THREE.Vector3).copy(camEcef);
    }
  }

  render(matrix: number[]) {
    if (!this.material) return;
    this.renderer.resetState();
    this.camera.projectionMatrix = this.projScratch.fromArray(matrix);
    this.renderer.render(this.scene, this.camera);
    this.renderer.resetState();
  }

  /** `renderer.info.render.calls` right after render() -- see README's HUD section for why this is read here rather than accumulated: `WebGLRenderer.info` auto-resets every render() call, so a stale read outside this window is meaningless. */
  getDrawCallCount(): number {
    return this.renderer?.info.render.calls ?? 0;
  }

  dispose() {
    if (this.line) this.scene.remove(this.line);
    this.geometry?.dispose();
    this.material?.dispose();
    this.renderer?.dispose();
  }
}
