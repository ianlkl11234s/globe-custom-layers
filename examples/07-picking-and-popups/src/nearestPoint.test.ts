import { describe, expect, it } from "vitest";
import { findNearestBruteForce, type ScreenPoint } from "./nearestPoint";

const points: ScreenPoint[] = [
  { id: "a", x: 100, y: 100 },
  { id: "b", x: 110, y: 100 }, // 10px from a
  { id: "c", x: 500, y: 500 }, // far away
];

describe("findNearestBruteForce", () => {
  it("returns the nearest point within radius", () => {
    const hit = findNearestBruteForce(points, 100, 100, 20);
    expect(hit?.id).toBe("a"); // exact match, distance 0
  });

  it("returns the second-nearest point when clicking closer to it", () => {
    const hit = findNearestBruteForce(points, 108, 100, 20);
    expect(hit?.id).toBe("b"); // 2px from b, 8px from a
  });

  it("returns null when nothing is within radius", () => {
    const hit = findNearestBruteForce(points, 300, 300, 20);
    expect(hit).toBeNull();
  });

  it("is inclusive at exactly the radius boundary", () => {
    // Isolated single-point set: "solo" sits at distance exactly 20 from
    // (120, 100), with nothing closer to compete with it.
    const solo: ScreenPoint[] = [{ id: "solo", x: 100, y: 100 }];
    const hit = findNearestBruteForce(solo, 120, 100, 20);
    expect(hit?.id).toBe("solo");
  });

  it("excludes a point exactly one unit past the radius boundary", () => {
    const solo: ScreenPoint[] = [{ id: "solo", x: 100, y: 100 }];
    const hit = findNearestBruteForce(solo, 121, 100, 20);
    expect(hit).toBeNull();
  });

  it("handles an empty candidate list without throwing", () => {
    expect(findNearestBruteForce([], 0, 0, 100)).toBeNull();
  });

  it("tie-break: the first point in input order wins when two are exactly equidistant", () => {
    const tied: ScreenPoint[] = [
      { id: "left", x: 90, y: 100 }, // 10px from (100,100)
      { id: "right", x: 110, y: 100 }, // also 10px from (100,100)
    ];
    expect(findNearestBruteForce(tied, 100, 100, 20)?.id).toBe("left");

    // Same distances, reversed input order -- the winner follows the input,
    // not some property of the points themselves (proving the rule is
    // "first in array", not e.g. "leftmost" or "lowest id").
    const reversed: ScreenPoint[] = [tied[1]!, tied[0]!];
    expect(findNearestBruteForce(reversed, 100, 100, 20)?.id).toBe("right");
  });
});
