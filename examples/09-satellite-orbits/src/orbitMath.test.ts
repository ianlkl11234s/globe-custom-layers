import { describe, expect, it } from "vitest";
import { MAPBOX_GLOBE_RADIUS, SCHEMATIC_ORBITS, orbitPointAt, sampleOrbit } from "./orbitMath";

describe("schematic orbit geometry", () => {
  it("closes each sampled orbit", () => {
    for (const orbit of SCHEMATIC_ORBITS) {
      const points = sampleOrbit(orbit, 180);
      points[0]!.ecef.forEach((component, index) => expect(component).toBeCloseTo(points[points.length - 1]!.ecef[index]!, 10));
    }
  });

  it("keeps every vertex outside the Earth at the declared altitude", () => {
    for (const orbit of SCHEMATIC_ORBITS) {
      const radii = sampleOrbit(orbit).map((point) => point.radius);
      const expected = MAPBOX_GLOBE_RADIUS * (1 + orbit.altitudeKm / 6371);
      expect(Math.min(...radii)).toBeCloseTo(expected, 9);
      expect(expected).toBeGreaterThan(MAPBOX_GLOBE_RADIUS);
    }
  });

  it("expresses inclination as north/south displacement, unlike an equatorial ring", () => {
    const polar = SCHEMATIC_ORBITS[0]!;
    const maxNorth = Math.max(...sampleOrbit(polar).map((point) => Math.abs(point.ecef[1])));
    const equatorial = { ...polar, inclinationDeg: 0 };
    const equatorialNorth = Math.max(...sampleOrbit(equatorial).map((point) => Math.abs(point.ecef[1])));
    expect(maxNorth / orbitPointAt(polar, 0).radius).toBeCloseTo(Math.sin(polar.inclinationDeg * Math.PI / 180), 3);
    expect(equatorialNorth).toBeLessThan(1e-9);
    expect(orbitPointAt(polar, 90).radius).toBeGreaterThan(MAPBOX_GLOBE_RADIUS);
  });
});
