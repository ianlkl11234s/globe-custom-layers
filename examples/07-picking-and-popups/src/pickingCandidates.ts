import { lonLatToEcef, type Vec3 } from "./globeProject";
import type { AirportPoint } from "./airports";

/**
 * One pickable candidate for the screen-space strategy: everything
 * `screenSpacePicking.ts` needs, computed once when data loads rather than
 * per click. `ecef` is precomputed at zero altitude for the same reason
 * `glowPointsScene.ts` precomputes it for rendering -- see globeProject.ts's
 * "Step 1" -- these airports do not move, so there is nothing to gain from
 * recomputing `lonLatToEcef` on every click.
 */
export interface PickingCandidate {
  ident: string;
  name: string;
  lon: number;
  lat: number;
  ecef: Vec3;
}

export function buildPickingCandidates(rows: readonly AirportPoint[]): PickingCandidate[] {
  return rows.map((r) => ({
    ident: r.ident,
    name: r.name,
    lon: r.lon,
    lat: r.lat,
    ecef: lonLatToEcef(r.lon, r.lat, 0),
  }));
}
