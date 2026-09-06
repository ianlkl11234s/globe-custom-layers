import { orbitPointFromSample, type OrbitDefinition, type OrbitSample } from "./orbitMath";

export interface SchematicOrbitSpec { id: string; label: string; altitudeKm: number; inclinationDeg: number; raanDeg: number; phaseDeg: number; color: string; periodSec: number; }
const rad = (deg: number) => deg * Math.PI / 180;

function sampleAt(orbit: SchematicOrbitSpec, anomalyDeg: number): OrbitSample {
  const u = rad(anomalyDeg + orbit.phaseDeg); const raan = rad(orbit.raanDeg); const inc = rad(orbit.inclinationDeg);
  const zeroLng = Math.cos(raan) * Math.cos(u) - Math.sin(raan) * Math.sin(u) * Math.cos(inc);
  const east = Math.sin(raan) * Math.cos(u) + Math.cos(raan) * Math.sin(u) * Math.cos(inc);
  const north = Math.sin(u) * Math.sin(inc);
  return { longitudeDeg: Math.atan2(east, zeroLng) * 180 / Math.PI, latitudeDeg: Math.asin(north) * 180 / Math.PI, altitudeMeters: orbit.altitudeKm * 1000 };
}

export const SCHEMATIC_ORBITS: readonly SchematicOrbitSpec[] = [
  { id: "aurora", label: "Aurora · polar", altitudeKm: 560, inclinationDeg: 97.6, raanDeg: 18, phaseDeg: 0, color: "#7ee7ff", periodSec: 28 },
  { id: "harbor", label: "Harbor · inclined", altitudeKm: 780, inclinationDeg: 53, raanDeg: 112, phaseDeg: 88, color: "#ffb86b", periodSec: 34 },
  { id: "meridian", label: "Meridian · MEO", altitudeKm: 4200, inclinationDeg: 56, raanDeg: 226, phaseDeg: 202, color: "#df9cff", periodSec: 52 },
];

export function createSchematicOrbits(segments = 180): OrbitDefinition[] { return SCHEMATIC_ORBITS.map((orbit) => ({ id: orbit.id, label: orbit.label, color: orbit.color, path: Array.from({ length: segments + 1 }, (_, index) => sampleAt(orbit, index / segments * 360)), satelliteAt: (simSec) => sampleAt(orbit, simSec / orbit.periodSec * 360) })); }
export function orbitPointAt(orbit: SchematicOrbitSpec, anomalyDeg: number, altitudeScale = 1) { return orbitPointFromSample(sampleAt(orbit, anomalyDeg), altitudeScale); }
export function sampleOrbit(orbit: SchematicOrbitSpec, segments = 180, altitudeScale = 1) { return Array.from({ length: segments + 1 }, (_, index) => orbitPointAt(orbit, index / segments * 360, altitudeScale)); }
