import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { getEmbedPreferences, getEmbeddedRuntimeToken, reportEmbedMapStatus } from "./embedBridge";
import { createGlowLayer } from "./glowLayer";
import type { PointPalette } from "./airports";

/**
 * Wires up the map + custom layer + a handful of sliders. No framework, no
 * state management -- this is deliberately the smallest amount of glue code
 * that lets you see globe-hugging working and poke at its parameters.
 */

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id} in index.html`);
  return el as T;
}

const tokenWarning = byId<HTMLDivElement>("token-warning");
const tokenWarningMessage = byId<HTMLParagraphElement>("token-warning-message");
const preferences = getEmbedPreferences();
const zh = { title: "貼合地球的點", zoom: "縮放", projection: "投影", transition: "轉換", color: "發光配色", solar: "日耀", aurora: "極光", plasma: "等離子", ice: "冰藍", size: "點大小 ×", opacity: "不透明度", core: "核心亮度", controls: "控制項" };

document.documentElement.dataset.theme = preferences.theme;
document.documentElement.dataset.embed = String(preferences.embed);
if (preferences.embed) {
  document.documentElement.lang = preferences.lang;
  if (preferences.lang === "zh-TW") document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    const text = zh[el.dataset.i18n as keyof typeof zh];
    if (text) el.textContent = text;
  });
}

function setupHudToggle() {
  if (!preferences.embed) return;
  const hud = byId<HTMLDivElement>("hud");
  const toggle = byId<HTMLButtonElement>("hud-toggle");
  const setCollapsed = (collapsed: boolean) => {
    hud.classList.toggle("hud-collapsed", collapsed);
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.textContent = preferences.lang === "zh-TW" ? (collapsed ? "顯示控制項" : "隱藏控制項") : (collapsed ? "Show controls" : "Hide controls");
  };
  setCollapsed(true);
  toggle.addEventListener("click", () => setCollapsed(!hud.classList.contains("hud-collapsed")));
}

setupHudToggle();

function showTokenFailure(status?: number) {
  tokenWarningMessage.textContent = status
    ? preferences.embed && preferences.lang === "zh-TW" ? `Mapbox 拒絕此 token（HTTP ${status}）。請輸入可公開使用且允許此 origin 的 token，然後重新載入場景。` : `Mapbox rejected this token (HTTP ${status}). Enter a public token that is valid and allowed for this origin, then run the scene again.`
    : preferences.embed && preferences.lang === "zh-TW" ? "找不到 Mapbox access token。獨立執行時，請在自己的 .env 設定 VITE_MAPBOX_TOKEN，然後重新啟動 Vite。" : "No Mapbox access token found. In standalone mode, set VITE_MAPBOX_TOKEN in your own .env and restart Vite.";
  tokenWarning.classList.add("visible");
}

// Requirement: never read any .env file ourselves and never hardcode a token
// -- only import.meta.env.VITE_MAPBOX_TOKEN, which Vite populates from the
// user's own .env (see .env.example). If it's missing, show a friendly
// message instead of letting mapbox-gl throw on every tile request.
void getEmbeddedRuntimeToken(import.meta.env.VITE_MAPBOX_TOKEN ?? "").then((token) => {
  if (!token) showTokenFailure();
  else {
    mapboxgl.accessToken = token;
    startMap();
  }
});

function startMap() {
  const map = new mapboxgl.Map({
    container: "map",
    style: preferences.theme === "light" ? "mapbox://styles/mapbox/light-v11" : "mapbox://styles/mapbox/dark-v11",
    // mapbox-gl-js v3 already defaults to globe projection at low zoom for
    // most styles, but we set it explicitly so this example behaves the same
    // way regardless of which style you swap in.
    projection: "globe",
    zoom: 1.3,
    center: [10, 15],
    pitch: 0,
  });

  // Auth/network errors (e.g. an invalid token) surface as 'error' events
  // rather than thrown exceptions -- catch the common case and point at the
  // same fix as the "no token at all" case, rather than a blank map.
  map.on("error", (e) => {
    const status = (e.error as { status?: number } | undefined)?.status;
    if (status === 401 || status === 403) {
      showTokenFailure(status);
    }
    reportEmbedMapStatus("error", status);
  });

  const sizeMulEl = byId<HTMLInputElement>("size-mul");
  const opacityEl = byId<HTMLInputElement>("opacity");
  const coreBoostEl = byId<HTMLInputElement>("core-boost");
  const paletteEl = byId<HTMLSelectElement>("point-palette");
  const sizeMulValueEl = byId<HTMLSpanElement>("size-mul-value");
  const opacityValueEl = byId<HTMLSpanElement>("opacity-value");
  const coreBoostValueEl = byId<HTMLSpanElement>("core-boost-value");
  const zoomValueEl = byId<HTMLSpanElement>("zoom-value");
  const projectionValueEl = byId<HTMLSpanElement>("projection-value");
  const transitionValueEl = byId<HTMLSpanElement>("transition-value");

  const syncSliderLabels = () => {
    sizeMulValueEl.textContent = Number(sizeMulEl.value).toFixed(2);
    opacityValueEl.textContent = Number(opacityEl.value).toFixed(2);
    coreBoostValueEl.textContent = Number(coreBoostEl.value).toFixed(2);
  };
  syncSliderLabels();
  for (const el of [sizeMulEl, opacityEl, coreBoostEl]) {
    el.addEventListener("input", syncSliderLabels);
  }

  const layer = createGlowLayer({
    getSizeMul: () => Number(sizeMulEl.value),
    getOpacity: () => Number(opacityEl.value),
    getCoreBoost: () => Number(coreBoostEl.value),
    getPalette: () => paletteEl.value as PointPalette,
    theme: preferences.theme,
    // HUD readout of the exact globe state this frame -- see globeLayer's
    // render() for where isGlobe/transition actually come from.
    onFrameInfo: ({ isGlobe, transition }) => {
      projectionValueEl.textContent = isGlobe ? "globe" : "mercator";
      transitionValueEl.textContent = transition.toFixed(2);
    },
  });

  map.on("load", () => {
    map.setFog(preferences.theme === "light" ? { color: "#f4f8f7", "high-color": "#ffffff", "space-color": "#dcebea", "horizon-blend": 0.08 } : { color: "#202020", "high-color": "#292929", "space-color": "#202020", "horizon-blend": 0.12 });
    map.addLayer(layer);
    reportEmbedMapStatus("loaded");
  });

  // Zoom changes independently of render() frames (e.g. while idle), so it
  // gets its own listener rather than piggybacking on onFrameInfo.
  const updateZoomReadout = () => {
    zoomValueEl.textContent = map.getZoom().toFixed(2);
  };
  updateZoomReadout();
  map.on("zoom", updateZoomReadout);
}
