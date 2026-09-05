import { describe, expect, it } from "vitest";
import { ParticleTrailBuffer } from "./particleTrailBuffer";

function collect(buf: ParticleTrailBuffer, particle: number): Array<{ age: number; lon: number; lat: number }> {
  const out: Array<{ age: number; lon: number; lat: number }> = [];
  buf.forEachAgeOrdered(particle, (age, lon, lat) => out.push({ age, lon, lat }));
  return out;
}

describe("ParticleTrailBuffer", () => {
  it("reports 0 live samples before anything is pushed", () => {
    const buf = new ParticleTrailBuffer(4, 3);
    expect(buf.liveCount(0)).toBe(0);
    expect(collect(buf, 0)).toEqual([]);
  });

  it("grows liveCount by one per push until capacity, then stops growing", () => {
    const buf = new ParticleTrailBuffer(1, 3);
    buf.push(0, 1, 1, 1, 1);
    expect(buf.liveCount(0)).toBe(1);
    buf.push(0, 2, 2, 2, 2);
    expect(buf.liveCount(0)).toBe(2);
    buf.push(0, 3, 3, 3, 3);
    expect(buf.liveCount(0)).toBe(3);
    buf.push(0, 4, 4, 4, 4); // capacity is 3 -- this overwrites, not grows
    expect(buf.liveCount(0)).toBe(3);
  });

  it("orders samples from newest (age 0) to oldest, before the buffer wraps", () => {
    const buf = new ParticleTrailBuffer(1, 5);
    buf.push(0, 10, 0, 0, 0);
    buf.push(0, 20, 0, 0, 0);
    buf.push(0, 30, 0, 0, 0);
    const samples = collect(buf, 0);
    expect(samples.map((s) => s.lon)).toEqual([30, 20, 10]); // newest first
    expect(samples.map((s) => s.age)).toEqual([0, 1, 2]);
  });

  it("overwrites only the single oldest slot on each push once full, never the newest", () => {
    const buf = new ParticleTrailBuffer(1, 3);
    buf.push(0, 1, 0, 0, 0);
    buf.push(0, 2, 0, 0, 0);
    buf.push(0, 3, 0, 0, 0); // full: [1, 2, 3]
    buf.push(0, 4, 0, 0, 0); // overwrites the "1" slot -> [4, 2, 3] logically
    const lons = collect(buf, 0).map((s) => s.lon);
    expect(lons).toEqual([4, 3, 2]); // newest (4) first, oldest surviving (2) last
    expect(lons).not.toContain(1); // the actual oldest value is gone
  });

  it("keeps writes to one particle independent of another", () => {
    const buf = new ParticleTrailBuffer(2, 3);
    buf.push(0, 100, 0, 0, 0);
    buf.push(1, 200, 0, 0, 0);
    buf.push(0, 101, 0, 0, 0);
    expect(collect(buf, 0).map((s) => s.lon)).toEqual([101, 100]);
    expect(collect(buf, 1).map((s) => s.lon)).toEqual([200]);
  });

  it("caches mercator coordinates alongside lon/lat at push time, unchanged on later reads", () => {
    const buf = new ParticleTrailBuffer(1, 2);
    buf.push(0, 12, 34, 0.5321, 0.1234);
    const [sample] = collect(buf, 0);
    // collect() above doesn't surface mercX/mercY -- read directly via forEachAgeOrdered.
    let seenMercX = 0;
    let seenMercY = 0;
    buf.forEachAgeOrdered(0, (_age, _lon, _lat, mercX, mercY) => {
      seenMercX = mercX;
      seenMercY = mercY;
    });
    expect(sample.lon).toBe(12);
    expect(seenMercX).toBeCloseTo(0.5321, 5);
    expect(seenMercY).toBeCloseTo(0.1234, 5);
  });

  it("resetParticle clears live samples and restarts the write head, without touching other particles", () => {
    const buf = new ParticleTrailBuffer(2, 3);
    buf.push(0, 1, 0, 0, 0);
    buf.push(0, 2, 0, 0, 0);
    buf.push(1, 9, 0, 0, 0);
    buf.resetParticle(0);
    expect(buf.liveCount(0)).toBe(0);
    expect(collect(buf, 0)).toEqual([]);
    expect(buf.liveCount(1)).toBe(1); // untouched

    buf.push(0, 42, 0, 0, 0);
    expect(collect(buf, 0).map((s) => s.lon)).toEqual([42]);
  });

  it("handles a trailLength of exactly 2 (the minimum) without off-by-one errors", () => {
    const buf = new ParticleTrailBuffer(1, 2);
    buf.push(0, 1, 0, 0, 0);
    buf.push(0, 2, 0, 0, 0);
    buf.push(0, 3, 0, 0, 0); // overwrites the "1"
    expect(collect(buf, 0).map((s) => s.lon)).toEqual([3, 2]);
  });

  it("rejects a capacity or trail length below the minimum", () => {
    expect(() => new ParticleTrailBuffer(0, 3)).toThrow();
    expect(() => new ParticleTrailBuffer(1, 1)).toThrow();
  });
});
