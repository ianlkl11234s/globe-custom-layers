import { forgetRuntimeToken, isPublicMapboxToken, isTrustedReadyEvent, readRuntimeToken, saveRuntimeToken, unloadFrame } from "./bridgeState.js";
import { translate } from "./i18n.js";
const root = "https://github.com/ianlkl11234s/globe-custom-layers";
const scenes = {
  nativePoints: { path: "00-native-vs-custom", recipe: "docs/00-start-here/decision-tree.md" },
  nativeLines: { path: "00-native-lines", recipe: "docs/00-start-here/decision-tree.md" },
  nativeAreas: { path: "00-native-choropleth", recipe: "docs/00-start-here/decision-tree.md" },
  points: { path: "01-points-on-globe", recipe: "docs/02-effects/spark-points.md" },
  arcs: { path: "02-arcs-on-globe", recipe: "docs/01-hugging-the-globe/mapbox.md" },
  tracks: { path: "05-mass-trajectories", recipe: "docs/03-scaling-up/batched-trails.md" }
};
const sceneOrder = ["nativePoints", "nativeLines", "nativeAreas", "points", "arcs", "tracks"];
const nativeScenes = new Set(sceneOrder.slice(0, 3));
const $ = (selector) => document.querySelector(selector);
let language = "en";
let theme = "light";
let selected = "nativePoints";
let engine = "free";
let token = readRuntimeToken(window.sessionStorage);
let frame = null;
let free = null;
let freePromise = null;
let handshake = null;
let loadTimeout = null;
let mapMessage = null;
let freeStatus = { state: "loading" };
let activePage = true;
const gate = $("#token-gate");
const liveStage = $("#live-stage");
const freeStage = $("#free-stage");
const sidebarInput = $("#sidebar-token");
const status = $("#token-status");
const t = (key, values) => translate(language, key, values);
function sceneKey(suffix) {
  return `${selected}${suffix}`;
}
function freeNoteKey() {
  return nativeScenes.has(selected) ? "nativeDifference" : "freeDifference";
}
function statusText() {
  return mapMessage ? t(mapMessage.key, mapMessage.values) : "";
}
function setMapMessage(key, values) {
  mapMessage = { key, values };
  status.textContent = statusText();
}
function promptForScene() {
  const title = t(selected);
  const source = t(sceneKey("Source"));
  const acceptance = language === "zh-TW" ? nativeScenes.has(selected) ? `確認「${title}」只顯示自己的 geometry type，參數可立即更新且來源語意不被誤讀。` : selected === "points" ? "確認 ECEF 背面 cull 與 globe→Mercator 過渡的註冊正確性。" : selected === "arcs" ? "將 segments 設成 2 重現穿過地球的 chord，再提高 subdivision。" : "確認 playback 下的一個 draw call、eviction 與 globe/背面/transition。" : nativeScenes.has(selected) ? `Verify that ${title} displays only its own geometry type, updates immediately, and preserves source meaning.` : selected === "points" ? "Verify ECEF far-side culling and globe-to-Mercator registration." : selected === "arcs" ? "Set segments to 2 to reproduce the chord through Earth, then increase subdivision." : "Verify one draw call under playback, eviction, globe, backside, and transition.";
  if (nativeScenes.has(selected)) {
    const usingMapLibre = engine === "free";
    const engineName = usingMapLibre ? "MapLibre GL JS 5.24.0" : "Mapbox GL JS 3.30.0";
    const intro = language === "zh-TW" ? `用 ${engineName} 為 [YOUR DATA] 建立「${title}」原生圖層。` : `Build a native ${title} layer for [YOUR DATA] with ${engineName}.`;
    const implementation = usingMapLibre ? `${root}/blob/main/site/freeGlobe.js` : `${root}/tree/main/examples/${scenes[selected].path}`;
    return `${intro}

Read ${root}/blob/main/AGENTS.md first; prefer native layers when sufficient.
Implementation: ${implementation}
Decision guide: ${root}/blob/main/docs/00-start-here/decision-tree.md
Data provenance: ${root}/blob/main/docs/data-sources.md

${source}
${acceptance}

Keep source attribution and missing-data semantics. Do not turn incomplete OSM coverage or null GDP into absence or zero. Verify this geometry type, its controls, camera, and globe projection in a browser.`;
  }
  if (engine === "free") {
    const intro = language === "zh-TW" ? `用 MapLibre GL JS 5.24.0 為 [YOUR DATA] 建立「${title}」。不需 Mapbox token。` : `Build ${title} for [YOUR DATA] with MapLibre GL JS 5.24.0, without a Mapbox token.`;
    return `${intro}

Read ${root}/blob/main/AGENTS.md first; prefer native layers when sufficient.
Port adapter: ${root}/blob/main/site/maplibreCustom.ts
Setup and limitations: ${root}/blob/main/site/README.md
Original geometry and fragment shaders: ${root}/tree/main/examples/${scenes[selected].path}
Recipe: ${root}/blob/main/docs/01-hugging-the-globe/maplibre.md

${source}
${acceptance}

Keep the pinned MapLibre projection prelude, meter altitude conversion, actual basemap transition coefficient, horizon clipping, and WebGL context reset. Verify globe/transition/Mercator, antimeridian, elevated arcs and pause/resume in a browser. Preserve local data attribution and distinguish synthetic data. This adapter reuses the original scene files: copy the required source files with it, not only the adapter.`;
  }
  if (language === "zh-TW") return `為 [YOUR DATA] 建立 Mapbox globe 上的「${title}」。

若 native Mapbox layer 可以表達結果，優先使用 native；只有 GPU 專屬 rendering 或獨立物件動畫才使用 custom layer。

Example: ${root}/tree/main/examples/${scenes[selected].path}
Recipe: ${root}/blob/main/${scenes[selected].recipe}
資料語意：${source}
驗收：${acceptance}

確認 projectionToMercatorTransition、transition 1 的 flat-Mercator path、shared renderer reset、精確 Mapbox/Three versions 與視覺證據。map load 不等於 shader 驗證。`;
  return `Build a ${title} visualization for [YOUR DATA] on a Mapbox globe.

Choose a native Mapbox layer first when it can express the result; use a custom layer only for GPU-specific rendering or independent object animation.

Example: ${root}/tree/main/examples/${scenes[selected].path}
Recipe: ${root}/blob/main/${scenes[selected].recipe}
Data semantics: ${source}
Acceptance: ${acceptance}

Verify projectionToMercatorTransition, the flat-Mercator path at transition 1, shared renderer reset, exact Mapbox/Three versions, and visual evidence. A map load is not shader verification.`;
}
function renderFreeStatus() {
  if (frame) {
    $("#asset-status").textContent = "Mapbox · WebGL";
    return;
  }
  const recordKey = nativeScenes.has(selected) ? "sourceFeatures" : "sourceRecords";
  const count = nativeScenes.has(selected) ? freeStatus.featureCount ?? "—" : freeStatus.airportCount ?? "—";
  const label = freeStatus.state === "ready" ? `${freeStatus.engine ?? "maplibre"} · ${t(recordKey, { count })}` : freeStatus.state === "error" ? t("fallback") : "…";
  $("#asset-status").textContent = label;
}
async function ensureFree() {
  if (frame || !activePage) return;
  if (!freePromise) {
    freePromise = import("./freeGlobe.js").then(({ createFreeGlobe }) => {
      free = createFreeGlobe(freeStage, { onStatus(nextStatus) {
        freeStatus = nextStatus;
        renderFreeStatus();
      } });
      return free;
    });
  }
  let controller;
  try {
    controller = await freePromise;
  } catch {
    freePromise = null;
    freeStatus = { state: "error" };
    renderFreeStatus();
    return;
  }
  if (frame || !activePage) return;
  controller.setScene(selected);
  controller.setTheme(theme);
  controller.setLanguage(language);
  controller.start();
}
function stopFree() {
  free?.stop();
}
function clearTimers() {
  if (handshake) clearTimeout(handshake);
  if (loadTimeout) clearTimeout(loadTimeout);
  handshake = null;
  loadTimeout = null;
}
function stopMapbox() {
  clearTimers();
  frame = unloadFrame(frame, liveStage);
}
function setGate(visible) {
  gate.hidden = !visible;
  freeStage.inert = visible;
  liveStage.inert = visible;
}
function forgetToken() {
  token = forgetRuntimeToken(window.sessionStorage);
  sidebarInput.value = "";
  renderTokenPanel();
}
function saveToken(candidate) {
  token = saveRuntimeToken(window.sessionStorage, candidate);
  sidebarInput.value = "";
  renderTokenPanel();
  return Boolean(token);
}
function renderTokenPanel() {
  const presence = $("#sidebar-token-presence");
  const hasToken = Boolean(token);
  presence.classList.toggle("is-present", hasToken);
  $("#sidebar-token-status").textContent = t(hasToken ? "tokenStored" : "tokenEmpty");
  $("#forget-token").hidden = !hasToken;
}
function renderReuseLinks() {
  $("#scene-status").textContent = engine === "free" ? (language === "zh-TW" ? "MapLibre：本機瀏覽器已重現" : "MapLibre: reproduced locally") : t("status");
  const recipe = nativeScenes.has(selected) ? scenes[selected].recipe : engine === "free" ? "docs/01-hugging-the-globe/maplibre.md" : scenes[selected].recipe;
  $("#recipe-link").href = `${root}/blob/main/${recipe}`;
  $("#source-link").href = engine === "free" ? `${root}/blob/main/site/${nativeScenes.has(selected) ? "freeGlobe.js" : "maplibreCustom.ts"}` : `${root}/tree/main/examples/${scenes[selected].path}`;
  $("#agent-prompt").textContent = promptForScene();
}
function setEngineButtons() {
  renderReuseLinks();
  const freeActive = engine === "free";
  const mapboxActive = engine === "mapbox";
  $("#free-mode").classList.toggle("is-active", freeActive);
  $("#free-mode").setAttribute("aria-pressed", String(freeActive));
  $("#mapbox-mode").classList.toggle("is-active", mapboxActive);
  $("#mapbox-mode").setAttribute("aria-pressed", String(mapboxActive));
}
async function returnFree() {
  stopMapbox();
  engine = "free";
  setGate(false);
  mapMessage = null;
  status.textContent = "";
  setEngineButtons();
  $("#engine-note").textContent = t(nativeScenes.has(selected) ? "nativePreviewNote" : "previewNote");
  $("#free-difference-note").textContent = t(freeNoteKey());
  $("#free-difference-note").hidden = false;
  renderFreeStatus();
  $("#reset-live").hidden = true;
  await ensureFree();
}
async function showGate({ focus = false } = {}) {
  stopMapbox();
  engine = "mapbox";
  setGate(true);
  setEngineButtons();
  mapMessage = null;
  status.textContent = "";
  $("#engine-note").textContent = t("gateTitle");
  $("#free-difference-note").hidden = true;
  $("#reset-live").hidden = true;
  if (token) mountMapbox();
  else {
    await ensureFree();
    if (focus && engine === "mapbox" && !frame && activePage) sidebarInput.focus();
  }
}
function mountMapbox() {
  stopMapbox();
  stopFree();
  engine = "mapbox";
  setEngineButtons();
  setGate(true);
  $("#free-difference-note").hidden = true;
  $("#reset-live").hidden = false;
  const next = document.createElement("iframe");
  next.title = `${t(selected)} WebGL example`;
  next.src = `./examples/${scenes[selected].path}/index.html?embed=1&theme=${theme}&lang=${language}`;
  frame = next;
  renderFreeStatus();
  liveStage.append(next);
  liveStage.hidden = false;
  setMapMessage("starting");
  $("#engine-note").textContent = t("loading");
  handshake = setTimeout(() => {
    if (frame === next) setMapMessage("failed");
  }, 4500);
}
function render() {
  document.documentElement.lang = language;
  document.body.dataset.theme = theme;
  document.querySelectorAll("[data-i18n]").forEach((node) => {
    node.textContent = t(node.dataset.i18n);
  });
  const zh = language === "zh-TW";
  $("#language-toggle").textContent = t("language");
  $("#theme-toggle").textContent = theme === "light" ? zh ? "切換深色" : "Switch to dark" : zh ? "切換淺色" : "Switch to light";
  $(".github-button").textContent = t("github");
  $(".rail-copy").textContent = zh ? "從點、線、面到動態特效，選一個元素，調整後帶回你的地球應用。" : "Choose a globe element, tune it, then take the recipe into your application.";
  $("#free-mode").textContent = t("freeMode");
  $("#mapbox-mode").textContent = t("mapboxMode");
  $("#gate-free").textContent = t("freeReturn");
  $(".gate-card .kicker").textContent = zh ? "MAPBOX 模式" : "MAPBOX MODE";
  $("#reset-live").textContent = t("unload");
  renderTokenPanel();
  document.querySelectorAll(".scene-tab").forEach((button) => {
    const scene = button.dataset.scene;
    const active = scene === selected;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
    button.setAttribute("aria-label", t(scene));
    button.querySelector("strong").textContent = t(scene);
    button.querySelector("small").textContent = t(`${scene}Sub`);
  });
  $("#scene-label").textContent = `${zh ? "範例" : "EXAMPLE"} 0${sceneOrder.indexOf(selected)} / ${t(selected)}`;
  $("#map-subtitle").textContent = t(`${selected}Sub`);
  $("#details-pane > .kicker").textContent = zh ? "在自己的專案使用" : "Use it in your project";
  $(".scene-list").setAttribute("aria-label", t("effects"));
  $(".engine-switch").setAttribute("aria-label", zh ? "地圖引擎" : "Map engine");
  $("#scene-name").textContent = t(selected);
  $("#scene-status").textContent = t("status");
  $("#scene-detail").textContent = t(`${selected}Detail`);
  $("#scene-source").textContent = t(sceneKey("Source"));
  $("#recipe-link").href = `${root}/blob/main/${scenes[selected].recipe}`;
  $("#recipe-link").textContent = `${t("recipe")} ↗`;
  $("#source-link").href = `${root}/tree/main/examples/${scenes[selected].path}`;
  $("#source-link").textContent = `${t("source")} ↗`;
  $("#agent-prompt").textContent = promptForScene();
  status.textContent = statusText();
  $("#engine-note").textContent = frame ? mapMessage?.key === "loaded" ? t("live") : t("loading") : engine === "mapbox" ? t("gateBody") : t(nativeScenes.has(selected) ? "nativePreviewNote" : "previewNote");
  $("#free-difference-note").textContent = t(freeNoteKey());
  $("#free-difference-note").hidden = engine !== "free";
  $("#zoom-in").setAttribute("aria-label", t("zoomIn"));
  $("#zoom-out").setAttribute("aria-label", t("zoomOut"));
  renderFreeStatus();
  setEngineButtons();
  $("#copy-status").textContent = "";
  free?.setScene(selected);
  free?.setTheme(theme);
  free?.setLanguage(language);
}
function setPanel(panel) {
  document.querySelectorAll(".inspector-tab").forEach((button) => {
    const active = button.dataset.panel === panel;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
    button.setAttribute("role", "tab");
    button.tabIndex = active ? 0 : -1;
  });
  $("#details-pane").hidden = panel !== "details";
  $("#prompt-pane").hidden = panel !== "prompt";
}
async function copyPrompt() {
  const content = promptForScene();
  try {
    await navigator.clipboard.writeText(content);
  } catch {
    const area = document.createElement("textarea");
    try {
      area.value = content;
      area.style.cssText = "position:fixed;opacity:0";
      document.body.append(area);
      area.select();
      if (!document.execCommand("copy")) throw new Error("copy unavailable");
    } catch {
      $("#copy-status").textContent = language === "zh-TW" ? "無法自動複製，請手動選取文字。" : "Copy unavailable; select the text manually.";
      return;
    } finally {
      area.remove();
    }
  }
  $("#copy-status").textContent = t("copied");
}
function resetForLifecycle() {
  activePage = false;
  stopMapbox();
  stopFree();
}
$("#free-mode").addEventListener("click", () => returnFree());
$("#gate-free").addEventListener("click", () => returnFree());
$("#mapbox-mode").addEventListener("click", showGate);
$("#zoom-in").addEventListener("click", () => free?.zoomBy(1.15));
$("#zoom-out").addEventListener("click", () => free?.zoomBy(1 / 1.15));
$("#language-toggle").addEventListener("click", () => {
  language = language === "zh-TW" ? "en" : "zh-TW";
  render();
  if (frame && token) mountMapbox();
});
$("#theme-toggle").addEventListener("click", () => {
  theme = theme === "light" ? "dark" : "light";
  render();
  if (frame && token) mountMapbox();
});
function submitToken(candidate) {
  const publicToken = candidate.trim();
  sidebarInput.value = "";
  if (!publicToken) return setMapMessage("noToken");
  if (!isPublicMapboxToken(publicToken)) return setMapMessage("invalidToken");
  if (!saveToken(publicToken)) return setMapMessage("failed");
  mountMapbox();
}
$("#sidebar-token-form").addEventListener("submit", (event) => {
  event.preventDefault();
  submitToken(sidebarInput.value);
});
$("#forget-token").addEventListener("click", async () => {
  forgetToken();
  await returnFree();
  setMapMessage("forgot");
});
$("#reset-live").addEventListener("click", async () => {
  forgetToken();
  await returnFree();
  setMapMessage("forgot");
});
$("#details-copy").addEventListener("click", () => {
  setPanel("prompt");
  $("#prompt-pane").scrollIntoView({ block: "nearest" });
  copyPrompt();
});
$("#copy-prompt").addEventListener("click", copyPrompt);
document.querySelectorAll(".inspector-tab").forEach((button) => button.addEventListener("click", () => setPanel(button.dataset.panel)));
const sceneButtons = [...document.querySelectorAll(".scene-tab")];
sceneButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    selected = button.dataset.scene;
    render();
    if (engine === "free" || !token) ensureFree();
    else mountMapbox();
  });
  button.addEventListener("keydown", (event) => {
    const index = sceneButtons.indexOf(button);
    const target = { ArrowRight: (index + 1) % sceneButtons.length, ArrowDown: (index + 1) % sceneButtons.length, ArrowLeft: (index + sceneButtons.length - 1) % sceneButtons.length, ArrowUp: (index + sceneButtons.length - 1) % sceneButtons.length, Home: 0, End: sceneButtons.length - 1 }[event.key];
    if (target === void 0) return;
    event.preventDefault();
    sceneButtons[target].focus();
    sceneButtons[target].click();
  });
});
window.addEventListener("message", (event) => {
  if (!frame || event.origin !== location.origin || event.source !== frame.contentWindow) return;
  if (isTrustedReadyEvent(event, frame, location.origin) && token) {
    if (handshake) clearTimeout(handshake);
    frame.contentWindow.postMessage({ type: "globe-demo:token", token }, location.origin);
    setMapMessage("connecting");
    loadTimeout = setTimeout(() => {
      if (frame) setMapMessage("timeout");
    }, 12e3);
    return;
  }
  if (event.data?.type !== "globe-demo:map-status") return;
  if (event.data.status === "loaded") {
    if (loadTimeout) clearTimeout(loadTimeout);
    setGate(false);
    $("#engine-note").textContent = t("live");
    setMapMessage("loaded");
  } else if (event.data.status === "error") {
    if (event.data.code === 401 || event.data.code === 403) {
      if (loadTimeout) clearTimeout(loadTimeout);
      setMapMessage("authFailed", { code: event.data.code });
    } else setMapMessage("failed");
    setGate(true);
  }
});
window.addEventListener("pagehide", resetForLifecycle);
window.addEventListener("pageshow", (event) => {
  if (!event.persisted) return;
  activePage = true;
  render();
  if (engine === "mapbox" && token) mountMapbox();
  else returnFree();
});
render();
returnFree();
const inspectorTabs = [...document.querySelectorAll(".inspector-tab")];
inspectorTabs.forEach((button, index) => button.addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const next = event.key === "Home" ? 0 : event.key === "End" ? 1 : 1 - index;
  inspectorTabs[next].focus();
  inspectorTabs[next].click();
}));
setPanel("details");
