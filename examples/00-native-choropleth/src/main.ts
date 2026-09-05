import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { gdpFillExpression, loadGdp, paletteName } from "./gdp";
import { getEmbeddedRuntimeToken, reportEmbedMapStatus } from "./embedBridge";

const status = document.querySelector<HTMLElement>("#status")!;
const opacity = document.querySelector<HTMLInputElement>("#opacity")!;
const palette = document.querySelector<HTMLSelectElement>("#palette")!;
const border = document.querySelector<HTMLInputElement>("#border")!;
const params = new URLSearchParams(location.search);
const embedded = params.get("embed") === "1";
const chinese = params.get("lang") !== "en";
document.documentElement.lang = chinese ? "zh-TW" : "en";
document.querySelector<HTMLDetailsElement>("#panel")!.open = !embedded;
if (chinese) {
  document.querySelector("#title")!.textContent = "面積圖層 · 歐洲各國 GDP 2023";
  document.querySelector("#description")!.textContent = "World Bank GDP（current US$）與 Natural Earth 國界；灰色代表缺值，不是 0。";
  document.querySelector("#opacity-label")!.textContent = "透明度";
  document.querySelector("#palette-label")!.textContent = "GDP 色階";
  document.querySelector("#border-label")!.textContent = "國界顏色";
}

void getEmbeddedRuntimeToken(import.meta.env.VITE_MAPBOX_TOKEN ?? "").then(async (token) => {
  if (!token) { status.textContent = "Set VITE_MAPBOX_TOKEN to render this Mapbox example."; return; }
  mapboxgl.accessToken = token;
  const map = new mapboxgl.Map({ container: "map", style: "mapbox://styles/mapbox/light-v11", center: [14, 52], zoom: 2.7, projection: "globe" });
  map.on("style.load", async () => {
    try {
      const data = await loadGdp();
      map.addSource("gdp", { type: "geojson", data });
      map.addLayer({ id: "gdp-fill", type: "fill", source: "gdp", paint: { "fill-color": gdpFillExpression("teal"), "fill-opacity": 0.78, "fill-outline-color": "#36545c" } });
      const update = () => { map.setPaintProperty("gdp-fill", "fill-opacity", Math.max(0.05, Math.min(1, +opacity.value))); map.setPaintProperty("gdp-fill", "fill-color", gdpFillExpression(paletteName(palette.value))); map.setPaintProperty("gdp-fill", "fill-outline-color", border.value); };
      [opacity, palette, border].forEach((control) => control.addEventListener("input", update));
      status.textContent = `${data.features.length} polygons · GDP current US$ (2023)`;
      reportEmbedMapStatus("loaded");
    } catch (error) { status.textContent = error instanceof Error ? error.message : "Could not load GDP fixture."; reportEmbedMapStatus("error"); }
  });
  map.on("error", () => reportEmbedMapStatus("error"));
});
