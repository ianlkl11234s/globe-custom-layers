export type Position = readonly [longitude: number, latitude: number];
export interface PolygonGeometry { type: "Polygon"; coordinates: readonly (readonly Position[])[]; }
export interface MultiPolygonGeometry { type: "MultiPolygon"; coordinates: readonly (readonly (readonly Position[])[])[]; }
export type BoundaryGeometry = PolygonGeometry | MultiPolygonGeometry;
export interface WallVertex { lon: number; lat: number; heightRatio: 0 | 1; }

const MAX_MERCATOR_LATITUDE = 85.05112878;
const EARTH_RADIUS_METERS = 6_371_008.8;
const samePosition = (a: Position, b: Position) => a[0] === b[0] && a[1] === b[1];

/** Removes a GeoJSON closing coordinate and unwraps each edge across ±180°. */
export function unwrapRing(ring: readonly Position[], ringLabel = "Boundary ring"): Array<{ lon: number; lat: number }> {
  if (ring.length === 0) throw new Error(`${ringLabel} is empty.`);
  for (const position of ring) {
    if (!Number.isFinite(position[0]) || !Number.isFinite(position[1])) throw new Error(`${ringLabel} contains a non-finite longitude or latitude.`);
    if (position[1] < -MAX_MERCATOR_LATITUDE || position[1] > MAX_MERCATOR_LATITUDE) throw new Error(`${ringLabel} is outside Web Mercator's supported latitude range.`);
  }
  const source = ring.length > 1 && samePosition(ring[0]!, ring.at(-1)!) ? ring.slice(0, -1) : ring;
  if (source.length < 3) throw new Error(`${ringLabel} needs at least three coordinates after removing its closing coordinate.`);
  const result = [{ lon: source[0]![0], lat: source[0]![1] }];
  for (let index = 1; index < source.length; index++) {
    const [rawLon, lat] = source[index]!; let lon = rawLon; const previousLon = result[index - 1]!.lon;
    while (lon - previousLon > 180) lon -= 360;
    while (lon - previousLon < -180) lon += 360;
    result.push({ lon, lat });
  }
  if (new Set(result.map(({ lon, lat }) => `${lon},${lat}`)).size < 3) throw new Error(`${ringLabel} needs three distinct coordinates.`);
  for (let index = 0; index < result.length; index++) {
    const a = result[index]!, b = result[(index + 1) % result.length]!;
    if (a.lon === b.lon && a.lat === b.lat) throw new Error(`${ringLabel} contains an adjacent duplicate coordinate (a zero-length segment).`);
  }
  return result;
}

function densifyEdge(a: { lon: number; lat: number }, b: { lon: number; lat: number }, maxSegmentMeters: number) {
  let endLon = b.lon;
  while (endLon - a.lon > 180) endLon -= 360;
  while (endLon - a.lon < -180) endLon += 360;
  const end = { lon: endLon, lat: b.lat };
  const rad = Math.PI / 180, aLon = a.lon * rad, aLat = a.lat * rad, bLon = end.lon * rad, bLat = end.lat * rad;
  const dot = Math.min(1, Math.max(-1, Math.sin(aLat) * Math.sin(bLat) + Math.cos(aLat) * Math.cos(bLat) * Math.cos(bLon - aLon)));
  const angle = Math.acos(dot), count = Math.max(1, Math.ceil(EARTH_RADIUS_METERS * angle / maxSegmentMeters)), sinAngle = Math.sin(angle), points = [{ ...a }];
  for (let step = 1; step < count; step++) {
    const t = step / count, wa = Math.sin((1 - t) * angle) / sinAngle, wb = Math.sin(t * angle) / sinAngle;
    const x = wa * Math.cos(aLat) * Math.cos(aLon) + wb * Math.cos(bLat) * Math.cos(bLon);
    const y = wa * Math.cos(aLat) * Math.sin(aLon) + wb * Math.cos(bLat) * Math.sin(bLon);
    const z = wa * Math.sin(aLat) + wb * Math.sin(bLat); let lon = Math.atan2(y, x) / rad;
    while (lon - points.at(-1)!.lon > 180) lon -= 360;
    while (lon - points.at(-1)!.lon < -180) lon += 360;
    points.push({ lon, lat: Math.atan2(z, Math.hypot(x, y)) / rad });
  }
  points.push(end); return points;
}

export function normalizeBoundaryGeometry(data: BoundaryGeometry): Array<readonly Position[]> {
  if (!data || (data.type !== "Polygon" && data.type !== "MultiPolygon")) throw new Error("Vertical boundary walls accept only GeoJSON Polygon or MultiPolygon geometry.");
  const polygons = data.type === "Polygon" ? [data.coordinates] : data.coordinates;
  if (polygons.length === 0) throw new Error("Boundary geometry has no polygons.");
  const rings: Array<readonly Position[]> = [];
  polygons.forEach((polygon, polygonIndex) => { if (polygon.length === 0) throw new Error(`Polygon ${polygonIndex} has no rings.`); polygon.forEach((ring, ringIndex) => { unwrapRing(ring, `Polygon ${polygonIndex}, ring ${ringIndex}`); rings.push(ring); }); });
  return rings;
}

/** Emits side faces for every exterior and interior ring; it deliberately never emits a top fill. */
export function buildWallVertices(data: BoundaryGeometry, maxSegmentMeters = 100_000): WallVertex[] {
  if (!Number.isFinite(maxSegmentMeters) || maxSegmentMeters <= 0) throw new Error("maxSegmentMeters must be a positive finite meter value.");
  const vertices: WallVertex[] = [];
  for (const ring of normalizeBoundaryGeometry(data)) {
    const points = unwrapRing(ring);
    for (let i = 0; i < points.length; i++) {
      const edge = densifyEdge(points[i]!, points[(i + 1) % points.length]!, maxSegmentMeters);
      for (let segment = 0; segment < edge.length - 1; segment++) { const a = edge[segment]!, b = edge[segment + 1]!; vertices.push({ ...a, heightRatio: 0 }, { ...b, heightRatio: 0 }, { ...b, heightRatio: 1 }, { ...a, heightRatio: 0 }, { ...b, heightRatio: 1 }, { ...a, heightRatio: 1 }); }
    }
  }
  return vertices;
}
