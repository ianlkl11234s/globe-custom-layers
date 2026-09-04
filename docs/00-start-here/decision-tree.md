# 0.1 Do you need a custom layer?

> **Status:** 📋 Reported — the native-capability claims are sourced from official documentation and changelogs (linked inline, versions named); the custom-layer claims come from the recipes they link to, each carrying its own marker.
> **Applies to:** `mapbox-gl` 3.18.1, `maplibre-gl` 5.24.0.

Read this before writing anything. The most expensive mistake in this domain is not a bug — it is writing two hundred lines of shader for something a native layer does in ten, and then owning that code forever.

Five questions, in this order. The order matters: each one prunes the tree, and the first one prunes most of it.

Every branch below ends somewhere. If you reach a point where nothing tells you what to do next, that is a bug in this page — please open an issue.

---

## Q1 — Can a native layer express the appearance you need?

This is the question that decides everything else. **Native layers project themselves onto the globe.** Custom layers do not; making one do so is [an entire recipe](../01-hugging-the-globe/mapbox.md) and a permanent maintenance cost.

| What you want to draw | Native layer | Enough on its own? |
|---|---|---|
| Points, markers, icons, labels | [`circle`](https://docs.mapbox.com/style-spec/reference/layers/#circle), [`symbol`](https://docs.mapbox.com/style-spec/reference/layers/#symbol) | Yes, unless you need per-pixel shader control |
| Lines, routes, borders | [`line`](https://docs.mapbox.com/style-spec/reference/layers/#line) | Yes — including along-line gradients (`line-gradient`, needs `lineMetrics: true`), a growing or vanishing route (`line-trim-offset`, v2.9.0+), and marching ants (`line-dasharray` cycling) |
| Filled areas | [`fill`](https://docs.mapbox.com/style-spec/reference/layers/#fill) | Yes |
| Extruded shapes, buildings | [`fill-extrusion`](https://docs.mapbox.com/style-spec/reference/layers/#fill-extrusion) | Yes, for prisms |
| A glTF model at a location | [`model`](https://docs.mapbox.com/style-spec/guides/using-3d-models/) — experimental v3.0.0, **GA v3.17.0** | Yes. **You do not need Three.js to put a 3D model on a map.** |
| Density surface | [`heatmap`](https://docs.mapbox.com/style-spec/reference/layers/#heatmap) | Yes |
| Animated wind / current field | [`raster-particle`](https://docs.mapbox.com/style-spec/reference/layers/#raster-particle) — v3.3.0, globe flicker fixed v3.4.0 | Only if your data can live in Mapbox's `raster-array` format — see Q1a |
| Raster imagery | [`raster`](https://docs.mapbox.com/style-spec/reference/layers/#raster) | Yes |

**If your row says yes → stop here.** Go to the [Mapbox style spec](https://docs.mapbox.com/style-spec/reference/layers/) or the [MapLibre style spec](https://maplibre.org/maplibre-style-spec/layers/) and use it. Nothing else on this page applies to you. [`examples/00-native-vs-custom`](../../examples/00-native-vs-custom/) puts both approaches side by side on the same data if you want to see the difference before deciding.

### Q1a — The `raster-particle` exception

It is a real, maintained, globe-compatible flow-field layer, and it is the right answer when it fits. It does not fit when:

- **Your data is not in `raster-array` format.** Getting it there means uploading and processing through [Mapbox Tiling Service](https://docs.mapbox.com/mapbox-tiling-service/examples/raster-mts-wind/) — *"you'll need to upload and process your data using Mapbox Tiling Service."* It will not read a GeoTIFF or a tile endpoint you host.
- **Your field updates in near-real-time** and a tiling round-trip per update is not viable.
- **Your particles need physics beyond advection** through a fixed vector field.
- **You are on MapLibre**, which has no equivalent layer type.

→ If it fits: use it. → If not: [3.3 Vector field particles](../03-scaling-up/vector-field-particles.md).

### Q1b — Four things native layers cannot do

Reach for a custom layer only if you need one of these:

1. **Per-vertex shader maths** that no paint property expresses.
2. **True additive blending** — overlapping geometry summing to blown-out white. `*-emissive-strength` is a lighting response, not additive blending, and not post-process bloom. → [4.2 Depth and blending](../04-discipline/depth-and-blending.md), [2.1 Spark points](../02-effects/spark-points.md)
3. **Thousands of objects animating independently** per frame. Native animation updates a whole layer (`setData` / `setPaintProperty`); it is not per-feature work on the GPU. → Q3
4. **Arbitrary scene logic** — instanced meshes, procedural geometry, custom particle physics, a Three.js scene graph.

### Q1c — What you give up by going custom

Three fields in `CustomLayerInterface` are typed `never`, and each one is a facility you now have to build yourself. This is the most concrete statement of the trade-off available:

```ts
interface CustomLayerInterface {
  source?:  never;   // no data source
  layout?:  never;   // no visibility
  minzoom?: never;   // no declarative zoom range
  maxzoom?: never;
}
```

| Native layers give you free | A custom layer |
|---|---|
| `setLayoutProperty(id, 'visibility', 'none')` — stops **both** rendering and hit-testing in one line | No visibility at all. Mapbox calls your `render()` every frame regardless; the best you can do is force opacity to zero, and **you pay the full GPU cost anyway** |
| `circle-color: ["get", "colorHex"]` — style expressions read feature properties directly | Two options only: bake the value into a vertex attribute at buffer-build time, or use a uniform shared by every vertex in the frame. **There is no "read this one point's property" in between** |
| `minzoom` / `maxzoom` — declarative zoom range | Your own check inside `render()` |
| Hit-testing via `queryRenderedFeatures` | Nothing — see Q5 |

If your requirement is "show it between z6 and z12, colour it by a data field, and pop up details on click", a custom layer turns four free facilities into four things you maintain. That is a bad trade unless Q1b forced it.

Still here? Continue.

---

## Q2 — Which library?

The answer changes what is possible, not just what is convenient.

| | Mapbox GL JS | MapLibre GL JS |
|---|---|---|
| Custom layer in globe projection | **Officially unsupported.** The [projections guide](https://docs.mapbox.com/mapbox-gl-js/guides/projections/) has said *"CustomLayerInterface can only be used only with Mercator"* since v2.6.0 — this applies to **every** non-Mercator projection, not just globe. It works anyway, through render arguments the public typings under-document. | **Officially supported** since v5.0.0: a `projectTile()` shader prelude, a `clippingPlane` uniform, and three official globe custom-layer examples |
| Licence | Proprietary since v2.0.0; account required | BSD-3-Clause |
| Native layer breadth | Wider — `model`, `raster-particle`, `line-trim-offset`, `*-emissive-strength` | Narrower; none of those four exist in its style spec |
| Durability of the globe recipes | Lower — undocumented arguments can change in a patch | Higher — documented API |

→ **Mapbox**: [1.1](../01-hugging-the-globe/mapbox.md) · **MapLibre**: [1.2](../01-hugging-the-globe/maplibre.md) (read its status marker) · **Porting between them**: [1.3](../01-hugging-the-globe/porting.md) — do this before writing a line of port, the transition coefficient runs in opposite directions.

---

## Q3 — How much, and does it move?

| Objects | Static | Animated per frame |
|---|---|---|
| **< ~1,000** | Build geometry once, upload once. Nothing special needed beyond [1.1](../01-hugging-the-globe/mapbox.md). → [`02-arcs-on-globe`](../../examples/02-arcs-on-globe/), [`03-areas-on-globe`](../../examples/03-areas-on-globe/) | Update the changed range of the buffer, not the whole thing. → [`04-moving-trajectory`](../../examples/04-moving-trajectory/) |
| **~1,000 – 100,000** | One draw call. Batch into a shared buffer, or instance a shared geometry. → [3.1 Batched trails](../03-scaling-up/batched-trails.md), [3.2 Instanced tracks](../03-scaling-up/instanced-tracks.md) | Same, plus: move the animation into shader uniforms so the CPU recomputes nothing per frame. → [3.2](../03-scaling-up/instanced-tracks.md) |
| **> 100,000** | Reconsider. Aggregate, cluster, or pre-render to a tileset first. If you must, everything in [2. Scaling up](../03-scaling-up/) applies and you will be measuring, not guessing. → [3.4 Finding the actual bottleneck](../03-scaling-up/debugging-performance.md) | Particle-style rendering with fixed capacity and slot reuse. → [3.3 Vector field particles](../03-scaling-up/vector-field-particles.md), [3.1](../03-scaling-up/batched-trails.md) |

**Under a few thousand static vertices, you do not need a shader at all.** Run the projection on the CPU each frame and write the results into a plain `MeshBasicMaterial` / `LineBasicMaterial` geometry. It is far easier to read and debug, and at that scale the cost is invisible. [`03-areas-on-globe`](../../examples/03-areas-on-globe/) does exactly this, deliberately, so that its geometry code stays the subject. Move to a shader when the vertex count makes per-frame CPU work show up in a profile — not before.

**A fork inside "does it move" that catches people out:** where the ECEF position comes from.

| | Static geometry | Moving geometry |
|---|---|---|
| ECEF | Precompute on the CPU as a vertex attribute | Derive in the vertex shader with an inverse Mercator, every frame |
| Why | A fixed place on Earth has a fixed ECEF | A moving point has none to precompute |

Both are in [1.1](../01-hugging-the-globe/mapbox.md); taking the wrong one is a rewrite, not a tweak.

---

## Q4 — Does anything span distance?

If any single piece of geometry — a line, a polygon edge, a wide quad — covers more than a few degrees, **subdivide it**.

Vertices are projected; the segments between them are not. A straight line between two distant points is a **chord**, not an arc, and it will cut through the planet no matter how correct both endpoints are. This is the most common cause of "my line goes behind the globe", and no library does it for you.

- Densely sampled data (a GPS trace, a flight track) already satisfies this by accident.
- A two-point great-circle arc, or a four-corner bounding box, does not.

→ [1.1 §"One thing to fix before you start"](../01-hugging-the-globe/mapbox.md) · [`02-arcs-on-globe`](../../examples/02-arcs-on-globe/) has a subdivision slider so you can watch the failure happen.

**And if anything crosses the antimeridian**, resolve longitude per segment rather than per vertex. `MercatorCoordinate.fromLngLat` uses `(180 + lng) / 360`, which is not periodic, so independently wrapped endpoints put a segment's two ends at opposite edges of the flat map. That is a **third** independent cause of geometry going somewhere it should not, distinct from both subdivision and depth. → [1.1 §"And a second one"](../01-hugging-the-globe/mapbox.md)

---

## Q5 — Does the user need to click it?

**Custom layers do not participate in hit-testing.** `queryRenderedFeatures` sees native layers only. There is no flag for this; it is not a bug you can fix.

| You need | Do this |
|---|---|
| Visual only | Nothing. Continue. |
| Clicks, hover, popups | Keep an **invisible native layer alongside** your custom one — same data, `circle-opacity: 0` — and let it own interaction while the custom layer owns appearance. |
| Precise picking of custom geometry | You are writing your own picking: project candidate positions with `map.project()` and test in screen space, or render an ID buffer. Neither is covered here yet. |

→ [`00-native-vs-custom`](../../examples/00-native-vs-custom/) demonstrates the failure directly: click the native layer and get a popup, click the custom layer and get nothing.

---

## If you got this far

You need a custom layer, you know which library, you know your scale and whether it moves, you know to subdivide, and you know how you will handle clicks.

Start at [1.1 Hugging the globe](../01-hugging-the-globe/mapbox.md) and copy from the example nearest your case. Then read [3. Discipline](../04-discipline/) before you ship — those four pages are all failures that appear a week later, not on the day you write the code.
