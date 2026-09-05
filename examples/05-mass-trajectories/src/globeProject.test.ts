import { describe, expect, it } from "vitest";
import {
  ecefFromMercator,
  GLOBE_PROJECT_HYBRID_GLSL,
  GLOBE_RADIUS,
  lonLatToMercator,
  mercatorToLonLat,
} from "./globeProject";

function closeTo(a: number, b: number, eps: number) {
  expect(Math.abs(a - b)).toBeLessThan(eps);
}

describe("lonLatToMercator / mercatorToLonLat round trip", () => {
  it("recovers latitude to high precision across -85..85 deg (Mercator's usable range)", () => {
    for (let lat = -85; lat <= 85; lat += 5) {
      for (let lon = -180; lon <= 180; lon += 30) {
        const merc = lonLatToMercator(lon, lat);
        const back = mercatorToLonLat(merc.x, merc.y);
        closeTo(back.lat, lat, 1e-7);
        closeTo(back.lon, lon, 1e-9); // longitude is linear in mercX, so this is exact modulo float error
      }
    }
  });
});

describe("ecefFromMercator", () => {
  it("every derived point has length GLOBE_RADIUS, including near-pole samples", () => {
    for (let lat = -85; lat <= 85; lat += 5) {
      for (let lon = -180; lon <= 180; lon += 30) {
        const merc = lonLatToMercator(lon, lat);
        const ecef = ecefFromMercator(merc.x, merc.y);
        closeTo(Math.hypot(ecef.x, ecef.y, ecef.z), GLOBE_RADIUS, 1e-6);
      }
    }
  });

  it("matches an independently hand-derived formula (cross-check against docs/01-hugging-the-globe/mapbox.md's Step 1, not just against itself)", () => {
    const lon = 42;
    const lat = 13;
    const merc = lonLatToMercator(lon, lat);
    const ecef = ecefFromMercator(merc.x, merc.y);

    const lonRad = (lon * Math.PI) / 180;
    const latRad = (lat * Math.PI) / 180; // exact input latitude, NOT round-tripped through mercator -- this checks the whole pipeline, not just the inverse step
    const cosLat = Math.cos(latRad);
    const expected = {
      x: cosLat * Math.sin(lonRad) * GLOBE_RADIUS,
      y: -Math.sin(latRad) * GLOBE_RADIUS,
      z: cosLat * Math.cos(lonRad) * GLOBE_RADIUS,
    };
    closeTo(ecef.x, expected.x, 1e-6);
    closeTo(ecef.y, expected.y, 1e-6);
    closeTo(ecef.z, expected.z, 1e-6);
  });

  it("is periodic in mercX with period 1 -- the property that makes leg.ts's antimeridian-unwrapping safe", () => {
    // leg.ts deliberately produces mercX values outside [0,1] so a rendered
    // segment takes the short way round the globe instead of streaking
    // across the whole flat map. That's only safe if a single POINT's
    // resolved ECEF position is unaffected by which "wrap" of mercX it's
    // expressed in -- this test is the guarantee this example's whole
    // antimeridian handling rests on.
    for (const mercY of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      for (const mercX of [-2.7, -1.3, -0.4, 0.2, 0.85, 1.9, 3.05]) {
        const a = ecefFromMercator(mercX, mercY);
        const b = ecefFromMercator(mercX + 1, mercY);
        const c = ecefFromMercator(mercX - 3, mercY);
        closeTo(a.x, b.x, 1e-9);
        closeTo(a.y, b.y, 1e-9);
        closeTo(a.z, b.z, 1e-9);
        closeTo(a.x, c.x, 1e-9);
        closeTo(a.y, c.y, 1e-9);
        closeTo(a.z, c.z, 1e-9);
      }
    }
  });
});

describe("GLOBE_PROJECT_HYBRID_GLSL", () => {
  // This can't compile or run the shader without a WebGL context (see
  // README, "Verifying it without a token") -- but a few textual
  // invariants are cheap, meaningful smoke tests that a hand-edit didn't
  // silently break the hybrid branch or reintroduce a missing PI constant
  // (examples/04-moving-trajectory's README documents this exact class of
  // mistake against the doc's own snippet).
  it("declares PI (GLSL has no built-in constant)", () => {
    expect(GLOBE_PROJECT_HYBRID_GLSL).toMatch(/const float PI = 3\.14159/);
  });

  it("branches per-vertex on aDynamic via step(), not an if/else that could diverge across a workgroup", () => {
    expect(GLOBE_PROJECT_HYBRID_GLSL).toMatch(/step\(0\.5,\s*aDynamic\)/);
  });

  it("keeps the uTransition >= 1.0 early-out", () => {
    expect(GLOBE_PROJECT_HYBRID_GLSL).toMatch(/uTransition >= 1\.0/);
  });
});
