/**
 * Turns a list of hub airports into origin-destination arc routes, and
 * samples each route into a polyline of (lon, lat, height) waypoints via
 * `slerp.ts`. This file is pure geometry/math -- no Three.js, no Mapbox --
 * so it can be unit-tested without a WebGL context (see arcs.test.ts). The
 * GPU-buffer side of turning these samples into a `THREE.LineSegments` mesh
 * lives in `arcsScene.ts`.
 */

import type { LonLat } from "./slerp";
import { slerpLonLat, unwrapLongitude } from "./slerp";
import type { Hub } from "./airports";

export interface ArcRoute {
  originIdent: string;
  destIdent: string;
  origin: LonLat;
  dest: LonLat;
}

export interface ArcSample {
  lon: number;
  lat: number;
  /**
   * Radial offset in mercator-Z units, in the same unit `lonLatToEcef`'s
   * `mercZ` parameter expects (see globeProject.ts). 0 at both endpoints,
   * peaking at the arc's midpoint -- see `sampleArc`'s docstring.
   */
  heightMercZ: number;
}

/**
 * Every unordered pair of hubs, once each -- C(hubs.length, 2) routes. With
 * this example's 20 hubs (see airports.ts) that's 190 arcs, which is why
 * `buildArcRoutes` doesn't bother with any curation logic: "all pairs of a
 * hand-picked hub list" already lands in the 50-200 arc range this example
 * targets, with no need to separately pick which O-D pairs to draw.
 *
 * These are NOT real flight routes -- there is no dataset behind "hub A
 * actually flies to hub B" here, just every combination of the hand-picked
 * list in airports.ts. Don't read "these two cities are connected" into any
 * single arc.
 */
export function buildArcRoutes(hubs: Hub[]): ArcRoute[] {
  const routes: ArcRoute[] = [];
  for (let i = 0; i < hubs.length; i++) {
    for (let j = i + 1; j < hubs.length; j++) {
      const a = hubs[i]!;
      const b = hubs[j]!;
      routes.push({
        originIdent: a.ident,
        destIdent: b.ident,
        origin: { lon: a.lon, lat: a.lat },
        dest: { lon: b.lon, lat: b.lat },
      });
    }
  }
  return routes;
}

/**
 * Samples `vertexCount` waypoints along the great-circle arc from `origin`
 * to `dest`, evenly spaced in the slerp parameter `t` (NOT in real distance --
 * see slerpUnitVectors's docstring for why constant angular speed is exactly
 * what makes slerp the right tool here).
 *
 * `vertexCount` is deliberately a VERTEX count, not a segment count: this is
 * the same number the "segments per arc" HUD slider drives directly, so that
 * dragging it to its minimum, 2, produces exactly the origin and destination
 * points and nothing else -- one raw line segment, the straight chord that
 * cuts through the planet this example exists to show. There is no way to
 * request "zero subdivision" as a segment COUNT without an off-by-one
 * argument at every call site; as a vertex count, 2 says exactly what it
 * means.
 *
 * Height follows a `sin(pi * t)` bump: 0 at t=0 and t=1 (both endpoints sit
 * on the surface, unraised), peaking at `peakHeightMercZ` at t=0.5. This is
 * a deliberately simple stand-in for a real flight-path profile (climb, cruise,
 * descend) -- see this example's README for why a real profile isn't needed
 * to demonstrate globe-hugging, and why the height itself is exaggerated well
 * beyond a real cruise altitude for visibility.
 */
export function sampleArc(origin: LonLat, dest: LonLat, vertexCount: number, peakHeightMercZ: number): ArcSample[] {
  if (vertexCount < 2) {
    throw new Error(`sampleArc: vertexCount must be >= 2 (an arc needs at least its two endpoints), got ${vertexCount}`);
  }

  const samples: ArcSample[] = [];
  let prevLon: number | null = null;

  for (let i = 0; i < vertexCount; i++) {
    const t = i / (vertexCount - 1);
    const { lon, lat } = slerpLonLat(origin, dest, t);
    // See unwrapLongitude's docstring: this keeps the returned sequence
    // continuous across the antimeridian instead of jumping ~360 degrees at
    // whichever sample happens to cross atan2's branch cut.
    // Explicit annotation breaks a circular inference TS otherwise reports
    // here: this variable's type depends on `prevLon`'s (via the ternary),
    // and `prevLon`'s control-flow type across loop iterations depends on
    // what gets assigned to it below -- which is this variable.
    const continuousLon: number = prevLon === null ? lon : unwrapLongitude(prevLon, lon);
    prevLon = continuousLon;

    const heightMercZ = peakHeightMercZ * Math.sin(Math.PI * t);
    samples.push({ lon: continuousLon, lat, heightMercZ });
  }

  return samples;
}
