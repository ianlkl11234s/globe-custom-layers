import { describe, expect, it } from "vitest";
import { airportsToGeoJSON } from "./airportsGeoJSON";
import type { AirportPoint } from "./airports";

const sample: AirportPoint[] = [
  { ident: "RCTP", name: "Taiwan Taoyuan International Airport", lon: 121.233, lat: 25.0777, colorHex: "rgb(255,140,26)", sizeNorm: 0.6 },
  { ident: "RCSS", name: "Taipei Songshan Airport", lon: 121.5514, lat: 25.0694, colorHex: "rgb(255,255,255)", sizeNorm: 0.1 },
  { ident: "NZSP", name: "South Pole Station Airport", lon: 0, lat: -90, colorHex: "rgb(255,30,30)", sizeNorm: 1 },
];

describe("airportsToGeoJSON", () => {
  it("produces one Feature per input row", () => {
    const fc = airportsToGeoJSON(sample);
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features).toHaveLength(sample.length);
  });

  it("orders coordinates as [lon, lat], NOT [lat, lon]", () => {
    const fc = airportsToGeoJSON(sample);
    // Taoyuan sits at lon ~121.2, lat ~25.1 -- if the axes were swapped this
    // would come out as [25.0777, 121.233], which is nowhere near Taiwan.
    const [lon, lat] = fc.features[0]!.geometry.coordinates;
    expect(lon).toBeCloseTo(121.233, 6);
    expect(lat).toBeCloseTo(25.0777, 6);
  });

  it("every feature's coordinates match its source row's lon/lat, positionally", () => {
    const fc = airportsToGeoJSON(sample);
    for (let i = 0; i < sample.length; i++) {
      const row = sample[i]!;
      const [lon, lat] = fc.features[i]!.geometry.coordinates;
      expect(lon).toBe(row.lon);
      expect(lat).toBe(row.lat);
    }
  });

  it("carries ident, name, colorHex and sizeNorm through into properties untouched", () => {
    const fc = airportsToGeoJSON(sample);
    fc.features.forEach((f, i) => {
      const row = sample[i]!;
      expect(f.properties.ident).toBe(row.ident);
      expect(f.properties.name).toBe(row.name);
      expect(f.properties.colorHex).toBe(row.colorHex);
      expect(f.properties.sizeNorm).toBe(row.sizeNorm);
    });
  });

  it("sets geometry.type to 'Point' and feature.type to 'Feature' for every row", () => {
    const fc = airportsToGeoJSON(sample);
    for (const f of fc.features) {
      expect(f.type).toBe("Feature");
      expect(f.geometry.type).toBe("Point");
    }
  });

  it("handles an empty input without throwing", () => {
    const fc = airportsToGeoJSON([]);
    expect(fc.features).toEqual([]);
  });

  it("handles the south pole (lat = -90, lon = 0) without special-casing it", () => {
    const fc = airportsToGeoJSON(sample);
    const pole = fc.features[2]!;
    expect(pole.geometry.coordinates).toEqual([0, -90]);
  });
});
