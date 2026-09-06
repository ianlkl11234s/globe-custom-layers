/**
 * Display-only Taiwan ADIZ approximation. It deliberately has no legal,
 * operational, source-ceiling, or sovereignty claim. Keep it separate from
 * authoritative aeronautical data: this cookbook has none bundled here.
 */
export type LonLat = readonly [lon: number, lat: number];

export const TAIWAN_ADIZ_SCHEMATIC_RING: readonly LonLat[] = [
  [123.0, 29.0], [123.0, 23.0], [121.3, 21.0], [117.3, 21.0], [117.3, 29.0], [123.0, 29.0],
];

export const BOUNDARY_STATUS = "illustrative-schematic" as const;
