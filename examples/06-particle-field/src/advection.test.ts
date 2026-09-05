import { describe, expect, it } from "vitest";
import { MAX_FRAME_DT, advectionStep, clampDt, eulerStep, wrapLon } from "./advection";
import { sampleFlow } from "./flowField";

function haversineDeg(a: { lon: number; lat: number }, b: { lon: number; lat: number }): number {
  const d2r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * d2r;
  const dLon = (b.lon - a.lon) * d2r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * d2r) * Math.cos(b.lat * d2r) * Math.sin(dLon / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(h))) * (180 / Math.PI);
}

describe("clampDt (raw wall-clock frame delta)", () => {
  it("passes a small dt through unchanged", () => {
    expect(clampDt(0.01)).toBeCloseTo(0.01, 12);
  });

  it("clamps a large dt (e.g. a backgrounded tab resuming) to MAX_FRAME_DT", () => {
    expect(clampDt(5)).toBe(MAX_FRAME_DT);
    expect(clampDt(100)).toBe(MAX_FRAME_DT);
  });

  it("floors non-finite or non-positive input to 0", () => {
    expect(clampDt(0)).toBe(0);
    expect(clampDt(-3)).toBe(0);
    expect(clampDt(NaN)).toBe(0);
    expect(clampDt(Infinity)).toBe(0);
  });
});

describe("eulerStep (pure integrator, flowSeconds already scaled)", () => {
  it("does not move the particle when flowSeconds is 0/negative/non-finite", () => {
    const pos = { lon: 10, lat: 20 };
    expect(eulerStep(pos, 999, 999, 0)).toEqual(pos);
    expect(eulerStep(pos, 999, 999, -1)).toEqual(pos);
    expect(eulerStep(pos, 999, 999, NaN)).toEqual(pos);
  });

  it("moving east (positive u) increases longitude; moving north (positive v) increases latitude", () => {
    const pos = { lon: 0, lat: 0 };
    const stepped = eulerStep(pos, 10, 5, 1000);
    expect(stepped.lon).toBeGreaterThan(pos.lon);
    expect(stepped.lat).toBeGreaterThan(pos.lat);
  });

  it("does NOT clamp flowSeconds itself -- a large scaled step moves further than a small one", () => {
    const pos = { lon: 0, lat: 0 };
    const small = eulerStep(pos, 10, 0, 100);
    const large = eulerStep(pos, 10, 0, 100_000);
    expect(large.lon).toBeGreaterThan(small.lon);
  });

  it("clamps latitude short of the exact pole", () => {
    const stepped = eulerStep({ lon: 0, lat: 89.85 }, 0, 500, 1000);
    expect(stepped.lat).toBeLessThanOrEqual(89.9);
  });

  it("wraps longitude across the antimeridian instead of drifting unbounded", () => {
    const stepped = eulerStep({ lon: 179.5, lat: 10 }, 500, 0, 100_000);
    expect(stepped.lon).toBeGreaterThanOrEqual(-180);
    expect(stepped.lon).toBeLessThanOrEqual(180);
  });
});

describe("advectionStep (clamps raw dt, then scales into flowSeconds)", () => {
  it("a huge raw dt produces the same result as the clamped MAX_FRAME_DT would", () => {
    const pos = { lon: 10, lat: 20 };
    const viaHugeRawDt = advectionStep(pos, 12, -4, 500, 40);
    const viaClampedRawDt = advectionStep(pos, 12, -4, MAX_FRAME_DT, 40);
    expect(viaHugeRawDt).toEqual(viaClampedRawDt);
  });

  it("without the clamp, the same huge raw dt would have moved the particle much further", () => {
    const pos = { lon: 10, lat: 20 };
    const clamped = advectionStep(pos, 12, -4, 500, 40);
    const unclamped = eulerStep(pos, 12, -4, 40 * 500); // what advectionStep would give with no clamp at all
    const clampedDelta = Math.abs(clamped.lon - pos.lon);
    // Plain abs-difference here, NOT wrapLon -- wrapLon folds an ABSOLUTE
    // longitude into (-180, 180], which isn't the right tool for a
    // DIFFERENCE between two longitudes (this particular case never
    // actually crosses the antimeridian, but using wrapLon on a difference
    // would be the wrong pattern to copy elsewhere).
    const unclampedDelta = Math.abs(unclamped.lon - pos.lon);
    expect(unclampedDelta).toBeGreaterThan(clampedDelta * 50); // MAX_FRAME_DT/500 = 1/2500, so the gap should be enormous
  });
});

describe("two half-steps approximate one double step (first-order consistency)", () => {
  // flowSeconds chosen so a single step covers a modest fraction of a
  // vortex's radius (~14-36 deg) -- large enough that the field's
  // curvature is actually exercised (the two paths must differ), small
  // enough that the local-linearity assumption behind Euler integration
  // still roughly holds (the difference must stay a small fraction of the
  // total displacement).
  it("is close for a moderate flowSeconds, re-sampling the field at the intermediate point", () => {
    const dtFlow = 2000;
    const start = { lon: 12, lat: 4 };

    const s0 = sampleFlow(start.lon, start.lat);
    const mid = eulerStep(start, s0.u, s0.v, dtFlow);
    const s1 = sampleFlow(mid.lon, mid.lat);
    const twoSteps = eulerStep(mid, s1.u, s1.v, dtFlow);

    const oneDoubleStep = eulerStep(start, s0.u, s0.v, 2 * dtFlow);

    const errorDeg = haversineDeg(twoSteps, oneDoubleStep);
    const totalDisplacementDeg = haversineDeg(start, twoSteps);

    // The two paths must not be identical (re-sampling at the midpoint is
    // the whole point of taking two steps instead of one) ...
    expect(errorDeg).toBeGreaterThan(0);
    // ... but for a moderate step the divergence must stay small relative
    // to how far the particle actually moved.
    expect(errorDeg).toBeLessThan(Math.max(totalDisplacementDeg * 0.3, 1e-6));
  });

  it("the error shrinks as the step size shrinks (bounded, not diverging)", () => {
    const start = { lon: -40, lat: 25 };

    function errorFor(dtFlow: number): number {
      const s0 = sampleFlow(start.lon, start.lat);
      const mid = eulerStep(start, s0.u, s0.v, dtFlow);
      const s1 = sampleFlow(mid.lon, mid.lat);
      const twoSteps = eulerStep(mid, s1.u, s1.v, dtFlow);
      const oneDoubleStep = eulerStep(start, s0.u, s0.v, 2 * dtFlow);
      return haversineDeg(twoSteps, oneDoubleStep);
    }

    const bigStep = errorFor(4000);
    const smallStep = errorFor(400);
    expect(smallStep).toBeLessThan(bigStep);
  });
});

describe("wrapLon", () => {
  it("leaves in-range longitudes unchanged", () => {
    expect(wrapLon(0)).toBeCloseTo(0, 9);
    expect(wrapLon(179.9)).toBeCloseTo(179.9, 9);
    expect(wrapLon(-179.9)).toBeCloseTo(-179.9, 9);
  });

  it("wraps out-of-range longitudes into (-180, 180]", () => {
    expect(wrapLon(181)).toBeCloseTo(-179, 9);
    expect(wrapLon(-181)).toBeCloseTo(179, 9);
    expect(wrapLon(360)).toBeCloseTo(0, 9);
    expect(wrapLon(-360)).toBeCloseTo(0, 9);
  });
});
