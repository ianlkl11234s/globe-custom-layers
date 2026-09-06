/** Geometry and validation for injected, pre-sampled orbital rings. Not TLE propagation. */
export const EARTH_RADIUS_METERS = 6_371_000;
export const MAPBOX_GLOBE_RADIUS = 8192 / (2 * Math.PI);

export interface OrbitSample {
  /** WGS84 longitude and latitude in degrees; altitude is metres above mean Earth radius. */
  longitudeDeg: number;
  latitudeDeg: number;
  altitudeMeters: number;
}

export interface OrbitDefinition {
  id: string;
  label: string;
  color: string;
  /** A closed, ordered path. Repeat the first sample as the last sample. */
  path: readonly OrbitSample[];
  /** Optional moving marker provider; omitted means the ring has no marker. */
  satelliteAt?: (simSec: number) => OrbitSample;
}

export interface OrbitPoint {
  mercator: [number, number, number];
  ecef: [number, number, number];
  radius: number;
  longitudeDeg: number;
}

const rad = (deg: number) => deg * Math.PI / 180;
const finite = (value: number) => Number.isFinite(value);

export function validateOrbitDefinitions(orbits: readonly OrbitDefinition[]): void {
  if (!orbits.length) throw new Error("At least one orbit definition is required");
  const ids = new Set<string>();
  for (const orbit of orbits) {
    if (!orbit.id || ids.has(orbit.id)) throw new Error(`Orbit ids must be unique and non-empty: ${orbit.id}`);
    ids.add(orbit.id);
    if (orbit.path.length < 4) throw new Error(`${orbit.id}: a closed ring needs at least three distinct samples plus the repeated closing sample`);
    for (const sample of orbit.path) {
      if (![sample.longitudeDeg, sample.latitudeDeg, sample.altitudeMeters].every(finite) || Math.abs(sample.latitudeDeg) >= 90 || sample.altitudeMeters < 0) throw new Error(`${orbit.id}: samples require finite longitude, latitude (-90, 90), and non-negative altitudeMeters`);
    }
    const first = orbit.path[0]!; const last = orbit.path[orbit.path.length - 1]!;
    if (Math.abs(first.latitudeDeg - last.latitudeDeg) > 1e-6 || Math.abs(first.altitudeMeters - last.altitudeMeters) > 1e-6 || Math.abs((((first.longitudeDeg - last.longitudeDeg + 540) % 360) - 180)) > 1e-6) throw new Error(`${orbit.id}: path must be closed by repeating its first sample`);
    const distinct = new Set(orbit.path.slice(0, -1).map((sample) => `${sample.longitudeDeg},${sample.latitudeDeg},${sample.altitudeMeters}`));
    if (distinct.size < 3) throw new Error(`${orbit.id}: a closed ring needs at least three distinct samples`);
  }
}

/** Position in Mapbox's ECEF axes: x=east, y=south, z=longitude 0. */
export function orbitPointFromSample(sample: OrbitSample, altitudeScale = 1): OrbitPoint {
  if (!Number.isFinite(altitudeScale) || altitudeScale < 0) throw new Error("altitudeScale must be a finite non-negative number");
  const lat = rad(sample.latitudeDeg); const lng = rad(sample.longitudeDeg);
  const altitudeMeters = sample.altitudeMeters * altitudeScale;
  const radius = MAPBOX_GLOBE_RADIUS * (1 + altitudeMeters / EARTH_RADIUS_METERS);
  const east = Math.cos(lat) * Math.sin(lng); const north = Math.sin(lat); const zeroLng = Math.cos(lat) * Math.cos(lng);
  const ecef: [number, number, number] = [east * radius, -north * radius, zeroLng * radius];
  const mercatorX = lng / (2 * Math.PI) + 0.5;
  const mercatorY = (1 - Math.log(Math.tan(Math.PI / 4 + lat / 2)) / Math.PI) / 2;
  // Matches Mapbox's altitude scaling: metres / circumference / cos(latitude).
  const mercatorZ = (altitudeMeters / EARTH_RADIUS_METERS) / (2 * Math.PI * Math.max(Math.cos(lat), 1e-6));
  return { mercator: [mercatorX, mercatorY, mercatorZ], ecef, radius, longitudeDeg: sample.longitudeDeg };
}

/** True when the finite camera-to-point segment stays outside the Earth sphere. */
export function hasEarthLineOfSight(camera: readonly number[], point: readonly number[], earthRadius = MAPBOX_GLOBE_RADIUS): boolean {
  const dx = camera[0]! - point[0]!; const dy = camera[1]! - point[1]!; const dz = camera[2]! - point[2]!;
  const denominator = dx * dx + dy * dy + dz * dz;
  const t = denominator === 0 ? 0 : Math.max(0, Math.min(1, -(point[0]! * dx + point[1]! * dy + point[2]! * dz) / denominator));
  const x = point[0]! + dx * t; const y = point[1]! + dy * t; const z = point[2]! + dz * t;
  return x * x + y * y + z * z >= earthRadius * earthRadius;
}

/** Repositions only a flat Mercator endpoint so a dateline segment is locally continuous. */
export function unwrapMercatorX(startX: number, endX: number): number { return endX - startX > .5 ? endX - 1 : startX - endX > .5 ? endX + 1 : endX; }
