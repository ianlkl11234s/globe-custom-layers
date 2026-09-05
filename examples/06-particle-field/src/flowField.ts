/**
 * A synthetic, analytic wind/current field -- deliberately NOT downloaded
 * real weather data (licensing, and this repo never fetches external
 * datasets for an example; see AGENTS.md's "Sample data is public domain or
 * generated" rule). It is built entirely from closed-form trig, so it is:
 *
 * - Deterministic: a fixed seed (`DEFAULT_SEED`) always produces the same
 *   set of vortices, hence the same field, hence the same-looking demo run
 *   after run.
 * - Globally continuous, including across the antimeridian -- structurally,
 *   not as a patched-in special case. Longitude only ever enters the maths
 *   below as the argument of `sin`/`cos` (converting to a 3D ECEF-style
 *   unit vector, and inside `cos(lon1 - lon2)` for the great-circle
 *   distance) -- both are exactly 2*PI-periodic, so lon=180 and lon=-180
 *   produce bit-identical 3D points, not merely "close" ones. There is no
 *   wrap/modulo of a longitude *difference* anywhere in this file (an
 *   earlier version had one, to convert a longitude difference into a
 *   local east/north displacement -- that introduced its OWN seam at each
 *   vortex's antipodal meridian, which does not generally coincide with
 *   the map's antimeridian and does not generally sit far enough from the
 *   vortex's core to be negligible for a high-latitude, wide-radius vortex.
 *   See git history / vector-field-particles.md's discrepancy note for
 *   that dead end).
 * - Each vortex is built as the curl of a radially-symmetric Gaussian bump,
 *   evaluated in 3D (ECEF-style unit-vector) space via a cross product --
 *   not a bearing/`atan2`-based "rotate the radial direction by 90 degrees"
 *   formulation. A bearing-based direction is continuous everywhere except
 *   at the vortex's own center and antipode, but "continuous" isn't the
 *   same as "well-conditioned": close to a core, a bearing's *direction* is
 *   acutely sensitive to tiny position changes (the same way compass
 *   bearing near the true pole swings wildly for a small step). The
 *   cross-product formulation has no direction computation to be
 *   ill-conditioned in the first place: it's a smooth, real-analytic
 *   (polynomial-times-Gaussian) function of two 3D unit vectors, exactly
 *   zero at both the vortex's own center AND its exact antipode (both
 *   smooth zeros, not discontinuities), peaking near `radiusDeg` away.
 * - Safe at the poles: converting (lon, lat) to a 3D unit vector maps every
 *   point at lat=+-90 to the same single 3D point regardless of longitude
 *   (the pole genuinely has no longitude, and this representation reflects
 *   that instead of producing an arbitrary or unstable one). No
 *   `atan2`/`asin`/`acos` anywhere in the vortex hot path; the one `acos`
 *   (in `angularDistanceDeg`, used only for the Gaussian's radial falloff)
 *   is clamped against float rounding pushing its argument outside [-1, 1].
 *
 * No `mapbox-gl` or WebGL import here on purpose -- this is plain math,
 * testable under Node with no GPU and no DOM (see flowField.test.ts).
 */

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Deterministic PRNG (mulberry32) -- same seed always produces the same vortex set. Same technique as 04-moving-trajectory/src/objectPath.ts's route generator. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Vec3 = [number, number, number];

/** lon/lat (degrees) -> unit ECEF-style vector. Every point at a pole maps to the same (0,0,+-1) regardless of longitude -- structurally pole-safe, not just NaN-safe. */
function toUnitEcef(lonDeg: number, latDeg: number): Vec3 {
  const lonRad = lonDeg * DEG2RAD;
  const latRad = latDeg * DEG2RAD;
  const cosLat = Math.cos(latRad);
  return [cosLat * Math.cos(lonRad), cosLat * Math.sin(lonRad), Math.sin(latRad)];
}

