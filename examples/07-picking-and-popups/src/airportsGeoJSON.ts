import type { AirportPoint } from "./airports";

/**
 * Minimal local GeoJSON types, deliberately NOT imported from the `geojson`
 * package (this example has no such dependency -- see the allowed-deps list
 * in the repo's contributing guide) and NOT referencing the ambient
 * `GeoJSON` namespace that mapbox-gl's own .d.ts declares types against.
 * That ambient namespace only resolves when something upstream of this
 * project happens to have `@types/geojson` installed -- it's a devDependency
 * of mapbox-gl itself, not a dependency, so a fresh `npm install` of THIS
 * example does not pull it in. `tsconfig.json`'s `skipLibCheck: true` masks
 * that gap in practice (mapbox-gl.d.ts's own unresolved references don't
 * become errors here), but relying on masked errors is not the same as not
 * having the problem. Defining our own tiny structural types sidesteps the
 * question entirely, which is more in the spirit of "copy this folder and
 * it still runs" than hoping a global type happens to be present.
 */
export interface AirportFeatureProperties {
  ident: string;
  name: string;
  colorHex: string;
  sizeNorm: number;
}

export interface AirportFeature {
  type: "Feature";
  geometry: {
    type: "Point";
    /** [longitude, latitude] -- GeoJSON's order, NOT [lat, lon]. See below. */
    coordinates: [number, number];
  };
  properties: AirportFeatureProperties;
}

export interface AirportFeatureCollection {
  type: "FeatureCollection";
  features: AirportFeature[];
}

/**
 * Converts loaded airport rows into the GeoJSON shape the native `circle`
 * layer's source consumes.
 *
 * THE COORDINATE ORDER IS [lon, lat], NOT [lat, lon]. This is the single
 * most common bug when hand-building GeoJSON -- everyday speech says
 * "latitude, longitude" (e.g. "25.03, 121.56" for Taipei), but the GeoJSON
 * spec (RFC 7946 §3.1.1) fixes the axis order the other way around. Get it
 * backwards and every point still renders -- just mirrored across the
 * equator and shifted by up to 180 degrees of longitude, which reads as
 * "the data is wrong" long before anyone suspects "the axis order is
 * swapped". `AirportPoint` already stores `lon`/`lat` as separate named
 * fields specifically so this function has no ambiguous pair to get wrong.
 */
export function airportsToGeoJSON(rows: AirportPoint[]): AirportFeatureCollection {
  return {
    type: "FeatureCollection",
    features: rows.map((r) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [r.lon, r.lat] },
      properties: {
        ident: r.ident,
        name: r.name,
        colorHex: r.colorHex,
        sizeNorm: r.sizeNorm,
      },
    })),
  };
}
