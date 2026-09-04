/**
 * Procedural route generation, playback phase, and the ring-buffer sync
 * logic that ties a moving object's deterministic position function to its
 * trail's ring buffer. No `three` or `mapbox-gl` import -- pure TS, runs
 * under vitest with no WebGL and no DOM.
 */

import { fromUnitVector, sampleGreatCirclePath, samplePathAtPhase, type LonLat, type Vec3 } from "./greatCircle";
import { lonLatToMercator } from "./globeProject";
import { TrailRingBuffer } from "./trailRingBuffer";

export const MAX_OBJECTS = 50;
/** Dense slerp samples per route -- see greatCircle.ts's module docstring for why this needs to be dense (the "subdivide until segments are short" rule). */
export const PATH_SUBDIVISIONS = 128;
/** One full scrubber loop, 0-100%, in seconds of simulation time at 1x speed. */
export const TIMELINE_DURATION_SEC = 30;
/** How often (in sim seconds) a new trail sample is captured -- 20/sec. Independent of the browser's actual frame rate; see syncTrailToTick's docstring. */
export const TRAIL_SAMPLE_INTERVAL_SEC = 0.05;

// Conjugate of the golden ratio -- gives per-object phase offsets that are
// spread with low discrepancy (no clustering) regardless of object count,
// unlike e.g. `i / count` which clusters unevenly when count changes.
const GOLDEN_CONJ = 0.6180339887498949;

export interface TrajectoryObject {
  start: LonLat;
  end: LonLat;
  path: Vec3[];
  /** MUST be an integer -- see objectPhase's docstring for why. */
  cyclesPerLoop: number;
  phaseOffset: number;
}

/** Deterministic PRNG (mulberry32) -- same seed always produces the same route set, which matters for reproducible screenshots and for keeping this module's output testable. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Wraps any real number into [0, 1). Unlike JS's `%`, this is correct for negative inputs (`mod1(-0.3) === 0.7`), which matters because the scrub-rebuild path samples ticks before t=0. Exported for main.ts's scrubber-position readout (same wrap the phase math already relies on). */
export function mod1(x: number): number {
  return x - Math.floor(x);
}

/** 0 -> 0 -> ... -> 1 (at raw=0.5) -> ... -> 0: a continuous ping-pong wave. */
function triangleWave(raw: number): number {
  return raw < 0.5 ? raw * 2 : 2 - raw * 2;
}

