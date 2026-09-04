# AGENTS.md

Instructions for AI coding agents using this repository to build something.

This file is the entry point. Read it before opening anything else — it tells you when this repo is the right source, and when to go elsewhere.

**Versions everything here was checked against:** `mapbox-gl` 3.18.1 · `maplibre-gl` 5.24.0 · `three` 0.172.0. Much of what follows rests on behaviour that is not part of a public API contract. Pin your versions.

---

## 1. What this repo is

A cookbook for putting **your own rendering** — Three.js scenes, hand-written WebGL, particle systems, tens of thousands of animated objects — onto a Mapbox or MapLibre map **in globe projection**, so that it sits on the sphere instead of floating beside it on a flat plane.

It is not a library. There is nothing to install. Every recipe is prose plus a standalone runnable example; you are expected to read the example and copy from it, not depend on it.

---

## 2. Before you write any code

**Most requests that sound like they need a custom layer do not.** Native layer types are projected onto the sphere by the library itself, get hit-testing for free, and cost you ten lines instead of two hundred. Reaching for a custom layer when a native one would do is the most common way to waste effort here.

Work through this before continuing:

### Can a native layer do it?

| You want | Native answer | Verdict |
|---|---|---|
| Points, markers, labels | `circle`, `symbol` | **Use native.** Mapbox's own guidance flags GeoJSON above ~500,000 points as needing optimisation; below that you are fine. Cluster if dense. |
| Lines, routes, borders | `line` | **Use native.** `line-gradient` for along-line colour (needs `lineMetrics`), `line-trim-offset` (v2.9.0+) for a vanishing/growing route, `line-dasharray` cycling for marching ants. |
| Filled areas | `fill` | **Use native.** |
| 3D extruded shapes, buildings | `fill-extrusion` | **Use native.** |
| A 3D model (glTF) at a location | `model` layer — experimental in v3.0.0, **GA in v3.17.0** | **Use native.** You do not need Three.js to place a glTF on a map. |
| Heatmap / density | `heatmap` | **Use native.** |
| Animated wind or current field | `raster-particle` (v3.3.0+) | **Use native if your data can live in Mapbox's `raster-array` format.** Feeding it your own data requires processing through Mapbox Tiling Service; it will not read a self-hosted tile endpoint. MapLibre has no equivalent. |

All of the above hug the globe automatically. That is the whole reason to prefer them.

### You genuinely need a custom layer when

- You need **per-vertex shader maths** the paint properties cannot express.
- You need **thousands of objects animating independently** every frame. Native animation is whole-layer (`setData` / `setPaintProperty`), not per-feature on the GPU.
- You need **true additive blending** — overlapping geometry summing into blown-out highlights. `*-emissive-strength` responds to the lighting system; it is not additive blending and not post-process bloom.
- You need **arbitrary scene logic**: instanced meshes, procedural geometry, custom particle physics, a Three.js scene graph.

