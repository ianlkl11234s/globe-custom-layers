/**
 * globe-hugging math: Earth-Centered-Earth-Fixed (ECEF) projection for Mapbox's
 * globe view, plus the sphere<->flat-plane blend.
 *
 * This module has two halves that MUST stay numerically identical:
 *   - `GLOBE_PROJECT_GLSL`: a GLSL string, prepended to a vertex shader, that runs
 *     this same math on the GPU for every vertex, every frame.
 *   - `mercatorToGlobe` (+ `lonLatToEcef`): a JS implementation of the same math,
 *     used here (a) to precompute each point's ECEF position once, at data-load
 *     time, and (b) as a CPU-side reference so the shader math can be unit-tested
 *     without spinning up a WebGL context.
 *
 * See docs/01-hugging-the-globe/mapbox.md in the parent repo for the full
 * explanation of *why* each step below exists -- this file is deliberately
 * terse on the "why" and leans on that document; the comments here focus on
 * the specific numbers and gotchas.
 */

// Mapbox's internal globe radius is derived from its 8192-unit vector-tile
// extent, NOT from a real-world radius in meters or any other physical unit.
// Every ECEF coordinate in this file lives in "mercator world units" scaled
// by this radius, which is also the space `projectionToMercatorMatrix` maps
// into (see the doc's "Step 1").
const GLOBE_EXTENT = 8192;
export const GLOBE_RADIUS = GLOBE_EXTENT / (2 * Math.PI); // ~= 1303.797

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * A generic 4x4 matrix, column-major, 16 numbers -- exactly the layout Mapbox
 * hands to `render()` as `projectionToMercatorMatrix`, and exactly the layout
 * `THREE.Matrix4.elements` and `THREE.Matrix4.fromArray()` use. We accept a
 * plain array here (rather than importing `three`) so this math module has no
 * runtime dependency on Three.js and can be unit-tested in isolation.
 */
export type Mat4 = ArrayLike<number>;

/** out = m * v, where v = (x, y, z, w). Column-major 4x4 * vec4. */
function transformPoint(m: Mat4, x: number, y: number, z: number, w: number): Vec3 {
  return {
    x: m[0]! * x + m[4]! * y + m[8]! * z + m[12]! * w,
    y: m[1]! * x + m[5]! * y + m[9]! * z + m[13]! * w,
    z: m[2]! * x + m[6]! * y + m[10]! * z + m[14]! * w,
  };
}

/**
 * Step 1 (precompute ECEF per vertex): convert a geographic lon/lat (degrees)
 * plus an altitude expressed as a Web Mercator "z" unit (the same unit
 * `MercatorCoordinate.fromLngLat(lngLat, altitudeMeters).z` produces) into
 * Mapbox's ECEF space.
 *
 *   x =  cos(phi) * sin(lambda) * R
 *   y = -sin(phi) * R
 *   z =  cos(phi) * cos(lambda) * R
 *
 * THE NEGATIVE Y IS NOT A TYPO. It matches Mapbox's internal globe convention
 * specifically. Get this sign wrong and your points come out mirrored or
 * rotated around an axis -- a bug that *looks* like corrupted input data, not
 * a math bug, because every point is wrong in a spatially-consistent way. If
 * you're porting this file to another engine, re-derive the signs against
 * that engine's own globe implementation rather than copying these -- see
 * docs/03-porting.md in the parent repo.
 *
 * Call this once per point, at buffer-build time, and store the result as a
 * vertex attribute. Doing this per-frame in JS (rather than once, up front)
 * would defeat the entire point of precomputing it -- see the GLSL half of
 * this file for the per-frame cost this avoids.
 */
export function lonLatToEcef(lonDeg: number, latDeg: number, mercZ = 0): Vec3 {
  const lambda = (lonDeg * Math.PI) / 180;
  const phi = (latDeg * Math.PI) / 180;
  const cosLat = Math.cos(phi);
  const sinLat = Math.sin(phi);

  // Altitude becomes a *radial* offset, scaled by cos(latitude) so that a
  // fixed real-world height corresponds to a fixed radial distance regardless
  // of where on the globe it is. This is Mapbox's own `globeMetersToEcef`,
  // expressed in mercator-Z units instead of raw meters.
  const hEcef = mercZ * GLOBE_EXTENT * cosLat;
  const radius = GLOBE_RADIUS + hEcef;

  return {
    x: cosLat * Math.sin(lambda) * radius,
    y: -sinLat * radius,
    z: cosLat * Math.cos(lambda) * radius,
  };
}

/** Standard smoothstep, mirroring GLSL's built-in of the same name. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export interface GlobeProjectResult extends Vec3 {
  /**
   * Backface-cull visibility in [0, 1]. 1 = fully visible, 0 = fully hidden
   * behind the globe. This is a soft factor meant to be multiplied into
   * alpha, not a hard visible/invisible flag -- see Step 4 in the recipe doc
   * for why a hard cutoff at the horizon reads as a bug and a soft one reads
   * as atmosphere.
   */
  cull: number;
}

/**
 * JS mirror of `globeWorldPosition()` in `GLOBE_PROJECT_GLSL` below. Given a
 * point's existing flat-mercator position and its precomputed ECEF position,
 * blends between "hugging the globe" and "flat plane" using Mapbox's own
 * transition factor, and computes how visible it is from the current camera.
 *
 * @param mercPos     This point's position in flat Web Mercator world space
 *                     (what you'd render with no globe support at all).
 * @param ecef        This point's precomputed ECEF position (from `lonLatToEcef`).
 * @param globeToMerc Mapbox's `projectionToMercatorMatrix`, or `null` when
 *                     globe projection isn't active (see the mercator
 *                     fallback rule below).
 * @param transition  Mapbox's `projectionToMercatorTransition`: 0 = sphere,
 *                     1 = flat plane. Note the direction -- MapLibre's
 *                     equivalent runs the other way (see docs/porting.md).
 * @param cameraEcef  The camera's position in ECEF space (see `glowLayer.ts`
 *                     for how to compute this from `map.getFreeCameraOptions()`),
 *                     or `null` to skip backface culling entirely (cull = 1).
 */
