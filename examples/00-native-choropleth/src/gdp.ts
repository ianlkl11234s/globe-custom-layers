import type { Expression } from "mapbox-gl";

export const GDP_PROPERTY = "gdp_usd";
export const NULL_COLOR = "#9aa3a5";
export const PALETTES = {
  teal: ["#d9f0ee", "#8ecdc4", "#3c9693", "#145b69", "#082f49"],
  amber: ["#fff3cf", "#f7cd77", "#df8c3e", "#a44727", "#59251f"],
} as const;
export type PaletteName = keyof typeof PALETTES;

export type GdpFeatureCollection = GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon, Record<string, unknown>>;

export function isGdpFeatureCollection(value: unknown): value is GdpFeatureCollection {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { type?: unknown; features?: unknown };
  return candidate.type === "FeatureCollection" && Array.isArray(candidate.features) && candidate.features.every((feature) => {
    if (!feature || typeof feature !== "object") return false;
    const current = feature as { geometry?: { type?: unknown }; properties?: Record<string, unknown> | null };
    const gdp = current.properties?.[GDP_PROPERTY];
    return (current.geometry?.type === "Polygon" || current.geometry?.type === "MultiPolygon") && (gdp === null || typeof gdp === "number");
  });
}

export async function loadGdp(): Promise<GdpFeatureCollection> {
  const response = await fetch("./europe-gdp-2023.geojson");
  if (!response.ok) throw new Error(`GDP fixture request failed: ${response.status}`);
  const data: unknown = await response.json();
  if (!isGdpFeatureCollection(data) || data.features.length === 0) throw new Error("GDP fixture is missing or empty; replace public/europe-gdp-2023.geojson with the attributed 2023 fixture");
  return data;
}

export function gdpFillExpression(palette: PaletteName): Expression {
  const colors = PALETTES[palette];
  return ["case", [">", ["to-number", ["get", GDP_PROPERTY], -1], 0], ["step", ["ln", ["get", GDP_PROPERTY]], colors[0], Math.log(1e9), colors[1], Math.log(1e10), colors[2], Math.log(1e11), colors[3], Math.log(1e12), colors[4]], NULL_COLOR];
}

export function paletteName(value: string): PaletteName { return value === "amber" ? "amber" : "teal"; }
