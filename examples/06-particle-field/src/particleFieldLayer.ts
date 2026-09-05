import type { CustomLayerInterface, Map as MapboxMap, ProjectionSpecification } from "mapbox-gl";
import { DEFAULT_VORTICES, SPEED_MAX_MS, sampleFlow, type Vortex } from "./flowField";
import { advectionStep, clampDt } from "./advection";
import { ParticleTrailBuffer } from "./particleTrailBuffer";
import { quantizedDensity, rawDensity, MIN_PARTICLES, MAX_PARTICLES } from "./adaptiveDensity";

/**
 * Raw WebGL2 CustomLayerInterface -- no Three.js. This is a direct port of
 * mini-taiwan-pulse/src/map/climateParticleLineLayer.ts (see
 * docs/03-scaling-up/vector-field-particles.md for the recipe), with the
 * PNG/raster wind-texture loading replaced by ./flowField.ts's synthetic
 * analytic field, and the shift-copy history arrays replaced by
 * ./particleTrailBuffer.ts's O(1) circular ring buffer.
 *
 * Why raw WebGL2 and not Three.js: see the recipe's "Why raw WebGL2, not
 * Three" section. In short, a Three.js renderer sharing Mapbox's GL context
 * needs to save/restore several pieces of GL blend state around every draw
 * (see 01-points-on-globe / 04-moving-trajectory's Scene classes calling
 * `renderer.resetState()`). A layer that only needs one shader program, one
 * VAO, and two buffers never owns a competing renderer or scene graph on a
 * context it doesn't exclusively control -- for a field of uniform,
 * instanced quads, that's strictly less machinery to get wrong.
 */

export interface ParticleFieldLayerOptions {
  id: string;
  getIsVisible: () => boolean;
  getOpacity: () => number;
  getParticleCount: () => number;
  getTrailLength: () => number;
  getAnimationSpeed: () => number;
  getLineWidth: () => number;
  /** Demo toggle: true (default behavior) uses the quantized zoom-density function; false uses the naive, unquantized one, so you can watch `msPerUpdate` jitter as you zoom. See adaptiveDensity.ts's module doc comment. */
  getQuantizeDensity: () => boolean;
  /** How many simulated seconds of wind advection happen per real second at animationSpeed=1. Tuned so the synthetic field's ~10-25 m/s speeds produce visible motion at a global viewing scale. */
  timeScaleSeconds: number;
  particleAlpha?: number;
  rampColors?: Record<number, string>;
  onFrameInfo?: (info: {
    zoom: number;
    isGlobe: boolean;
    transition: number;
    particleCount: number;
    trailLength: number;
    segmentsUploaded: number;
    msPerUpdate: number;
  }) => void;
}

const DEFAULT_RAMP: Record<number, string> = {
  0.0: "#4c6fb0",
  0.35: "#4fd0c8",
  0.7: "#f3f79b",
  1.0: "#ffffff",
};

export const MIN_TRAIL_LENGTH = 4;
export const MAX_TRAIL_LENGTH = 40;
/** Every particle respawns somewhere new after this many simulated frame-equivalents (jittered +-40%), same lifecycle rule as the source layer -- keeps the field from looking static even where the flow is locally slow. */
const BASE_MAX_AGE = 420;

const PI = Math.PI;
const INSTANCE_FLOATS = 8; // fromMerc.xy + toMerc.xy + rgba

// Fixed four-corner geometry per segment (2 triangles = 6 vertices, (side, along)); uploaded once, divisor 0.
const CORNERS = new Float32Array([-1, 0, 1, 0, -1, 1, -1, 1, 1, 0, 1, 1]);

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function mercatorX(lon: number): number {
  return (lon + 180) / 360;
}

function mercatorY(lat: number): number {
  const latRad = (clamp(lat, -85.051129, 85.051129) * PI) / 180;
  return 0.5 - Math.log(Math.tan(PI / 4 + latRad / 2)) / (2 * PI);
}

function parseHexColor(hex: string): [number, number, number] {
  const h = hex.replace("#", "").trim();
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.padEnd(6, "0").slice(0, 6);
  return [
    Number.parseInt(full.slice(0, 2), 16) / 255,
    Number.parseInt(full.slice(2, 4), 16) / 255,
    Number.parseInt(full.slice(4, 6), 16) / 255,
  ];
}

