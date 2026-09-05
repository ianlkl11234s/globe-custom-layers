import { describe, expect, it } from "vitest";
import { destinationPoint, fromUnitVector, sampleGreatCirclePath, toUnitVector, type LonLat } from "./greatCircle";

function closeTo(a: number, b: number, eps = 1e-9) {
  expect(Math.abs(a - b)).toBeLessThan(eps);
}

describe("toUnitVector / fromUnitVector round trip", () => {
  it("recovers lon/lat across a latitude range, exactly at the poles' neighbourhood", () => {
    for (let lat = -89; lat <= 89; lat += 7) {
      for (let lon = -179; lon <= 179; lon += 41) {
        const v = toUnitVector({ lon, lat });
        const back = fromUnitVector(v);
        closeTo(back.lon, lon, 1e-6);
        closeTo(back.lat, lat, 1e-6);
      }
    }
  });

  it("unit vectors have length 1", () => {
    const v = toUnitVector({ lon: 123.4, lat: -45.6 });
    closeTo(Math.hypot(v.x, v.y, v.z), 1, 1e-12);
  });
});

describe("sampleGreatCirclePath", () => {
  it("first and last samples match the endpoints exactly", () => {
    const a: LonLat = { lon: -122.4, lat: 37.8 }; // San Francisco
    const b: LonLat = { lon: 139.7, lat: 35.7 }; // Tokyo
    const path = sampleGreatCirclePath(a, b, 48);
    const first = fromUnitVector(path[0]!);
    const last = fromUnitVector(path[path.length - 1]!);
    closeTo(first.lon, a.lon, 1e-6);
    closeTo(first.lat, a.lat, 1e-6);
    closeTo(last.lon, b.lon, 1e-6);
    closeTo(last.lat, b.lat, 1e-6);
  });

  it("stays on the unit sphere at every sample", () => {
    const path = sampleGreatCirclePath({ lon: 0, lat: 0 }, { lon: 90, lat: 45 }, 32);
    for (const p of path) closeTo(Math.hypot(p.x, p.y, p.z), 1, 1e-9);
  });

  it("an antimeridian-crossing route has no discontinuity in consecutive unit-vector samples", () => {
    // Tokyo -> Los Angeles crosses +-180 the short way round.
    const path = sampleGreatCirclePath({ lon: 139.7, lat: 35.7 }, { lon: -118.2, lat: 34.0 }, 64);
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1]!;
      const b = path[i]!;
      const step = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      // Adjacent unit-vector samples on a 64-sample dense path should never
      // jump by more than a small chord -- a naive lon/lat lerp would
      // instead produce one huge jump right at the antimeridian.
      expect(step).toBeLessThan(0.2);
    }
  });

  it("throws for fewer than 2 samples", () => {
    expect(() => sampleGreatCirclePath({ lon: 0, lat: 0 }, { lon: 1, lat: 1 }, 1)).toThrow();
  });
});

describe("destinationPoint", () => {
  it("travelling 0 degrees returns the start point", () => {
    const start: LonLat = { lon: 10, lat: 20 };
    const end = destinationPoint(start, 45, 0);
    closeTo(end.lon, start.lon, 1e-9);
    closeTo(end.lat, start.lat, 1e-9);
  });

  it("bearing 0 (due north) increases latitude and keeps longitude", () => {
    const end = destinationPoint({ lon: 0, lat: 0 }, 0, 10);
    closeTo(end.lon, 0, 1e-6);
    closeTo(end.lat, 10, 1e-6);
  });

  it("keeps longitude within (-180, 180]", () => {
    const end = destinationPoint({ lon: 170, lat: 10 }, 90, 30);
    expect(end.lon).toBeGreaterThan(-180);
    expect(end.lon).toBeLessThanOrEqual(180);
  });
});