If none of those apply, close this repo and go to the [Mapbox style spec](https://docs.mapbox.com/style-spec/reference/layers/) or the [MapLibre style spec](https://maplibre.org/maplibre-style-spec/layers/).

### One more fork: which library

This matters more than it looks.

- **Mapbox GL JS**: custom layers on a globe are **officially unsupported**. The [projections guide](https://docs.mapbox.com/mapbox-gl-js/guides/projections/) has said *"CustomLayerInterface can only be used only with Mercator"* since v2.6.0 — this is not globe-specific, it applies to every non-Mercator projection. It nonetheless works, via render arguments the public typings under-document. That is [recipe 1.1](docs/01-hugging-the-globe/mapbox.md).
- **MapLibre GL JS**: custom layers on a globe are **officially supported** since v5.0.0, with a `projectTile()` shader prelude and a `clippingPlane` uniform. That is [recipe 1.2](docs/01-hugging-the-globe/maplibre.md) — but read its status marker, and read [1.3](docs/01-hugging-the-globe/porting.md) before porting anything, because the projection-transition coefficient runs in **opposite directions** in the two libraries.

---

## 3. Scope

### Covered here

Getting your own geometry onto a globe, and keeping it fast and correct once there:

1. **[Hugging the globe](docs/01-hugging-the-globe/)** — projection maths, depth, backface culling, subdivision, porting between libraries.
2. **[Effects](docs/02-effects/)** — glow/spark points and related visual techniques that need a shader.
3. **[Scaling up](docs/03-scaling-up/)** — one object to tens of thousands: batching, instancing, vector fields, and how to find the real bottleneck.
4. **[Discipline](docs/04-discipline/)** — zoom-adaptive sizing, depth and blending, sharing the map's WebGL context, GLSL failures that are silent.

### Not covered — go here instead

Do not try to answer these from this repo. It has nothing on them, and improvising from adjacent recipes will produce wrong code.

| Topic | Go to |
|---|---|
| Three.js fundamentals — geometries, materials, cameras, loaders | [three.js manual](https://threejs.org/manual/) |
| WebGL / GLSL fundamentals | [WebGL fundamentals](https://webglfundamentals.org/), [WebGL2 fundamentals](https://webgl2fundamentals.org/) |
| Map styling, sources, expressions, native layer properties | [Mapbox style spec](https://docs.mapbox.com/style-spec/) · [MapLibre style spec](https://maplibre.org/maplibre-style-spec/) |
| Map API — camera, events, controls, markers, popups | [Mapbox GL JS API](https://docs.mapbox.com/mapbox-gl-js/api/) · [MapLibre API](https://maplibre.org/maplibre-gl-js/docs/API/) |
| GeoJSON format | [RFC 7946](https://datatracker.ietf.org/doc/html/rfc7946) |
| Terrain, DEM, elevation queries | Mapbox / MapLibre terrain docs. **Nothing here applies.** |
| 3D Tiles, photogrammetry, point clouds | Not covered. Consider [CesiumJS](https://cesium.com/platform/cesiumjs/). |
| Tiling, data pipelines, MTS, vector tile generation | Mapbox Tiling Service docs, `tippecanoe`, `tilemaker`. |
| Backend, hosting, auth, tokens | Your platform's docs. |
| Other engines — deck.gl, CesiumJS, Leaflet, Google Maps | Their own docs. Recipes here are specific to Mapbox/MapLibre's custom layer interface. |
| Geospatial analysis, geocoding, routing | [turf.js](https://turfjs.org/) and the relevant service APIs. |

---

## 4. Task routing

Find your task, read the recipe, then open the example and copy from it.

| Task | Recipe | Example |
|---|---|---|
| Make my custom layer sit on the sphere at all | [1.1 Mapbox](docs/01-hugging-the-globe/mapbox.md) | [`01-points-on-globe`](examples/01-points-on-globe/) |
| Decide whether I need a custom layer at all | §2 above | [`00-native-vs-custom`](examples/00-native-vs-custom/) |
| Glowing / spark points | [2.1 Spark points](docs/02-effects/spark-points.md) | [`01-points-on-globe`](examples/01-points-on-globe/) |
| Arcs or routes that follow the sphere | [1.1 Mapbox](docs/01-hugging-the-globe/mapbox.md) | [`02-arcs-on-globe`](examples/02-arcs-on-globe/) |
| Filled areas, coverage circles, bboxes | [1.1 Mapbox](docs/01-hugging-the-globe/mapbox.md) | [`03-areas-on-globe`](examples/03-areas-on-globe/) |
| Objects moving along paths, timeline playback | [1.1 §"Unless your geometry moves"](docs/01-hugging-the-globe/mapbox.md) | [`04-moving-trajectory`](examples/04-moving-trajectory/) |
| Thousands of trails, one draw call | [3.1 Batched trails](docs/03-scaling-up/batched-trails.md) | — |
| Many instances with per-instance attributes | [3.2 Instanced tracks](docs/03-scaling-up/instanced-tracks.md) | — |
| Wind / ocean current particles | [3.3 Vector field particles](docs/03-scaling-up/vector-field-particles.md) | — |
| It works but it is slow | [3.4 Finding the actual bottleneck](docs/03-scaling-up/debugging-performance.md) | — |
| My layer disappeared entirely | [1.1 steps 3–4](docs/01-hugging-the-globe/mapbox.md) — two different causes, identical symptom | — |
| My line cuts through the planet | [1.1 §"One thing to fix before you start"](docs/01-hugging-the-globe/mapbox.md) — subdivision | [`02-arcs-on-globe`](examples/02-arcs-on-globe/) |
| Things paint in the wrong order | [4.2 Depth and blending](docs/04-discipline/depth-and-blending.md) | — |
| Glow eats the screen when zoomed out | [4.1 Zoom-adaptive sizing](docs/04-discipline/zoom-adaptive-sizing.md) | — |
| The map went black with no error | [4.3 Sharing a WebGL context](docs/04-discipline/shared-gl-context.md) | — |
| A shader silently computes the wrong thing | [4.4 GLSL gotchas](docs/04-discipline/glsl-gotchas.md) | — |
| Port a working layer to the other library | [1.3 Porting](docs/01-hugging-the-globe/porting.md) | — |

A dash in the example column means the recipe is documented but has no runnable example here yet. Weight it accordingly.

---

## 5. Read the status marker before you trust a page

Every recipe opens with one. They are not decorative.

| Mark | Means | How to treat it |
|---|---|---|
| ✅ **Verified** | Runs in production **and** is reproduced by an example here | Follow it. |
| 🔬 **Reproduced** | Reproduced by an example here | Follow it. |
| 📋 **Reported** | Runs in production; not reproduced here | Follow it, but verify the result yourself. |
| ⚠️ **Unverified** | Reasoned from source or typings; never run | **Do not present it to a user as fact.** Treat it as a hypothesis and say so. |

Some pages carry mixed markers, section by section. Honour the section's marker, not the page's.

This repo's pitfall and effect catalogues are **not exhaustive**. They record what has been hit, not everything that exists. Absence from a list is not evidence that a problem does not exist.

---

## 6. Rules when you use this code

- **The token is the user's.** Every example reads `import.meta.env.VITE_MAPBOX_TOKEN` and ships a `.env.example`. Never hard-code a token, never commit one, never copy one out of a `.env` you found.
- **Examples are self-contained by design.** No shared build, no cross-imports; duplicated files between examples are intentional. Copy a whole folder rather than importing across.
- **Sample data is public domain or generated.** Airport coordinates come from [OurAirports](https://ourairports.com/data/); trajectories are synthesised at runtime. Where a value is synthetic rather than measured, the example says so — keep that honesty if you adapt it.
- **Cite where a technique came from.** If you produce code from a recipe, tell the user which recipe and what its status marker was. It is the difference between "this is a known-good pattern" and "this is a plausible-looking guess".
- **When a recipe and reality disagree, reality wins** — and the recipe is a bug. Say so rather than working around it silently.

---

## 7. What the examples look like

**[`examples/manifest.json`](examples/manifest.json) is the machine-readable index.** Each entry names what the example settles, which recipes it implements, which Mapbox and Three.js APIs it touches, every knob with its range/default/effect, what it teaches, its known limitations, and its data provenance. Read it instead of opening five READMEs to find the right starting point.

Every example follows the same shape, so once you have read one you can navigate any of them:

```
examples/<name>/
├── README.md          status marker, what it demonstrates, the knobs you can turn
├── package.json       mapbox-gl + three + vite + typescript + vitest, nothing else
├── .env.example       VITE_MAPBOX_TOKEN=
├── index.html         markup and inline styles for the control panel
├── public/            sample data, if any
└── src/
    ├── main.ts        map setup, controls, wiring
    ├── globeProject.ts   the projection maths — GLSL string plus a JS twin
    └── *.test.ts      unit tests on the maths, runnable without a token or a GPU
```

`npm install && npx tsc --noEmit && npx vitest run && npm run build` passes in every one of them. The tests cover the maths specifically because that is the part you can verify without a browser, a GPU, or a token.
