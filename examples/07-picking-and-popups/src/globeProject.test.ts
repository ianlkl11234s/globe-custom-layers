import { describe, expect, it } from "vitest";
import { GLOBE_RADIUS, lonLatToEcef, mercatorToGlobe, type Vec3 } from "./globeProject";

function length(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

function normalize(v: Vec3): Vec3 {
  const len = length(v) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

describe("lonLatToEcef", () => {
  it("lat=0, lon=0 sits on the +z axis, one radius out", () => {
    const p = lonLatToEcef(0, 0);
    expect(p.x).toBeCloseTo(0, 9);
    expect(p.y).toBeCloseTo(0, 9);
    expect(p.z).toBeCloseTo(GLOBE_RADIUS, 9);
  });

  it("the north pole (lat=90) maps to -y (the negative y is intentional, see docstring)", () => {
    const p = lonLatToEcef(0, 90);
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.y).toBeCloseTo(-GLOBE_RADIUS, 6);
    expect(p.z).toBeCloseTo(0, 6);
  });

  it("the south pole (lat=-90) maps to +y", () => {
    const p = lonLatToEcef(0, -90);
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.y).toBeCloseTo(GLOBE_RADIUS, 6);
    expect(p.z).toBeCloseTo(0, 6);
  });

  it("lon=90, lat=0 sits on the +x axis", () => {
    const p = lonLatToEcef(90, 0);
    expect(p.x).toBeCloseTo(GLOBE_RADIUS, 9);
    expect(p.y).toBeCloseTo(0, 9);
    expect(p.z).toBeCloseTo(0, 6);
  });

  it("at zero altitude, every ECEF point lies exactly on the sphere of radius GLOBE_RADIUS", () => {
    // A spread of lon/lat pairs, including edge cases (antimeridian, poles-adjacent,
    // both hemispheres) plus a few arbitrary "random-looking" values.
    const samples: Array<[number, number]> = [
      [0, 0],
      [180, 0],
      [-180, 0],
      [45, 45],
      [-73.5, 40.7], // New York
      [139.767, 35.681], // Tokyo
      [18.42, -33.92], // Cape Town
      [-58.38, -34.6], // Buenos Aires
      [0, 89.9],
      [0, -89.9],
      [123.456, -12.345],
    ];
    for (const [lon, lat] of samples) {
      const p = lonLatToEcef(lon, lat, 0);
      expect(length(p)).toBeCloseTo(GLOBE_RADIUS, 6);
    }
  });

  it("positive altitude pushes the point radially outward without changing its direction", () => {
    const lon = 139.767;
    const lat = 35.681;
    const ground = lonLatToEcef(lon, lat, 0);
    const aloft = lonLatToEcef(lon, lat, 0.05); // 0.05 mercator-Z units of altitude

    expect(length(aloft)).toBeGreaterThan(length(ground));

    const dirGround = normalize(ground);
    const dirAloft = normalize(aloft);
    expect(dirAloft.x).toBeCloseTo(dirGround.x, 9);
    expect(dirAloft.y).toBeCloseTo(dirGround.y, 9);
    expect(dirAloft.z).toBeCloseTo(dirGround.z, 9);
  });
});

