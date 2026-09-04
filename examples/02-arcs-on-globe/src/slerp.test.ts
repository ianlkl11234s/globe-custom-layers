import { describe, expect, it } from "vitest";
import { lonLatToUnitVector, slerpUnitVectors, slerpLonLat, unwrapLongitude, type LonLat } from "./slerp";
import { lonLatToEcef, GLOBE_RADIUS, type Vec3 } from "./globeProject";

function length(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

describe("slerpLonLat endpoints", () => {
  const taipei: LonLat = { lon: 121.5, lat: 25.0 };
  const losAngeles: LonLat = { lon: -118.2, lat: 33.9 };

  it("t=0 returns the origin", () => {
    const p = slerpLonLat(taipei, losAngeles, 0);
    expect(p.lon).toBeCloseTo(taipei.lon, 6);
    expect(p.lat).toBeCloseTo(taipei.lat, 6);
  });

  it("t=1 returns the destination", () => {
    const p = slerpLonLat(taipei, losAngeles, 1);
    expect(p.lon).toBeCloseTo(losAngeles.lon, 6);
    expect(p.lat).toBeCloseTo(losAngeles.lat, 6);
  });

  it("endpoints hold for a second, unrelated pair too (poles)", () => {
    const north: LonLat = { lon: 0, lat: 90 };
    const south: LonLat = { lon: 0, lat: -90 };
    expect(slerpLonLat(north, south, 0).lat).toBeCloseTo(90, 6);
    expect(slerpLonLat(north, south, 1).lat).toBeCloseTo(-90, 6);
  });
});

describe("slerp stays on the sphere", () => {
  it("slerpUnitVectors output has unit length across a range of t", () => {
    const a = lonLatToUnitVector(-73.5, 40.7); // New York
    const b = lonLatToUnitVector(139.767, 35.681); // Tokyo
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const v = slerpUnitVectors(a, b, t);
      expect(length(v)).toBeCloseTo(1, 9);
    }
  });

  it("lonLatToEcef(slerpLonLat(...), 0) lands exactly on the sphere of radius GLOBE_RADIUS", () => {
    // Ties slerp's output format directly into the render pipeline's own
    // invariant (see globeProject.test.ts's equivalent check on lonLatToEcef
    // itself) -- this is the "midpoint is on the sphere" property the spec
    // asks for, expressed through the actual function boundary this example
    // uses it through.
    const pairs: Array<[LonLat, LonLat]> = [
      [{ lon: 0, lat: 0 }, { lon: 90, lat: 45 }],
      [{ lon: 121.5, lat: 25.0 }, { lon: -118.2, lat: 33.9 }],
      [{ lon: 18.42, lat: -33.92 }, { lon: 151.177, lat: -33.9461 }], // Cape Town -> Sydney
    ];
    for (const [a, b] of pairs) {
      for (let i = 0; i <= 4; i++) {
        const t = i / 4;
        const mid = slerpLonLat(a, b, t);
        const ecef = lonLatToEcef(mid.lon, mid.lat, 0);
        expect(length(ecef)).toBeCloseTo(GLOBE_RADIUS, 6);
      }
    }
  });
});

describe("antipodal points do not produce NaN", () => {
  it("north pole -> south pole (exact antipodes) stays finite at every t", () => {
    const north: LonLat = { lon: 0, lat: 90 };
    const south: LonLat = { lon: 0, lat: -90 };
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const p = slerpLonLat(north, south, t);
      expect(Number.isFinite(p.lon)).toBe(true);
      expect(Number.isFinite(p.lat)).toBe(true);
    }
  });

  it("equatorial antipodes (lon=0 vs lon=180) stay finite at every t", () => {
    const a: LonLat = { lon: 0, lat: 0 };
    const b: LonLat = { lon: 180, lat: 0 };
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const p = slerpLonLat(a, b, t);
      expect(Number.isFinite(p.lon)).toBe(true);
      expect(Number.isFinite(p.lat)).toBe(true);
    }
  });

  it("slerpUnitVectors on exactly-antipodal vectors returns finite, unit-length output at every t", () => {
    const a: Vec3 = { x: 0, y: 0, z: 1 };
    const b: Vec3 = { x: 0, y: 0, z: -1 };
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const v = slerpUnitVectors(a, b, t);
      expect(Number.isNaN(v.x)).toBe(false);
      expect(Number.isNaN(v.y)).toBe(false);
      expect(Number.isNaN(v.z)).toBe(false);
      expect(length(v)).toBeCloseTo(1, 9);
    }
    // Endpoints are still exact even through the antipodal fallback branch.
    expect(slerpUnitVectors(a, b, 0)).toEqual(a);
    const end = slerpUnitVectors(a, b, 1);
    expect(end.x).toBeCloseTo(b.x, 9);
    expect(end.y).toBeCloseTo(b.y, 9);
    expect(end.z).toBeCloseTo(b.z, 9);
  });
});

describe("unwrapLongitude", () => {
  it("leaves a small step unchanged", () => {
    expect(unwrapLongitude(10, 15)).toBeCloseTo(15, 9);
  });

  it("adds 360 when the raw atan2 output jumped backward across the antimeridian", () => {
    // 177 -> -178 raw is a ~355 degree jump; the true angular step is ~5
    // degrees the OTHER way, so the unwrapped value should read ~182 (-178 + 360).
    expect(unwrapLongitude(177, -178)).toBeCloseTo(182, 9);
  });

  it("subtracts 360 when the raw atan2 output jumped forward across the antimeridian", () => {
    expect(unwrapLongitude(-177, 178)).toBeCloseTo(-182, 9);
  });
});
