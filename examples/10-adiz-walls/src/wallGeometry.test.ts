import { describe, expect, it } from "vitest";
import { TAIWAN_ADIZ_SCHEMATIC_RING } from "./adizBoundary";
import { buildWallVertices, unwrapRing } from "./wallGeometry";

describe("ADIZ wall geometry", () => {
  it("removes the duplicated closing coordinate and emits two closed triangles per edge", () => {
    const vertices = buildWallVertices(TAIWAN_ADIZ_SCHEMATIC_RING);
    expect(vertices).toHaveLength((TAIWAN_ADIZ_SCHEMATIC_RING.length - 1) * 6);
    expect(vertices.slice(0, 6).map((v) => v.heightRatio)).toEqual([0, 0, 1, 0, 1, 1]);
    expect(vertices.slice(-6)).toContainEqual({ lon: 123, lat: 29, heightRatio: 1 });
  });

  it("keeps every wall edge attached to a bottom and a top vertex", () => {
    for (const vertex of buildWallVertices(TAIWAN_ADIZ_SCHEMATIC_RING)) {
      expect(vertex.heightRatio === 0 || vertex.heightRatio === 1).toBe(true);
    }
  });

  it("unwraps an antimeridian edge instead of stretching it through the world", () => {
    const unwrapped = unwrapRing([[179, 10], [-179, 10], [-179, 12], [179, 12]]);
    expect(Math.abs(unwrapped[1]!.lon - unwrapped[0]!.lon)).toBeLessThanOrEqual(180);
    expect(unwrapped[1]!.lon).toBe(181);
  });
});
