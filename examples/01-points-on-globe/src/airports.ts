/**
 * Loads public/airports.json and turns it into the generic point shape
 * `GlowPointsScene` consumes: `{ lon, lat, colorHex, sizeNorm }[]`.
 *
 * IMPORTANT: `sizeNorm` here is NOT real traffic/passenger data. OurAirports
 * (the source of the lon/lat/name data) doesn't publish traffic figures, so
 * we synthesize a size purely from a hash of each airport's `ident` code.
 * That gives a stable, varied-looking distribution of point sizes across a
 * screen full of hubs -- it has no relationship to how busy any airport
 * actually is. Don't read anything into which airports render "big".
 */

export interface AirportPoint {
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
 * Fetches and decodes public/airports.json, produced by
 * scripts/fetch-airports.mjs (either real OurAirports large_airport rows, or
 * a synthetic sphere-of-points fallback -- see that script's docstring). The
 * two cases are rendered identically; check `airports.json`'s own `source`
 * field if you need to know which one you're looking at.
 */
export async function loadAirports(): Promise<AirportPoint[]> {
  const res = await fetch("/airports.json");
  if (!res.ok) throw new Error(`Failed to fetch /airports.json: HTTP ${res.status}`);
  const data = (await res.json()) as AirportsFile;

  return data.airports.map(([ident, , lon, lat]) => {
    // sqrt-compress the hash so the size distribution is a bit less flat than
    // a raw uniform hash would give -- purely a visual choice, still synthetic.
    const sizeNorm = Math.sqrt(hashToUnitFloat(ident));
    return {
      lon,
      lat,
      sizeNorm,
      colorHex: syntheticColorRamp(sizeNorm),
    };
  });
}
