import { describe, expect, it } from "vitest";
import { bboxOutline, geodesicCircle, triangulateFan, type LonLat } from "./shapes";
import { GLOBE_RADIUS, lonLatToEcef } from "./globeProject";

const EARTH_RADIUS_KM = 6371; // must match shapes.ts -- kept separate on purpose, see below

/**
 * Independent great-circle distance (haversine), written from scratch here
 * rather than imported -- this test exists to catch bugs in
 * geodesicCircle()'s "destination point" formula, so it must not share code
 * with it. If both used the same formula, a shared sign error would pass
 * this test while still being wrong.
 */
function greatCircleDistanceKm(a: LonLat, b: LonLat): number {
  const phi1 = (a.lat * Math.PI) / 180;
  const phi2 = (b.lat * Math.PI) / 180;
  const dPhi = ((b.lat - a.lat) * Math.PI) / 180;
  const dLambda = ((b.lon - a.lon) * Math.PI) / 180;
  const h = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function ecefLength(p: LonLat): number {
  const e = lonLatToEcef(p.lon, p.lat, 0);
  return Math.hypot(e.x, e.y, e.z);
}

describe("geodesicCircle", () => {
  it("every boundary point is exactly radiusKm of great-circle distance from the center (independent check)", () => {
    const center: LonLat = { lon: 34.5, lat: 12.2 };
    const radiusKm = 500;
    const points = geodesicCircle(center, radiusKm, 48);
    for (const p of points) {
      expect(greatCircleDistanceKm(center, p)).toBeCloseTo(radiusKm, 4);
    }
  });

  it("holds across a spread of centers, including the equator, both hemispheres, and near-polar circles", () => {
    const cases: Array<{ center: LonLat; radiusKm: number }> = [
      { center: { lon: 0, lat: 0 }, radiusKm: 500 },
      { center: { lon: 20, lat: 45 }, radiusKm: 500 },
      { center: { lon: -58.38, lat: -34.6 }, radiusKm: 1200 },
      { center: { lon: 179.5, lat: 0 }, radiusKm: 300 }, // near antimeridian
      { center: { lon: 0, lat: 85 }, radiusKm: 300 }, // near pole, circle stays clear of the pole itself
      { center: { lon: 0, lat: 85 }, radiusKm: 700 }, // near pole, circle actually encloses the pole
    ];
    for (const { center, radiusKm } of cases) {
      const points = geodesicCircle(center, radiusKm, 32);
      for (const p of points) {
        expect(greatCircleDistanceKm(center, p)).toBeCloseTo(radiusKm, 3);
      }
    }
  });

  it("returns exactly `segments` boundary points", () => {
    for (const segments of [3, 8, 16, 64]) {
      expect(geodesicCircle({ lon: 10, lat: 10 }, 400, segments)).toHaveLength(segments);
    }
  });

  it("circles near the pole produce no NaN, valid lat/lon, for radii both clear of and enclosing the pole", () => {
    // ~555.95km is approximately the great-circle distance from lat 85 to
    // the pole itself (5 degrees * ~111.19 km/degree) -- these three cases
    // bracket that boundary: comfortably clear of the pole, right on top of
    // it (asin() clamping matters most here), and past it (the circle
    // encloses the pole, so its far-side points sit on the OPPOSITE
    // meridian, e.g. a boundary point can legitimately come out near
    // lon=180 for a center at lon=0 -- that is correct geometry, not a bug).
    for (const radiusKm of [300, 555.95, 700]) {
      const points = geodesicCircle({ lon: 0, lat: 85 }, radiusKm, 32);
      for (const p of points) {
        expect(Number.isFinite(p.lon)).toBe(true);
        expect(Number.isFinite(p.lat)).toBe(true);
        expect(p.lon).toBeGreaterThan(-180);
        expect(p.lon).toBeLessThanOrEqual(180);
        expect(p.lat).toBeGreaterThanOrEqual(-90);
        expect(p.lat).toBeLessThanOrEqual(90);
      }
    }
  });

  it("a circle that encloses the pole reaches the far meridian (lon flips ~180 degrees from the center)", () => {
    // radiusKm=700 > the ~555.95km distance from lat 85 to the pole, so this
    // circle's boundary passes on the far side of the pole for bearings near
    // due north/south -- the correct signature of "the geometry actually
    // wraps over the pole" rather than staying in a wedge facing the center.
    const points = geodesicCircle({ lon: 0, lat: 85 }, 700, 16);
    const farSide = points.some((p) => Math.abs(p.lon) > 150);
    expect(farSide).toBe(true);
  });

  it("a circle straddling the antimeridian (center lon 180) produces points on both sides, no NaN", () => {
    const points = geodesicCircle({ lon: 180, lat: 10 }, 500, 24);

    let sawNearPositive180 = false;
    let sawNearNegative180 = false;
    for (const p of points) {
      expect(Number.isFinite(p.lon)).toBe(true);
      expect(p.lon).toBeGreaterThan(-180);
      expect(p.lon).toBeLessThanOrEqual(180);
      if (p.lon > 150) sawNearPositive180 = true;
      if (p.lon < -150) sawNearNegative180 = true;
    }
    expect(sawNearPositive180).toBe(true);
    expect(sawNearNegative180).toBe(true);
  });
});

describe("bboxOutline", () => {
  it("returns exactly 4 * segmentsPerEdge points", () => {
    for (const segmentsPerEdge of [1, 3, 10]) {
      const points = bboxOutline({ lon: -10, lat: -5 }, { lon: 25, lat: 20 }, segmentsPerEdge);
      expect(points).toHaveLength(4 * segmentsPerEdge);
    }
  });

  it("at segmentsPerEdge = 1, returns exactly the four corners, starting at the southwest corner", () => {
    const sw: LonLat = { lon: -10, lat: -5 };
    const ne: LonLat = { lon: 25, lat: 20 };
    const points = bboxOutline(sw, ne, 1);
    expect(points).toEqual([
      { lon: sw.lon, lat: sw.lat },
      { lon: ne.lon, lat: sw.lat },
      { lon: ne.lon, lat: ne.lat },
      { lon: sw.lon, lat: ne.lat },
    ]);
  });

  it("subdivided edges stay within the box's lon/lat bounds", () => {
    const sw: LonLat = { lon: -10, lat: -5 };
    const ne: LonLat = { lon: 25, lat: 20 };
    const points = bboxOutline(sw, ne, 8);
    for (const p of points) {
      expect(p.lon).toBeGreaterThanOrEqual(sw.lon);
      expect(p.lon).toBeLessThanOrEqual(ne.lon);
      expect(p.lat).toBeGreaterThanOrEqual(sw.lat);
      expect(p.lat).toBeLessThanOrEqual(ne.lat);
    }
  });
});

describe("ECEF conversion of generated boundaries lands every point on the sphere", () => {
  it("geodesicCircle boundary points all have equal ECEF vector length (== GLOBE_RADIUS)", () => {
    const points = geodesicCircle({ lon: 12, lat: -30 }, 800, 40);
    for (const p of points) {
      expect(ecefLength(p)).toBeCloseTo(GLOBE_RADIUS, 6);
    }
  });

  it("bboxOutline boundary points all have equal ECEF vector length (== GLOBE_RADIUS)", () => {
    const points = bboxOutline({ lon: -10, lat: -5 }, { lon: 25, lat: 20 }, 6);
    for (const p of points) {
      expect(ecefLength(p)).toBeCloseTo(GLOBE_RADIUS, 6);
    }
  });

  it("a near-pole circle's ECEF points also land exactly on the sphere", () => {
    const points = geodesicCircle({ lon: 60, lat: 85 }, 300, 24);
    for (const p of points) {
      expect(ecefLength(p)).toBeCloseTo(GLOBE_RADIUS, 6);
    }
  });
});

describe("triangulateFan", () => {
  it("produces 3*(n-2) indices for n >= 3, all referencing vertex 0 as the pivot", () => {
    for (const n of [3, 4, 8, 32]) {
      const indices = triangulateFan(n);
      expect(indices).toHaveLength(3 * (n - 2));
      for (let t = 0; t < indices.length; t += 3) {
        expect(indices[t]).toBe(0);
      }
    }
  });

  it("produces no triangles for fewer than 3 vertices", () => {
    expect(triangulateFan(0)).toEqual([]);
    expect(triangulateFan(1)).toEqual([]);
    expect(triangulateFan(2)).toEqual([]);
  });

  it("every index is within [0, n)", () => {
    const n = 12;
    const indices = triangulateFan(n);
    for (const idx of indices) {
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(n);
    }
  });
});
