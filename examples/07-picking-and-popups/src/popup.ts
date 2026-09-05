import mapboxgl from "mapbox-gl";
import type { Map as MapboxMap, LngLatLike } from "mapbox-gl";

/**
 * The one display path both picking strategies share. The point of this
 * example is that strategies 1 and 2 differ ONLY in *how they find* a hit --
 * once you have an ident/name and a place to anchor the popup, what happens
 * next is identical. Keeping this in one function is what makes that true in
 * the code, not just in the README's prose.
 */
export function showAirportPopup(map: MapboxMap, lngLat: LngLatLike, name: string, ident: string): void {
  new mapboxgl.Popup({ closeButton: true, closeOnClick: true })
    .setLngLat(lngLat)
    .setHTML(
      `<strong>${escapeHtml(name)}</strong><br>` + `<span style="opacity:.7">${escapeHtml(ident)}</span>`,
    )
    .addTo(map);
}

function escapeHtml(s: string): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return s.replace(/[&<>"']/g, (c) => map[c]!);
}