function buildRamp(ramp: Record<number, string>): Array<[number, [number, number, number]]> {
  const stops = Object.entries(ramp)
    .map(([k, v]) => [Number(k), parseHexColor(v)] as [number, [number, number, number]])
    .filter(([k]) => Number.isFinite(k))
    .sort((a, b) => a[0] - b[0]);
  return stops.length ? stops : buildRamp(DEFAULT_RAMP);
}

function rampColor(stops: Array<[number, [number, number, number]]>, t: number): [number, number, number] {
  if (t <= stops[0]![0]) return stops[0]![1];
  for (let i = 1; i < stops.length; i++) {
    const [t1, c1] = stops[i]!;
    if (t <= t1) {
      const [t0, c0] = stops[i - 1]!;
      const f = clamp((t - t0) / Math.max(t1 - t0, 1e-6), 0, 1);
      return [c0[0] + (c1[0] - c0[0]) * f, c0[1] + (c1[1] - c0[1]) * f, c0[2] + (c1[2] - c0[2]) * f];
    }
  }
  return stops[stops.length - 1]![1];
}

// column-major 4x4 inverse (gl-matrix technique) -- used to bring the camera's mercator position back into ECEF for backface culling.
function invertMat4(m: ArrayLike<number>): Float32Array | null {
  const a00 = m[0]!, a01 = m[1]!, a02 = m[2]!, a03 = m[3]!;
  const a10 = m[4]!, a11 = m[5]!, a12 = m[6]!, a13 = m[7]!;
  const a20 = m[8]!, a21 = m[9]!, a22 = m[10]!, a23 = m[11]!;
  const a30 = m[12]!, a31 = m[13]!, a32 = m[14]!, a33 = m[15]!;
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return null;
  det = 1.0 / det;
  const o = new Float32Array(16);
  o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return o;
}

// column-major mat4 * (x,y,z,1), with perspective divide.
function transformPoint(m: ArrayLike<number>, x: number, y: number, z: number): [number, number, number] {
  const w = m[3]! * x + m[7]! * y + m[11]! * z + m[15]! || 1;
  return [
    (m[0]! * x + m[4]! * y + m[8]! * z + m[12]!) / w,
    (m[1]! * x + m[5]! * y + m[9]! * z + m[13]!) / w,
    (m[2]! * x + m[6]! * y + m[10]! * z + m[14]!) / w,
  ];
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("createShader failed");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`ParticleField shader compile failed: ${log}`);
  }
  return shader;
}

