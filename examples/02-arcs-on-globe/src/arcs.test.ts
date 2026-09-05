import { describe, expect, it } from "vitest";
import { arcColorForRoute, buildArcRoutes, sampleArc, type ArcPalette } from "./arcs";
import type { Hub } from "./airports";
import type { LonLat } from "./slerp";

function makeHubs(n: number): Hub[] {
  return Array.from({ length: n }, (_, i) => ({
    ident: `H${i}`,
    name: `Hub ${i}`,
    lon: i * 10,
    lat: 0,
  }));
}

describe("buildArcRoutes", () => {
  it("produces C(n,2) unordered pairs, no self-pairs, no duplicates", () => {
    const hubs = makeHubs(6);
    const routes = buildArcRoutes(hubs);
    expect(routes.length).toBe((6 * 5) / 2); // 15

    const seen = new Set<string>();
    for (const r of routes) {
      expect(r.originIdent).not.toBe(r.destIdent);
      const key = [r.originIdent, r.destIdent].sort().join("-");
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("this example's real hub count (20, see airports.ts) yields 190 arcs -- inside the 50-200 target range", () => {
    expect(buildArcRoutes(makeHubs(20)).length).toBe(190);
  });

  it("each route's origin/dest lon/lat match the input hubs' coordinates", () => {
    const hubs = makeHubs(3);
    const routes = buildArcRoutes(hubs);
    const first = routes[0]!;
    expect(first.origin).toEqual({ lon: hubs[0]!.lon, lat: hubs[0]!.lat });
    expect(first.dest).toEqual({ lon: hubs[1]!.lon, lat: hubs[1]!.lat });
  });
});

describe("arc palettes", () => {
  const palettes: ArcPalette[] = ["spectrum", "solar", "aurora", "plasma", "ice"];
  const route = buildArcRoutes(makeHubs(2))[0]!;

  it("returns a valid, deterministic RGB color for every selectable palette", () => {
    for (const palette of palettes) {
      const first = arcColorForRoute(route, palette);
      expect(first).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
      expect(arcColorForRoute(route, palette)).toBe(first);
    }
  });

  it("gives the Spectrum palette visible per-route variety", () => {
    const colors = buildArcRoutes(makeHubs(6)).map((item) => arcColorForRoute(item, "spectrum"));
    expect(new Set(colors).size).toBeGreaterThan(8);
  });
});

describe("sampleArc", () => {
  const origin: LonLat = { lon: 10, lat: 20 };
  const dest: LonLat = { lon: 100, lat: -5 };

  it("produces exactly `vertexCount` samples", () => {
    for (const n of [2, 3, 8, 64, 128]) {
      expect(sampleArc(origin, dest, n, 0.02).length).toBe(n);
    }
  });

  it("rejects a vertexCount below 2 -- an arc needs at least its two endpoints", () => {
    expect(() => sampleArc(origin, dest, 1, 0.02)).toThrow();
    expect(() => sampleArc(origin, dest, 0, 0.02)).toThrow();
  });

  it("the first and last samples land exactly on the origin/destination, at height 0", () => {
    const samples = sampleArc(origin, dest, 16, 0.05);
    const first = samples[0]!;
    const last = samples[samples.length - 1]!;
    expect(first.lon).toBeCloseTo(origin.lon, 5);
    expect(first.lat).toBeCloseTo(origin.lat, 5);
    expect(first.heightMercZ).toBeCloseTo(0, 9);
    expect(last.lon).toBeCloseTo(dest.lon, 5);
    expect(last.lat).toBeCloseTo(dest.lat, 5);
    expect(last.heightMercZ).toBeCloseTo(0, 9);
  });

  it("at vertexCount=2 the arc IS the raw two-point chord -- no lift applied at either end", () => {
    // This is the slider's minimum, and the whole reason this example exists:
    // two points and one straight segment between them, which cuts through
    // the globe no matter how correct the endpoints are (see README).
    const samples = sampleArc(origin, dest, 2, 0.05);
    expect(samples.length).toBe(2);
    expect(samples[0]!.heightMercZ).toBeCloseTo(0, 9);
    expect(samples[1]!.heightMercZ).toBeCloseTo(0, 9);
  });

  it("height follows a sin(pi*t) bump, peaking at the midpoint", () => {
    const peak = 0.04;
    const samples = sampleArc(origin, dest, 9, peak); // index 4 == t=0.5 exactly
    const mid = samples[4]!;
    expect(mid.heightMercZ).toBeCloseTo(peak, 9);
    for (const s of samples) {
      expect(s.heightMercZ).toBeLessThanOrEqual(peak + 1e-9);
      expect(s.heightMercZ).toBeGreaterThanOrEqual(-1e-9);
    }
  });
});

describe("sampleArc across the antimeridian (Taipei -> Los Angeles)", () => {
  const taipei: LonLat = { lon: 121.5, lat: 25.0 };
  const losAngeles: LonLat = { lon: -118.2, lat: 33.9 };

  it("does not span the whole map: the (unwrapped) longitude range stays within the true ~120 degree corridor over the Pacific", () => {
    // Verified against the raw great-circle math: the true short-way span is
    // ~120.3 degrees. See the naive-lerp comparison below for what a WRONG
    // implementation produces instead.
    const samples = sampleArc(taipei, losAngeles, 33, 0);
    const lons = samples.map((s) => s.lon);
    const span = Math.max(...lons) - Math.min(...lons);
    expect(span).toBeGreaterThan(90);
    expect(span).toBeLessThan(150);
  });

  it("adjacent longitudes never show a near-360 degree jump", () => {
    // sampleArc unwraps longitude continuously (see slerp.ts's unwrapLongitude)
    // specifically so this holds -- the raw atan2 output for this exact route
    // WOULD jump by ~355 degrees at the sample that crosses the antimeridian
    // if that unwrap weren't applied (see slerp.test.ts's unwrapLongitude
    // suite for that jump demonstrated in isolation).
    const samples = sampleArc(taipei, losAngeles, 33, 0);
    let maxStep = 0;
    for (let i = 1; i < samples.length; i++) {
      maxStep = Math.max(maxStep, Math.abs(samples[i]!.lon - samples[i - 1]!.lon));
    }
    expect(maxStep).toBeLessThan(20); // observed max step is ~4.7 degrees
  });

  it("comparison: naive lon/lat linear interpolation takes the WRONG way around the planet -- this is exactly what slerp fixes", () => {
    // A deliberately naive reference, local to this test only -- NOT
    // something arcs.ts exports or uses anywhere.
    const naiveMidLon = taipei.lon + (losAngeles.lon - taipei.lon) * 0.5; // ~1.65
    const naiveSpan = Math.abs(losAngeles.lon - taipei.lon); // 239.7, uncorrected

    const slerpSamples = sampleArc(taipei, losAngeles, 33, 0);
    const slerpLons = slerpSamples.map((s) => s.lon);
    const slerpSpan = Math.max(...slerpLons) - Math.min(...slerpLons);

    // The naive path's "midpoint" sits near longitude 0 (Greenwich/West
    // Africa) -- nowhere near the Pacific the real great circle crosses --
    // and its total span is roughly double the slerp path's, because it
    // travels the long way around the planet instead of the short way.
    expect(Math.abs(naiveMidLon)).toBeLessThan(20);
    expect(naiveSpan).toBeGreaterThan(slerpSpan * 1.5);
  });
});
