import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const site = new URL("../", import.meta.url);
const read = (name) => readFile(new URL(name, site), "utf8");

test("atlas navigation leads with element names and keeps data as subtitles", async () => {
  const html = await read("index.html");
  const copy = await read("i18n.js");
  const styles = await read("styles.css");
  const point = html.indexOf('data-scene="nativePoints"');
  const line = html.indexOf('data-scene="nativeLines"');
  const area = html.indexOf('data-scene="nativeAreas"');
  const custom = html.indexOf('data-scene="points"');
  assert.ok(point >= 0 && point < line && line < area && area < custom);
  assert.match(html, /data-i18n="nativeFoundations"/);
  assert.match(html, /data-i18n="threeCustom"/);
  assert.match(copy, /"nativePoints": "點位圖層"/);
  assert.match(copy, /"nativePointsSub": "全球機場分布"/);
  assert.match(copy, /"nativeLines": "線段圖層"/);
  assert.match(copy, /"nativeLinesSub": "大西洋海底電纜"/);
  assert.match(copy, /"nativeAreas": "面積圖層"/);
  assert.match(copy, /"nativeAreasSub": "歐洲國家 GDP"/);
  assert.match(styles, /grid-template-columns: 304px minmax\(440px, 1fr\) 324px/);
  assert.match(styles, /html\[lang="zh-TW"\] \.effects-panel > h1 \{ white-space: nowrap; \}/);
  assert.match(styles, /html\[lang="en"\] \.effects-panel > h1/);
  assert.match(styles, /grid-template-columns: 118px minmax\(0, 1fr\)/);
});

test("static build bundles a Mapbox counterpart for every map element", async () => {
  const build = await read("scripts/build.mjs");
  for (const name of ["00-native-vs-custom", "00-native-lines", "00-native-choropleth"]) assert.match(build, new RegExp(name));
});

test("free globe keeps scene-specific native controls and visible glow swatches", async () => {
  const source = await read("freeGlobe.js");
  for (const id of ["free-basemap", "free-point-size", "free-point-opacity", "free-core-boost", "free-glow-palette"]) assert.match(source, new RegExp(id));
  for (const palette of ["spectrum", "solar", "aurora", "plasma", "ice"]) assert.match(source, new RegExp(palette));
  assert.match(source, /glow-palette-choice/);
  assert.match(source, /setArcPalette/);
  assert.match(source, /scene === 'arcs' \? options\.arcPalette : options\.glowPalette/);
  for (const layer of ["native-points", "native-lines", "native-areas"]) assert.match(source, new RegExp(layer));
  for (const control of ["free-native-point-opacity", "free-native-point-palette", "free-native-line-opacity", "free-native-line-color", "free-native-area-palette", "free-native-area-border-width"]) assert.match(source, new RegExp(control));
  assert.match(source, /scene === 'nativePoints' \? 'visible' : 'none'/);
  assert.match(source, /scene === 'nativeLines' \? 'visible' : 'none'/);
  assert.match(source, /scene === 'nativeAreas' \? 'visible' : 'none'/);
});

test("screenshot-aligned defaults stay wired in the free controller", async () => {
  const source = await read("freeGlobe.js");
  assert.match(source, /basemap = 'blueprint'/);
  assert.match(source, /activeCount: 600, speed: \.3, opacity: \.7, palette: 'warm'/);
  assert.match(source, /pointSize: \.6, pointOpacity: \.65, coreBoost: \.85, glowPalette: 'plasma'/);
  assert.match(source, /arcPalette: 'plasma'/);
  assert.match(source, /height: \.028, segments: 53/);
});

test("native demonstrations preserve source meaning and uncertainty", async () => {
  const source = await read("freeGlobe.js");
  const copy = await read("i18n.js");
  assert.match(source, /atlantic-submarine-cables\.geojson/);
  assert.match(source, /europe-gdp-2023\.geojson/);
  assert.match(source, /categoricalColorExpression/);
  assert.match(source, /gdpFillExpression/);
  assert.match(source, /© OpenStreetMap contributors · ODbL/);
  assert.match(copy, /不能作為工程圖或完整清冊/);
  assert.match(copy, /缺值不轉成 0/);
  assert.match(copy, /Public-domain large-airport positions from OurAirports/);
  assert.match(copy, /Natural Earth 1:50m de facto boundaries/);
  assert.match(source, /maplibre-native/);
});

test("session token panel persists only a public token and exposes explicit forgetting", async () => {
  const html = await read("index.html");
  const app = await read("app.js");
  const bridge = await read("bridgeState.js");
  assert.match(html, /id="sidebar-token-form"/);
  assert.match(html, /id="sidebar-token-status"/);
  assert.match(app, /window\.sessionStorage/);
  assert.match(bridge, /startsWith\("pk\."\)/);
  assert.doesNotMatch(app, /localStorage\.setItem/);
  assert.doesNotMatch(app, /token=.*location/);
});

test("embedded parameter panels start collapsed for every selected scene", async () => {
  const free = await read("freeGlobe.js");
  assert.match(free, /hud\.open = false/);
  assert.match(free, /hud\.open = false; applyScene\(\)/);

  const project = new URL("../../", import.meta.url);
  for (const name of ["01-points-on-globe", "02-arcs-on-globe", "05-mass-trajectories"]) {
    const main = await readFile(new URL(`examples/${name}/src/main.ts`, project), "utf8");
    assert.match(main, /setCollapsed\(true\)/);
  }
  const foundations = await readFile(new URL("examples/00-native-vs-custom/src/main.ts", project), "utf8");
  assert.match(foundations, /setCollapsed\(true\)/);
});
