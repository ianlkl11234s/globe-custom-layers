import { describe, expect, it, vi } from "vitest";
import { disposeWallResources, WALL_VERTEX_SHADER } from "./verticalBoundaryWallLayer";

const GLSL_300_RESERVED_IDENTIFIERS = new Set([
  "flat",
  "smooth",
  "layout",
  "centroid",
  "noperspective",
]);

describe("vertical boundary wall lifecycle", () => {
  it("does not declare GLSL ES 3.0 interpolation qualifiers as identifiers", () => {
    const declarations = [...WALL_VERTEX_SHADER.matchAll(/\b(?:float|vec[234]|mat[234])\s+([A-Za-z_]\w*)/g)]
      .map((match) => match[1]);
    expect(declarations.filter((identifier) => GLSL_300_RESERVED_IDENTIFIERS.has(identifier))).toEqual([]);
  });

  it("disposes the mesh geometry and material when a layer is removed", () => {
    const geometry = { dispose: vi.fn() };
    const material = { dispose: vi.fn() };
    const mesh = { geometry };
    const scene = { remove: vi.fn() };
    disposeWallResources(mesh as never, material as never, scene as never);
    expect(scene.remove).toHaveBeenCalledWith(mesh);
    expect(geometry.dispose).toHaveBeenCalledOnce();
    expect(material.dispose).toHaveBeenCalledOnce();
  });
});
