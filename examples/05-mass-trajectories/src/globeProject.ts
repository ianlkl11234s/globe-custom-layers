/**
 * Globe-hugging math, and the one thing this example adds on top of
 * examples/01-points-on-globe and examples/04-moving-trajectory: a SINGLE
 * shader that supports BOTH of docs/01-hugging-the-globe/mapbox.md's two
 * ECEF branches at once, selected per-vertex by an `aDynamic` attribute:
 *
 *   - aDynamic = 0 ("static" branch, Step 1): ECEF was precomputed on the
 *     CPU when this vertex's sample was cached (see leg.ts's generateLeg)
 *     and is read straight from the `aEcef` attribute -- zero trig this
 *     frame. This is every "interior" trail vertex: a leg's dense
 *     great-circle samples don't move once computed.
 *   - aDynamic = 1 ("moving" branch, "Unless your geometry moves"): this
 *     vertex is a head or tail point, freshly interpolated in mercator
 *     space *this frame* (leg.ts's sliceWindow lerps it directly between
 *     two cached samples -- see that file for why this needs no trig
 *     either). It has no cached ECEF, so the shader derives one from
 *     `position.xy` right here, every frame.
 *
 * This is docs/03-scaling-up/batched-trails.md's "Step 4: precompute what
 * doesn't move" (interior points are a straight array copy, never
 * recomputed) combined with mapbox.md's moving-geometry branch for the two
 * points per trail that Step 4 says need fresh trig -- except here that
 * trig runs in the vertex shader, not on the CPU via a JS
 * `mercatorToEcef()` call the way plan-art's BatchedTrails.ts does it. See
 * this repo's README, "Where this differs from the source", for why.
 *
 * Both `ecefFromMercator` below and its GLSL twin inside
 * `GLOBE_PROJECT_HYBRID_GLSL` are surface-bound (no altitude term) --
 * exactly the same simplification 04's GLOBE_PROJECT_MOVING_GLSL makes, for
 * the same reason: nothing in this example has altitude. Because there's
 * no altitude term, the "precompute" formula (Step 1) and the
 * "shader-derives-it" formula ("unless your geometry moves") are the exact
 * same function -- the only difference is WHERE and WHEN each vertex's copy
 * of it gets evaluated. `globeProject.test.ts`'s round-trip test is what
 * stands in for "the GLSL transcription matches this JS function": there is
 * only one function to keep in sync, used both to build the leg cache
 * (interior points) and as the source the GLSL snippet below was
 * transcribed from (head/tail points).
 */

// Mapbox's internal globe radius, derived from its 8192-unit vector-tile
// extent -- identical constant to every other example in this cookbook.
const GLOBE_EXTENT = 8192;
export const GLOBE_RADIUS = GLOBE_EXTENT / (2 * Math.PI); // ~= 1303.797

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Column-major 4x4 matrix, 16 numbers. */
export type Mat4 = ArrayLike<number>;

function transformPoint(m: Mat4, x: number, y: number, z: number, w: number): Vec3 {
  return {
    x: m[0]! * x + m[4]! * y + m[8]! * z + m[12]! * w,
    y: m[1]! * x + m[5]! * y + m[9]! * z + m[13]! * w,
    z: m[2]! * x + m[6]! * y + m[10]! * z + m[14]! * w,
  };
}

/** Forward Web Mercator: lon/lat (degrees) -> mercator unit coordinates. y=0 at the north edge, x deliberately NOT clamped to [0,1] -- see leg.ts's antimeridian-unwrapping loop for why an out-of-range x must stay out-of-range instead of being wrapped back. */
export function lonLatToMercator(lonDeg: number, latDeg: number): { x: number; y: number } {
  const x = (lonDeg + 180) / 360;
  const latRad = (latDeg * Math.PI) / 180;
  const y = (1 - Math.log(Math.tan(Math.PI / 4 + latRad / 2)) / Math.PI) / 2;
  return { x, y };
}

/** The exact inverse-Mercator line both branches of the GLSL use -- transcribed into JS so the round trip can be tested with no WebGL. */
export function mercatorYToLatRad(mercY: number): number {
  return 2 * Math.atan(Math.exp(Math.PI * (1 - 2 * mercY))) - Math.PI * 0.5;
}

/** Inverse Web Mercator: mercator unit coordinates -> lon/lat (degrees). */
export function mercatorToLonLat(mercX: number, mercY: number): { lon: number; lat: number } {
  const lonDeg = mercX * 360 - 180;
  const latRad = mercatorYToLatRad(mercY);
  const latDeg = (latRad * 180) / Math.PI;
  return { lon: lonDeg, lat: latDeg };
}

/**
 * Surface-bound ECEF from a mercator coordinate. Periodic in mercX: an
 * unwrapped mercX outside [0,1] (leg.ts produces these on purpose, see its
 * docstring) gives the exact same result as its wrapped equivalent, because
 * `lngRad` only ever appears inside `sin`/`cos`. This is what makes it safe
 * to feed unwrapped mercX into this function AND into the GLSL twin below
 * without special-casing the antimeridian at this layer -- the unwrapping
 * only matters for which straight line the renderer draws between two
 * adjacent samples, never for where a single point ends up.
 *
 * Used for BOTH branches described in this module's docstring: called once
 * per dense sample at leg-creation time (interior/cached points), and
 * mirrored verbatim inside `GLOBE_PROJECT_HYBRID_GLSL` for head/tail points
 * computed fresh every frame.
 */