// Same globe-hugging vertex shader technique as
// mini-taiwan-pulse/src/map/climateParticleLineLayer.ts and
// docs/01-hugging-the-globe/mapbox.md's "Unless your geometry moves" +
// "Step 4: cull the far side yourself" sections. Every vertex here takes
// the moving-geometry branch (derives ECEF from mercator in-shader, every
// frame) because nothing in a flow field has a fixed position to
// precompute against -- see vector-field-particles.md's "Why per-vertex
// trigonometry is correct here" section.
function createProgram(gl: WebGL2RenderingContext): WebGLProgram {
  const vs = compileShader(
    gl,
    gl.VERTEX_SHADER,
    `
    precision highp float;
    attribute vec2 a_from;
    attribute vec2 a_to;
    attribute vec4 a_color;
    attribute float a_side;
    attribute float a_along;
    uniform mat4 u_matrix;
    uniform vec2 u_resolution;
    uniform float u_line_width;
    uniform mat4 u_globe_to_merc;  // projectionToMercatorMatrix: ECEF -> mercator world
    uniform float u_transition;    // projectionToMercatorTransition: 0 = sphere, 1 = flat plane
    uniform vec3 u_camera_ecef;    // camera in ECEF, for backface culling
    varying vec4 v_color;

    const float GB_PI = 3.141592653589793;
    const float GB_R = 8192.0 / (2.0 * 3.141592653589793); // GLOBE_RADIUS ~= 1303.797

    // mercator unit coords (x,y in [0,1]) -> globe-hugging mercator-world coords; out cull = backface fade (0..1).
    vec3 mercToWorld(vec2 merc, out float cull) {
      cull = 1.0;
      if (u_transition >= 1.0) return vec3(merc, 0.0); // flat mercator: zero extra cost, unchanged behavior
      float lngRad = (merc.x - 0.5) * 2.0 * GB_PI;
      float latRad = 2.0 * atan(exp(GB_PI * (1.0 - 2.0 * merc.y))) - GB_PI * 0.5; // inverse Mercator
      float cosLat = cos(latRad);
      vec3 dir = vec3(cosLat * sin(lngRad), -sin(latRad), cosLat * cos(lngRad));
      vec3 ecef = dir * GB_R; // particles hug the surface, altitude = 0
      vec3 globeMerc = (u_globe_to_merc * vec4(ecef, 1.0)).xyz;
      // Backface cull in true ECEF space (not mercator-distorted space) -- see mapbox.md Step 4.
      vec3 toCam = normalize(u_camera_ecef - ecef);
      float globeCull = smoothstep(-0.08, 0.02, dot(dir, toCam));
      cull = mix(globeCull, 1.0, u_transition);
      return mix(globeMerc, vec3(merc, 0.0), u_transition);
    }

    void main() {
      float cullA, cullB;
      vec4 clipA = u_matrix * vec4(mercToWorld(a_from, cullA), 1.0);
      vec4 clipB = u_matrix * vec4(mercToWorld(a_to, cullB), 1.0);
      vec2 aNdc = clipA.xy / clipA.w;
      vec2 bNdc = clipB.xy / clipB.w;
      vec2 dirPx = (bNdc - aNdc) * u_resolution * 0.5;
      vec2 dir = dirPx / max(length(dirPx), 0.000001);
      vec2 normal = vec2(-dir.y, dir.x);
      vec4 clip = mix(clipA, clipB, a_along);
      clip.xy += normal * a_side * u_line_width / u_resolution * 2.0 * clip.w;
      gl_Position = clip;
      v_color = a_color;
      v_color.a *= mix(cullA, cullB, a_along);
    }
  `,
  );
  const fs = compileShader(
    gl,
    gl.FRAGMENT_SHADER,
    `
    precision mediump float;
    varying vec4 v_color;
    void main() {
      gl_FragColor = v_color;
    }
  `,
  );
  const program = gl.createProgram();
  if (!program) throw new Error("createProgram failed");
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`ParticleField program link failed: ${log}`);
  }
  return program;
}

