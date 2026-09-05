import { describe, expect, it } from "vitest";
import { DEFAULT_VORTICES, SPEED_MAX_MS, generateVortices, sampleFlow, zonalBaseSpeedMs } from "./flowField";

describe("generateVortices", () => {
  it("is deterministic for a fixed seed", () => {
    const a = generateVortices(9, 12345);
    const b = generateVortices(9, 12345);
    expect(a).toEqual(b);
  });

  it("produces a different set for a different seed", () => {
    const a = generateVortices(9, 1);
    const b = generateVortices(9, 2);
    expect(a).not.toEqual(b);
  });

  it("keeps every center within valid lon/lat ranges", () => {
    for (const v of generateVortices(40, 777)) {
      expect(v.lon).toBeGreaterThanOrEqual(-180);
      expect(v.lon).toBeLessThanOrEqual(180);
      expect(v.lat).toBeGreaterThanOrEqual(-90);
      expect(v.lat).toBeLessThanOrEqual(90);
    }
  });
});

describe("antimeridian continuity", () => {
  // "Nearly identical" is checked two ways: (1) the literal points the task
  // spec names (179.99 / -179.99, 0.02 degrees apart) must be close in
  // absolute terms relative to the field's own speed scale -- generous,
  // because a smooth field with real curvature near a vortex can
  // legitimately differ by a bit more than floating-point noise over a
  // non-infinitesimal 0.02-degree gap; and (2) far more rigorously, that
  // the gap between two dateline-straddling samples SHRINKS as the two
  // query points move closer together. A genuine discontinuity (e.g. a
  // forgotten `% 360`) would NOT shrink under (2) -- it would stay roughly
  // constant regardless of how close the two points get -- so (2) is the
  // test that actually distinguishes "continuous" from "looks continuous
  // at one sample spacing by coincidence".
  it("sampleFlow at lon=179.99 is close to lon=-179.99 relative to the field's speed scale, at several latitudes", () => {
    for (const lat of [-72, -35, -20, 0, 20, 35, 60, 72]) {
      const a = sampleFlow(179.99, lat);
      const b = sampleFlow(-179.99, lat);
      const gap = Math.hypot(a.u - b.u, a.v - b.v);
      expect(gap).toBeLessThan(SPEED_MAX_MS * 0.03); // well under 3% of the field's full speed scale
    }
  });

  it("the gap across the antimeridian shrinks as the two query points move closer together (no jump discontinuity)", () => {
    const vortices = [{ lon: 179.5, lat: 0, radiusDeg: 20, strengthMs: 15 }]; // a vortex right at the seam, the toughest case
    function gapAt(halfWidthDeg: number): number {
      const a = sampleFlow(180 - halfWidthDeg, 0.1, vortices);
      const b = sampleFlow(-180 + halfWidthDeg, 0.1, vortices);
      return Math.hypot(a.u - b.u, a.v - b.v);
    }
    const wide = gapAt(0.02); // the task spec's literal 179.99 / -179.99
    const narrower = gapAt(0.002); // 10x closer
    const narrowest = gapAt(0.0002); // 100x closer
    expect(narrower).toBeLessThan(wide);
    expect(narrowest).toBeLessThan(narrower);
    // A true discontinuity wouldn't shrink at all as the gap narrows -- this
    // confirms it shrinks roughly in proportion (not just "a bit smaller").
    expect(narrowest).toBeLessThan(wide * 0.02);
  });

  it("also holds directly at the seam (lon=180 vs lon=-180, the same meridian)", () => {
    for (const lat of [-50, 0, 50]) {
      const a = sampleFlow(180, lat);
      const b = sampleFlow(-180, lat);
      expect(a.u).toBeCloseTo(b.u, 6);
      expect(a.v).toBeCloseTo(b.v, 6);
    }
  });

  it("stays continuous even for a vortex whose antipodal meridian sits on the dateline (lon near 0)", () => {
    const vortices = [{ lon: 1, lat: 0, radiusDeg: 30, strengthMs: 18 }];
    const a = sampleFlow(179.99, 0, vortices);
    const b = sampleFlow(-179.99, 0, vortices);
    expect(a.u).toBeCloseTo(b.u, 2);
    expect(a.v).toBeCloseTo(b.v, 2);
  });

  // Regression case for a real bug an earlier version of this file had: that
  // version measured the Gaussian window using a *flat-plane* distance
  // (deltaLon * cos(vortex latitude), deltaLat) instead of the true
  // great-circle distance. For a high-latitude, wide-radius vortex, the
  // flat-plane distance to its own antipodal meridian shrinks well below
  // 180 degrees (cos(latitude) shrinks the longitude term), so the window
  // was NOT negligible there and a real, visible jump leaked through right
  // at that vortex's antipodal meridian -- which for a vortex near lon=1
  // sits almost exactly on the map's antimeridian. This is the case that
  // reproduced it: a wide (36 deg), high-latitude (70 deg) vortex, checked
  // at ITS OWN latitude (not the equator, where the earlier bug's effect
  // happened to be small).
  it("stays continuous for a high-latitude, wide-radius vortex checked at its own latitude (regression)", () => {
    const vortices = [{ lon: 1, lat: 70, radiusDeg: 36, strengthMs: 18 }];
    const a = sampleFlow(179.99, 70, vortices);
    const b = sampleFlow(-179.99, 70, vortices);
    const gap = Math.hypot(a.u - b.u, a.v - b.v);
    expect(gap).toBeLessThan(0.01); // the flat-plane-distance bug produced a gap of several m/s here
  });

  it("every default vortex stays continuous across ITS OWN antipodal meridian, not just the map's antimeridian", () => {
    // General-purpose guard against reintroducing any longitude-difference
    // wrap: this implementation has no seam anywhere except an exact
    // antipodal POINT (where the cross product is exactly zero, not
    // discontinuous), so there should be nothing special happening at any
    // vortex's antipodal MERIDIAN either.
    for (const vx of DEFAULT_VORTICES) {
      const antipodeLon = vx.lon + 180;
      const a = sampleFlow(antipodeLon - 0.01, vx.lat);
      const b = sampleFlow(antipodeLon + 0.01, vx.lat);
      const gap = Math.hypot(a.u - b.u, a.v - b.v);
      expect(gap).toBeLessThan(0.01);
    }
  });
});

