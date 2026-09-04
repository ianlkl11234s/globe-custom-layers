/**
 * Loads public/airports.json (the same file, and the same fetch script, as
 * `examples/01-points-on-globe` -- see that example's README for the full
 * provenance) and picks out a fixed list of major hub airports to draw
 * origin-destination arcs between.
 *
 * Positions and names are real (OurAirports, public domain, `large_airport`
 * rows only). WHICH airports are "hubs" here is NOT: OurAirports does not
 * publish traffic figures, so `HUB_IDENTS` below is hand-picked purely for
 * geographic spread (every populated continent gets at least one) so the
 * resulting arcs fan out across the whole globe instead of clustering in one
 * region. Don't read anything into which airports made this list -- it is
 * not a "busiest airports" ranking.
 */

export interface Hub {
  ident: string;
  name: string;
  lon: number;
  lat: number;
}

interface AirportsFile {
  source: string;
  fields: ["ident", "name", "lon", "lat"];
  airports: Array<[string, string, number, number]>;
}

/**
 * 20 airports, hand-picked from public/airports.json's real OurAirports rows
 * for continent-level spread: East/Southeast Asia, the Middle East, Europe,
 * Africa, North America, South America, and Oceania. 20 hubs produces
 * C(20,2) = 190 unordered origin-destination pairs, which is what
 * `arcs.ts`'s `buildArcRoutes` turns into the ~190 arcs this example renders
 * -- comfortably inside the 50-200 arc range this example targets.
 */
const HUB_IDENTS = [
  "RCTP", // Taiwan Taoyuan
  "RJAA", // Tokyo Narita
  "RKSI", // Seoul Incheon
  "ZBAA", // Beijing Capital
  "WSSS", // Singapore Changi
  "OMDB", // Dubai
  "EGLL", // London Heathrow
  "LFPG", // Paris Charles de Gaulle
  "EDDF", // Frankfurt Main
  "LTFJ", // Istanbul Sabiha Gokcen
  "FAOR", // Johannesburg O.R. Tambo
  "KJFK", // New York John F. Kennedy
  "KATL", // Atlanta Hartsfield-Jackson
  "KORD", // Chicago O'Hare
  "KLAX", // Los Angeles
  "CYYZ", // Toronto Pearson
  "CYVR", // Vancouver
  "MMMX", // Mexico City Benito Juarez
  "SBGR", // Sao Paulo Guarulhos
  "YSSY", // Sydney Kingsford Smith
] as const;

/**
 * Fetches and decodes public/airports.json, then filters it down to
 * `HUB_IDENTS`, preserving that list's order (used later so `buildArcRoutes`'
 * output order is deterministic run to run).
 */
export async function loadHubs(): Promise<Hub[]> {
  const res = await fetch("/airports.json");
  if (!res.ok) throw new Error(`Failed to fetch /airports.json: HTTP ${res.status}`);
  const data = (await res.json()) as AirportsFile;

  // A Map so a duplicate ident in the source data (public/airports.json has
  // a couple, e.g. two FAOR rows with identical coordinates -- an upstream
  // OurAirports quirk, not something this example needs to fix) can't produce
  // two hubs with the same ident.
  const byIdent = new Map<string, Hub>();
  for (const [ident, name, lon, lat] of data.airports) {
    if (!byIdent.has(ident) && (HUB_IDENTS as readonly string[]).includes(ident)) {
      byIdent.set(ident, { ident, name, lon, lat });
    }
  }

  const hubs: Hub[] = [];
  const missing: string[] = [];
  for (const ident of HUB_IDENTS) {
    const hub = byIdent.get(ident);
    if (hub) hubs.push(hub);
    else missing.push(ident);
  }
  if (missing.length > 0) {
    // Not fatal -- fewer hubs just means fewer arcs -- but worth knowing
    // about if OurAirports ever renames/retires one of these idents.
    console.warn(`[airports] ${missing.length} hub ident(s) not found in airports.json:`, missing);
  }
  return hubs;
}
