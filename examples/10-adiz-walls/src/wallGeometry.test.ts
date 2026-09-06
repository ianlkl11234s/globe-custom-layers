import { describe, expect, it } from "vitest";
import { TAIWAN_ADIZ_SCHEMATIC_FIXTURE } from "./adizBoundary";
import { buildWallVertices, unwrapRing } from "./wallGeometry";

describe("vertical boundary wall geometry", () => {
  it("removes the duplicated closing coordinate and emits two closed triangles per edge", () => {
    const vertices = buildWallVertices(TAIWAN_ADIZ_SCHEMATIC_FIXTURE, 2_000_000);
    expect(vertices).toHaveLength(5 * 6);
    expect(vertices.slice(0, 6).map((v) => v.heightRatio)).toEqual([0, 0, 1, 0, 1, 1]);
    expect(vertices.slice(-6)).toContainEqual({ lon: 123, lat: 29, heightRatio: 1 });
  });

  it("keeps every wall edge attached to a bottom and a top vertex", () => {
    for (const vertex of buildWallVertices(TAIWAN_ADIZ_SCHEMATIC_FIXTURE, 2_000_000)) {
      expect(vertex.heightRatio === 0 || vertex.heightRatio === 1).toBe(true);
    }
  });

  it("unwraps an antimeridian edge instead of stretching it through the world", () => {
    const unwrapped = unwrapRing([[179, 10], [-179, 10], [-179, 12], [179, 12]]);
    expect(Math.abs(unwrapped[1]!.lon - unwrapped[0]!.lon)).toBeLessThanOrEqual(180);
    expect(unwrapped[1]!.lon).toBe(181);
  });

  it("keeps every generated triangle edge local for a closed antimeridian ring", () => {
    const vertices = buildWallVertices({ type: "Polygon", coordinates: [[[179, 10], [-179, 10], [-179, 12], [179, 12], [179, 10]]] }, 2_000_000);
    for (let index = 0; index < vertices.length; index += 3) {
      const triangle = vertices.slice(index, index + 3);
      for (const a of triangle) for (const b of triangle) expect(Math.abs(a.lon - b.lon)).toBeLessThanOrEqual(180);
    }
  });

  it("emits side walls for holes and multiple polygons without a top fill", () => {
    const vertices = buildWallVertices({ type: "MultiPolygon", coordinates: [
      [[[0, 0], [1, 0], [1, 1], [0, 0]], [[0.2, 0.2], [0.3, 0.2], [0.2, 0.3], [0.2, 0.2]]],
      [[[2, 0], [3, 0], [2, 1], [2, 0]]],
    ] }, 2_000_000);
    expect(vertices).toHaveLength(9 * 6);
    expect(vertices.filter((vertex) => vertex.heightRatio === 1)).toHaveLength(9 * 3);
  });

  it("densifies long geodesic edges", () => {
    expect(buildWallVertices({ type: "Polygon", coordinates: [[[0, 0], [20, 0], [0, 1], [0, 0]]] }, 100_000).length).toBeGreaterThan(18);
  });

  it.each([
    [{ type: "Polygon", coordinates: [[]] }, "empty"],
    [{ type: "Polygon", coordinates: [[[0, 90], [1, 0], [0, 0]]] }, "Mercator"],
    [{ type: "Polygon", coordinates: [[[0, 0], [Number.NaN, 1], [1, 0]]] }, "non-finite"],
    [{ type: "Polygon", coordinates: [[[0, 0], [0, 0], [1, 0], [0, 1]]] }, "zero-length"],
  ])("rejects invalid input: %s", (geometry, message) => {
    expect(() => buildWallVertices(geometry as never)).toThrow(message);
  });
});
