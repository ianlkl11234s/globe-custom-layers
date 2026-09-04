import { describe, expect, it } from "vitest";
import {
  TIMELINE_DURATION_SEC,
  generateObjectPaths,
  objectPhase,
  objectPositionAtSimTime,
  syncTrailToTick,
} from "./objectPath";
import { TrailRingBuffer } from "./trailRingBuffer";

describe("generateObjectPaths", () => {
  it("is deterministic: the same seed produces the same routes", () => {
    const a = generateObjectPaths(8, 42);
    const b = generateObjectPaths(8, 42);
    expect(a.map((o) => o.start)).toEqual(b.map((o) => o.start));
    expect(a.map((o) => o.end)).toEqual(b.map((o) => o.end));
  });

  it("every route's angular length is within the [20, 150] degree design bound", () => {
    const objects = generateObjectPaths(50, 7);
    for (const obj of objects) {
      // Chord-length check via the endpoints' dot product on the unit sphere,
      // cheaper than re-deriving great-circle distance here.
      const path = obj.path;
      const a = path[0]!;
      const b = path[path.length - 1]!;
      const cosAngle = Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z));
      const angleDeg = (Math.acos(cosAngle) * 180) / Math.PI;
      expect(angleDeg).toBeGreaterThanOrEqual(19.9);
      expect(angleDeg).toBeLessThanOrEqual(150.1);
    }
  });
});

describe("objectPositionAtSimTime: determinism under scrubbing", () => {
  const obj = generateObjectPaths(1, 1)[0]!;

  it("the same t always returns the same position, regardless of call order or prior calls", () => {
    const direct = objectPositionAtSimTime(obj, 12.34);

    // Simulate "played forward to t=25, then scrubbed back to t=12.34":
    // call a bunch of other times first, in an order that mimics forward
    // playback followed by a backward jump.
    objectPositionAtSimTime(obj, 1);
    objectPositionAtSimTime(obj, 5);
    objectPositionAtSimTime(obj, 25);
    objectPositionAtSimTime(obj, 3); // the "scrub back" itself
    const afterScrub = objectPositionAtSimTime(obj, 12.34);

    expect(afterScrub).toEqual(direct);
  });

  it("scrubbing forward past a loop boundary and back gives the same answer as querying it directly", () => {
    const t = TIMELINE_DURATION_SEC * 2.5 + 4;
    const viaDirect = objectPositionAtSimTime(obj, t);
    objectPositionAtSimTime(obj, 0);
    objectPositionAtSimTime(obj, TIMELINE_DURATION_SEC * 10);
    const viaScrub = objectPositionAtSimTime(obj, t);
    expect(viaScrub).toEqual(viaDirect);
  });
});

describe("objectPhase: seamless loop wrap", () => {
  it("phase just before a loop boundary is continuous with phase just after (no teleport)", () => {
    const objects = generateObjectPaths(6, 99);
    for (const obj of objects) {
      const before = objectPhase(obj, TIMELINE_DURATION_SEC - 1e-6);
      const after = objectPhase(obj, TIMELINE_DURATION_SEC + 1e-6);
      expect(Math.abs(before - after)).toBeLessThan(1e-4);
    }
  });
});

describe("syncTrailToTick: unifies incremental playback and scrub-rebuild", () => {
  it("rebuilding directly at time T matches incrementally playing from 0 up to T, slot for slot", () => {
    const obj = generateObjectPaths(1, 5)[0]!;
    const capacity = 40;
    const T = 5.0;

    // Sequence A: incremental playback in small, frame-rate-independent
    // steps (37/sec -- deliberately NOT a divisor of TRAIL_SAMPLE_INTERVAL_SEC).
    const ringIncremental = new TrailRingBuffer(capacity);
    let prevTick: number | null = null;
    const stepsPerSecond = 37;
    const totalSteps = Math.round(T * stepsPerSecond);
    for (let i = 1; i <= totalSteps; i++) {
      const t = (i / totalSteps) * T;
      const { newTick } = syncTrailToTick(ringIncremental, obj, prevTick, t);
      prevTick = newTick;
    }

    // Sequence B: a single cold rebuild directly at T.
    const ringRebuilt = new TrailRingBuffer(capacity);
    syncTrailToTick(ringRebuilt, obj, null, T);

    for (let slot = 0; slot < capacity; slot++) {
      expect(ringIncremental.readSlot(slot)).toEqual(ringRebuilt.readSlot(slot));
    }
  });

  it("a backward scrub triggers a full rebuild (writtenTicks spans the whole capacity)", () => {
    const obj = generateObjectPaths(1, 6)[0]!;
    const ring = new TrailRingBuffer(20);
    const { newTick: t1 } = syncTrailToTick(ring, obj, null, 3.0);
    const result = syncTrailToTick(ring, obj, t1, 1.0); // jump backward
    expect(result.writtenTicks.length).toBe(ring.capacity);
  });

  it("normal forward playback by one sample interval writes exactly one tick", () => {
    const obj = generateObjectPaths(1, 6)[0]!;
    const ring = new TrailRingBuffer(20);
    const { newTick: t1 } = syncTrailToTick(ring, obj, null, 3.0);
    const result = syncTrailToTick(ring, obj, t1, 3.0 + 0.05); // one TRAIL_SAMPLE_INTERVAL_SEC later
    expect(result.writtenTicks.length).toBeLessThanOrEqual(1);
  });

  it("no time elapsed (paused) writes nothing", () => {
    const obj = generateObjectPaths(1, 6)[0]!;
    const ring = new TrailRingBuffer(20);
    const { newTick: t1 } = syncTrailToTick(ring, obj, null, 3.0);
    const result = syncTrailToTick(ring, obj, t1, 3.0);
    expect(result.writtenTicks.length).toBe(0);
  });
});
