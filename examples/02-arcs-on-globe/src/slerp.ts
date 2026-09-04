/**
 * Spherical linear interpolation (slerp) between two points on Earth's
 * surface, used to sample great-circle arcs for `arcs.ts`.
 *
 * WHY THIS FILE EXISTS AT ALL: it is tempting to interpolate an origin/destination
 * pair directly in (lon, lat) space -- `lon = lerp(lon0, lon1, t)`, same for lat.
 * That is wrong in two independent ways:
 *
 *   1. It is not a great circle. Linearly blending degrees of longitude and
 *      latitude does not trace the shortest path over a sphere -- it traces a
 *      path that looks reasonable near the equator and becomes visibly wrong
 *      at higher latitudes and long distances, because a degree of longitude
 *      covers less real distance the further you are from the equator.
 *   2. It has no idea the antimeridian (+/-180 deg) exists. Two points that are
 *      geographically close across the date line (say lon=179 and lon=-179,
 *      only 2 degrees apart) are numerically far apart (358) in raw longitude.
 *      A naive lerp walks the "358 degrees" way around the planet -- through
 *      the OTHER side of the Earth -- instead of the 2-degree way. This example's
 *      Taipei -> Los Angeles arc crosses close to the date line and is exactly
 *      the case that exposes this (see arcs.test.ts).
 *
 * Slerping in 3D unit-vector space sidesteps both problems for free: there is
 * no "longitude" in that space, so there is no antimeridian to special-case,
 * and the interpolation is geometrically the great circle by construction
 * (see `slerpUnitVectors`'s docstring). Longitude only re-enters the picture
 * once we convert a sampled 3D point back to (lon, lat) for `lonLatToEcef` --
 * see `unwrapLongitude` below for the one wrinkle that reintroduces.
 *
 * NOTE: this file's `lonLatToUnitVector` is a plain right-handed geographic
 * unit sphere (x = cos(lat)*cos(lon), y = cos(lat)*sin(lon), z = sin(lat)) --
 * NOT Mapbox's ECEF convention in `globeProject.ts` (which has a negated y
 * and a rotated axis, see that file's docstring). That is deliberate: slerping
 * is pure spherical geometry and does not care which engine's convention you
 * eventually render in. Keeping it convention-free means this module has no
 * idea Mapbox exists, and its output -- a plain (lon, lat) -- is handed to
 * `lonLatToEcef` exactly like any other static point, at the boundary in
 * `arcs.ts`.
 */

import type { Vec3 } from "./globeProject";

export interface LonLat {
  lon: number;
  lat: number;
}

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

// Below this angle (radians) between two input vectors, sin(omega) is close
// enough to zero that dividing by it would amplify floating-point noise.
// A plain normalized linear blend is numerically safe here and the visual
// difference from "true" slerp at this scale is unmeasurable.
const NEAR_ZERO_ANGLE = 1e-6;