/** Deterministic PRNG (mulberry32), separate stream from flowField.ts's vortex generator so respawn positions don't secretly correlate with vortex placement. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class ParticleFieldState {
  private readonly vortices: Vortex[];
  private readonly ramp: Array<[number, [number, number, number]]>;
  private readonly rng = mulberry32(0xf1e1d5);
  count = 0;
  trailLength = 0;
  private lon = new Float32Array(0);
  private lat = new Float32Array(0);
  private ages = new Float32Array(0);
  private maxAge = new Float32Array(0);
  private speedT = new Float32Array(0);
  private trail = new ParticleTrailBuffer(1, MIN_TRAIL_LENGTH);
  private instances = new Float32Array(0);

  constructor(vortices: Vortex[], rampColors: Record<number, string>) {
    this.vortices = vortices;
    this.ramp = buildRamp(rampColors);
  }

  resize(nextCountRaw: number, nextTrailLengthRaw: number): void {
    const nextCount = clamp(Math.floor(nextCountRaw || 0), MIN_PARTICLES, MAX_PARTICLES);
    const nextTrailLength = clamp(Math.floor(nextTrailLengthRaw || 0), MIN_TRAIL_LENGTH, MAX_TRAIL_LENGTH);
    if (nextCount === this.count && nextTrailLength === this.trailLength) return;
    this.count = nextCount;
    this.trailLength = nextTrailLength;
    this.lon = new Float32Array(this.count);
    this.lat = new Float32Array(this.count);
    this.ages = new Float32Array(this.count);
    this.maxAge = new Float32Array(this.count);
    this.speedT = new Float32Array(this.count);
    this.trail = new ParticleTrailBuffer(this.count, this.trailLength);
    // Worst case: every one of (trailLength - 1) segments per particle survives (none skipped for a dateline crossing or a near-zero fade).
    this.instances = new Float32Array(this.count * (this.trailLength - 1) * INSTANCE_FLOATS);
    for (let i = 0; i < this.count; i++) this.resetParticle(i);
  }

  private randomLonLat(): { lon: number; lat: number } {
    // Uniform-on-sphere sampling: uniform in sin(lat), not in lat itself (uniform-in-lat would cluster points near the poles).
    const lon = this.rng() * 360 - 180;
    const lat = Math.asin(this.rng() * 2 - 1) * (180 / PI);
    return { lon, lat };
  }

  private resetParticle(i: number): void {
    const { lon, lat } = this.randomLonLat();
    this.lon[i] = lon;
    this.lat[i] = lat;
    this.ages[i] = this.rng() * BASE_MAX_AGE; // desynchronize respawns so the whole field doesn't blink at once
    this.maxAge[i] = BASE_MAX_AGE * (0.6 + this.rng() * 0.8);
    this.speedT[i] = 0;
    // Pre-fill every trail slot with the spawn point -- the trail "exists"
    // immediately as a zero-length point and stretches into a line as the
    // particle moves, instead of popping in one sample at a time.
    this.trail.resetParticle(i);
    const mx = mercatorX(lon);
    const my = mercatorY(lat);
    for (let s = 0; s < this.trailLength; s++) this.trail.push(i, lon, lat, mx, my);
  }

  /**
   * rawDtSeconds: real wall-clock delta since last frame -- clamped exactly
   * once here (via advection.ts's clampDt, through advectionStep), not
   * per-particle-then-again, so every particle in a frame sees the same
   * clamped time budget. flowSecondsPerRealSecond: timeScaleSeconds * the
   * speed slider.
   */
  step(rawDtSeconds: number, flowSecondsPerRealSecond: number): void {
    const dt = clampDt(rawDtSeconds);
    if (dt <= 0) return;
    for (let i = 0; i < this.count; i++) {
      this.ages[i]! += dt * 60; // frame-rate-independent aging counter
      if (this.ages[i]! > this.maxAge[i]!) {
        this.resetParticle(i);
        continue;
      }
      const sample = sampleFlow(this.lon[i]!, this.lat[i]!, this.vortices);
      const next = advectionStep({ lon: this.lon[i]!, lat: this.lat[i]! }, sample.u, sample.v, dt, flowSecondsPerRealSecond);
      this.lon[i] = next.lon;
      this.lat[i] = next.lat;
      this.trail.push(i, next.lon, next.lat, mercatorX(next.lon), mercatorY(next.lat));
      this.speedT[i] = clamp(sample.speed / SPEED_MAX_MS, 0, 1);
    }
  }

  /** Builds the instanced fat-line buffer: 8 floats per surviving segment (fromMerc.xy, toMerc.xy, rgba). Segments whose mercator-x jumps by more than half the unit width are dropped -- they crossed the antimeridian in mercator-unit space, the same guard as climateParticleLineLayer.ts's `isGlobalX` check (our field is always globally continuous, so this guard is unconditional here). */
  buildInstanceData(opacity: number, particleAlpha: number): { data: Float32Array; instanceCount: number } {
    let ptr = 0;
    const layerOpacity = clamp(opacity, 0, 1);
    const baseAlpha = clamp(particleAlpha, 0.02, 1) * layerOpacity;
    const inv = 1 / Math.max(1, this.trailLength - 1);
    for (let i = 0; i < this.count; i++) {
      const [r, g, b] = rampColor(this.ramp, this.speedT[i]!);
      let havePrev = false;
      let prevMX = 0;
      let prevMY = 0;
      let segIndex = 0;
      this.trail.forEachAgeOrdered(i, (_age, _lon, _lat, mx, my) => {
        if (havePrev) {
          const crossesWrap = Math.abs(mx - prevMX) > 0.5;
          if (!crossesWrap) {
            const fade = Math.pow(1 - segIndex * inv, 1.35);
            const a = baseAlpha * fade;
            if (a > 0.002) {
              // from = older (current sample), to = newer (previous sample)
              this.instances[ptr++] = mx;
              this.instances[ptr++] = my;
              this.instances[ptr++] = prevMX;
              this.instances[ptr++] = prevMY;
              this.instances[ptr++] = r;
              this.instances[ptr++] = g;
              this.instances[ptr++] = b;
              this.instances[ptr++] = a;
            }
          }
          segIndex++;
        }
        prevMX = mx;
        prevMY = my;
        havePrev = true;
      });
    }
    return { data: this.instances.subarray(0, ptr), instanceCount: ptr / INSTANCE_FLOATS };
  }
}

