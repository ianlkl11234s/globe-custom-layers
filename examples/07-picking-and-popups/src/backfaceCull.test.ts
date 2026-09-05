import { describe, expect, it } from "vitest";
import { frontFacingDot, isFrontFacing } from "./backfaceCull";
import { GLOBE_RADIUS, lonLatToEcef } from "./globeProject";
import type { Vec3 } from "./globeProject";

describe("frontFacingDot", () => {
  it("is +1 when the camera sits straight out along the point's own normal", () => {
    const point: Vec3 = { x: GLOBE_RADIUS, y: 0, z: 0 };
    const camera: Vec3 = { x: 10 * GLOBE_RADIUS, y: 0, z: 0 };
    expect(frontFacingDot(point, camera)).toBeCloseTo(1, 9);
  });

  it("is -1 when the camera sits on the exact opposite side of the sphere", () => {
    const point: Vec3 = { x: GLOBE_RADIUS, y: 0, z: 0 };
    const camera: Vec3 = { x: -10 * GLOBE_RADIUS, y: 0, z: 0 };
    expect(frontFacingDot(point, camera)).toBeCloseTo(-1, 9);
  });

  it("is exactly 0 at the true horizon (camera-to-point direction perpendicular to the surface normal)", () => {
    // Point on the +x axis (normal = (1,0,0)). Placing the camera at
    // (R, D, 0) for any D > 0 makes (camera - point) = (0, D, 0), which is
    // exactly perpendicular to the point's normal -- the textbook horizon
    // case, constructed algebraically rather than by trial and error.
    const point: Vec3 = { x: GLOBE_RADIUS, y: 0, z: 0 };
    const camera: Vec3 = { x: GLOBE_RADIUS, y: 5000, z: 0 };
    expect(frontFacingDot(point, camera)).toBeCloseTo(0, 9);
  });

  it("stays in [-1, 1] for a spread of real lon/lat points against a fixed distant camera", () => {
    const camera: Vec3 = { x: 0, y: 0, z: 10 * GLOBE_RADIUS };
    const samples: Array<[number, number]> = [
      [0, 0],
      [45, 45],
      [-73.5, 40.7],
      [139.767, 35.681],
      [18.42, -33.92],
      [0, 89.9],
      [0, -89.9],
      [180, 0],
      [-180, 0],
    ];
    for (const [lon, lat] of samples) {
      const d = frontFacingDot(lonLatToEcef(lon, lat, 0), camera);
      expect(d).toBeGreaterThanOrEqual(-1 - 1e-9);
      expect(d).toBeLessThanOrEqual(1 + 1e-9);
    }
    // And the point directly facing this camera (lon=0, lat=0, since the
    // camera sits on +z, matching lonLatToEcef(0,0)'s +z axis) should be the
    // most front-facing of the batch.
    const dFacing = frontFacingDot(lonLatToEcef(0, 0, 0), camera);
    for (const [lon, lat] of samples) {
      if (lon === 0 && lat === 0) continue;
      expect(dFacing).toBeGreaterThanOrEqual(frontFacingDot(lonLatToEcef(lon, lat, 0), camera) - 1e-9);
    }
  });
});

describe("isFrontFacing", () => {
  it("is true for a point facing the camera", () => {
    const point: Vec3 = { x: GLOBE_RADIUS, y: 0, z: 0 };
    const camera: Vec3 = { x: 10 * GLOBE_RADIUS, y: 0, z: 0 };
    expect(isFrontFacing(point, camera)).toBe(true);
  });

  it("is false for a point facing away from the camera", () => {
    const point: Vec3 = { x: GLOBE_RADIUS, y: 0, z: 0 };
    const camera: Vec3 = { x: -10 * GLOBE_RADIUS, y: 0, z: 0 };
    expect(isFrontFacing(point, camera)).toBe(false);
  });

  it("is true (inclusive) exactly at the horizon, dot === 0 -- documented boundary behavior", () => {
    const point: Vec3 = { x: GLOBE_RADIUS, y: 0, z: 0 };
    const camera: Vec3 = { x: GLOBE_RADIUS, y: 5000, z: 0 };
    expect(frontFacingDot(point, camera)).toBeCloseTo(0, 9);
    expect(isFrontFacing(point, camera)).toBe(true);
  });

  it("flips from true to false as the camera sweeps past the horizon", () => {
    const point: Vec3 = { x: GLOBE_RADIUS, y: 0, z: 0 };
    // Camera positions sweeping the angle between "facing" and "away",
    // holding distance from the point roughly fixed -- the dot product
    // should cross zero exactly once, monotonically.
    const angles = [0, 30, 60, 89, 91, 120, 150, 180]; // degrees, 90 = horizon
    const dots = angles.map((deg) => {
      const rad = (deg * Math.PI) / 180;
      // Camera placed on a circle around the point's tangent plane, at a
      // fixed large radius, parameterized so 0deg = dead-on facing and
      // 180deg = dead-on away.
      const camera: Vec3 = {
        x: point.x + Math.cos(rad) * 10 * GLOBE_RADIUS,
        y: Math.sin(rad) * 10 * GLOBE_RADIUS,
        z: 0,
      };
      return frontFacingDot(point, camera);
    });
    for (let i = 1; i < dots.length; i++) {
      expect(dots[i]!).toBeLessThanOrEqual(dots[i - 1]! + 1e-9);
    }
    expect(dots[0]!).toBeGreaterThan(0);
    expect(dots[dots.length - 1]!).toBeLessThan(0);
  });
});
