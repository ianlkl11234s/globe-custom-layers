/** Pure, schematic circular-orbit geometry. Not TLE propagation. */
export const EARTH_RADIUS_KM = 6371;
export const MAPBOX_GLOBE_RADIUS = 8192 / (2 * Math.PI);

export interface SchematicOrbit {
  id: string;
  label: string;
  altitudeKm: number;
  inclinationDeg: number;
  raanDeg: number;
  phaseDeg: number;
  color: string;
  periodSec: number;
}

export interface OrbitPoint {
  mercator: [number, number, number];
  ecef: [number, number, number];
  radius: number;
}

const rad = (deg: number) => deg * Math.PI / 180;

/** Position in Mapbox's ECEF axes: x=east, y=south, z=longitude 0. */
export function orbitPointAt(orbit: SchematicOrbit, anomalyDeg: number, altitudeScale = 1): OrbitPoint {
  const u = rad(anomalyDeg + orbit.phaseDeg);
  const raan = rad(orbit.raanDeg);
  const inc = rad(orbit.inclinationDeg);
  const zeroLng = Math.cos(raan) * Math.cos(u) - Math.sin(raan) * Math.sin(u) * Math.cos(inc);
  const east = Math.sin(raan) * Math.cos(u) + Math.cos(raan) * Math.sin(u) * Math.cos(inc);
  const north = Math.sin(u) * Math.sin(inc);
  const altitudeKm = orbit.altitudeKm * altitudeScale;
  const radius = MAPBOX_GLOBE_RADIUS * (1 + altitudeKm / EARTH_RADIUS_KM);
  const ecef: [number, number, number] = [east * radius, -north * radius, zeroLng * radius];
  const lat = Math.asin(north);
  const lng = Math.atan2(east, zeroLng);
  const mercatorX = lng / (2 * Math.PI) + 0.5;
  const mercatorY = (1 - Math.log(Math.tan(Math.PI / 4 + lat / 2)) / Math.PI) / 2;
  // Matches Mapbox's altitude scaling: metres / circumference / cos(latitude).
  const mercatorZ = (altitudeKm / EARTH_RADIUS_KM) / (2 * Math.PI * Math.max(Math.cos(lat), 1e-6));
  return { mercator: [mercatorX, mercatorY, mercatorZ], ecef, radius };
}

export function sampleOrbit(orbit: SchematicOrbit, segments = 180, altitudeScale = 1): OrbitPoint[] {
  return Array.from({ length: segments + 1 }, (_, index) => orbitPointAt(orbit, index / segments * 360, altitudeScale));
}

export const SCHEMATIC_ORBITS: SchematicOrbit[] = [
  { id: "aurora", label: "Aurora · polar", altitudeKm: 560, inclinationDeg: 97.6, raanDeg: 18, phaseDeg: 0, color: "#7ee7ff", periodSec: 28 },
  { id: "harbor", label: "Harbor · inclined", altitudeKm: 780, inclinationDeg: 53, raanDeg: 112, phaseDeg: 88, color: "#ffb86b", periodSec: 34 },
  { id: "meridian", label: "Meridian · MEO", altitudeKm: 4200, inclinationDeg: 56, raanDeg: 226, phaseDeg: 202, color: "#df9cff", periodSec: 52 },
];
