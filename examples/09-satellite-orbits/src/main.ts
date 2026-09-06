import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { createOrbitLayer } from "./orbitLayer";
import { getEmbedPreferences, getEmbeddedRuntimeToken, reportEmbedMapStatus } from "./embedBridge";

const byId = <T extends HTMLElement>(id: string) => { const element = document.getElementById(id); if (!element) throw new Error(`Missing #${id}`); return element as T; };
const preferences = getEmbedPreferences();
document.documentElement.dataset.theme = preferences.theme;
document.documentElement.lang = preferences.lang;
void getEmbeddedRuntimeToken(import.meta.env.VITE_MAPBOX_TOKEN ?? "").then((token) => {
  if (!token) { byId("token-warning").classList.add("visible"); reportEmbedMapStatus("error"); return; }
  mapboxgl.accessToken = token;
  start();
});

function start() {
  const map = new mapboxgl.Map({ container: "map", style: "mapbox://styles/mapbox/dark-v11", projection: "globe", center: [121, 24], zoom: 1.65 });
  const altitude = byId<HTMLInputElement>("altitude"); const speed = byId<HTMLInputElement>("speed"); const play = byId<HTMLButtonElement>("play"); const altitudeValue = byId("altitude-value"); const speedValue = byId("speed-value"); const state = byId("projection-state");
  let playing = true; let simSec = 0; let lastMs: number | null = null;
  const updateLabels = () => { altitudeValue.textContent = `${Number(altitude.value).toFixed(1)}×`; speedValue.textContent = `${Number(speed.value).toFixed(1)}×`; };
  altitude.addEventListener("input", updateLabels); speed.addEventListener("input", updateLabels); updateLabels();
  play.addEventListener("click", () => { playing = !playing; play.textContent = playing ? "Pause orbit" : "Resume orbit"; });
  const getSimSec = () => { const now = performance.now(); const dt = lastMs === null ? 0 : Math.min((now - lastMs) / 1000, .1); lastMs = now; if (playing) simSec += dt * Number(speed.value); return simSec; };
  map.on("load", () => { map.addLayer(createOrbitLayer({ getSimSec, getAltitudeScale: () => Number(altitude.value), onFrame: (globe) => { state.textContent = globe ? "globe · ECEF" : "mercator transition"; } })); reportEmbedMapStatus("loaded"); });
  map.on("error", (event) => { const status = (event.error as { status?: number } | undefined)?.status; if (status === 401 || status === 403) byId("token-warning").classList.add("visible"); reportEmbedMapStatus("error", status); });
}
