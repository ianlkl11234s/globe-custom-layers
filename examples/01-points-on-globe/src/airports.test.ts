import { describe, expect, it } from "vitest";
import { syntheticColorRamp, type PointPalette } from "./airports";

describe("syntheticColorRamp", () => {
  it("keeps every selectable palette deterministic and distinct", () => {
    const palettes: PointPalette[] = ["solar", "aurora", "plasma", "ice"];
    const colors = palettes.map((palette) => syntheticColorRamp(0.75, palette));
    expect(new Set(colors).size).toBe(palettes.length);
    expect(colors.every((color) => /^rgb\(\d+,\d+,\d+\)$/.test(color))).toBe(true);
  });

  it("clamps values before interpolating", () => {
    expect(syntheticColorRamp(-1, "solar")).toBe(syntheticColorRamp(0, "solar"));
    expect(syntheticColorRamp(2, "solar")).toBe(syntheticColorRamp(1, "solar"));
  });
});
