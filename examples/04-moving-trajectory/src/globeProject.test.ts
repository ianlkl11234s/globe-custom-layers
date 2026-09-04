import { describe, expect, it } from "vitest";
import {
  GLOBE_RADIUS,
  ecefFromMercator,
  lonLatToMercator,
  mercatorToGlobe,
  mercatorToLonLat,
  type Vec3,
} from "./globeProject";

function length(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

describe("inverse Mercator round trip (the core correctness claim of this example)", () => {
  // lon/lat -> lonLatToMercator (forward) -> mercatorToLonLat, whose latitude
  // half is the *exact same formula* GLOBE_PROJECT_MOVING_GLSL uses in the
  // shader (see mercatorYToLatRad's docstring) -> back to lon/lat. Web
  // Mercator is only well-conditioned away from the poles; ±85 deg is the
  // conventional bound (a plain latitude of ±85.051 deg is where Mercator's
  // y already reaches [0,1]'s edges), which is also the range this example
  // actually samples object routes from.
  const lats = [-85, -60, -30, -10, -1, 0, 1, 10, 30, 45, 60, 75, 85];
  const lons = [-179.5, -120, -73.5, -0.001, 0, 0.001, 45, 90, 139.767, 179.5];

  it("recovers latitude within a tiny tolerance for every sample in [-85, 85] deg", () => {
    for (const lat of lats) {
      for (const lon of [0, 90, -150]) {
        const merc = lonLatToMercator(lon, lat);
        const back = mercatorToLonLat(merc.x, merc.y);
        expect(back.lat).toBeCloseTo(lat, 9);
      }
    }
  });

  it("recovers longitude exactly (the x half of the round trip is linear, no trig involved)", () => {
    for (const lon of lons) {
      const merc = lonLatToMercator(lon, 20);
      const back = mercatorToLonLat(merc.x, merc.y);
      expect(back.lon).toBeCloseTo(lon, 9);
    }
  });

  it("round-trips the antimeridian correctly on both sides", () => {
    for (const lon of [179.9, -179.9]) {
      const merc = lonLatToMercator(lon, 10);
      const back = mercatorToLonLat(merc.x, merc.y);
      expect(back.lon).toBeCloseTo(lon, 6);
    }
  });
});

describe("ecefFromMercator", () => {
  it("every derived ECEF point lies exactly on the sphere of radius GLOBE_RADIUS", () => {
    const samples: Array<[number, number]> = [
      [0, 0],
      [180, 0],
      [-180, 0],
      [45, 45],
      [-73.5, 40.7], // New York
      [139.767, 35.681], // Tokyo
      [18.42, -33.92], // Cape Town
      [-58.38, -34.6], // Buenos Aires
      [0, 84.9],
      [0, -84.9],
      [123.456, -12.345],
    ];
    for (const [lon, lat] of samples) {
      const merc = lonLatToMercator(lon, lat);
      const ecef = ecefFromMercator(merc.x, merc.y);
      expect(length(ecef)).toBeCloseTo(GLOBE_RADIUS, 6);
    }
  });

  it("lat=0, lon=0 sits on the +z axis, one radius out", () => {
    const merc = lonLatToMercator(0, 0);
    const p = ecefFromMercator(merc.x, merc.y);
    expect(p.x).toBeCloseTo(0, 9);
    expect(p.y).toBeCloseTo(0, 9);
    expect(p.z).toBeCloseTo(GLOBE_RADIUS, 9);
  });

  it("lon=90, lat=0 sits on the +x axis", () => {
    const merc = lonLatToMercator(90, 0);
    const p = ecefFromMercator(merc.x, merc.y);
    expect(p.x).toBeCloseTo(GLOBE_RADIUS, 6);
    expect(p.y).toBeCloseTo(0, 9);
    expect(p.z).toBeCloseTo(0, 6);
  });

  it("north (positive) latitude maps to -y, matching the static example's sign convention", () => {
    const merc = lonLatToMercator(0, 60);
    const p = ecefFromMercator(merc.x, merc.y);
    expect(p.y).toBeLessThan(0);
  });
});

describe("mercatorToGlobe (downstream mix + cull, reused verbatim from the static example)", () => {
  const mercPos: Vec3 = { x: 0.512, y: 0.271, z: 0 };
  const ecef = ecefFromMercator(mercPos.x, mercPos.y);
  const someMatrix = [
    0.7, 0, 0, 0,
    0, 0.7, 0, 0,
    0, 0, 0.7, 0,
    0.1, 0.2, 0.3, 1,
  ];

  it("at uTransition >= 1, returns the flat mercator position bit-identical", () => {
    const result = mercatorToGlobe(mercPos, ecef, someMatrix, 1, null);
    expect(result.x).toBe(mercPos.x);
    expect(result.y).toBe(mercPos.y);
    expect(result.z).toBe(mercPos.z);
    expect(result.cull).toBe(1);
  });

  it("with no globe matrix at all, also returns the flat position bit-identical", () => {
    const result = mercatorToGlobe(mercPos, ecef, null, 0, null);
    expect(result.x).toBe(mercPos.x);
    expect(result.y).toBe(mercPos.y);
    expect(result.cull).toBe(1);
  });

  it("at uTransition = 0, the result comes from the ECEF->mercator matrix, not mercPos", () => {
    const result = mercatorToGlobe(mercPos, ecef, someMatrix, 0, null);
    expect(result.x).not.toBe(mercPos.x);
  });

  it("a point facing directly away from the camera is culled toward 0", () => {
    const farMerc = lonLatToMercator(180, 0);
    const farSideEcef = ecefFromMercator(farMerc.x, farMerc.y);
    const cameraEcef: Vec3 = { x: 0, y: 0, z: GLOBE_RADIUS * 4 };
    const result = mercatorToGlobe(mercPos, farSideEcef, someMatrix, 0, cameraEcef);
    expect(result.cull).toBeLessThan(0.05);
  });

  it("a point facing directly toward the camera is fully visible", () => {
    const nearMerc = lonLatToMercator(0, 0);
    const nearSideEcef = ecefFromMercator(nearMerc.x, nearMerc.y);
    const cameraEcef: Vec3 = { x: 0, y: 0, z: GLOBE_RADIUS * 4 };
    const result = mercatorToGlobe(mercPos, nearSideEcef, someMatrix, 0, cameraEcef);
    expect(result.cull).toBeCloseTo(1, 6);
  });
});