describe("mercatorToGlobe", () => {
  const mercPos: Vec3 = { x: 0.512, y: 0.271, z: 0.0004 };
  const ecef = lonLatToEcef(10, 20, 0.0004);
  // A plausible-looking projectionToMercatorMatrix: not identity, so a bug that
  // accidentally short-circuits to identity wouldn't slip past this test.
  const someMatrix = [
    0.7, 0, 0, 0,
    0, 0.7, 0, 0,
    0, 0, 0.7, 0,
    0.1, 0.2, 0.3, 1,
  ];

  it("at uTransition >= 1, returns the flat mercator position bit-identical (not just close)", () => {
    const result = mercatorToGlobe(mercPos, ecef, someMatrix, 1, null);
    expect(result.x).toBe(mercPos.x);
    expect(result.y).toBe(mercPos.y);
    expect(result.z).toBe(mercPos.z);
    expect(result.cull).toBe(1);

    // Also true for transition > 1 (Mapbox shouldn't send this, but the early-out
    // uses >=, not ===, so it should still hold).
    const result2 = mercatorToGlobe(mercPos, ecef, someMatrix, 1.5, null);
    expect(result2.x).toBe(mercPos.x);
    expect(result2.y).toBe(mercPos.y);
    expect(result2.z).toBe(mercPos.z);
  });

  it("with no globe matrix at all (mercator-only fallback), also returns the flat position bit-identical", () => {
    // This is the "render() got only 2 arguments" fallback case from the recipe:
    // globeToMerc is null regardless of what transition value is passed.
    const result = mercatorToGlobe(mercPos, ecef, null, 0, null);
    expect(result.x).toBe(mercPos.x);
    expect(result.y).toBe(mercPos.y);
    expect(result.z).toBe(mercPos.z);
    expect(result.cull).toBe(1);
  });

  it("at uTransition = 0 (full globe), the result comes from the ECEF->mercator matrix, not mercPos", () => {
    const result = mercatorToGlobe(mercPos, ecef, someMatrix, 0, null);
    // Should NOT equal the flat mercator input -- it must actually be transformed.
    expect(result.x).not.toBe(mercPos.x);
    // Sanity: matches applying someMatrix to ecef by hand (column-major mat4 * vec4).
    const expectedX = someMatrix[0]! * ecef.x + someMatrix[4]! * ecef.y + someMatrix[8]! * ecef.z + someMatrix[12]!;
    const expectedY = someMatrix[1]! * ecef.x + someMatrix[5]! * ecef.y + someMatrix[9]! * ecef.z + someMatrix[13]!;
    const expectedZ = someMatrix[2]! * ecef.x + someMatrix[6]! * ecef.y + someMatrix[10]! * ecef.z + someMatrix[14]!;
    expect(result.x).toBeCloseTo(expectedX, 9);
    expect(result.y).toBeCloseTo(expectedY, 9);
    expect(result.z).toBeCloseTo(expectedZ, 9);
  });

  it("without a camera position, culling is disabled (cull = 1) even in full globe mode", () => {
    const result = mercatorToGlobe(mercPos, ecef, someMatrix, 0, null);
    expect(result.cull).toBe(1);
  });

  it("a point facing directly away from the camera is culled toward 0", () => {
    // Camera sitting far out along +z; a point whose outward normal faces -z
    // (i.e. the far side of the globe from this camera) should be culled.
    const farSideEcef = lonLatToEcef(180, 0, 0); // outward normal points toward -z
    const cameraEcef: Vec3 = { x: 0, y: 0, z: GLOBE_RADIUS * 4 };
    const result = mercatorToGlobe(mercPos, farSideEcef, someMatrix, 0, cameraEcef);
    expect(result.cull).toBeLessThan(0.05);
  });

  it("a point facing directly toward the camera is fully visible (cull = 1)", () => {
    const nearSideEcef = lonLatToEcef(0, 0, 0); // outward normal points toward +z
    const cameraEcef: Vec3 = { x: 0, y: 0, z: GLOBE_RADIUS * 4 };
    const result = mercatorToGlobe(mercPos, nearSideEcef, someMatrix, 0, cameraEcef);
    expect(result.cull).toBeCloseTo(1, 6);
  });

  it("culling is disabled (mixed to 1) as transition approaches the flat plane", () => {
    const farSideEcef = lonLatToEcef(180, 0, 0);
    const cameraEcef: Vec3 = { x: 0, y: 0, z: GLOBE_RADIUS * 4 };
    const nearlyFlat = mercatorToGlobe(mercPos, farSideEcef, someMatrix, 0.99, cameraEcef);
    expect(nearlyFlat.cull).toBeGreaterThan(0.9);
  });
});
