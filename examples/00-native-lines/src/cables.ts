export type CableFeatureCollection = GeoJSON.FeatureCollection<GeoJSON.LineString | GeoJSON.MultiLineString>;

export function isCableFeatureCollection(value: unknown): value is CableFeatureCollection {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { type?: unknown; features?: unknown };
  return candidate.type === "FeatureCollection"
    && Array.isArray(candidate.features)
    && candidate.features.every((feature) => {
      const geometry = feature && typeof feature === "object" ? (feature as { geometry?: { type?: unknown } }).geometry : undefined;
      return geometry?.type === "LineString" || geometry?.type === "MultiLineString";
    });
}

export async function loadCables(): Promise<CableFeatureCollection> {
  const response = await fetch("./atlantic-submarine-cables.geojson");
  if (!response.ok) throw new Error(`cable fixture request failed: ${response.status}`);
  const data: unknown = await response.json();
  if (!isCableFeatureCollection(data) || data.features.length === 0) {
    throw new Error("cable fixture is missing or empty; replace public/atlantic-submarine-cables.geojson with the attributed OSM-derived fixture");
  }
  return data;
}
