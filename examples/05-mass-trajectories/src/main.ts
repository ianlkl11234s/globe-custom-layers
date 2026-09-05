import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { getEmbedPreferences, getEmbeddedRuntimeToken, reportEmbedMapStatus } from "./embedBridge";
import { createTrajectoryLayer } from "./trajectoryLayer";
import type { EvictionStrategy } from "./slotPool";
import type { TrailPalette } from "./trajectoryScene";

/**
 * Wires up the map + custom layer + HUD. Same "smallest amount of glue
 * code" philosophy as every other example in this cookbook -- no
 * framework, no state management library.
 *
 * Unlike examples/04-moving-trajectory, there is no scrubber here: legs
 * (leg.ts) are generated forward-only and never stop, so there is no
 * fixed-length timeline to seek within, and no backward-time determinism
 * to support -- this example's whole point is what happens when demand for
 * a FIXED render capacity keeps growing, not scrubbing. See this repo's
 * README, "Deliberate simplifications".
 */

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id} in index.html`);
  return el as T;
}

const tokenWarning = byId<HTMLDivElement>("token-warning");
const tokenWarningMessage = byId<HTMLParagraphElement>("token-warning-message");
const preferences = getEmbedPreferences();
const zh = { title: "大量軌跡", objects: "物件", eviction: "淘汰策略", palette: "配色", multicolor: "多色", cool: "冷色", warm: "暖色", speed: "速度 ×", opacity: "不透明度", proof: "批次處理證明", active: "物件（運行中）", slots: "已使用 slots", draws: "draw calls", perSecond: "每秒淘汰", perUpdate: "每次更新 ms", zoom: "縮放", projection: "投影", transition: "轉換", heap: "min-heap（O(log capacity)）", linear: "線性掃描（O(capacity)）", transport: "軌跡以程序方式持續生成，不會停止，因此沒有固定長度的時間軸可拖曳。", controls: "控制項" };

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
  setCollapsed(window.innerWidth < 520);
  toggle.addEventListener("click", () => setCollapsed(!hud.classList.contains("hud-collapsed")));
}

setupHudToggle();

function showTokenFailure(status?: number) {
  tokenWarningMessage.textContent = status
    ? preferences.embed && preferences.lang === "zh-TW" ? `Mapbox 拒絕此 token（HTTP ${status}）。請輸入可公開使用且允許此 origin 的 token，然後重新載入場景。` : `Mapbox rejected this token (HTTP ${status}). Enter a public token that is valid and allowed for this origin, then run the scene again.`
    : preferences.embed && preferences.lang === "zh-TW" ? "找不到 Mapbox access token。獨立執行時，請在自己的 .env 設定 VITE_MAPBOX_TOKEN，然後重新啟動 Vite。" : "No Mapbox access token found. In standalone mode, set VITE_MAPBOX_TOKEN in your own .env and restart Vite.";
  tokenWarning.classList.add("visible");
}

// Never read any .env file ourselves, never hardcode a token -- only
// import.meta.env.VITE_MAPBOX_TOKEN, same rule as every example here.
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
    projection: "globe",
    zoom: 1.6,
    center: [10, 15],
    pitch: 0,
  });

  map.on("error", (e) => {
    const status = (e.error as { status?: number } | undefined)?.status;
    if (status === 401 || status === 403) {
      showTokenFailure(status);
    }
    reportEmbedMapStatus("error", status);
  });

  // --- HUD elements -------------------------------------------------------
  const objectsEl = byId<HTMLInputElement>("objects");
  const strategyEl = byId<HTMLSelectElement>("strategy");
  const paletteEl = byId<HTMLSelectElement>("palette");
  const speedEl = byId<HTMLInputElement>("speed");
  const opacityEl = byId<HTMLInputElement>("opacity");

  const objectsValueEl = byId<HTMLSpanElement>("objects-value");
  const speedValueEl = byId<HTMLSpanElement>("speed-value");
  const opacityValueEl = byId<HTMLSpanElement>("opacity-value");

  const zoomValueEl = byId<HTMLSpanElement>("zoom-value");
  const projectionValueEl = byId<HTMLSpanElement>("projection-value");
  const transitionValueEl = byId<HTMLSpanElement>("transition-value");

  const statObjectsEl = byId<HTMLSpanElement>("stat-objects");
  const statSlotsEl = byId<HTMLSpanElement>("stat-slots");
  const statDrawsEl = byId<HTMLSpanElement>("stat-draws");
  const statEvictionsEl = byId<HTMLSpanElement>("stat-evictions");
  const statMsEl = byId<HTMLSpanElement>("stat-ms");

  const playPauseEl = byId<HTMLButtonElement>("play-pause");

  const syncSliderLabels = () => {
    objectsValueEl.textContent = objectsEl.value;
    speedValueEl.textContent = Number(speedEl.value).toFixed(1);
    opacityValueEl.textContent = Number(opacityEl.value).toFixed(2);
  };
  syncSliderLabels();
  for (const el of [objectsEl, speedEl, opacityEl]) {
    el.addEventListener("input", syncSliderLabels);
  }

  // --- Playback clock -------------------------------------------------------
  // Forward-only wall-clock-driven simulation time -- no scrubber, see this
  // file's module docstring for why.
  let simTime = 0;
  let isPlaying = true;
  let lastWallMs: number | null = null;

  function setPlaying(playing: boolean) {
    isPlaying = playing;
    playPauseEl.textContent = preferences.embed && preferences.lang === "zh-TW" ? (isPlaying ? "暫停" : "播放") : (isPlaying ? "Pause" : "Play");
  }
  setPlaying(true);
  playPauseEl.addEventListener("click", () => setPlaying(!isPlaying));

  function getSimTime(): number {
    const now = performance.now();
    if (lastWallMs === null) lastWallMs = now;
    // Clamp so a backgrounded tab resumes with one bounded catch-up step
    // instead of every object's leg jumping arbitrarily far past its own
    // endTime at once -- same rule as 04's getSimTime().
    const dtMs = Math.min(now - lastWallMs, 100);
    lastWallMs = now;
    if (isPlaying) simTime += (dtMs / 1000) * Number(speedEl.value);
    return simTime;
  }

  // --- Evictions/sec: derived from the cumulative eviction counter --------
  let evictionWindowStartMs = performance.now();
  let evictionCountAtWindowStart = 0;
  let evictionsPerSecEma = 0;

  const layer = createTrajectoryLayer({
    getSimTime,
    getActiveCount: () => Number(objectsEl.value),
    getOpacity: () => Number(opacityEl.value),
    getStrategy: () => strategyEl.value as EvictionStrategy,
    getPalette: () => paletteEl.value as TrailPalette,
    theme: preferences.theme,
    onFrameInfo: ({ isGlobe, transition, stats, drawCalls }) => {
      projectionValueEl.textContent = isGlobe ? "globe" : "mercator";
      transitionValueEl.textContent = transition.toFixed(2);

      statObjectsEl.textContent = String(stats.activeCount);
      statSlotsEl.textContent = `${stats.slotsUsed} / ${stats.slotCapacity}`;
      statDrawsEl.textContent = String(drawCalls);
      statMsEl.textContent = `${stats.msPerUpdate.toFixed(3)} ms`;

      const nowMs = performance.now();
      const elapsedSec = (nowMs - evictionWindowStartMs) / 1000;
      if (elapsedSec >= 0.5) {
        const rate = (stats.evictionCountTotal - evictionCountAtWindowStart) / elapsedSec;
        evictionsPerSecEma = evictionsPerSecEma === 0 ? rate : evictionsPerSecEma * 0.5 + rate * 0.5;
        evictionWindowStartMs = nowMs;
        evictionCountAtWindowStart = stats.evictionCountTotal;
      }
      statEvictionsEl.textContent = evictionsPerSecEma.toFixed(0);
    },
  });

  map.on("load", () => {
    map.setFog(preferences.theme === "light" ? { color: "#f4f8f7", "high-color": "#ffffff", "space-color": "#dcebea", "horizon-blend": 0.08 } : { color: "#0b0d12", "high-color": "#1c2c35", "space-color": "#080b12", "horizon-blend": 0.12 });
    map.addLayer(layer);
    reportEmbedMapStatus("loaded");
  });

  const updateZoomReadout = () => {
    zoomValueEl.textContent = map.getZoom().toFixed(2);
  };
  updateZoomReadout();
  map.on("zoom", updateZoomReadout);
}
