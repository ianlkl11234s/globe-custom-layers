/**
 * A "leg" is one point-to-point great-circle trip: a synthetic stand-in for
 * a single flight, generated procedurally (fixed seed) rather than loaded
 * from data. No `three` or `mapbox-gl` import -- pure TS, runs under
 * vitest with no WebGL and no DOM.
 *
 * Two things happen once, at leg-creation time, and never again for that
 * leg (docs/03-scaling-up/batched-trails.md's "Step 4: precompute what
 * doesn't move"):
 *   1. `sampleGreatCirclePath` (greatCircle.ts) builds a dense array of
 *      unit-vector samples -- proper slerp, exact at any t.
 *   2. Each sample is converted to lon/lat, then to mercator with
 *      longitude resolved PER SEGMENT relative to the previous sample (not
 *      independently per vertex) -- docs/01-hugging-the-globe/mapbox.md's
 *      "and a second one, if anything crosses the antimeridian". A 150deg
 *      leg can easily cross +-180; converting each sample's longitude with
 *      the ordinary `(lng+180)/360` formula independently would put two
 *      adjacent samples at mercX~=0.99 and mercX~=0.01, and this example
 *      draws a real connected line (THREE.Line) through them -- unlike 04's
 *      THREE.Points cloud, which never had to care. Unwrapping keeps mercX
 *      continuous even when that pushes it outside [0,1]; see
 *      globeProject.ts's `ecefFromMercator` docstring for why an
 *      out-of-range mercX still produces the correct ECEF point (the
 *      formula is 2*PI-periodic in longitude).
 *   3. Each sample's ECEF is precomputed too (globeProject.ts's
 *      `ecefFromMercator`), stored alongside its mercator coordinate --
 *      this is the array plan-art's BatchedTrails.writeTrail calls `ecef:
 *      Float32Array` and copies from with zero trig, every frame, for
 *      every interior point.
 *
 * `sliceWindow` is the per-frame read side: given the current simulation
 * time, it returns exactly the vertices a caller should write into a slot
 * -- oldest first, head last -- by binary-searching this leg's own dense
 * sample array for the trailing time window, then linearly interpolating
 * (in already-unwrapped mercator space, NOT re-deriving from the unit
 * vectors) a tail sample (if the window's trailing edge falls between two
 * cached samples) and a head sample (if `time` is past the last cached
 * sample, which it almost always is mid-leg). This mirrors plan-art's
 * `BatchedTrails.writeTrail` binary-search + interpolate structure
 * closely, adapted from "real timestamped track points" to "dense
 * synthetic samples with an implied per-sample timestamp".
 */

import { destinationPoint, fromUnitVector, sampleGreatCirclePath, type LonLat } from "./greatCircle";
import { ecefFromMercator, lonLatToMercator } from "./globeProject";

/** Dense slerp samples per leg -- see greatCircle.ts's module docstring for why this needs to be dense (the "subdivide until segments are short" rule). At most 150deg / (SAMPLES-1) per segment. */
export const PATH_SUBDIVISIONS = 48;

export const MIN_LEG_DURATION_SEC = 4;
export const MAX_LEG_DURATION_SEC = 12;

/** Trailing time window a rendered trail shows, in simulation seconds. Comparable to (sometimes shorter than, sometimes longer than) a leg's own duration -- deliberately, so sliceWindow's "whole leg visible" and "windowed, tail interpolated" branches both get exercised. */
export const TRAIL_WINDOW_SEC = 5;

/** One dense, precomputed sample: mercator + ECEF, both computed once, plus this sample's absolute simulation timestamp. */
export interface LegSample {
  mercX: number;
  mercY: number;
  ecefX: number;
  ecefY: number;
  ecefZ: number;
  t: number;
}

export interface Leg {
  readonly startTime: number;
  readonly duration: number;
  readonly endTime: number;
  readonly samples: readonly LegSample[];
}

