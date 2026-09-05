import { describe, expect, it } from "vitest";
import { clampLineControls, DEFAULT_LINE_CONTROLS } from "./lineStyle";
import { isCableFeatureCollection } from "./cables";
import { installEmbedMemoryStorage, isTrustedRuntimeTokenMessage } from "./embedBridge";

describe("native cable controls", () => {
  it("clamps paint controls without accepting an arbitrary color string", () => {
    expect(clampLineControls({ width: 99, opacity: 0, color: "bad" })).toEqual({ width: 12, opacity: 0.05, color: DEFAULT_LINE_CONTROLS.color });
  });
  it("accepts only line geometries", () => {
    expect(isCableFeatureCollection({ type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [] } }] })).toBe(true);
    expect(isCableFeatureCollection({ type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [0, 0] } }] })).toBe(false);
  });
  it("isolates embedded SDK storage and accepts only the expected token sender", () => {
    const parent = {} as WindowProxy;
    const host = { parent, location: { search: "?embed=1" } };
    expect(installEmbedMemoryStorage(host)).toBe(true);
    const storage = (host as typeof host & { localStorage: Storage }).localStorage;
    storage.setItem("sdk", "memory-only");
    expect(storage.getItem("sdk")).toBe("memory-only");
    const event = { origin: "https://demo.example", source: parent, data: { type: "globe-demo:token", token: "pk.test" } };
    expect(isTrustedRuntimeTokenMessage(event, parent, event.origin)).toBe(true);
    expect(isTrustedRuntimeTokenMessage({ ...event, origin: "https://elsewhere.example" }, parent, "https://demo.example")).toBe(false);
  });
});
