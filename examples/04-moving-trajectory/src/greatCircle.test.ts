import { describe, expect, it } from "vitest";
import { fromUnitVector, sampleGreatCirclePath, samplePathAtPhase, slerp, toUnitVector, type Vec3 } from "./greatCircle";

function length(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

describe("sampleGreatCirclePath: slerp-sampled path endpoints", () => {
  it("the first sample equals the start point", () => {
    const a = { lon: -73.5, lat: 40.7 }; // New York
    const b = { lon: 139.767, lat: 35.681 }; // Tokyo
    const path = sampleGreatCirclePath(a, b, 64);
    const first = path[0]!;
    const expected = toUnitVector(a);
    expect(first.x).toBeCloseTo(expected.x, 9);
    expect(first.y).toBeCloseTo(expected.y, 9);
    expect(first.z).toBeCloseTo(expected.z, 9);
  });

  it("the last sample equals the end point", () => {
    const a = { lon: -73.5, lat: 40.7 };
    const b = { lon: 139.767, lat: 35.681 };
    const path = sampleGreatCirclePath(a, b, 64);
    const last = path[path.length - 1]!;
    const expected = toUnitVector(b);
    expect(last.x).toBeCloseTo(expected.x, 9);
    expect(last.y).toBeCloseTo(expected.y, 9);
    expect(last.z).toBeCloseTo(expected.z, 9);
  });

  it("every sample lies on the unit sphere", () => {
    const path = sampleGreatCirclePath({ lon: 10, lat: -20 }, { lon: -160, lat: 50 }, 32);
    for (const p of path) {
      expect(length(p)).toBeCloseTo(1, 9);
    }
  });

  it("handles an antimeridian-crossing route without a discontinuity (no lon/lat lerp involved)", () => {
    // Tokyo -> Los Angeles: the short way crosses the 180 deg line.
    const a = { lon: 139.767, lat: 35.681 };
    const b = { lon: -118.24, lat: 34.05 };
    const path = sampleGreatCirclePath(a, b, 128);
    // Consecutive samples should never jump by more than a small angle --
    // a lon/lat-lerp bug would show up here as one huge jump near the seam.
    for (let i = 1; i < path.length; i++) {
      const p0 = path[i - 1]!;
      const p1 = path[i]!;
      const cosAngle = p0.x * p1.x + p0.y * p1.y + p0.z * p1.z;
      expect(cosAngle).toBeGreaterThan(0.99); // small angle between consecutive samples
    }
  });
});

describe("slerp", () => {
  it("t=0 returns a, t=1 returns b", () => {
    const a = toUnitVector({ lon: 0, lat: 0 });
    const b = toUnitVector({ lon: 90, lat: 30 });
    const r0 = slerp(a, b, 0);
    const r1 = slerp(a, b, 1);
    expect(r0).toEqual(a);
    expect(r1).toEqual(b);
  });

  it("stays on the unit sphere at every t", () => {
    const a = toUnitVector({ lon: -40, lat: 10 });
    const b = toUnitVector({ lon: 170, lat: -60 });
    for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      expect(length(slerp(a, b, t))).toBeCloseTo(1, 9);
    }
  });

  it("does not produce NaN for near-identical endpoints (the sin(omega)=0 edge case)", () => {
    const a = toUnitVector({ lon: 12.3, lat: 45.6 });
    const b = toUnitVector({ lon: 12.3, lat: 45.6 });
    const r = slerp(a, b, 0.5);
    expect(Number.isFinite(r.x)).toBe(true);
    expect(Number.isFinite(r.y)).toBe(true);
    expect(Number.isFinite(r.z)).toBe(true);
  });

  it("does not produce NaN for near-antipodal endpoints", () => {
    // Only ~0.0001 deg short of exactly antipodal -- an inherently
    // ill-conditioned input (the true great-circle direction between exactly
    // antipodal points is undefined), so this only asserts "stays finite and
    // roughly unit-length", not slerp's usual tight precision.
    const a = toUnitVector({ lon: 0, lat: 0 });
    const b = toUnitVector({ lon: 179.9999, lat: -0.0001 });
    const r = slerp(a, b, 0.5);
    expect(Number.isFinite(r.x)).toBe(true);
    expect(Number.isFinite(r.y)).toBe(true);
    expect(Number.isFinite(r.z)).toBe(true);
    expect(length(r)).toBeCloseTo(1, 2);
  });
});

describe("toUnitVector / fromUnitVector round trip", () => {
  it("round-trips a handful of lon/lat points", () => {
    const points = [
      { lon: 0, lat: 0 },
      { lon: 45, lat: 45 },
      { lon: -73.5, lat: 40.7 },
      { lon: 139.767, lat: 35.681 },
      { lon: -179, lat: -10 },
    ];
    for (const p of points) {
      const back = fromUnitVector(toUnitVector(p));
      expect(back.lon).toBeCloseTo(p.lon, 9);
      expect(back.lat).toBeCloseTo(p.lat, 9);
    }
  });
});

describe("samplePathAtPhase", () => {
  const path = sampleGreatCirclePath({ lon: -73.5, lat: 40.7 }, { lon: 139.767, lat: 35.681 }, 64);

  it("phase=0 matches the path start, phase=1 matches the path end", () => {
    const start = samplePathAtPhase(path, 0);
    const end = samplePathAtPhase(path, 1);
    expect(start.x).toBeCloseTo(path[0]!.x, 6);
    expect(end.x).toBeCloseTo(path[path.length - 1]!.x, 6);
  });

  it("is a pure function: same phase always returns the same vector", () => {
    const r1 = samplePathAtPhase(path, 0.37);
    const r2 = samplePathAtPhase(path, 0.37);
    expect(r1).toEqual(r2);
  });

  it("stays on the unit sphere for interior phases", () => {
    for (const phase of [0.1, 0.33, 0.5, 0.66, 0.9]) {
      expect(length(samplePathAtPhase(path, phase))).toBeCloseTo(1, 6);
    }
  });
});
