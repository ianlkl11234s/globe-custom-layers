import { describe, expect, it } from "vitest";
import { EARTH_RADIUS_METERS, MAPBOX_GLOBE_RADIUS, hasEarthLineOfSight, orbitPointFromSample, unwrapMercatorX, validateOrbitDefinitions } from "./orbitMath";
import { SCHEMATIC_ORBITS, createSchematicOrbits, orbitPointAt, sampleOrbit } from "./orbitFixture";

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

describe("injected paths and globe visibility", () => {
  it("accepts closed injected data and rejects open or invalid rings", () => {
    const ring = createSchematicOrbits(12);
    expect(() => validateOrbitDefinitions(ring)).not.toThrow();
    expect(() => validateOrbitDefinitions([{ ...ring[0]!, path: ring[0]!.path.slice(0, -1) }])).toThrow(/closed/);
    expect(() => validateOrbitDefinitions([{ ...ring[0]!, path: [{ longitudeDeg: 0, latitudeDeg: 90, altitudeMeters: 1 }, ...ring[0]!.path.slice(1) ] }])).toThrow(/latitude/);
    expect(() => validateOrbitDefinitions([{ ...ring[0]!, path: [ring[0]!.path[0]!, ring[0]!.path[1]!, ring[0]!.path[0]!] }])).toThrow(/distinct samples/);
    expect(() => orbitPointFromSample(ring[0]!.path[0]!, Number.NaN)).toThrow(/altitudeScale/);
  });

  it("keeps high-altitude points beyond the surface horizon when their camera ray clears Earth", () => {
    const camera = [0, 0, MAPBOX_GLOBE_RADIUS * 2] as const;
    const surfaceFar = [0, 0, -MAPBOX_GLOBE_RADIUS] as const;
    const highNearHorizon = [MAPBOX_GLOBE_RADIUS * 1.8, 0, -MAPBOX_GLOBE_RADIUS * .2] as const;
    expect(hasEarthLineOfSight(camera, surfaceFar)).toBe(false);
    expect(hasEarthLineOfSight(camera, highNearHorizon)).toBe(true);
  });

  it("unwraps dateline-crossing flat endpoints while retaining original ECEF endpoints", () => {
    const a = orbitPointFromSample({ longitudeDeg: 170, latitudeDeg: 0, altitudeMeters: 600_000 });
    const b = orbitPointFromSample({ longitudeDeg: -170, latitudeDeg: 5, altitudeMeters: 600_000 });
    const unwrappedB = unwrapMercatorX(a.mercator[0], b.mercator[0]);
    expect(Math.abs(unwrappedB - a.mercator[0])).toBeLessThanOrEqual(.5);
    expect(unwrappedB).toBeGreaterThan(1);
    expect(b.ecef).not.toEqual(a.ecef);
  });

  it("uses metres for generic inputs instead of treating ECEF radius as a surface ring", () => {
    const point = orbitPointFromSample({ longitudeDeg: 0, latitudeDeg: 0, altitudeMeters: EARTH_RADIUS_METERS });
    expect(point.radius).toBeCloseTo(MAPBOX_GLOBE_RADIUS * 2, 9);
  });
});
