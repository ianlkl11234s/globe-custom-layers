import type { ScreenPoint } from "./nearestPoint";

/**
 * A minimal uniform spatial grid over 2D screen points, so a click doesn't
 * have to brute-force every candidate on the map.
 *
 * At this example's real scale (~1,174 airports, one query per click, not
 * per frame) a plain loop over every point genuinely is fast enough -- see
 * nearestPoint.ts and the README's "Deliberate simplifications" for that
 * distinction. This class exists to demonstrate the *shape* of the fix once
 * you have more candidates than that (thousands of vehicles, a country's
 * worth of sensors, ...): bucket points into fixed-size cells by screen
 * position, then only scan the handful of cells that could possibly contain
 * something within `radiusPx` of the click, instead of every point that
 * exists anywhere on screen.
 *
 * Deliberately NOT a general-purpose spatial index: no rebalancing, no
 * removal, no bulk-load optimization, one fixed cell size for the grid's
 * whole lifetime. Build a new one per query (this example's usage) or call
 * `clear()` and re-`insert()` when the underlying points move.
 */
export class SpatialGrid {
  private readonly cellSize: number;
  private readonly cells = new Map<string, ScreenPoint[]>();

  /**
   * @param cellSize Side length of one grid cell, in the same units as the
   *   points you insert (screen pixels, here). Must be >= the largest
   *   `radiusPx` you intend to query with -- see `queryNearest`'s docstring
   *   for why a too-small cell size silently produces wrong (incomplete)
   *   results rather than throwing.
   */
  constructor(cellSize: number) {
    if (!(cellSize > 0)) throw new Error(`SpatialGrid: cellSize must be > 0, got ${cellSize}`);
    this.cellSize = cellSize;
  }

  private cellCoord(v: number): number {
    return Math.floor(v / this.cellSize);
  }

  private cellKey(cx: number, cy: number): string {
    return `${cx},${cy}`;
  }

  insert(point: ScreenPoint): void {
    const key = this.cellKey(this.cellCoord(point.x), this.cellCoord(point.y));
    const bucket = this.cells.get(key);
    if (bucket) bucket.push(point);
    else this.cells.set(key, [point]);
  }

  clear(): void {
    this.cells.clear();
  }

  /**
   * Nearest inserted point to (x, y) within `radiusPx`, or `null` if none
   * qualify. Matches `findNearestBruteForce`'s semantics exactly when
   * `radiusPx` here equals the radius passed there -- see
   * spatialGrid.test.ts for the equivalence check against random data.
   *
   * Correctness depends on `radiusPx <= cellSize` (the constructor does not
   * enforce this, because a caller who wants a bigger on-the-fly radius than
   * the grid was built for is a real, supportable use -- see below): a point
   * up to `radiusPx` away from (x, y) can only fall in a cell whose index is
   * within one cell-width of (x, y)'s own cell, PROVIDED `radiusPx` does not
   * exceed `cellSize`. If it does, scan a wider ring: this method already
   * derives the cell range from `radiusPx` itself (`Math.ceil(radiusPx /
   * cellSize)`), rather than hardcoding "1 cell in every direction", so a
   * caller building the grid with a smaller `cellSize` than their largest
   * query radius still gets correct (if less efficient) results.
   */
  queryNearest(x: number, y: number, radiusPx: number): ScreenPoint | null {
    const cx = this.cellCoord(x);
    const cy = this.cellCoord(y);
    const reach = Math.max(1, Math.ceil(radiusPx / this.cellSize));

    let best: ScreenPoint | null = null;
    let bestDist = Infinity;

    for (let gx = cx - reach; gx <= cx + reach; gx++) {
      for (let gy = cy - reach; gy <= cy + reach; gy++) {
        const bucket = this.cells.get(this.cellKey(gx, gy));
        if (!bucket) continue;
        for (const p of bucket) {
          const dx = p.x - x;
          const dy = p.y - y;
          const dist = Math.hypot(dx, dy);
          // Same tie-break shape as findNearestBruteForce (strict `<`), but
          // "first in input order" is not a meaningful guarantee here: which
          // point is scanned first depends on cell iteration order, not
          // insertion order, whenever two candidates land in different
          // cells. Only relied upon within a single cell's own bucket, where
          // insertion order (== `Array.push` order) is preserved. See
          // spatialGrid.test.ts for what IS guaranteed: exact agreement with
          // brute force on non-adversarial (random, essentially-never-tied)
          // data.
          if (dist <= radiusPx && dist < bestDist) {
            best = p;
            bestDist = dist;
          }
        }
      }
    }

    return best;
  }
}