export function ecefFromMercator(mercX: number, mercY: number): Vec3 {
  const lngRad = (mercX - 0.5) * 2 * Math.PI;
  const latRad = mercatorYToLatRad(mercY);
  const cosLat = Math.cos(latRad);
  const sinLat = Math.sin(latRad);
  // Negative y matches Mapbox's internal globe convention -- see
  // examples/01-points-on-globe/src/globeProject.ts for the full
  // derivation note; identical sign convention here.
  return {
    x: cosLat * Math.sin(lngRad) * GLOBE_RADIUS,
    y: -sinLat * GLOBE_RADIUS,
    z: cosLat * Math.cos(lngRad) * GLOBE_RADIUS,
  };
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export interface GlobeProjectResult extends Vec3 {
  cull: number;
}

/**
 * Downstream mix + backface-cull math -- identical function to every other
 * example in this cookbook (`mercatorToGlobe` in 01's and 04's
 * globeProject.ts). Doesn't know or care whether `ecef` came from the
 * `aEcef` attribute or was just derived from `mercPos` -- which is the
 * entire point of the hybrid branch above: this function is downstream of
 * both.
 */
export function mercatorToGlobe(
  mercPos: Vec3,
  ecef: Vec3,
  globeToMerc: Mat4 | null,
  transition: number,
  cameraEcef: Vec3 | null,
): GlobeProjectResult {
  if (!globeToMerc || transition >= 1) {
    return { x: mercPos.x, y: mercPos.y, z: mercPos.z, cull: 1 };
  }

  const globeMerc = transformPoint(globeToMerc, ecef.x, ecef.y, ecef.z, 1);

  const world: Vec3 = {
    x: globeMerc.x + (mercPos.x - globeMerc.x) * transition,
    y: globeMerc.y + (mercPos.y - globeMerc.y) * transition,
    z: globeMerc.z + (mercPos.z - globeMerc.z) * transition,
  };

  let cull = 1;
  if (cameraEcef) {
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

    const d = dir.x * toCam.x + dir.y * toCam.y + dir.z * toCam.z;
    cull = smoothstep(-0.08, 0.02, d);
    cull = cull + (1 - cull) * transition;
  }

  return { x: world.x, y: world.y, z: world.z, cull };
}

/**
 * GLSL companion to `ecefFromMercator` + `mercatorToGlobe` above. Prepend
 * this string to the trail vertex shader (trajectoryScene.ts).
 *
 * The one thing this shader does that no other example in this cookbook
 * does: it branches PER VERTEX on `aDynamic` to pick which of
 * mapbox.md's two ECEF branches applies, in the SAME draw call, the SAME
 * shader invocation family. `aEcef` (Step 1, precomputed attribute) and
 * live-derived-from-`position` ("Unless your geometry moves") coexist
 * because a batched-trail slot is a mix of both kinds of vertex --
 * see this module's docstring for exactly which vertices are which.
 */
export const GLOBE_PROJECT_HYBRID_GLSL = /* glsl */ `
uniform mat4 uGlobeToMerc;   // projectionToMercatorMatrix: ECEF -> mercator world space
uniform float uTransition;   // projectionToMercatorTransition: 0 = sphere, 1 = flat plane
uniform vec3 uCameraEcef;    // camera position in ECEF space (backface culling)

// GLSL has no built-in PI -- docs/01-hugging-the-globe/mapbox.md's snippet
// omits this const too; see examples/04-moving-trajectory's README for why
// it's required, not optional.
const float PI = 3.141592653589793;
const float GLOBE_RADIUS = 8192.0 / (2.0 * PI);

// Moving-geometry branch, only reached when aDynamic > 0.5: derive ECEF
// from a mercator coordinate that changed THIS frame (a freshly
// interpolated head or tail point -- see this file's module docstring).
// Byte-for-byte the same formula as ecefFromMercator() above.
vec3 ecefFromMercator(vec2 merc) {
  float lngRad = (merc.x - 0.5) * 2.0 * PI;
  float latRad = 2.0 * atan(exp(PI * (1.0 - 2.0 * merc.y))) - PI * 0.5;  // inverse Mercator
  float cosLat = cos(latRad);
  vec3 dir = vec3(cosLat * sin(lngRad), -sin(latRad), cosLat * cos(lngRad));
  return dir * GLOBE_RADIUS;
}

// mercPos: this vertex's mercator position (may be outside [0,1] on x --
// see leg.ts's antimeridian-unwrapping docstring; harmless here, sin/cos
// are 2*PI-periodic in lngRad).
// aEcef: precomputed ECEF, valid only when aDynamic <= 0.5.
// aDynamic: 0 = static/cached vertex (Step 1), 1 = moving vertex
//   (derive in-shader, "unless your geometry moves").
// Everything from here down -- the uGlobeToMerc multiply, the mix(), the
// ECEF-space backface cull, the uTransition >= 1.0 early-out -- is
// identical to every other example in this cookbook: see
// docs/01-hugging-the-globe/mapbox.md.
vec3 globeWorldPosition(vec3 mercPos, vec3 aEcef, float aDynamic, out float cull) {
  cull = 1.0;
  if (uTransition >= 1.0) return mercPos; // flat map: skip all globe math, same cost as a non-globe layer

  vec3 ecef = mix(aEcef, ecefFromMercator(mercPos.xy), step(0.5, aDynamic));

  vec3 globeMerc = (uGlobeToMerc * vec4(ecef, 1.0)).xyz;

  vec3 dir = normalize(ecef);        // outward surface normal
  vec3 surf = dir * GLOBE_RADIUS;
  vec3 toCam = normalize(uCameraEcef - surf);
  float d = dot(dir, toCam);         // d == 0 is the true horizon
  cull = smoothstep(-0.08, 0.02, d);
  cull = mix(cull, 1.0, uTransition); // no culling once we're flat

  return mix(globeMerc, mercPos, uTransition);
}
`;
