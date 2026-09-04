/**
 * globe-hugging math for MOVING geometry: instead of precomputing each
 * vertex's Earth-Centered-Earth-Fixed (ECEF) position once (as
 * `examples/01-points-on-globe` does for its static airports), this
 * example derives ECEF from the mercator coordinate *inside the vertex
 * shader, every frame*. That's the branch documented in
 * docs/01-hugging-the-globe/mapbox.md under "Unless your geometry moves --
 * then do it in the shader": there is no fixed lon/lat to precompute against
 * once a point is a flight, a particle, or (as here) a ring-buffer trail
 * sample that gets rewritten as the object moves.
 *
 * This module has two halves that MUST stay numerically identical, same as
 * the static example:
 *   - `GLOBE_PROJECT_MOVING_GLSL`: a GLSL string, prepended to a vertex
 *     shader, that inverts Web Mercator back to lon/lat and on to ECEF for
 *     every vertex, every frame.
 *   - `ecefFromMercator` (+ `mercatorToGlobe`, reused verbatim from the same
 *     downstream math as the static example): a JS mirror used here (a) as a
 *     CPU-side reference so the shader math can be unit-tested without
 *     spinning up a WebGL context, and (b) to prove the round trip
 *     (lon/lat -> mercator -> shader's inverse formula -> lon/lat) is
 *     accurate within the latitude range this example actually uses.
 *
 * See docs/01-hugging-the-globe/mapbox.md in the parent repo for the *why*
 * behind every step below; this file stays terse and leans on that
 * document, same convention as the static example's globeProject.ts.
 */

// Mapbox's internal globe radius is derived from its 8192-unit vector-tile
// extent, NOT from a real-world radius in metres or any other physical unit.
// Identical constant to examples/01-points-on-globe -- see that file's
// comment for the derivation.
const GLOBE_EXTENT = 8192;
export const GLOBE_RADIUS = GLOBE_EXTENT / (2 * Math.PI); // ~= 1303.797

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Column-major 4x4 matrix, 16 numbers -- see the static example's globeProject.ts for why this shape. */
export type Mat4 = ArrayLike<number>;

function transformPoint(m: Mat4, x: number, y: number, z: number, w: number): Vec3 {
  return {
    x: m[0]! * x + m[4]! * y + m[8]! * z + m[12]! * w,
    y: m[1]! * x + m[5]! * y + m[9]! * z + m[13]! * w,
    z: m[2]! * x + m[6]! * y + m[10]! * z + m[14]! * w,
  };
}

/**
 * Forward Web Mercator: lon/lat (degrees) -> mercator unit coordinates in
 * [0,1]^2, y=0 at the north edge. This is the plain formula every web map
 * uses (equivalent to what `mapboxgl.MercatorCoordinate.fromLngLat` computes
 * for x/y) -- reimplemented here, with no `mapbox-gl` import, purely so this
 * module (and its tests) has zero runtime dependency on either `three` or
 * `mapbox-gl` and can run under Node/vitest with no WebGL and no DOM.
 */
export function lonLatToMercator(lonDeg: number, latDeg: number): { x: number; y: number } {
  const x = (lonDeg + 180) / 360;
  const latRad = (latDeg * Math.PI) / 180;
  const y = (1 - Math.log(Math.tan(Math.PI / 4 + latRad / 2)) / Math.PI) / 2;
  return { x, y };
}

/**
 * The exact inverse-Mercator line the recipe doc gives for the "moving
 * geometry" GLSL branch, transcribed into JS with the same operation order
 * so the two are easy to eyeball-compare:
 *
 *   latRad = 2.0 * atan(exp(PI * (1.0 - 2.0 * merc.y))) - PI * 0.5;
 *
 * This is the function under test for the round-trip check in
 * globeProject.test.ts (lon/lat -> lonLatToMercator -> this -> lon/lat).
 */
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
 * JS mirror of `ecefFromMercator()` in `GLOBE_PROJECT_MOVING_GLSL` below.
 * Derives a point's ECEF position directly from its mercator coordinate --
 * the "do it in the shader" branch, run here on the CPU only so it can be
 * unit-tested. Surface-bound (no altitude term): the recipe doc notes you'd
 * "add a radial factor if you need altitude" the same way Step 1's
 * `hEcef = mercZ * 8192 * cosLat` does for the precomputed branch, but
 * nothing in this example needs altitude, so it's dropped for clarity.
 */
export function ecefFromMercator(mercX: number, mercY: number): Vec3 {
  const lngRad = (mercX - 0.5) * 2 * Math.PI;
  const latRad = mercatorYToLatRad(mercY);
  const cosLat = Math.cos(latRad);
  const sinLat = Math.sin(latRad);
  // Same sign convention as the precomputed branch's lonLatToEcef: negative
  // y is intentional, matches Mapbox's internal globe convention. See that
  // function's docstring in examples/01-points-on-globe/src/globeProject.ts.
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
  /** Backface-cull visibility in [0, 1]. See the static example's GlobeProjectResult for the full docstring. */
  cull: number;
}

