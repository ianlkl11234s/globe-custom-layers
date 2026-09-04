/**
 * Boundary-point generators for two kinds of "area" on the globe, plus the
 * one triangulation helper both of them share.
 *
 * Everything in this file works in plain lon/lat degrees -- it knows nothing
 * about Mapbox, mercator, or ECEF. `areasScene.ts` is the layer that takes
 * these boundary points and (a) converts each one to mercator + ECEF via
 * globeProject.ts, and (b) blends/culls them per frame. Keeping this file
 * ignorant of that lets it be unit-tested with plain numbers -- no WebGL
 * context, no Mapbox instance, no Three.js.
 *
 * IMPORTANT: this file's "radius" is a REAL-WORLD distance in kilometres
 * (great-circle distance on a sphere of Earth's mean radius). That is a
 * completely different number from `GLOBE_RADIUS` in globeProject.ts, which
 * is Mapbox's internal abstract radius in "mercator world units" (~1303.797,
 * derived from an 8192-unit tile extent, nothing to do with the Earth's
 * actual size). Don't let the two "radius" concepts blur together -- this
 * module's EARTH_RADIUS_KM never appears in globeProject.ts, and vice versa.
 */

export interface LonLat {
  lon: number;
  lat: number;
}

// Mean Earth radius in km (the "authalic" radius, ~6371.0088, is close enough
// that the extra digits don't matter for a demo -- this is not a geodesy
// library and doesn't model the WGS84 ellipsoid's flattening).
const EARTH_RADIUS_KM = 6371;

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

/** Wraps a longitude in degrees into (-180, 180]. */
function normalizeLonDeg(lonDeg: number): number {
  let l = lonDeg % 360;
  if (l <= -180) l += 360;
  if (l > 180) l -= 360;
  return l;
}

/**
 * Generates `segments` boundary points of a geodesic circle: every point is
 * exactly `radiusKm` of great-circle distance from `center`, on a sphere.
 * This is NOT the same shape as "every point `radiusKm` away in flat lon/lat
 * degrees" -- that flat notion of a circle doesn't correspond to any
 * consistent distance on a sphere, which is exactly why this function exists
 * instead of just adding/subtracting a fixed degree offset.
 *
 * Uses the standard "destination point given distance and bearing" formula
 * for a sphere (the same one behind every online great-circle calculator):
 *
 *   phi2    = asin( sin(phi1)*cos(delta) + cos(phi1)*sin(delta)*cos(theta) )
 *   lambda2 = lambda1 + atan2( sin(theta)*sin(delta)*cos(phi1),
 *                               cos(delta) - sin(phi1)*sin(phi2) )
 *
 * where phi/lambda are lat/lon in radians, delta = radiusKm / EARTH_RADIUS_KM
 * is the angular radius, and theta is the bearing (0 = due north), swept from
 * 0 to 2*PI across `segments` points. This traces a "small circle" (a circle
 * of constant angular radius around a point) rather than a great circle --
 * the two only coincide when delta = PI/2 (a 10,007 km "radius", a quarter of
 * the way around the Earth).
 *
 * Deliberately NOT handled: a circle whose radius exceeds the distance from
 * `center` to the nearest pole (i.e. a circle that swallows the pole) still
 * produces `segments` valid, on-sphere points, but they no longer trace a
 * single simple loop around `center` the way every other circle here does --
 * this generator doesn't special-case that, and downstream fan triangulation
 * would produce a self-intersecting mesh for it. None of this example's demo
 * shapes do that; see the README's "Deliberate simplifications" section.
 */