/** Deterministic PRNG (mulberry32) -- same seed always produces the same leg sequence. Each object owns one generator instance that advances leg after leg, so re-running this example always reproduces the exact same traffic. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Picks a uniformly-random point on the sphere. */
export function randomLonLat(rand: () => number): LonLat {
  const lat = Math.asin(rand() * 2 - 1) * (180 / Math.PI);
  const lon = rand() * 360 - 180;
  return { lon, lat };
}

/**
 * Builds one leg from `start` to a procedurally-chosen destination
 * 20-150deg away by bearing (same range as 04's `generateObjectPaths`, same
 * "long enough to hug visibly, short of antipodal" rationale), starting at
 * `startTime` with a random duration in
 * [MIN_LEG_DURATION_SEC, MAX_LEG_DURATION_SEC].
 *
 * `start` is a parameter rather than randomized here so consecutive legs
 * chain start-to-end (this leg's destination becomes the next leg's
 * start) -- see trajectoryScene.ts's per-object leg-renewal, which is what
 * makes the population read as continuously-flying traffic rather than
 * teleporting between unrelated legs.
 */
export function generateLeg(rand: () => number, start: LonLat, startTime: number): Leg {
  const bearing = rand() * 360;
  const angularDist = 20 + rand() * 130; // [20, 150] deg, see greatCircle.ts's destinationPoint
  const end = destinationPoint(start, bearing, angularDist);
  const duration = MIN_LEG_DURATION_SEC + rand() * (MAX_LEG_DURATION_SEC - MIN_LEG_DURATION_SEC);

  const path = sampleGreatCirclePath(start, end, PATH_SUBDIVISIONS);
  const samples: LegSample[] = new Array(PATH_SUBDIVISIONS);

  let prevLon = start.lon;
  for (let i = 0; i < PATH_SUBDIVISIONS; i++) {
    const ll = fromUnitVector(path[i]!);
    // Antimeridian unwrap: bring this sample's longitude into the same
    // continuous frame as the previous one, even if that pushes it outside
    // (-180, 180]. See this module's docstring, point 2.
    let lon = ll.lon;
    while (lon - prevLon > 180) lon -= 360;
    while (lon - prevLon < -180) lon += 360;
    prevLon = lon;

    const merc = lonLatToMercatorUnwrapped(lon, ll.lat);
    const ecef = ecefFromMercator(merc.x, merc.y);
    samples[i] = {
      mercX: merc.x,
      mercY: merc.y,
      ecefX: ecef.x,
      ecefY: ecef.y,
      ecefZ: ecef.z,
      t: startTime + (i / (PATH_SUBDIVISIONS - 1)) * duration,
    };
  }

  return { startTime, duration, endTime: startTime + duration, samples };
}

/** Same forward-mercator formula as globeProject.ts's `lonLatToMercator`, but named locally to make explicit that `lon` here is an UNWRAPPED, already-continuous longitude (may be outside (-180,180]) -- this function must not re-wrap it. */
function lonLatToMercatorUnwrapped(lonDeg: number, latDeg: number): { x: number; y: number } {
  return lonLatToMercator(lonDeg, latDeg);
}

/** One vertex ready to be written into a slot -- see trailWriter.ts. `dynamic = true` means "recompute ECEF from mercX/mercY in the shader every frame" (this frame's freshly-interpolated head/tail); `dynamic = false` means "aEcef below is precomputed and stable" (an interior sample straight from the leg's cache, per Step 4). */
export interface TrailVertex {
  mercX: number;
  mercY: number;
  ecefX: number;
  ecefY: number;
  ecefZ: number;
  dynamic: boolean;
  /** 0 = oldest (tail), 1 = newest (head) -- fade-shader input, matches plan-art's `progress` attribute. */
  progress: number;
}

export interface WindowSlice {
  vertices: TrailVertex[];
}