// Within this distance (radians) of PI, two points are antipodal (or close
// enough that sin(omega) is again near zero). See slerpUnitVectors's docstring
// for why this case needs different handling, not just a smaller divisor.
const NEAR_ANTIPODAL_ANGLE = 1e-6;

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function scale(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function length(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

function normalize(v: Vec3): Vec3 {
  const len = length(v) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

/**
 * Geographic lon/lat (degrees) -> unit vector on a plain right-handed sphere.
 * See this file's module docstring for why this is NOT the same convention
 * as `globeProject.ts`'s `lonLatToEcef` -- the two are only reconciled at the
 * point where `slerpLonLat`'s output is fed into `lonLatToEcef` in `arcs.ts`.
 */
export function lonLatToUnitVector(lonDeg: number, latDeg: number): Vec3 {
  const lambda = lonDeg * DEG2RAD;
  const phi = latDeg * DEG2RAD;
  const cosLat = Math.cos(phi);
  return {
    x: cosLat * Math.cos(lambda),
    y: cosLat * Math.sin(lambda),
    z: Math.sin(phi),
  };
}

/** Inverse of `lonLatToUnitVector`. `v` need not be pre-normalized. */
export function unitVectorToLonLat(v: Vec3): LonLat {
  const n = normalize(v);
  // asin's domain is [-1, 1]; clamp against float rounding that can push
  // n.z a hair outside that range for points exactly at the poles.
  const clampedZ = Math.min(1, Math.max(-1, n.z));
  return {
    lat: Math.asin(clampedZ) * RAD2DEG,
    lon: Math.atan2(n.y, n.x) * RAD2DEG,
  };
}

/**
 * Rotate unit vector `v` by `angle` radians around unit axis `axis`, using
 * Rodrigues' rotation formula: v*cos(th) + (axis x v)*sin(th) + axis*(axis.v)*(1-cos(th)).
 * Used only by the antipodal branch below, where axis is always constructed
 * perpendicular to v (axis . v = 0), so that formula's last term vanishes and
 * only the two terms kept here remain.
 */
function rotateAroundAxis(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  return add(scale(v, cosA), scale(cross(axis, v), sinA));
}

/**
 * Any unit vector perpendicular to `v`. There are infinitely many; we only
 * need one, deterministically, for the antipodal fallback below -- which
 * specific one is picked has no effect on slerp's t=0/t=1 endpoints, only on
 * which arbitrary great circle is used to connect two antipodal points (see
 * `slerpUnitVectors`'s docstring).
 */
function pickArbitraryPerpendicular(v: Vec3): Vec3 {
  // Cross with whichever world axis is LEAST aligned with v, so the cross
  // product below is never near-zero-length itself.
  const reference: Vec3 = Math.abs(v.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 };
  return normalize(cross(v, reference));
}

/**
 * Spherical linear interpolation between two unit vectors: the point at
 * fraction `t` along the shorter great-circle arc from `a` to `b`, both
 * assumed to already lie on the unit sphere.
 *
 * Standard formula: slerp(a,b,t) = (sin((1-t)*omega)*a + sin(t*omega)*b) / sin(omega),
 * where omega is the angle between a and b. This traces the great circle
 * through a and b at constant angular speed -- unlike a linear blend of the
 * two vectors (which would cut a straight chord inside the sphere and need
 * re-normalizing, producing an angularly UNEVEN speed that bunches points up
 * near the ends and stretches them near the middle).
 *
 * Two edge cases need special handling, both because sin(omega) approaches
 * zero and would blow up the division:
 *
 *   - a and b nearly coincide (omega ~ 0): a normalized linear blend is a
 *     fine, numerically stable substitute -- see NEAR_ZERO_ANGLE.
 *   - a and b are (nearly) antipodal (omega ~ PI): sin(omega) is near zero
 *     again, but the deeper issue is that infinitely many great circles pass
 *     through two antipodal points -- the "shortest path" is not merely hard
 *     to compute here, it is genuinely undefined. Real flight-arc tools hit
 *     this too (there is no unique geodesic between exact antipodes) and
 *     resolve it the same way this does: pick ANY perpendicular axis and
 *     rotate `a` around it by t*PI. This never divides by ~0 and can never
 *     produce NaN, which is the property this example's tests care about --
 *     see arcs.test.ts's antipodal case.
 */
export function slerpUnitVectors(a: Vec3, b: Vec3, t: number): Vec3 {
  const clampedDot = Math.min(1, Math.max(-1, dot(a, b)));
  const omega = Math.acos(clampedDot);

  if (omega < NEAR_ZERO_ANGLE) {
    return normalize(add(a, scale(add(b, scale(a, -1)), t)));
  }

  if (Math.PI - omega < NEAR_ANTIPODAL_ANGLE) {
    const axis = pickArbitraryPerpendicular(a);
    return rotateAroundAxis(a, axis, t * Math.PI);
  }

  const sinOmega = Math.sin(omega);
  const wa = Math.sin((1 - t) * omega) / sinOmega;
  const wb = Math.sin(t * omega) / sinOmega;
  return add(scale(a, wa), scale(b, wb));
}

/** Slerp two (lon, lat) points directly, round-tripping through unit vectors. */
export function slerpLonLat(a: LonLat, b: LonLat, t: number): LonLat {
  const va = lonLatToUnitVector(a.lon, a.lat);
  const vb = lonLatToUnitVector(b.lon, b.lat);
  return unitVectorToLonLat(slerpUnitVectors(va, vb, t));
}

/**
 * `unitVectorToLonLat` calls `atan2`, which always returns a value in
 * (-180, 180]. That is fine for any SINGLE point, but a SEQUENCE of points
 * sampled along an arc that crosses the antimeridian will have consecutive
 * longitudes that are geographically a few degrees apart but numerically
 * ~360 apart (e.g. ...,177.3, -178.1,... -- see arcs.test.ts's Taipei -> Los
 * Angeles case). That is atan2's branch cut, not a geometry error: the
 * underlying 3D points move continuously the whole way.
 *
 * This "unwraps" `lon` relative to the previous sample by adding/subtracting
 * whole turns until it is within 180 degrees of `prevLon`, restoring a
 * continuous sequence. It is purely cosmetic for rendering -- `lonLatToEcef`'s
 * sin/cos are 360-periodic, so an unwrapped value like 181.9 produces the
 * IDENTICAL ECEF point as -178.1 -- but it matters for anything that inspects,
 * exports, or plots the raw waypoints (this example's tests included), and it
 * is what makes `arcs.ts`'s `sampleArc` output a continuous curve instead of
 * one with a spurious backtrack in it.
 */
export function unwrapLongitude(prevLon: number, lon: number): number {
  let unwrapped = lon;
  while (unwrapped - prevLon > 180) unwrapped -= 360;
  while (unwrapped - prevLon < -180) unwrapped += 360;
  return unwrapped;
}
