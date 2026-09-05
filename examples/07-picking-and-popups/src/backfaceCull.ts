import type { Vec3 } from "./globeProject";

/**
 * The backface test for screen-space picking (strategy 2 in this example).
 *
 * `map.project(lngLat)` turns a geographic coordinate into a screen pixel
 * using plain projection maths -- the same matrix multiply the vertex shader
 * runs, with no notion of "is this point currently on the far side of the
 * globe, hidden behind the sphere's own surface". Every point on a sphere,
 * front-facing or not, lands SOMEWHERE inside the globe's on-screen outline
 * once projected this way (a fact of perspective projection: the sphere's
 * silhouette on screen is the full extent any point on it can project to,
 * because the camera ray to any far-side point necessarily crosses the near
 * hemisphere first). So screen position alone cannot tell front from back --
 * you need this dot-product test, done in ECEF space, matching exactly what
 * `GLOBE_PROJECT_GLSL` in globeProject.ts does per-vertex for the *visual*
 * cull. This module exists so the *pickable* set of points can be filtered
 * by the same rule as the *visible* set, independently of any rendering call.
 *
 * See docs/01-hugging-the-globe/mapbox.md, "Step 4: cull the far side
 * yourself" for the derivation this mirrors.
 */

function length(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

function normalize(v: Vec3): Vec3 {
  const len = length(v) || 1; // guards the degenerate zero-vector input; never hit for real ECEF data
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/**
 * Raw front/back signal for one point, in [-1, 1]:
 *   1  = point faces directly at the camera (screen centre of a head-on view)
 *   0  = exactly at the horizon -- the true limb of the sphere as seen from
 *        this camera position
 *  -1  = point faces directly away from the camera (dead centre of the far
 *        side, antipodal to the sub-camera point)
 *
 * `pointEcef` is assumed to sit ON the sphere surface (this example's
 * airports have zero altitude), so `pointEcef` doubles as both the surface
 * position AND -- once normalized -- the outward surface normal at that
 * position. A point with nonzero altitude would need the two kept separate,
 * exactly as `mercatorToGlobe` in globeProject.ts does (its `dir` vs `surf`).
 *
 * Exported (not just `isFrontFacing`) because the exact value matters for
 * testing the horizon boundary precisely, and because a HUD could show it
 * as a continuous "how central is this hit" readout if you wanted one.
 */
export function frontFacingDot(pointEcef: Vec3, cameraEcef: Vec3): number {
  const dir = normalize(pointEcef);
  const toCam = normalize(subtract(cameraEcef, pointEcef));
  return dot(dir, toCam);
}

/**
 * Boolean cull decision for picking. `>= 0` is an inclusive horizon: a point
 * exactly at the limb (dot === 0) counts as pickable. That choice is
 * arbitrary -- the true horizon is a measure-zero line, so almost no real
 * click will land exactly on it -- but it has to be *some* fixed choice, and
 * inclusive-at-zero is the one this function makes. Contrast with the soft
 * `smoothstep(-0.08, 0.02, d)` the *shader* uses for the visual cull (see
 * globeProject.ts's `mercatorToGlobe`): that one fades alpha over a band so
 * the horizon reads as atmosphere, not a hard edge. Picking has no pixels to
 * fade -- a click either finds a candidate or it doesn't -- so a hard
 * boolean cutoff is the right shape here, just at a different (single)
 * threshold than the shader's soft band.
 */
export function isFrontFacing(pointEcef: Vec3, cameraEcef: Vec3): boolean {
  return frontFacingDot(pointEcef, cameraEcef) >= 0;
}