/** Standard spherical "destination point given start, bearing, angular distance" formula. */
function destinationPoint(start: LonLat, bearingDeg: number, angularDistDeg: number): LonLat {
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

/**
 * Deterministically generates `count` great-circle routes -- same seed,
 * same routes, every run. Each route's angular length is constrained to
 * [20, 150] degrees by construction (not rejection sampling): long enough
 * that globe-hugging is visually obvious, short of antipodal (180 deg)
 * where a bearing-based destination becomes degenerate.
 */
export function generateObjectPaths(count: number, seed = 20260904): TrajectoryObject[] {
  const rand = mulberry32(seed);
  const objects: TrajectoryObject[] = [];
  for (let i = 0; i < count; i++) {
    const lat = Math.asin(rand() * 2 - 1) * (180 / Math.PI); // uniform point on the sphere
    const lon = rand() * 360 - 180;
    const start: LonLat = { lon, lat };
    const bearing = rand() * 360;
    const angularDist = 20 + rand() * 130; // [20, 150] deg
    const end = destinationPoint(start, bearing, angularDist);
    objects.push({
      start,
      end,
      path: sampleGreatCirclePath(start, end, PATH_SUBDIVISIONS),
      cyclesPerLoop: 1 + (i % 3), // 1, 2 or 3 -- must stay an integer, see objectPhase
      phaseOffset: mod1(i * GOLDEN_CONJ),
    });
  }
  return objects;
}

/**
 * Ping-pong phase in [0, 1] for one object at a given simulation time.
 *
 * `cyclesPerLoop` MUST be an integer. `simTimeSec / TIMELINE_DURATION_SEC *
 * cyclesPerLoop` then advances by exactly `cyclesPerLoop` -- an integer --
 * every time `simTimeSec` advances by one `TIMELINE_DURATION_SEC`, so
 * `mod1()` of it is bit-for-bit identical just before and just after a
 * multiple of `TIMELINE_DURATION_SEC`. That is what makes the scrubber's
 * 100% -> 0% wrap seamless: the object's position at those two instants is
 * exactly the same point, not just a close one. A non-integer per-object
 * speed multiplier would NOT have this property -- it would still be
 * periodic in *its own* period, but that period generally doesn't divide
 * `TIMELINE_DURATION_SEC` evenly, so the scrubber wrap would show a visible
 * jump for that object.
 */
export function objectPhase(obj: TrajectoryObject, simTimeSec: number): number {
  const raw = mod1((simTimeSec / TIMELINE_DURATION_SEC) * obj.cyclesPerLoop + obj.phaseOffset);
  return triangleWave(raw);
}

/**
 * The one function this whole example's animation is built on: given an
 * object and a simulation time, always returns the same lon/lat. No
 * internal state, no dependency on what time was requested before -- which
 * is exactly what makes dragging the scrubber backward (or to any arbitrary
 * point) safe. See objectPath.test.ts's determinism test.
 */
export function objectPositionAtSimTime(obj: TrajectoryObject, simTimeSec: number): LonLat {
  const phase = objectPhase(obj, simTimeSec);
  return fromUnitVector(samplePathAtPhase(obj.path, phase));
}

export interface TrailSyncResult {
  newTick: number;
  /** Ticks written this call. `writtenTicks.length === ring.capacity` means a full rebuild happened (see trajectoryScene.ts for how the caller turns this into `addUpdateRange` calls). */
  writtenTicks: number[];
}

/**
 * Advances (or rebuilds) one object's trail ring buffer to reflect
 * simulation time `simTimeSec`, given the tick it was last synced to
 * (`null` the first time an object is synced).
 *
 * This is the ONE code path both normal playback and scrubbing go through --
 * unifying them is what makes "scrub back, then resume playing" produce a
 * trail with no seam, and it's what the strongest test in this file
 * (`objectPath.test.ts`, "rebuild matches incremental playback") verifies
 * directly: sample ticks at a fixed interval (`TRAIL_SAMPLE_INTERVAL_SEC`,
 * NOT tied to the browser's frame rate), and:
 *
 *   - 0 ticks crossed: nothing to do.
 *   - a small, positive number of ticks crossed (normal forward playback,
 *     usually exactly 1 per rendered frame): push each crossed tick's
 *     sample individually. This is the incremental path -- see
 *     trajectoryScene.ts for how each individual write becomes one small
 *     `addUpdateRange` call instead of a full buffer re-upload.
 *   - a backward jump (any scrub that moves time earlier) or a forward jump
 *     bigger than the whole buffer (speed turned up high enough, or the
 *     first sync for a newly-activated object): every slot the buffer could
 *     show is about to change anyway, so reset and rebuild the trailing
 *     window of `ring.capacity` ticks ending at the new tick in one pass.
 *
 * Because `TrailRingBuffer.writeAtTick` is a pure function of (tick, value)
 * -- see its docstring -- both branches leave the ring buffer in the exact
 * same final state for the same final tick, regardless of which path got
 * there or how the intermediate ticks were batched.
 */
export function syncTrailToTick(
  ring: TrailRingBuffer,
  obj: TrajectoryObject,
  prevTick: number | null,
  simTimeSec: number,
): TrailSyncResult {
  const newTick = Math.floor(simTimeSec / TRAIL_SAMPLE_INTERVAL_SEC);
  const writtenTicks: number[] = [];

  const sampleAndWrite = (tick: number) => {
    const pos = objectPositionAtSimTime(obj, tick * TRAIL_SAMPLE_INTERVAL_SEC);
    const merc = lonLatToMercator(pos.lon, pos.lat);
    ring.writeAtTick(tick, merc.x, merc.y);
    writtenTicks.push(tick);
  };

  const delta = prevTick === null ? Infinity : newTick - prevTick;

  if (delta === 0) {
    return { newTick, writtenTicks };
  }

  if (delta > 0 && delta <= ring.capacity) {
    for (let tick = prevTick! + 1; tick <= newTick; tick++) sampleAndWrite(tick);
  } else {
    // Backward scrub, or a forward jump bigger than the buffer: every slot
    // is stale relative to the new tick, so start clean rather than leaving
    // "future" ticks (relative to the new, smaller currentTick) sitting in
    // the buffer -- see trajectoryScene.ts's fragment shader, which treats
    // negative age as invisible too, but reset() here means it never has to.
    ring.reset();
    const start = newTick - ring.capacity + 1;
    for (let tick = start; tick <= newTick; tick++) sampleAndWrite(tick);
  }

  return { newTick, writtenTicks };
}
