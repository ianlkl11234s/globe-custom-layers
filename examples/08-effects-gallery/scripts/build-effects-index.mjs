#!/usr/bin/env node
// Regenerates effects.json from the actual effect definitions in
// src/showcase/effects/*.js -- this is the single source of truth, not a
// hand-maintained file. Run it whenever an effect's id/name/desc/prompt/
// params changes: `npm run build-effects-index`.
//
// It works by importing each category module the same way the running app
// does, then keeping only the JSON-serializable fields (JSON.stringify drops
// the `build`/`update` functions for us -- that's the whole trick).

import { writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");
const effectsDir = path.join(rootDir, "src", "showcase", "effects");
const outFile = path.join(rootDir, "effects.json");

// Order matches index.html's "File layout" panel and the README table.
const CATEGORIES = [
  ["basic", "Basic geometry"],
  ["light", "Light effects"],
  ["animation", "Animated events"],
  ["shader", "Shader deformation"],
  ["particles", "Particles"],
  ["line", "Lines / paths"],
  ["viz", "Data visualization"],
  ["atmospheric", "Volumetric / atmosphere"],
  ["scene", "Scene / sci-fi"],
];

const effects = [];
const categorySummary = [];

for (const [category, label] of CATEGORIES) {
  const fileUrl = pathToFileURL(path.join(effectsDir, `${category}.js`));
  const mod = await import(fileUrl.href);
  const defs = mod.default;
  if (!Array.isArray(defs)) {
    throw new Error(`${category}.js does not export a default array`);
  }

  categorySummary.push({ category, label, count: defs.length });

  for (const eff of defs) {
    // JSON.stringify silently drops function-valued properties (build/update)
    // and _-prefixed runtime fields aren't set at module load time, so a
    // plain round-trip is all the "extraction" this needs.
    const plain = JSON.parse(JSON.stringify(eff));

    /** @type {Record<string, unknown>} */
    const entry = {
      id: plain.id,
      category,
      title: plain.name,
      description: plain.desc,
      prompt: plain.prompt,
      tech: plain.tech,
      sourceFile: `src/showcase/effects/${category}.js`,
      location: {
        lng: plain.loc?.[0],
        lat: plain.loc?.[1],
        city: plain.city,
      },
      params: (plain.params ?? []).map((p) => ({
        id: p.id,
        label: p.label,
        min: p.min,
        max: p.max,
        step: p.step,
        default: p.value,
      })),
    };

    if (plain.lineEnd) {
      entry.lineEnd = { lng: plain.lineEnd[0], lat: plain.lineEnd[1] };
    }
    if (plain.isLine) entry.isLine = true;
    if (plain.isArc) entry.isArc = true;

    effects.push(entry);
  }
}

const index = {
  $comment:
    "Machine-readable index of every effect in this gallery, generated from src/showcase/effects/*.js by scripts/build-effects-index.mjs. Do not hand-edit -- regenerate with `npm run build-effects-index`. Human version: README.md.",
  version: 1,
  generated: new Date().toISOString().slice(0, 10),
  sourceProject:
    "Ported from mini-taiwan-pulse's public/showcase/ demo (see README 'What changed during the port').",
  totalEffects: effects.length,
  categories: categorySummary,
  effects,
};

await writeFile(outFile, JSON.stringify(index, null, 2) + "\n", "utf8");
console.log(`Wrote ${effects.length} effects across ${categorySummary.length} categories to ${path.relative(rootDir, outFile)}`);
