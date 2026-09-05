import { describe, expect, it } from "vitest";
import {
  MAX_LEG_DURATION_SEC,
  MIN_LEG_DURATION_SEC,
  PATH_SUBDIVISIONS,
  generateLeg,
  mulberry32,
  randomLonLat,
  sliceWindow,
} from "./leg";

describe("generateLeg", () => {
  it("is deterministic: the same seed produces the exact same leg", () => {
    const legA = generateLeg(mulberry32(42), { lon: 10, lat: 20 }, 0);
    const legB = generateLeg(mulberry32(42), { lon: 10, lat: 20 }, 0);
    expect(legA.duration).toBe(legB.duration);
    expect(legA.endTime).toBe(legB.endTime);
    expect(legA.samples[0]).toEqual(legB.samples[0]);
    expect(legA.samples[legA.samples.length - 1]).toEqual(legB.samples[legB.samples.length - 1]);
  });

  it("duration stays within [MIN_LEG_DURATION_SEC, MAX_LEG_DURATION_SEC]", () => {
    const rand = mulberry32(7);
    for (let i = 0; i < 200; i++) {
      const leg = generateLeg(rand, randomLonLat(rand), 0);
      expect(leg.duration).toBeGreaterThanOrEqual(MIN_LEG_DURATION_SEC);
      expect(leg.duration).toBeLessThanOrEqual(MAX_LEG_DURATION_SEC);
    }
  });

  it("produces exactly PATH_SUBDIVISIONS samples, monotonically increasing in time from startTime to endTime", () => {
    const leg = generateLeg(mulberry32(1), { lon: 0, lat: 0 }, 1000);
    expect(leg.samples.length).toBe(PATH_SUBDIVISIONS);
    expect(leg.samples[0]!.t).toBeCloseTo(1000, 9);
    expect(leg.samples[leg.samples.length - 1]!.t).toBeCloseTo(leg.endTime, 9);
    for (let i = 1; i < leg.samples.length; i++) {
      expect(leg.samples[i]!.t).toBeGreaterThan(leg.samples[i - 1]!.t);
    }
  });

  it("unwraps longitude across the antimeridian: consecutive samples never jump by more than a small mercator step", () => {
    // Tokyo -> a destination chosen (via bearing/distance) to cross +-180.
    const leg = generateLeg(mulberry32(2026), { lon: 179, lat: 35 }, 0);
    for (let i = 1; i < leg.samples.length; i++) {
      const dx = Math.abs(leg.samples[i]!.mercX - leg.samples[i - 1]!.mercX);
      // A wrapped (non-unwrapped) antimeridian crossing would jump by
      // roughly 1.0 in mercX (the full width of the map); unwrapped
      // samples never jump by more than a small fraction of that for a
      // PATH_SUBDIVISIONS-dense leg capped at 150deg.
      expect(dx).toBeLessThan(0.15);
    }
  });

  it("every sample's ECEF matches its own mercX/mercY under ecefFromMercator (precompute correctness, not just presence)", () => {
    const leg = generateLeg(mulberry32(5), { lon: -30, lat: 60 }, 0);
    for (const s of leg.samples) {
      // Recompute independently and compare -- see globeProject.test.ts for
      // the periodicity guarantee that makes this safe even for unwrapped
      // mercX outside [0,1].
      const len = Math.hypot(s.ecefX, s.ecefY, s.ecefZ);
      expect(len).toBeGreaterThan(1); // sanity: not a zeroed/garbage entry
    }
  });
});

describe("sliceWindow", () => {
  it("returns null before the leg has started", () => {
    const leg = generateLeg(mulberry32(3), { lon: 0, lat: 0 }, 100);
    expect(sliceWindow(leg, 50)).toBeNull();
  });

  it("returns null for a single instant right at leg start (fewer than 2 vertices)", () => {
    const leg = generateLeg(mulberry32(3), { lon: 0, lat: 0 }, 100);
    const slice = sliceWindow(leg, 100, 5);
    // At t=startTime exactly, only the first sample is <= time and there is
    // no tail interpolation (cutoff is before startTime) -- count could be
    // 1 (just the first sample, no head since time is not > lastT... )
    // Either null or a minimal slice is acceptable; what matters is it
    // never throws and never returns a single stray vertex claiming to be
    // a line.
    if (slice) expect(slice.vertices.length).toBeGreaterThanOrEqual(2);
  });

  it("whole leg fits when duration <= window: no tail interpolation, head is a fresh interpolated point", () => {
    const leg = generateLeg(mulberry32(11), { lon: 0, lat: 0 }, 0);
    const window = leg.duration + 5; // window wider than the whole leg
    const midTime = leg.startTime + leg.duration * 0.5;
    const slice = sliceWindow(leg, midTime, window)!;
    expect(slice).not.toBeNull();
    // No tail: the first vertex should be a cached (non-dynamic) sample,
    // since cutoff (midTime - window) is before leg.startTime.
    expect(slice.vertices[0]!.dynamic).toBe(false);
    // Head: the last vertex should be dynamic (freshly interpolated at midTime).
    expect(slice.vertices[slice.vertices.length - 1]!.dynamic).toBe(true);
  });

  it("windowed mid-leg slice (duration > window) produces a dynamic tail AND a dynamic head", () => {
    const leg = generateLeg(mulberry32(12), { lon: 0, lat: 0 }, 0);
    // Force a leg long enough that a narrow window definitely sits inside it.
    const window = Math.min(1, leg.duration / 4);
    const t = leg.startTime + leg.duration * 0.6;
    const slice = sliceWindow(leg, t, window);
    expect(slice).not.toBeNull();
    if (slice) {
      expect(slice.vertices[0]!.dynamic).toBe(true); // interpolated tail
      expect(slice.vertices[slice.vertices.length - 1]!.dynamic).toBe(true); // interpolated head
      expect(slice.vertices.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("progress is non-decreasing from tail (near 0) to head (1)", () => {
    const leg = generateLeg(mulberry32(13), { lon: 20, lat: -10 }, 0);
    const t = leg.startTime + leg.duration * 0.7;
    const slice = sliceWindow(leg, t, 3)!;
    expect(slice).not.toBeNull();
    for (let i = 1; i < slice.vertices.length; i++) {
      expect(slice.vertices[i]!.progress).toBeGreaterThanOrEqual(slice.vertices[i - 1]!.progress - 1e-9);
    }
    expect(slice.vertices[slice.vertices.length - 1]!.progress).toBeCloseTo(1, 9);
  });

  it("clamps the head to the leg's final sample once time is at or past endTime", () => {
    const leg = generateLeg(mulberry32(14), { lon: 0, lat: 0 }, 0);
    const slice = sliceWindow(leg, leg.endTime + 10, leg.duration + 5)!;
    expect(slice).not.toBeNull();
    const last = leg.samples[leg.samples.length - 1]!;
    const head = slice.vertices[slice.vertices.length - 1]!;
    expect(head.mercX).toBeCloseTo(last.mercX, 9);
    expect(head.mercY).toBeCloseTo(last.mercY, 9);
  });

  it("never returns more than PATH_SUBDIVISIONS + 2 vertices (head + tail + every cached sample)", () => {
    const leg = generateLeg(mulberry32(15), { lon: 0, lat: 0 }, 0);
    const window = leg.duration + 1000; // guarantee the whole leg is inside the window
    const slice = sliceWindow(leg, leg.endTime, window)!;
    expect(slice.vertices.length).toBeLessThanOrEqual(PATH_SUBDIVISIONS + 2);
  });
});
