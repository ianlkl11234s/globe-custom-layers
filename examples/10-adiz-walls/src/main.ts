import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { createAdizWallLayer } from "./adizWallLayer";
import { getEmbedPreferences, getEmbeddedRuntimeToken, reportEmbedMapStatus } from "./embedBridge";

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`missing #${id}`);
  return element as T;
}

const tokenWarning = byId<HTMLDivElement>("token-warning");
const preferences = getEmbedPreferences();
document.documentElement.dataset.theme = preferences.theme;
document.documentElement.lang = preferences.lang;
void getEmbeddedRuntimeToken(import.meta.env.VITE_MAPBOX_TOKEN ?? "").then((token) => {
  if (!token) { tokenWarning.classList.add("visible"); reportEmbedMapStatus("error"); return; }
  mapboxgl.accessToken = token;
  const height = byId<HTMLInputElement>("height");
  const heightValue = byId<HTMLSpanElement>("height-value");
  const updateHeight = () => { heightValue.textContent = height.value; };
  updateHeight();
  const map = new mapboxgl.Map({ container: "map", style: "mapbox://styles/mapbox/dark-v11", projection: "globe", center: [120.4, 24.8], zoom: 4.25, pitch: 42, bearing: -20 });
  map.on("error", (event) => {
    const status = (event.error as { status?: number } | undefined)?.status;
    if (status === 401 || status === 403) tokenWarning.classList.add("visible");
    reportEmbedMapStatus("error", status);
  });
  const layer = createAdizWallLayer({ getHeightMeters: () => Number(height.value) * 1000 });
  map.on("load", () => { map.addLayer(layer); reportEmbedMapStatus("loaded"); });
  height.addEventListener("input", () => { updateHeight(); map.triggerRepaint(); });
});
