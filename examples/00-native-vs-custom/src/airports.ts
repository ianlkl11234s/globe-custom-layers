/**
 * Loads public/airports.json -- the same file, from the same source, as
 * examples/01-points-on-globe/public/airports.json -- and turns it into
 * one flat record shape that feeds BOTH rendering paths in this example:
 *
 *   - The native `circle` layer (src/nativeLayer.ts) needs `ident`/`name`
 *     for its click popup, on top of position/color/size.
 *   - The custom Three.js layer (src/glowPointsScene.ts, kept as a local
 *     self-contained copy of examples/01-points-on-globe) only reads `lon`/`lat`/`colorHex`/
 *     `sizeNorm` and ignores the rest -- which is why this interface is
 *     still named `AirportPoint`: it's a superset of what that scene imports.
 *
 * IMPORTANT: `sizeNorm` here is NOT real traffic/passenger data. OurAirports
 * (the source of the lon/lat/name data) doesn't publish traffic figures, so
 * we synthesize a size purely from a hash of each airport's `ident` code.
 * That gives a stable, varied-looking distribution of point sizes -- it has
 * no relationship to how busy any airport actually is. Don't read anything
 * into which airports render "big". (Identical synthesis to
 * 01-points-on-globe/src/airports.ts, duplicated here rather than
 * imported -- see this repo's "self-contained examples" rule.)
 */

export interface AirportPoint {
  ident: string;
  name: string;
  lon: number;
  lat: number;
  colorHex: string;
  /** 0..1, synthetic (see module docstring) -- NOT real traffic. */
  sizeNorm: number;
}

interface AirportsFile {
  source: string;
  fields: ["ident", "name", "lon", "lat"];
  airports: Array<[string, string, number, number]>;
}

/**
 * Deterministic string -> [0, 1) hash (FNV-1a variant). Used only to give
 * each airport a stable-but-arbitrary "weight" for sizeNorm, since we have no
 * real traffic data to size points by. Deterministic means reloading the
 * page always renders the same sizes, which matters for a demo people will
 * screenshot and compare.
 */
function hashToUnitFloat(s: string): number {
  let h = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193); // FNV prime
  }
  return (h >>> 0) / 0xffffffff;
}

/**
 * Synthetic white -> orange -> red ramp, keyed by the same sizeNorm used for
 * point size (mirrors the "big and bright" pattern of a real hub-traffic
 * visualization, without claiming to have real traffic data behind it).
 */
function syntheticColorRamp(t: number): string {
  const k = Math.max(0, Math.min(1, t));
  const white: [number, number, number] = [255, 255, 255];
  const orange: [number, number, number] = [255, 140, 26];
  const red: [number, number, number] = [255, 30, 30];
  const lerp = (a: [number, number, number], b: [number, number, number], m: number) =>
    a.map((v, i) => Math.round(v + (b[i]! - v) * m)) as [number, number, number];
  const [r, g, b] = k < 0.5 ? lerp(white, orange, k / 0.5) : lerp(orange, red, (k - 0.5) / 0.5);
  return `rgb(${r},${g},${b})`;
}

/**
 * Fetches and decodes public/airports.json (real OurAirports large_airport
 * rows -- see examples/01-points-on-globe/scripts/fetch-airports.mjs for
 * how it was produced; that script isn't duplicated here, only its output).
 */
export async function loadAirports(): Promise<AirportPoint[]> {
  const res = await fetch("/airports.json");
  if (!res.ok) throw new Error(`Failed to fetch /airports.json: HTTP ${res.status}`);
  const data = (await res.json()) as AirportsFile;

  return data.airports.map(([ident, name, lon, lat]) => {
    // sqrt-compress the hash so the size distribution is a bit less flat than
    // a raw uniform hash would give -- purely a visual choice, still synthetic.
    const sizeNorm = Math.sqrt(hashToUnitFloat(ident));
    return {
      ident,
      name,
      lon,
      lat,
      sizeNorm,
      colorHex: syntheticColorRamp(sizeNorm),
    };
  });
}
