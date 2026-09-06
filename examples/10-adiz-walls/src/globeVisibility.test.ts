import { describe, expect, it } from "vitest";
import { isEcefPointVisible } from "./globeVisibility";

describe("sphere occlusion", () => {
  const radius = 10;
  it("keeps a front-side surface point fully visible", () => {
    expect(isEcefPointVisible({ x: 0, y: 0, z: 20 }, { x: 0, y: 0, z: 10 }, radius)).toBe(true);
  });
  it("hides a far-side surface point", () => {
    expect(isEcefPointVisible({ x: 0, y: 0, z: 20 }, { x: 0, y: 0, z: -10 }, radius)).toBe(false);
  });
  it("keeps a raised horizon point visible when its ray clears the sphere", () => {
    expect(isEcefPointVisible({ x: 0, y: 0, z: 20 }, { x: 12, y: 0, z: 0 }, radius)).toBe(true);
  });
});
