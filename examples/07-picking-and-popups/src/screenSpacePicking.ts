import type { Map as MapboxMap, PointLike } from "mapbox-gl";
import type { Vec3 } from "./globeProject";
import type { PickingCandidate } from "./pickingCandidates";
import { isFrontFacing } from "./backfaceCull";
import { SpatialGrid } from "./spatialGrid";
import type { ScreenPoint } from "./nearestPoint";

/**
 * Strategy 2: screen-space picking.
 *
 * Projects every (surviving) candidate to screen pixels with `map.project()`
 * and finds the nearest one to the click, within `radiusPx`. Unlike the
 * companion-layer strategy, this owns its own backface test end to end --
 * `map.project()` alone cannot tell you a point is hidden behind the globe
 * (see backfaceCull.ts's module docstring for why not), so skipping that
 * step here is not a shortcut, it is the specific bug this example's HUD
 * toggle exists to demonstrate.
 *
 * This function is intentionally NOT unit-tested directly: it calls
 * `map.project()`, a real Mapbox GL method that needs a live map + WebGL
 * context to mean anything. Everything it delegates to (`isFrontFacing`,
 * `SpatialGrid`) IS unit-tested in isolation -- see backfaceCull.test.ts,
 * nearestPoint.test.ts and spatialGrid.test.ts. This function is thin
 * orchestration on top of those, on purpose.
 */

export interface ScreenSpacePickResult {
  hit: { ident: string; name: string; lon: number; lat: number } | null;
  /** Wall-clock time for this call, in milliseconds (`performance.now()` delta). */
  ms: number;
  /** How many candidates survived the backface filter and were projected+searched. */
  consideredCount: number;
}

export interface ScreenSpacePickParams {
  map: MapboxMap;
  candidates: readonly PickingCandidate[];
  clickPoint: PointLike;
  /**
   * This frame's camera position in ECEF space, or `null`. Passing `null`
   * -- whether because the map isn't in globe projection, or because the
   * caller has turned the "backface culling in picking" HUD toggle off --
   * disables the backface filter entirely: every candidate is projected and
   * searched, including ones actually hidden behind the globe. That is
   * exactly the failure mode this example's backface-cull toggle exists to
   * let you trigger on demand.
   */
  cameraEcef: Vec3 | null;
  radiusPx: number;
}

export function pickScreenSpace(params: ScreenSpacePickParams): ScreenSpacePickResult {
  const t0 = performance.now();

  const grid = new SpatialGrid(Math.max(params.radiusPx, 1));
  const byId = new Map<string, PickingCandidate>();
  let consideredCount = 0;

  for (const c of params.candidates) {
    if (params.cameraEcef && !isFrontFacing(c.ecef, params.cameraEcef)) continue;

    const screen = params.map.project([c.lon, c.lat]);
    const point: ScreenPoint = { id: c.ident, x: screen.x, y: screen.y };
    grid.insert(point);
    byId.set(c.ident, c);
    consideredCount++;
  }

  const clickX = Array.isArray(params.clickPoint) ? params.clickPoint[0] : params.clickPoint.x;
  const clickY = Array.isArray(params.clickPoint) ? params.clickPoint[1] : params.clickPoint.y;
  const nearest = grid.queryNearest(clickX, clickY, params.radiusPx);
  const candidate = nearest ? byId.get(nearest.id) : undefined;

  const ms = performance.now() - t0;
  return {
    hit: candidate ? { ident: candidate.ident, name: candidate.name, lon: candidate.lon, lat: candidate.lat } : null,
    ms,
    consideredCount,
  };
}
