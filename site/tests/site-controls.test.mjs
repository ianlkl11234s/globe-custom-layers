import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const site = new URL("../", import.meta.url);
const read = (name) => readFile(new URL(name, site), "utf8");

test("atlas navigation exposes foundations before Three.js scenes", async () => {
  const html = await read("index.html");
  assert.ok(html.indexOf('data-scene="basics"') < html.indexOf('data-scene="points"'));
  assert.match(html, /data-i18n="nativeFoundations"/);
  assert.match(html, /data-i18n="threeCustom"/);
});

test("static build bundles the Mapbox counterpart for the foundations scene", async () => {
  const build = await read("scripts/build.mjs");
  assert.match(build, /00-native-vs-custom/);
});

test("free globe keeps all requested local controls and palettes", async () => {
  const source = await read("freeGlobe.js");
  for (const id of ["free-basemap", "free-point-size", "free-point-opacity", "free-core-boost", "free-glow-palette"]) assert.match(source, new RegExp(id));
  for (const palette of ["solar", "aurora", "plasma", "ice"]) assert.match(source, new RegExp(palette));
  for (const layer of ["native-airports", "native-route", "native-area"]) assert.match(source, new RegExp(layer));
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
