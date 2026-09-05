/**
 * Great-circle path sampling, on the unit sphere, independent of both
 * `three` and `mapbox-gl` -- pure math, runs under vitest/Node with no
 * WebGL and no DOM. Verbatim subset of the same module in
 * examples/04-moving-trajectory/src/greatCircle.ts (each example in this
 * cookbook duplicates rather than shares code -- see the top-level
 * examples/README.md, "self-contained").
 *
 * Unlike 04, this module does NOT export a per-frame "sample at phase"
 * function: 04 needs one because it reprojects a dense path at an
 * arbitrary phase every frame. This example instead reads a leg's head/tail
 * position by *linearly interpolating two adjacent, already-unwrapped
 * mercator samples* (see leg.ts's sliceWindow) -- the same technique
 * plan-art's BatchedTrails.writeTrail uses, and cheaper: no unit-vector
 * round trip, no re-normalization, just two float lerps. `slerp` is still
 * needed once per leg, at leg-creation time, to build the dense sample
 * array leg.ts then converts to mercator.
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

/** lon/lat (degrees) -> unit vector on the sphere. */
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
// fall back to linear interpolation + renormalize (nlerp) instead. Same
// threshold and rationale as 04's greatCircle.ts.
const SLERP_MIN_SIN_OMEGA = 1e-3;

/**
 * Spherical linear interpolation between two unit vectors. t=0 -> a
 * exactly, t=1 -> b exactly. Falls back to nlerp when a and b are
 * (numerically) identical or antipodal.
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
 * Called once per leg, at leg-creation time (leg.ts's generateLeg) -- see
 * this module's docstring for why every-frame reads never call this or
 * `slerp` again.
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

/** Standard spherical "destination point given start, bearing, angular distance" formula. Used by leg.ts to pick each leg's endpoint. */
export function destinationPoint(start: LonLat, bearingDeg: number, angularDistDeg: number): LonLat {
  const lat1 = (start.lat * Math.PI) / 180;
  const lon1 = (start.lon * Math.PI) / 180;
  const theta = (bearingDeg * Math.PI) / 180;
  const delta = (angularDistDeg * Math.PI) / 180;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(delta) + Math.cos(lat1) * Math.sin(delta) * Math.cos(theta),
  );
  const lon2 =
    lon1 +
    Math.atan2(Math.sin(theta) * Math.sin(delta) * Math.cos(lat1), Math.cos(delta) - Math.sin(lat1) * Math.sin(lat2));

  return { lon: (((lon2 * 180) / Math.PI + 540) % 360) - 180, lat: (lat2 * 180) / Math.PI };
}
