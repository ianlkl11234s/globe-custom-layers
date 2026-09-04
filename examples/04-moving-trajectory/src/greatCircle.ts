/**
 * Great-circle path sampling, on the unit sphere, independent of both
 * `three` and `mapbox-gl` -- this module is pure math so it can run under
 * vitest/Node with no WebGL and no DOM.
 *
 * Two distinct interpolation steps happen in this example, and they are
 * deliberately NOT the same function:
 *
 *   1. `slerp` builds the dense, precomputed sample array for a route (once,
 *      at object-creation time) -- proper spherical interpolation, exact at
 *      any t.
 *   2. `samplePathAtPhase` reads a *position* out of that dense array on
 *      every frame, by linearly interpolating (and renormalizing) the two
 *      nearest precomputed samples. That's cheap nlerp, not slerp -- fine
 *      because step 1 already made adjacent samples close together, which is
 *      exactly the "subdivide until segments are short" rule from
 *      docs/01-hugging-the-globe/mapbox.md's "one thing to fix before you
 *      start".
 *
 * Both operate on unit vectors, NOT on lon/lat pairs. Interpolating lon/lat
 * directly breaks at the antimeridian: lerping longitude 179 -> -179 crosses
 * through 0, landing the interpolated point on the opposite side of the
 * planet from the true short way around. Converting to a unit vector first
 * sidesteps the seam entirely -- there is no discontinuity in Cartesian
 * space.
 */

export interface LonLat {
  lon: number;
  lat: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** lon/lat (degrees) -> unit vector on the sphere. Any consistent right-handed convention works here -- this is an interpolation space, not the ECEF space globeProject.ts uses, and the two are never mixed. */
export function toUnitVector(p: LonLat): Vec3 {
  const lambda = (p.lon * Math.PI) / 180;
  const phi = (p.lat * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  return {
    x: cosPhi * Math.cos(lambda),
    y: cosPhi * Math.sin(lambda),
    z: Math.sin(phi),
  };
}

/** unit vector -> lon/lat (degrees). Inverse of toUnitVector. */
export function fromUnitVector(v: Vec3): LonLat {
  const lat = Math.asin(Math.max(-1, Math.min(1, v.z)));
  const lon = Math.atan2(v.y, v.x);
  return { lon: (lon * 180) / Math.PI, lat: (lat * 180) / Math.PI };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function length(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

function normalize(v: Vec3): Vec3 {
  const len = length(v) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

// Below this |sin(omega)|, slerp's division becomes numerically unstable --
// fall back to linear interpolation + renormalize (nlerp) instead. Checking
// sin(omega) directly (rather than a separate threshold on omega near 0 and
// another near PI) catches both the near-identical and near-antipodal cases
// with one test, since both make sin(omega) small for the same reason.
const SLERP_MIN_SIN_OMEGA = 1e-3;

/**
 * Spherical linear interpolation between two unit vectors. t=0 -> a exactly,
 * t=1 -> b exactly. Falls back to nlerp when a and b are (numerically)
 * identical or antipodal, where the standard slerp formula divides by
 * ~sin(0) and would otherwise blow up or produce NaN. Note: for *exactly*
 * antipodal input, the great-circle direction is mathematically undefined
 * (infinitely many arcs connect them) -- the nlerp fallback still returns a
 * finite vector, just not a meaningful "the" midpoint, which is the best any
 * implementation can do without an externally-supplied disambiguating axis.
 */
export function slerp(a: Vec3, b: Vec3, t: number): Vec3 {
  if (t <= 0) return a;
  if (t >= 1) return b;

  const cosOmega = Math.max(-1, Math.min(1, dot(a, b)));
  const omega = Math.acos(cosOmega);
  const sinOmega = Math.sin(omega);

  if (Math.abs(sinOmega) < SLERP_MIN_SIN_OMEGA) {
    return normalize(lerpVec3(a, b, t));
  }

  const wa = Math.sin((1 - t) * omega) / sinOmega;
  const wb = Math.sin(t * omega) / sinOmega;
  return { x: a.x * wa + b.x * wb, y: a.y * wa + b.y * wb, z: a.z * wa + b.z * wb };
}

/**
 * Precomputes `numSamples` unit-vector points evenly spaced (by slerp
 * parameter, i.e. by angle) along the great-circle arc from `a` to `b`.
 * Called once per object at path-generation time -- see the module
 * docstring for why every-frame reads use `samplePathAtPhase` instead of
 * calling this (or slerp directly) again.
 */
export function sampleGreatCirclePath(a: LonLat, b: LonLat, numSamples: number): Vec3[] {
  if (numSamples < 2) throw new Error("sampleGreatCirclePath needs at least 2 samples");
  const ua = toUnitVector(a);
  const ub = toUnitVector(b);
  const out: Vec3[] = new Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    out[i] = slerp(ua, ub, i / (numSamples - 1));
  }
  return out;
}

/**
 * Reads a position out of a precomputed dense path at phase in [0, 1] (0 =
 * path start, 1 = path end), nlerp-ing between the two nearest samples. Pure
 * function of (path, phase) -- no internal state, so calling it twice with
 * the same arguments always returns the same vector. That purity is what
 * makes the scrubber's "same t always gives the same position" requirement
 * trivially true: this function has nothing to accumulate.
 */
export function samplePathAtPhase(path: Vec3[], phase: number): Vec3 {
  const clamped = Math.max(0, Math.min(1, phase));
  const scaled = clamped * (path.length - 1);
  const i0 = Math.min(path.length - 2, Math.floor(scaled));
  const i1 = i0 + 1;
  const frac = scaled - i0;
  return normalize(lerpVec3(path[i0]!, path[i1]!, frac));
}