function cross3(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * Great-circle angular distance between two lon/lat points, in degrees, via
 * the spherical law of cosines. Antimeridian-safe: the only place `lon`
 * appears is inside `cos(lon1 - lon2)`, exactly 2*PI-periodic regardless of
 * how large the raw difference is. Pole-safe: clamps the acos argument
 * against float rounding pushing it fractionally outside [-1, 1].
 */
export function angularDistanceDeg(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const phi1 = lat1 * DEG2RAD;
  const phi2 = lat2 * DEG2RAD;
  const dLon = (lon1 - lon2) * DEG2RAD;
  const cosD = clamp(Math.sin(phi1) * Math.sin(phi2) + Math.cos(phi1) * Math.cos(phi2) * Math.cos(dLon), -1, 1);
  return Math.acos(cosD) * RAD2DEG;
}

export interface Vortex {
  lon: number;
  lat: number;
  /** Great-circle radius (degrees) at which this vortex's tangential speed roughly peaks -- also the Gaussian's characteristic width. */
  radiusDeg: number;
  /** Sets both peak tangential speed (m/s-ish) and rotation direction (+ = counterclockwise as seen from outside the sphere, - = clockwise). */
  strengthMs: number;
}

export const DEFAULT_SEED = 0x600d_bead;
export const DEFAULT_VORTEX_COUNT = 9;
/** Used to normalize particle speed into the [0,1] color-ramp domain -- see particleFieldLayer.ts's rampColor. Chosen comfortably above the sum of a plausible zonal + single-vortex peak so the ramp rarely clips. */
export const SPEED_MAX_MS = 26;

/**
 * Deterministic vortex generator. Centers are spread on the sphere (not just
 * in lon/lat, which would cluster near the poles) by sampling latitude from
 * an arcsin distribution -- uniform in sin(lat), which is uniform-on-sphere.
 */
export function generateVortices(count = DEFAULT_VORTEX_COUNT, seed = DEFAULT_SEED): Vortex[] {
  const rng = mulberry32(seed);
  const vortices: Vortex[] = [];
  for (let i = 0; i < count; i++) {
    const lon = rng() * 360 - 180;
    const lat = Math.asin(rng() * 2 - 1) * RAD2DEG;
    const radiusDeg = 14 + rng() * 22; // 14..36 deg
    const strengthMs = (8 + rng() * 10) * (rng() < 0.5 ? -1 : 1); // 8..18 m/s-ish, random handedness
    vortices.push({ lon, lat, radiusDeg, strengthMs });
  }
  return vortices;
}

export const DEFAULT_VORTICES = generateVortices();

/**
 * Latitude-banded prevailing wind (a crude trade-winds/westerlies/polar-
 * easterlies stand-in): purely a function of latitude, so it never touches
 * longitude at all -- trivially antimeridian-continuous. `Math.sin` is
 * bounded in [-1, 1], so this can never diverge; multiplying by `amplitude`
 * (itself finite) keeps the whole thing finite at every latitude, poles
 * included. `bands` controls how many alternating easterly/westerly bands
 * fit between the poles.
 */
export function zonalBaseSpeedMs(latDeg: number, amplitude = 9, bands = 3): number {
  return amplitude * Math.sin(bands * latDeg * DEG2RAD);
}

export interface FlowSample {
  /** Eastward component, m/s-ish. */
  u: number;
  /** Northward component, m/s-ish. */
  v: number;
  speed: number;
}

/**
 * One vortex's contribution to (u, v) at a query point.
 *
 * Built as: convert both points to unit ECEF vectors, take their cross
 * product (a vector tangent to the sphere at the query point, exactly zero
 * at the vortex's own center and its exact antipode, magnitude sin(d) in
 * between), scale it by a Gaussian in the true great-circle distance `d`,
 * then project onto the local east/north basis at the query point to get
 * (u, v). See the module doc comment for why this replaced an earlier
 * bearing-based (`atan2`) formulation.
 */
function vortexContribution(vx: Vortex, lon: number, lat: number): { u: number; v: number } {
  const p = toUnitEcef(lon, lat);
  const c = toUnitEcef(vx.lon, vx.lat);
  const d = angularDistanceDeg(vx.lon, vx.lat, lon, lat);
  const sigma = vx.radiusDeg;
  const gaussian = Math.exp(-(d * d) / (2 * sigma * sigma));
  const sigmaRad = Math.max(sigma * DEG2RAD, 1e-6);
  // |cross3(c, p)| == sin(angle between c and p) == sin(d in radians) --
  // zero exactly at the center (p == c) and the antipode (p == -c), which
  // is what makes this "calm eye" behavior structural rather than
  // window-dependent.
  const tangent3 = cross3(c, p);
  const scale = (vx.strengthMs / sigmaRad) * gaussian;

  const lonRad = lon * DEG2RAD;
  const latRad = lat * DEG2RAD;
  // Local east/north basis at the query point (standard ENU vectors).
  // eastHat stays unit length at the poles (it just picks *some* direction,
  // since longitude is meaningless there); northHat's z-component is
  // cos(lat), which -> 0 at the poles, so any tangent vector's projected
  // north/south component naturally tapers to zero there too -- no NaN,
  // no blow-up, and no arbitrary non-zero value at a point where "north"
  // isn't physically well-defined.
  const eastHat: Vec3 = [-Math.sin(lonRad), Math.cos(lonRad), 0];
  const northHat: Vec3 = [-Math.sin(latRad) * Math.cos(lonRad), -Math.sin(latRad) * Math.sin(lonRad), Math.cos(latRad)];

  const tangent: Vec3 = [tangent3[0] * scale, tangent3[1] * scale, tangent3[2] * scale];
  return { u: dot3(tangent, eastHat), v: dot3(tangent, northHat) };
}

/**
 * Samples the total synthetic field (zonal base flow + every vortex) at one
 * lon/lat point. Always finite -- see the module doc comment for why each
 * contributing term is individually bounded and antimeridian/pole-safe;
 * summing finitely many finite terms stays finite.
 */
export function sampleFlow(lon: number, lat: number, vortices: Vortex[] = DEFAULT_VORTICES): FlowSample {
  let u = zonalBaseSpeedMs(lat);
  let v = 0;
  for (const vx of vortices) {
    const c = vortexContribution(vx, lon, lat);
    u += c.u;
    v += c.v;
  }
  return { u, v, speed: Math.hypot(u, v) };
}