/**
 * Downstream mix + backface-cull math -- byte-for-byte the same function as
 * `mercatorToGlobe` in examples/01-points-on-globe/src/globeProject.ts.
 * The recipe doc calls this out explicitly: "Everything downstream is
 * identical -- same uGlobeToMerc multiply, same blend, same ECEF-space cull
 * using dir as the normal, same early-out." Only Step 1 (where `ecef` comes
 * from) differs between the two examples; this function doesn't know or
 * care whether its `ecef` argument was read from a precomputed attribute or
 * just computed by `ecefFromMercator` above -- which is the whole point.
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
 * this string to any vertex shader whose geometry moves -- see
 * `trajectoryScene.ts`, which uses it for BOTH the head-point mesh (moves
 * every frame by definition) and the trail mesh (each vertex is frozen once
 * written into its ring-buffer slot, but this example reprojects it anyway
 * every frame for a single shared code path -- see this repo's README,
 * "Deliberate simplifications", for the production alternative).
 *
 * Compared to `GLOBE_PROJECT_GLSL` in the static example, the only change is
 * *where* `aEcef` comes from: computed from `position.xy` here (a mercator
 * coordinate) instead of read from a precomputed vertex attribute. The doc
 * calls out "four transcendentals per vertex per frame" for this branch;
 * counting the actual calls below -- atan, exp, cos, sin -- gives four
 * distinct *kinds* of call, though `sin`/`cos` are each evaluated twice
 * (once for latitude, once for longitude), so six calls total. Worth naming
 * because "four" undercounts the literal call count by two.
 */
export const GLOBE_PROJECT_MOVING_GLSL = /* glsl */ `
uniform mat4 uGlobeToMerc;   // projectionToMercatorMatrix: ECEF -> mercator world space
uniform float uTransition;   // projectionToMercatorTransition: 0 = sphere, 1 = flat plane
uniform vec3 uCameraEcef;    // camera position in ECEF space (Step 4 backface culling)

// GLSL has no built-in PI -- the recipe doc's snippet uses PI without
// defining it; this const is the fix, must match the JS constant above.
const float PI = 3.141592653589793;
const float GLOBE_RADIUS = 8192.0 / (2.0 * PI);

// Moving-geometry branch (recipe doc, "Unless your geometry moves -- then do
// it in the shader"): derive ECEF from the mercator coordinate every frame,
// instead of reading a precomputed attribute. merc.xy are mercator unit
// coordinates in [0,1]; this is the "position" attribute you'd already have
// even with zero globe support.
vec3 ecefFromMercator(vec2 merc) {
  float lngRad = (merc.x - 0.5) * 2.0 * PI;
  float latRad = 2.0 * atan(exp(PI * (1.0 - 2.0 * merc.y))) - PI * 0.5;  // inverse Mercator
  float cosLat = cos(latRad);
  vec3 dir = vec3(cosLat * sin(lngRad), -sin(latRad), cosLat * cos(lngRad));
  return dir * GLOBE_RADIUS;   // surface-bound; add a radial factor if you need altitude (see Step 1)
}

// Identical downstream to the precomputed-attribute branch in the static
// example's GLOBE_PROJECT_GLSL: same uGlobeToMerc multiply, same mix(), same
// ECEF-space cull using dir as the normal, same uTransition >= 1.0
// early-out. See globeProject.ts's mercatorToGlobe() for the JS mirror of
// this exact function, which is what the unit tests exercise.
vec3 globeWorldPosition(vec3 mercPos, out float cull) {
  cull = 1.0;

  // Early-out: once fully zoomed past the globe<->flat transition, skip the
  // trig above entirely and hand back exactly what a non-globe layer would
  // have produced -- this is what keeps flat-map rendering at the same cost
  // it always had, even though this branch computes ECEF every frame while
  // the transition is still active.
  if (uTransition >= 1.0) return mercPos;

  vec3 aEcef = ecefFromMercator(mercPos.xy);
  vec3 globeMerc = (uGlobeToMerc * vec4(aEcef, 1.0)).xyz;

  vec3 dir = normalize(aEcef);       // outward surface normal
  vec3 surf = dir * GLOBE_RADIUS;
  vec3 toCam = normalize(uCameraEcef - surf);
  float d = dot(dir, toCam);         // d == 0 is the true horizon
  cull = smoothstep(-0.08, 0.02, d);
  cull = mix(cull, 1.0, uTransition); // no culling once we're flat

  return mix(globeMerc, mercPos, uTransition);
}
`;
