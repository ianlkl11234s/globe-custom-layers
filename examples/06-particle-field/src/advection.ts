/**
 * CPU-side Euler (first-order) advection: given a particle's current
 * lon/lat and a sampled wind vector (u, v in m/s), step it forward through
 * the flow field. This is the technique documented in
 * docs/03-scaling-up/vector-field-particles.md's "CPU-side Euler
 * advection" section, transcribed from
 * mini-taiwan-pulse/src/map/climateParticleLineLayer.ts's `step()` method
 * (which works in normalized [0,1] texture-UV space; this version works in
 * plain lon/lat degrees instead, since our field is analytic, not a raster).
 *
 * No `mapbox-gl` or WebGL import here on purpose -- pure math, testable
 * under Node with no GPU and no DOM (see advection.test.ts).
 *
 * Two time quantities, kept deliberately separate:
 * - `rawDtSeconds`: real wall-clock time since the last frame. This is what
 *   needs the safety clamp (see MAX_FRAME_DT below) -- it is the quantity
 *   that spikes when a backgrounded tab regains focus.
 * - `flowSeconds`: how much *simulated* time the particle should advect
 *   through this frame -- `rawDtSeconds` scaled by a speed multiplier the
 *   caller controls (a HUD slider, a "how fast is simulated time" constant,
 *   or both). `eulerStep` takes this already-scaled quantity and does not
 *   re-clamp it: clamping belongs to the raw wall-clock delta, once, before
 *   it gets multiplied up -- clamping *after* scaling would defeat the
 *   speed multiplier at high settings.
 */

const DEG2RAD = Math.PI / 180;

/** A background tab returning after several real seconds must not fling every particle across the whole field in one step -- see the recipe's "The trap that costs the most time" section. This is the ceiling on the RAW wall-clock frame delta, in seconds. */
export const MAX_FRAME_DT = 1 / 20;

export const EARTH_METERS_PER_DEG_LAT = 110_540;
export const EARTH_METERS_PER_DEG_LON_AT_EQUATOR = 111_320;
/** Floor on meters-per-degree-longitude near the poles, where cos(lat) -> 0. Without this floor, dividing by a near-zero denominator would fling near-pole particles an enormous longitude distance in one step. */
export const MIN_METERS_PER_DEG_LON = 20_000;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Clamps a RAW wall-clock frame delta to MAX_FRAME_DT. Also floors non-finite/non-positive input to 0 (performance.now() deltas are never negative in practice, but a caller passing a bad value should freeze the particle for a frame, not send it flying or NaN it). */
export function clampDt(rawDtSeconds: number): number {
  if (!Number.isFinite(rawDtSeconds) || rawDtSeconds <= 0) return 0;
  return Math.min(rawDtSeconds, MAX_FRAME_DT);
}

/** Wraps a longitude into (-180, 180], periodically -- keeps long-running accumulation from drifting to ever-larger magnitudes (float precision) and keeps mercator-x conversion (which assumes lon in that range) correct. */
export function wrapLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

export interface LonLat {
  lon: number;
  lat: number;
}

/**
 * One first-order Euler step, given an already-scaled `flowSeconds` (see
 * module doc comment). Deliberately does NOT clamp `flowSeconds` itself --
 * that would double-clamp against `clampDt` and silently cap the speed
 * slider. Non-finite/non-positive `flowSeconds` is still floored to a
 * no-op, as a defensive invariant independent of where the caller got the
 * value from.
 *
 * Latitude is clamped away from the exact poles (+-89.9) rather than to
 * +-90: at exactly +-90 the notion of "longitude" degenerates, and a
 * particle sitting exactly on the pole would have its longitude become
 * meaningless on the next sample (though still finite -- see flowField.ts's
 * pole-safety tests). Stopping just short avoids that degenerate case
 * without discarding any visually meaningful particle track.
 */
export function eulerStep(pos: LonLat, u: number, v: number, flowSeconds: number): LonLat {
  if (!Number.isFinite(flowSeconds) || flowSeconds <= 0) return pos;
  const latRad = pos.lat * DEG2RAD;
  const metersPerDegLon = Math.max(MIN_METERS_PER_DEG_LON, EARTH_METERS_PER_DEG_LON_AT_EQUATOR * Math.cos(latRad));
  const nextLon = wrapLon(pos.lon + (u * flowSeconds) / metersPerDegLon);
  const nextLat = clamp(pos.lat + (v * flowSeconds) / EARTH_METERS_PER_DEG_LAT, -89.9, 89.9);
  return { lon: nextLon, lat: nextLat };
}

/**
 * Convenience used by the layer's per-frame loop: clamps the raw wall-clock
 * delta once, scales it by `flowSecondsPerRealSecond` (the product of a
 * fixed "how fast is simulated time" constant and the speed HUD slider),
 * then takes one Euler step. This is the function that actually enforces
 * the frame-dt safety clamp end to end.
 */
export function advectionStep(
  pos: LonLat,
  u: number,
  v: number,
  rawDtSeconds: number,
  flowSecondsPerRealSecond: number,
): LonLat {
  const dt = clampDt(rawDtSeconds);
  return eulerStep(pos, u, v, flowSecondsPerRealSecond * dt);
}
