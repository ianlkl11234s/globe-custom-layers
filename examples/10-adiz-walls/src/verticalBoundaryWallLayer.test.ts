import { describe, expect, it, vi } from "vitest";
import { disposeWallResources } from "./verticalBoundaryWallLayer";

describe("vertical boundary wall lifecycle", () => {
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
