import type { LonLat } from "./adizBoundary";

export interface WallVertex { lon: number; lat: number; heightRatio: 0 | 1; }

/** Removes an optional closing point and keeps each consecutive edge short across ±180°. */
export function unwrapRing(ring: readonly LonLat[]): Array<{ lon: number; lat: number }> {
  const source = ring.length > 1 && ring[0]![0] === ring.at(-1)![0] && ring[0]![1] === ring.at(-1)![1] ? ring.slice(0, -1) : ring;
  if (source.length < 3) throw new Error("A wall needs at least three distinct boundary points.");
  const result: Array<{ lon: number; lat: number }> = [{ lon: source[0]![0], lat: source[0]![1] }];
  for (let index = 1; index < source.length; index++) {
    const [rawLon, lat] = source[index]!;
    let lon = rawLon;
    const previousLon = result[index - 1]!.lon;
    while (lon - previousLon > 180) lon -= 360;
    while (lon - previousLon < -180) lon += 360;
    result.push({ lon, lat });
  }
  return result;
}

/** Creates two triangles per closed edge: bottom-bottom-top / bottom-top-top. */
export function buildWallVertices(ring: readonly LonLat[]): WallVertex[] {
  const points = unwrapRing(ring);
  const vertices: WallVertex[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    vertices.push(
      { ...a, heightRatio: 0 }, { ...b, heightRatio: 0 }, { ...b, heightRatio: 1 },
      { ...a, heightRatio: 0 }, { ...b, heightRatio: 1 }, { ...a, heightRatio: 1 },
    );
  }
  return vertices;
}