describe("pole safety", () => {
  it("never returns NaN or Infinity at the exact poles", () => {
    for (const lon of [-180, -90, 0, 45, 179.999]) {
      for (const lat of [90, -90]) {
        const s = sampleFlow(lon, lat);
        expect(Number.isFinite(s.u)).toBe(true);
        expect(Number.isFinite(s.v)).toBe(true);
        expect(Number.isFinite(s.speed)).toBe(true);
      }
    }
  });

  it("never returns NaN or Infinity approaching the poles", () => {
    for (const lat of [89.9999, -89.9999]) {
      const s = sampleFlow(123.456, lat, DEFAULT_VORTICES);
      expect(Number.isFinite(s.u)).toBe(true);
      expect(Number.isFinite(s.v)).toBe(true);
    }
  });

  it("zonalBaseSpeedMs is bounded by its amplitude at every latitude, including the poles", () => {
    for (let lat = -90; lat <= 90; lat += 3.7) {
      expect(Math.abs(zonalBaseSpeedMs(lat, 9, 3))).toBeLessThanOrEqual(9 + 1e-9);
    }
  });

  it("sampleFlow speed stays finite and bounded across a dense lat sweep with the default vortex set", () => {
    for (let lat = -90; lat <= 90; lat += 1.3) {
      const s = sampleFlow(200 * Math.sin(lat), lat, DEFAULT_VORTICES);
      expect(Number.isFinite(s.speed)).toBe(true);
      expect(s.speed).toBeLessThan(9 + DEFAULT_VORTICES.length * 18 + 1); // loose ceiling, just guards against blow-up
    }
  });

  it("a vortex centered exactly on a pole never produces NaN nearby or at the pole", () => {
    const vortices = [{ lon: 0, lat: 90, radiusDeg: 20, strengthMs: 12 }];
    for (const lon of [-180, -90, 0, 90, 180]) {
      const s = sampleFlow(lon, 90, vortices);
      expect(Number.isFinite(s.u)).toBe(true);
      expect(Number.isFinite(s.v)).toBe(true);
    }
  });
});

describe("vortex shape", () => {
  it("velocity is exactly zero at a vortex's own center (a calm eye), not a discontinuity", () => {
    const vortices = [{ lon: 40, lat: 10, radiusDeg: 20, strengthMs: 15 }];
    const s = sampleFlow(40, 10, vortices);
    // zonalBaseSpeedMs(10) is the only remaining contribution at the core.
    expect(s.u).toBeCloseTo(zonalBaseSpeedMs(10), 9);
    expect(s.v).toBeCloseTo(0, 9);
  });

  it("decays to near-zero well outside the vortex radius", () => {
    const vortices = [{ lon: 0, lat: 0, radiusDeg: 10, strengthMs: 15 }];
    const far = sampleFlow(60, 0, vortices); // 60 degrees away, radius is 10
    expect(Math.abs(far.u - zonalBaseSpeedMs(0))).toBeLessThan(0.01);
    expect(Math.abs(far.v)).toBeLessThan(0.01);
  });
});

describe("determinism", () => {
  it("sampleFlow is a pure function of its inputs", () => {
    const a = sampleFlow(30, 15, DEFAULT_VORTICES);
    const b = sampleFlow(30, 15, DEFAULT_VORTICES);
    expect(a).toEqual(b);
  });
});