export interface ParticleFieldLayer extends CustomLayerInterface {}

export function createParticleFieldLayer(opts: ParticleFieldLayerOptions): ParticleFieldLayer {
  let map: MapboxMap | null = null;
  let program: WebGLProgram | null = null;
  let vao: WebGLVertexArrayObject | null = null;
  let cornerBuffer: WebGLBuffer | null = null;
  let instanceBuffer: WebGLBuffer | null = null;
  let aFrom = -1;
  let aTo = -1;
  let aColor = -1;
  let aSide = -1;
  let aAlong = -1;
  let uMatrix: WebGLUniformLocation | null = null;
  let uResolution: WebGLUniformLocation | null = null;
  let uLineWidth: WebGLUniformLocation | null = null;
  let uGlobeToMerc: WebGLUniformLocation | null = null;
  let uTransition: WebGLUniformLocation | null = null;
  let uCameraEcef: WebGLUniformLocation | null = null;
  let disposed = false;
  let lastTs = 0;

  const state = new ParticleFieldState(DEFAULT_VORTICES, opts.rampColors ?? DEFAULT_RAMP);

  return {
    id: opts.id,
    type: "custom" as const,
    renderingMode: "2d" as const,

    onAdd(mapInstance: MapboxMap, gl: WebGL2RenderingContext) {
      map = mapInstance;
      program = createProgram(gl);
      aFrom = gl.getAttribLocation(program, "a_from");
      aTo = gl.getAttribLocation(program, "a_to");
      aColor = gl.getAttribLocation(program, "a_color");
      aSide = gl.getAttribLocation(program, "a_side");
      aAlong = gl.getAttribLocation(program, "a_along");
      uMatrix = gl.getUniformLocation(program, "u_matrix");
      uResolution = gl.getUniformLocation(program, "u_resolution");
      uLineWidth = gl.getUniformLocation(program, "u_line_width");
      uGlobeToMerc = gl.getUniformLocation(program, "u_globe_to_merc");
      uTransition = gl.getUniformLocation(program, "u_transition");
      uCameraEcef = gl.getUniformLocation(program, "u_camera_ecef");

      // VAO wraps every attribute/divisor setup so it never leaks into
      // Mapbox's own default vertex array state -- see mapbox.md's
      // "A VAO keeps this layer from corrupting Mapbox's own draw state".
      vao = gl.createVertexArray();
      cornerBuffer = gl.createBuffer();
      instanceBuffer = gl.createBuffer();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, CORNERS, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(aSide);
      gl.vertexAttribPointer(aSide, 1, gl.FLOAT, false, 2 * 4, 0);
      gl.vertexAttribDivisor(aSide, 0);
      gl.enableVertexAttribArray(aAlong);
      gl.vertexAttribPointer(aAlong, 1, gl.FLOAT, false, 2 * 4, 1 * 4);
      gl.vertexAttribDivisor(aAlong, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
      const iStride = INSTANCE_FLOATS * 4;
      gl.enableVertexAttribArray(aFrom);
      gl.vertexAttribPointer(aFrom, 2, gl.FLOAT, false, iStride, 0);
      gl.vertexAttribDivisor(aFrom, 1);
      gl.enableVertexAttribArray(aTo);
      gl.vertexAttribPointer(aTo, 2, gl.FLOAT, false, iStride, 2 * 4);
      gl.vertexAttribDivisor(aTo, 1);
      gl.enableVertexAttribArray(aColor);
      gl.vertexAttribPointer(aColor, 4, gl.FLOAT, false, iStride, 4 * 4);
      gl.vertexAttribDivisor(aColor, 1);
      gl.bindVertexArray(null);

      state.resize(opts.getParticleCount(), opts.getTrailLength());
    },

    render(
      glCtx: WebGL2RenderingContext,
      matrix: number[],
      projection?: ProjectionSpecification,
      projectionToMercatorMatrix?: number[],
      projectionToMercatorTransition?: number,
    ) {
      if (disposed || !opts.getIsVisible() || !program || !vao || !instanceBuffer || !uMatrix || !uResolution || !uLineWidth) return;

      const updateStart = performance.now();

      const zoom = map?.getZoom() ?? 0;
      const baseCount = opts.getParticleCount();
      const requestedCount = opts.getQuantizeDensity() ? quantizedDensity(baseCount, zoom) : rawDensity(baseCount, zoom);
      state.resize(requestedCount, opts.getTrailLength());

      const now = performance.now();
      const rawDt = lastTs ? (now - lastTs) / 1000 : 1 / 60;
      lastTs = now;
      state.step(rawDt, opts.timeScaleSeconds * opts.getAnimationSpeed());
      const { data, instanceCount } = state.buildInstanceData(opts.getOpacity(), opts.particleAlpha ?? 0.85);

      const msPerUpdate = performance.now() - updateStart;

      let transition = 1;
      let cameraEcef: [number, number, number] | null = null;
      const isGlobe =
        projection?.name === "globe" && Array.isArray(projectionToMercatorMatrix) && projectionToMercatorMatrix.length >= 16;
      if (isGlobe && (projectionToMercatorTransition ?? 0) < 1) {
        const cam = map?.getFreeCameraOptions().position;
        const inv = invertMat4(projectionToMercatorMatrix!);
        if (cam && inv) {
          cameraEcef = transformPoint(inv, cam.x, cam.y, cam.z);
          transition = clamp(projectionToMercatorTransition ?? 0, 0, 1);
        }
      }

      opts.onFrameInfo?.({
        zoom,
        isGlobe,
        transition,
        particleCount: state.count,
        trailLength: state.trailLength,
        segmentsUploaded: instanceCount,
        msPerUpdate,
      });

      if (instanceCount > 0) {
        glCtx.useProgram(program);
        glCtx.bindVertexArray(vao);
        glCtx.bindBuffer(glCtx.ARRAY_BUFFER, instanceBuffer);
        glCtx.bufferData(glCtx.ARRAY_BUFFER, data, glCtx.DYNAMIC_DRAW);
        glCtx.uniformMatrix4fv(uMatrix, false, matrix);
        glCtx.uniform2f(uResolution, glCtx.drawingBufferWidth, glCtx.drawingBufferHeight);
        glCtx.uniform1f(uLineWidth, clamp(opts.getLineWidth(), 0.5, 4.0) * (window.devicePixelRatio || 1));
        glCtx.uniform1f(uTransition, transition);
        if (transition < 1 && cameraEcef) {
          glCtx.uniformMatrix4fv(uGlobeToMerc, false, projectionToMercatorMatrix!);
          glCtx.uniform3f(uCameraEcef, cameraEcef[0], cameraEcef[1], cameraEcef[2]);
        }

        glCtx.disable(glCtx.DEPTH_TEST);
        glCtx.disable(glCtx.CULL_FACE);
        glCtx.enable(glCtx.BLEND);
        glCtx.blendFuncSeparate(glCtx.SRC_ALPHA, glCtx.ONE_MINUS_SRC_ALPHA, glCtx.ONE, glCtx.ONE_MINUS_SRC_ALPHA);
        glCtx.drawArraysInstanced(glCtx.TRIANGLES, 0, 6, instanceCount);
        glCtx.bindVertexArray(null);
      }

      // Simplification, same as every other example in this repo: always
      // repaint rather than throttling to a target framerate or pausing
      // when idle. Don't copy this into a layer with a real GPU budget.
      map?.triggerRepaint();
    },

    onRemove(_mapInstance: MapboxMap, glCtx: WebGL2RenderingContext) {
      disposed = true;
      if (cornerBuffer) glCtx.deleteBuffer(cornerBuffer);
      if (instanceBuffer) glCtx.deleteBuffer(instanceBuffer);
      if (vao) glCtx.deleteVertexArray(vao);
      if (program) glCtx.deleteProgram(program);
      cornerBuffer = null;
      instanceBuffer = null;
      vao = null;
      program = null;
      map = null;
    },
  };
}