export function geodesicCircle(center: LonLat, radiusKm: number, segments: number): LonLat[] {
  const phi1 = center.lat * DEG2RAD;
  const lambda1 = center.lon * DEG2RAD;
  const delta = radiusKm / EARTH_RADIUS_KM;

  const sinPhi1 = Math.sin(phi1);
  const cosPhi1 = Math.cos(phi1);
  const sinDelta = Math.sin(delta);
  const cosDelta = Math.cos(delta);

  const points: LonLat[] = [];
  for (let i = 0; i < segments; i++) {
    const theta = (i / segments) * 2 * Math.PI;

    // Clamp before asin: floating point can push this a hair past +-1 for
    // theta values that land exactly on phi2 = +-90 (radiusKm very close to
    // the distance to a pole), and asin(1.0000000002) is NaN.
    const sinPhi2 = Math.min(1, Math.max(-1, sinPhi1 * cosDelta + cosPhi1 * sinDelta * Math.cos(theta)));
    const phi2 = Math.asin(sinPhi2);

    const y = Math.sin(theta) * sinDelta * cosPhi1;
    const x = cosDelta - sinPhi1 * sinPhi2;
    const lambda2 = lambda1 + Math.atan2(y, x);

    points.push({ lon: normalizeLonDeg(lambda2 * RAD2DEG), lat: phi2 * RAD2DEG });
  }
  return points;
}

/**
 * Generates the boundary of a lat/lon bounding box, subdividing each of the
 * four edges into `segmentsPerEdge` points. At `segmentsPerEdge = 1` this
 * returns exactly the four corners -- the "undivided" box the recipe warns
 * about, whose edges are straight chords in lon/lat space and visibly cut
 * into the globe once projected. Raising `segmentsPerEdge` adds intermediate
 * points along each edge (linear interpolation in lon/lat, which is what a
 * "constant latitude" or "constant longitude" line actually is -- these are
 * not geodesics either, but subdividing them still shortens each chord
 * enough to hug the sphere once there are more than a handful per edge).
 *
 * Winds counter-clockwise as seen in lon/lat space, starting at the
 * southwest corner: south edge, east edge, north edge, west edge. Corners
 * are NOT duplicated between adjacent edges (each corner is the first point
 * of the edge leaving it), so the total point count is exactly
 * `4 * segmentsPerEdge`.
 *
 * Deliberately NOT handled: a box that crosses the antimeridian (e.g.
 * sw.lon = 170, ne.lon = -170) is not detected or split -- linearly
 * interpolating 170 -> -170 goes the "short way" through 0, spanning 340
 * degrees of longitude the wrong way round the planet instead of 20. See the
 * README's "Deliberate simplifications" section; `geodesicCircle` above does
 * not share this limitation, because it works in bearing/distance rather
 * than raw longitude and so never needs to interpolate across the seam.
 */
export function bboxOutline(sw: LonLat, ne: LonLat, segmentsPerEdge: number): LonLat[] {
  const corners: [LonLat, LonLat][] = [
    [sw, { lon: ne.lon, lat: sw.lat }], // south: SW -> SE
    [{ lon: ne.lon, lat: sw.lat }, ne], // east: SE -> NE
    [ne, { lon: sw.lon, lat: ne.lat }], // north: NE -> NW
    [{ lon: sw.lon, lat: ne.lat }, sw], // west: NW -> SW
  ];

  const points: LonLat[] = [];
  for (const [a, b] of corners) {
    for (let i = 0; i < segmentsPerEdge; i++) {
      const t = i / segmentsPerEdge;
      points.push({ lon: a.lon + (b.lon - a.lon) * t, lat: a.lat + (b.lat - a.lat) * t });
    }
  }
  return points;
}

/**
 * Fan triangulation, indices only (no coordinates needed): every triangle
 * shares boundary point 0. Correct for ANY convex polygon, which is why this
 * example limits itself to circles and axis-aligned boxes -- a concave
 * boundary (or one with a hole) would need ear-clipping or a constrained
 * Delaunay triangulator to avoid producing triangles that poke outside the
 * shape, and this repo's dependency budget for examples stops at
 * `mapbox-gl` + `three` (see the README).
 *
 * Returns 3*(n-2) indices for n >= 3 boundary points, or an empty array for
 * n < 3 (nothing to fill -- a "circle" with 1 or 2 points has no interior,
 * only `geodesicCircle`/`bboxOutline` output that small on purpose, e.g. via
 * the segments slider's lowest setting).
 */
export function triangulateFan(vertexCount: number): number[] {
  const indices: number[] = [];
  for (let i = 1; i < vertexCount - 1; i++) {
    indices.push(0, i, i + 1);
  }
  return indices;
}
