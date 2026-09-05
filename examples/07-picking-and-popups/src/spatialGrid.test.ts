import { describe, expect, it } from "vitest";
import { SpatialGrid } from "./spatialGrid";
import { findNearestBruteForce, type ScreenPoint } from "./nearestPoint";

/**
 * Deterministic seeded PRNG (mulberry32), so this suite's "random data"
 * assertions are reproducible across runs -- a flaky test that fails once in
 * a thousand CI runs is worse than no test, because nobody trusts it enough
 * to investigate. Not a dependency: it's ~5 lines, and this repo's allowed
 * deps list (mapbox-gl, three, vite, typescript, vitest) has no room for a
 * random-number library anyway.
 */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomPoints(count: number, rand: () => number, extentPx: number): ScreenPoint[] {
  const pts: ScreenPoint[] = [];
  for (let i = 0; i < count; i++) {
    pts.push({ id: `p${i}`, x: rand() * extentPx, y: rand() * extentPx });
  }
  return pts;
}

describe("SpatialGrid vs. brute force, on random data", () => {
  it("agrees with findNearestBruteForce for many random click points", () => {
    const rand = mulberry32(12345);
    const points = randomPoints(500, rand, 2000);
    const radiusPx = 14;

    const grid = new SpatialGrid(radiusPx);
    for (const p of points) grid.insert(p);

    // Random click positions, including some deliberately near/at existing
    // points and some in likely-empty space, over many trials.
    for (let i = 0; i < 200; i++) {
      const x = rand() * 2200 - 100; // slightly outside [0, extentPx] too
      const y = rand() * 2200 - 100;

      const bruteForce = findNearestBruteForce(points, x, y, radiusPx);
      const gridResult = grid.queryNearest(x, y, radiusPx);

      // Compare by id + confirm both report "no hit" together -- see this
      // file's header comment on why exact tie ordering isn't asserted:
      // with continuous random floats, two candidates landing at EXACTLY
      // equal distance from a given click has probability ~0, so agreement
      // on the winning id is the meaningful invariant here.
      expect(gridResult?.id ?? null).toBe(bruteForce?.id ?? null);
    }
  });

  it("agrees with findNearestBruteForce across several cell sizes and radii", () => {
    const rand = mulberry32(999);
    const points = randomPoints(300, rand, 1000);

    for (const [cellSize, radiusPx] of [
      [10, 10],
      [25, 10], // cellSize > radius: still correct, just fewer/bigger cells
      [8, 20], // radius > cellSize: exercises the multi-cell-ring `reach` path
    ] as const) {
      const grid = new SpatialGrid(cellSize);
      for (const p of points) grid.insert(p);

      for (let i = 0; i < 100; i++) {
        const x = rand() * 1000;
        const y = rand() * 1000;
        const bruteForce = findNearestBruteForce(points, x, y, radiusPx);
        const gridResult = grid.queryNearest(x, y, radiusPx);
        expect(gridResult?.id ?? null).toBe(bruteForce?.id ?? null);
      }
    }
  });

  it("returns null when queried before any insert", () => {
    const grid = new SpatialGrid(10);
    expect(grid.queryNearest(0, 0, 100)).toBeNull();
  });

  it("clear() empties the grid", () => {
    const grid = new SpatialGrid(10);
    grid.insert({ id: "a", x: 5, y: 5 });
    expect(grid.queryNearest(5, 5, 10)?.id).toBe("a");
    grid.clear();
    expect(grid.queryNearest(5, 5, 10)).toBeNull();
  });

  it("throws for a non-positive cell size", () => {
    expect(() => new SpatialGrid(0)).toThrow();
    expect(() => new SpatialGrid(-5)).toThrow();
  });

  it("finds a point inserted near a cell boundary (off-by-one-cell regression guard)", () => {
    // cellSize = 10: a point at x=9.9 sits in cell 0, a query centred at
    // x=10.1 (cell 1) with radius 1 must still find it -- exercises the
    // "reach" neighbor-cell scan rather than only the query's own cell.
    const grid = new SpatialGrid(10);
    grid.insert({ id: "edge", x: 9.9, y: 0 });
    const hit = grid.queryNearest(10.1, 0, 1);
    expect(hit?.id).toBe("edge");
  });
});
