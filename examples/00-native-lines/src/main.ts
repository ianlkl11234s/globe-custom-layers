import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { loadCables } from "./cables";
import { clampLineControls, DEFAULT_LINE_CONTROLS } from "./lineStyle";
import { getEmbeddedRuntimeToken, reportEmbedMapStatus } from "./embedBridge";

const status = document.querySelector<HTMLElement>("#status")!;
const width = document.querySelector<HTMLInputElement>("#width")!;
const opacity = document.querySelector<HTMLInputElement>("#opacity")!;
const color = document.querySelector<HTMLInputElement>("#color")!;
const params = new URLSearchParams(location.search);
const embedded = params.get("embed") === "1";
const chinese = params.get("lang") !== "en";
document.documentElement.lang = chinese ? "zh-TW" : "en";
document.querySelector<HTMLDetailsElement>("#panel")!.open = !embedded;
if (chinese) {
  document.querySelector("#title")!.textContent = "線段圖層 · 大西洋海底電纜";
  document.querySelector("#description")!.textContent = "OpenStreetMap / ODbL 真實幾何；群眾資料並不完整，不可視為工程圖。";
  document.querySelector("#width-label")!.textContent = "線寬";
  document.querySelector("#opacity-label")!.textContent = "透明度";
  document.querySelector("#color-label")!.textContent = "顏色";
}

void getEmbeddedRuntimeToken(import.meta.env.VITE_MAPBOX_TOKEN ?? "").then(async (token) => {
  if (!token) { status.textContent = "Set VITE_MAPBOX_TOKEN to render this Mapbox example."; return; }
  mapboxgl.accessToken = token;
  const map = new mapboxgl.Map({ container: "map", style: "mapbox://styles/mapbox/light-v11", center: [-42, 42], zoom: 2.45, projection: "globe" });
  map.on("style.load", async () => {
    try {
      const data = await loadCables();
      map.addSource("cables", { type: "geojson", data });
      map.addLayer({ id: "cables", type: "line", source: "cables", paint: { "line-color": DEFAULT_LINE_CONTROLS.color, "line-width": DEFAULT_LINE_CONTROLS.width, "line-opacity": DEFAULT_LINE_CONTROLS.opacity } });
      const update = () => { const next = clampLineControls({ width: +width.value, opacity: +opacity.value, color: color.value }); map.setPaintProperty("cables", "line-width", next.width); map.setPaintProperty("cables", "line-opacity", next.opacity); map.setPaintProperty("cables", "line-color", next.color); };
      [width, opacity, color].forEach((control) => control.addEventListener("input", update));
      status.textContent = `${data.features.length} cable geometries · native Mapbox line layer`;
      reportEmbedMapStatus("loaded");
    } catch (error) { status.textContent = error instanceof Error ? error.message : "Could not load cable fixture."; reportEmbedMapStatus("error"); }
  });
  map.on("error", () => reportEmbedMapStatus("error"));
});
