/**
 * Brute-force "nearest point within a pixel radius" search in screen space.
 *
 * This is the ground truth this example's spatial grid (spatialGrid.ts) is
 * tested against, AND it is a perfectly reasonable implementation on its own
 * for the ~1,174-point scale this example runs at -- see the README's
 * "Deliberate simplifications" for where the line between "just loop over
 * it" and "you need an index" actually sits.
 */

export interface ScreenPoint {
  /** Opaque identifier, carried through untouched so callers can look the
   *  original record back up (this example uses an ICAO `ident`). */
  id: string;
  x: number;
  y: number;
}

/**
 * Returns the point closest to (x, y) among `points`, provided it is within
 * `radiusPx`; `null` if none qualify (including an empty `points` array).
 *
 * Tie-break rule, made explicit because "closest" is ambiguous when two
 * points are exactly equidistant: **the first point in input order wins**.
 * This falls out of using strict `<` (not `<=`) when updating the running
 * best -- a later point at the exact same distance never displaces an
 * earlier one. Deterministic, but not "closest in some other sense" (e.g.
 * insertion order is not meaningful data here) -- it is simply *a* fixed
 * rule, chosen because click-picking needs to return the same answer every
 * time for the same inputs, not because first-in-array is semantically
 * better than last-in-array.
 */
export function findNearestBruteForce(
  points: readonly ScreenPoint[],
  x: number,
  y: number,
  radiusPx: number,
): ScreenPoint | null {
  let best: ScreenPoint | null = null;
  let bestDist = Infinity;

  for (const p of points) {
    const dx = p.x - x;
    const dy = p.y - y;
    const dist = Math.hypot(dx, dy);
    if (dist <= radiusPx && dist < bestDist) {
      best = p;
      bestDist = dist;
    }
  }

  return best;
}
