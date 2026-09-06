import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const site = new URL("../", import.meta.url);
const read = (name) => readFile(new URL(name, site), "utf8");

test("atlas navigation leads with element names and keeps data as subtitles", async () => {
  const html = await read("index.html");
  const app = await read("app.js");
  const copy = await read("i18n.js");
  const styles = await read("styles.css");
  const point = html.indexOf('data-scene="nativePoints"');
  const line = html.indexOf('data-scene="nativeLines"');
  const area = html.indexOf('data-scene="nativeAreas"');
  const custom = html.indexOf('data-scene="points"');
  const satellite = html.indexOf('data-scene="satelliteOrbits"');
  const adiz = html.indexOf('data-scene="adizWalls"');
  assert.ok(point >= 0 && point < line && line < area && area < custom && custom < satellite && satellite < adiz);
  assert.match(html, /<html lang="en">/);
  assert.match(app, /let language = "en";/);
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
  const manifest = JSON.parse(await readFile(new URL("../../examples/manifest.json", import.meta.url), "utf8"));
  assert.equal(manifest.siteScenes.length, 8);
  assert.match(build, /manifest\.siteScenes\.map/);
  assert.match(build, /sceneCatalog\.js/);
  assert.match(build, /examples\/manifest\.json/);
  for (const scene of manifest.siteScenes) assert.ok(manifest.examples.some((example) => example.id === scene.exampleId));
});

test("satellite orbit and vertical boundary wall scenes keep component and fixture semantics separate", async () => {
  const app = await read("app.js");
  const copy = await read("i18n.js");
  const free = await read("freeGlobe.js");
  const special = await read("specialScenes.ts");
  const manifest = JSON.parse(await readFile(new URL("../../examples/manifest.json", import.meta.url), "utf8"));
  for (const scene of ["satelliteOrbits", "adizWalls"]) {
    assert.ok(manifest.siteScenes.some((entry) => entry.sceneId === scene));
    assert.match(copy, new RegExp(scene));
    assert.match(free, new RegExp(scene));
    assert.match(special, new RegExp(scene));
  }
  assert.match(app, /sceneCatalog/);
  assert.match(app, /TARGET REPOSITORY OR WORKSPACE/);
  assert.match(app, /Replace the demonstration fixture/);
  assert.match(app, /real WebGL\/browser behavior/);
  assert.equal(manifest.siteScenes.find((scene) => scene.sceneId === "adizWalls").component, "vertical boundary walls");
  assert.match(copy, /不是即時 TLE/);
  assert.match(copy, /ADIZ 不等於主權領空/);
  assert.match(copy, /"adizWalls": "立體邊界牆"/);
  assert.match(copy, /"adizWalls": "Vertical boundary walls"/);
  assert.match(copy, /台灣 ADIZ・示意資料/);
  assert.match(copy, /display height, not a published ceiling/);
});

test("site publishes a globe favicon and social sharing preview", async () => {
  const html = await read("index.html");
  const build = await read("scripts/build.mjs");
  assert.match(html, /rel="icon"[^>]+assets\/favicon-32\.png/);
  assert.match(html, /rel="apple-touch-icon"[^>]+assets\/apple-touch-icon\.png/);
  assert.match(html, /property="og:image" content="https:\/\/globe-custom-layers\.zeabur\.app\/assets\/social-preview\.png"/);
  assert.match(html, /property="og:image:width" content="1200"/);
  assert.match(html, /property="og:image:height" content="630"/);
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
  assert.match(build, /cp\(join\(siteRoot, "assets"\), join\(outputRoot, "assets"\), \{ recursive: true \}\)/);
});

test("site uses the self-hosted IBM Plex family for Latin, Traditional Chinese, and technical labels", async () => {
  const html = await read("index.html");
  const styles = await read("styles.css");
  const build = await read("scripts/build.mjs");
  assert.match(html, /fonts\/plex\.css/);
  assert.doesNotMatch(styles, /fonts\.googleapis\.com|Newsreader|Noto Sans TC|DM Mono/);
  assert.match(styles, /--sans:"IBM Plex Sans","IBM Plex Sans TC",sans-serif/);
  assert.match(styles, /--display:"IBM Plex Sans","IBM Plex Sans TC",sans-serif/);
  assert.match(styles, /--mono:"IBM Plex Mono","IBM Plex Sans TC",monospace/);
  assert.match(styles, /html\[lang="zh-TW"\][\s\S]+--sans:"IBM Plex Sans TC","IBM Plex Sans",sans-serif/);
  for (const face of ["IBMPlexSansTC-Regular", "IBMPlexSansTC-Medium", "IBMPlexSansTC-SemiBold", "IBMPlexSans-Regular", "IBMPlexSans-Medium", "IBMPlexSans-SemiBold", "IBMPlexMono-Regular", "IBMPlexMono-Medium"]) assert.match(build, new RegExp(face));
});

test("long example titles use stable toolbar layouts at every breakpoint", async () => {
  const styles = await read("styles.css");
  assert.match(styles, /\.map-toolbar \{[\s\S]*?display: grid;[\s\S]*?grid-template-columns: minmax\(0, 1fr\) auto;/);
  assert.match(styles, /\.map-toolbar > div:first-child \{[\s\S]*?min-width: 0;/);
  assert.match(styles, /#scene-label \{[\s\S]*?text-overflow: ellipsis;[\s\S]*?white-space: nowrap;/);
  assert.match(styles, /@media \(min-width: 821px\) and \(max-width: 1080px\)[\s\S]*?#scene-label \{[\s\S]*?font-size: 10px;/);
  assert.match(styles, /@media \(min-width: 721px\) and \(max-width: 820px\)[\s\S]*?\.map-toolbar \{[\s\S]*?display: block;[\s\S]*?\.engine-switch \{[\s\S]*?width: 100%;/);
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*?\.map-toolbar \{[\s\S]*?display: block;/);
});

test("the medium-width element rail remains scrollable without trapping the mobile page", async () => {
  const styles = await read("styles.css");
  assert.match(styles, /\.effects-panel \{[\s\S]*?min-height: 0;[\s\S]*?overflow-y: auto;[\s\S]*?scrollbar-gutter: stable;/);
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*?\.effects-panel \{[\s\S]*?overflow: visible;[\s\S]*?scrollbar-gutter: auto;/);
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
