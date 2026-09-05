import { describe, expect, it } from "vitest";
import { GDP_PROPERTY, NULL_COLOR, gdpFillExpression, isGdpFeatureCollection, paletteName } from "./gdp";
import { installEmbedMemoryStorage, isTrustedRuntimeTokenMessage } from "./embedBridge";

describe("GDP choropleth semantics", () => {
  it("keeps null distinct from zero and only accepts country polygons", () => {
    expect(isGdpFeatureCollection({ type: "FeatureCollection", features: [{ type: "Feature", properties: { [GDP_PROPERTY]: null }, geometry: { type: "Polygon", coordinates: [] } }] })).toBe(true);
    expect(isGdpFeatureCollection({ type: "FeatureCollection", features: [{ type: "Feature", properties: { [GDP_PROPERTY]: 0 }, geometry: { type: "Polygon", coordinates: [] } }] })).toBe(true);
    expect(isGdpFeatureCollection({ type: "FeatureCollection", features: [{ type: "Feature", properties: { [GDP_PROPERTY]: "0" }, geometry: { type: "Polygon", coordinates: [] } }] })).toBe(false);
  });
  it("uses a positive-only log threshold expression with a null gray fallback", () => {
    const expression = gdpFillExpression("teal");
    expect(expression[0]).toBe("case");
    expect(expression[expression.length - 1]).toBe(NULL_COLOR);
    expect(JSON.stringify(expression)).toContain(`\"${GDP_PROPERTY}\"`);
    expect(paletteName("unknown")).toBe("teal");
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
    expect(isTrustedRuntimeTokenMessage({ ...event, source: null }, parent, event.origin)).toBe(false);
  });
});