export function mercatorToGlobe(
  mercPos: Vec3,
  ecef: Vec3,
  globeToMerc: Mat4 | null,
  transition: number,
  cameraEcef: Vec3 | null,
): GlobeProjectResult {
  // Mercator fallback + Step 2's early-out, combined: no globe matrix at all
  // (older mapbox-gl, non-globe style, or we haven't received one yet) is
  // treated exactly like "fully transitioned to flat" (transition >= 1).
  // Either way we hand back `mercPos` completely untouched -- bit-identical,
  // not just numerically close -- so a flat map costs exactly what it always
  // did, with zero risk of the globe math introducing drift.
  if (!globeToMerc || transition >= 1) {
    return { x: mercPos.x, y: mercPos.y, z: mercPos.z, cull: 1 };
  }

  const globeMerc = transformPoint(globeToMerc, ecef.x, ecef.y, ecef.z, 1);

  // mix(globeMerc, mercPos, transition)
  const world: Vec3 = {
    x: globeMerc.x + (mercPos.x - globeMerc.x) * transition,
    y: globeMerc.y + (mercPos.y - globeMerc.y) * transition,
    z: globeMerc.z + (mercPos.z - globeMerc.z) * transition,
  };

  let cull = 1;
  if (cameraEcef) {
    // Step 4: cull in ECEF space, NOT mercator space. In mercator space the
    // sphere is heavily distorted (especially near the poles) and surface
    // normals don't point where you'd expect, so a dot product computed
    // there misjudges entire regions at once rather than failing at individual
    // points. `dir` is the outward surface normal; `ecef` already includes
    // any altitude radial offset, so normalizing it recovers the pure
    // direction regardless of how far above the surface this point sits.
    const len = Math.hypot(ecef.x, ecef.y, ecef.z) || 1;
    const dir: Vec3 = { x: ecef.x / len, y: ecef.y / len, z: ecef.z / len };
    const surf: Vec3 = { x: dir.x * GLOBE_RADIUS, y: dir.y * GLOBE_RADIUS, z: dir.z * GLOBE_RADIUS };

    const toCamRaw: Vec3 = {
      x: cameraEcef.x - surf.x,
      y: cameraEcef.y - surf.y,
      z: cameraEcef.z - surf.z,
    };
    const toCamLen = Math.hypot(toCamRaw.x, toCamRaw.y, toCamRaw.z) || 1;
    const toCam: Vec3 = { x: toCamRaw.x / toCamLen, y: toCamRaw.y / toCamLen, z: toCamRaw.z / toCamLen };

    const d = dir.x * toCam.x + dir.y * toCam.y + dir.z * toCam.z; // d == 0 is the true horizon
    cull = smoothstep(-0.08, 0.02, d);
    cull = cull + (1 - cull) * transition; // mix(cull, 1.0, transition) -- no culling once flat
  }

  return { x: world.x, y: world.y, z: world.z, cull };
}

/**
 * GLSL companion to `mercatorToGlobe` above -- prepend this string to any
 * vertex shader that needs to hug the globe (see `glowPointsScene.ts`).
 *
 * Uniform names are deliberately the same words the recipe doc and Mapbox's
 * own `render()` argument names use, so grepping either codebase for
 * `uGlobeToMerc` / `uTransition` / `uCameraEcef` finds this file.
 */
export const GLOBE_PROJECT_GLSL = /* glsl */ `
uniform mat4 uGlobeToMerc;   // projectionToMercatorMatrix: ECEF -> mercator world space
uniform float uTransition;   // projectionToMercatorTransition: 0 = sphere, 1 = flat plane
uniform vec3 uCameraEcef;    // camera position in ECEF space (Step 4 backface culling)

const float GLOBE_RADIUS = 8192.0 / (2.0 * 3.141592653589793); // must match the TS constant above

// mercPos: this vertex's existing flat-mercator position (the "position" attribute
//          you'd already be using with no globe support at all).
// aEcef:   precomputed once at buffer-build time via lonLatToEcef() -- doing this
//          per-frame instead would mean running sin/cos/exp/atan for every vertex,
//          every frame, which is exactly the cost this technique exists to avoid.
// cull:    out param in [0,1], multiply into alpha (don't discard -- see docstring
//          on GlobeProjectResult.cull above for why).
vec3 globeWorldPosition(vec3 mercPos, vec3 aEcef, out float cull) {
  cull = 1.0;

  // Early-out: once fully zoomed past the globe<->flat transition, skip every
  // globe computation below and hand back exactly what a non-globe layer
  // would have produced. This is what makes close-in / flat-map rendering
  // cost exactly what it cost before this feature existed.
  if (uTransition >= 1.0) return mercPos;

  vec3 globeMerc = (uGlobeToMerc * vec4(aEcef, 1.0)).xyz;

  // Backface cull in ECEF space -- see the "Step 4" comment on mercatorToGlobe
  // in globeProject.ts for why this must NOT be done in mercator space.
  vec3 dir = normalize(aEcef);       // outward surface normal
  vec3 surf = dir * GLOBE_RADIUS;
  vec3 toCam = normalize(uCameraEcef - surf);
  float d = dot(dir, toCam);         // d == 0 is the true horizon
  cull = smoothstep(-0.08, 0.02, d);
  cull = mix(cull, 1.0, uTransition); // no culling once we're flat

  return mix(globeMerc, mercPos, uTransition);
}
`;