/**
 * The per-frame read side of a leg: slices `leg.samples` down to the
 * trailing `TRAIL_WINDOW_SEC` ending at `time`, returns `null` if fewer
 * than 2 vertices would result (nothing worth drawing yet -- mirrors
 * plan-art's `count < 2` early return).
 *
 * Binary-searches for the window bounds (same structure as
 * `BatchedTrails.writeTrail`'s two binary searches), then:
 *   - if the window's trailing edge (`time - TRAIL_WINDOW_SEC`) falls
 *     strictly between two cached samples, LERPS a tail vertex between them
 *     directly in mercator space (`dynamic: true` -- no cached ECEF for an
 *     interpolated point that exists only this frame).
 *   - copies every cached sample inside the window verbatim (`dynamic:
 *     false` -- Step 4's "straight array copy", zero trig).
 *   - if `time` is past the leg's last cached sample (the overwhelmingly
 *     common case mid-leg), LERPS a head vertex the same way.
 *
 * Returns `null` (not an empty array) when there is nothing to draw, so a
 * caller (trajectoryScene.ts) can tell "leg hasn't started" / "leg is a
 * single instant" apart from "leg produced zero vertices due to a bug" at a
 * glance -- same shape decision `TrailRingBuffer`'s callers make in
 * examples/04-moving-trajectory.
 */
export function sliceWindow(leg: Leg, time: number, windowSec: number = TRAIL_WINDOW_SEC): WindowSlice | null {
  const samples = leg.samples;
  const n = samples.length;
  if (n === 0 || time < leg.startTime) return null;

  const cutoff = time - windowSec;

  // startIdx = first index with t >= cutoff.
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid]!.t < cutoff) lo = mid + 1;
    else hi = mid;
  }
  let startIdx = lo;

  // endIdx = last index with t <= time.
  lo = startIdx;
  hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid]!.t <= time) lo = mid + 1;
    else hi = mid;
  }
  const endIdx = lo - 1;

  const hasTail = startIdx > 0 && startIdx < n; // cutoff strictly between two cached samples
  const origCount = Math.max(0, endIdx - startIdx + 1);
  const lastT = origCount > 0 ? samples[endIdx]!.t : hasTail ? cutoff : -Infinity;
  const hasHead = (hasTail || origCount > 0) && time > lastT;

  const count = (hasTail ? 1 : 0) + origCount + (hasHead ? 1 : 0);
  if (count < 2) return null;

  const t0 = hasTail ? cutoff : samples[startIdx]!.t;
  const tEnd = hasHead ? time : samples[endIdx]!.t;
  const tRange = tEnd - t0;
  const inv = tRange > 0 ? 1 / tRange : 0;

  const vertices: TrailVertex[] = [];

  if (hasTail) {
    const a = samples[startIdx - 1]!;
    const b = samples[startIdx]!;
    const r = (cutoff - a.t) / (b.t - a.t);
    vertices.push({
      mercX: a.mercX + (b.mercX - a.mercX) * r,
      mercY: a.mercY + (b.mercY - a.mercY) * r,
      ecefX: 0,
      ecefY: 0,
      ecefZ: 0, // unused when dynamic -- shader derives ECEF from mercX/mercY every frame
      dynamic: true,
      progress: tRange > 0 ? 0 : 1,
    });
  }

  for (let i = startIdx; i <= endIdx; i++) {
    const s = samples[i]!;
    vertices.push({
      mercX: s.mercX,
      mercY: s.mercY,
      ecefX: s.ecefX,
      ecefY: s.ecefY,
      ecefZ: s.ecefZ,
      dynamic: false,
      progress: tRange > 0 ? (s.t - t0) * inv : 1,
    });
  }

  if (hasHead) {
    let mercX: number;
    let mercY: number;
    if (endIdx < n - 1) {
      const a = samples[endIdx]!;
      const b = samples[endIdx + 1]!;
      const r = (time - a.t) / (b.t - a.t);
      mercX = a.mercX + (b.mercX - a.mercX) * r;
      mercY = a.mercY + (b.mercY - a.mercY) * r;
    } else {
      // time is at or past the leg's final sample -- clamp to it.
      const p = samples[n - 1]!;
      mercX = p.mercX;
      mercY = p.mercY;
    }
    vertices.push({ mercX, mercY, ecefX: 0, ecefY: 0, ecefZ: 0, dynamic: true, progress: 1 });
  }

  return { vertices };
}
