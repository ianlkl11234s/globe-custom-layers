# Agent guide

This reference expands the repository entrypoint. Read only the section needed for the task.

## Choose the rendering path

Use native Mapbox layers for points, labels, lines, fills, fill extrusions, models, and heatmaps where their paint properties are sufficient. Use a custom layer only for shader math, independently animated GPU objects, additive blending, or arbitrary scene logic. The [decision tree](00-start-here/decision-tree.md) and the relevant example are the implementation source.

Mapbox globe custom layers are outside its public support contract; follow the marker and caveats in [the Mapbox recipe](01-hugging-the-globe/mapbox.md). MapLibre globe support has a reproduced prelude-based adapter for selected site scenes, while direct ECEF/mainMatrix, terrain/depth, and broader portability remain unverified; read [the MapLibre recipe](01-hugging-the-globe/maplibre.md) and [porting notes](01-hugging-the-globe/porting.md).

## Route by task

| Need | Read | Runnable example |
|---|---|---|
| Sphere projection, depth, subdivision | [Mapbox recipe](01-hugging-the-globe/mapbox.md) | `examples/01-points-on-globe/` |
| Arcs, routes, or area geometry | [Mapbox recipe](01-hugging-the-globe/mapbox.md) | `examples/02-arcs-on-globe/`, `03-areas-on-globe/` |
| Playback | [moving geometry section](01-hugging-the-globe/mapbox.md) | `examples/04-moving-trajectory/` |
| Many trails or instances | [scaling up](03-scaling-up/) | `examples/05-mass-trajectories/` |
| Complete satellite orbital rings | [Mapbox recipe](01-hugging-the-globe/mapbox.md) | `examples/09-satellite-orbits/` |
| Vertical polygon boundary walls | [Mapbox recipe](01-hugging-the-globe/mapbox.md) | `examples/10-adiz-walls/` |
| Vector particles | [vector fields](03-scaling-up/vector-field-particles.md) | `examples/06-particle-field/` |
| Picking and popups | [decision tree](00-start-here/decision-tree.md) | `examples/07-picking-and-popups/` |
| Visual ideas | [effects](02-effects/spark-points.md) | `examples/08-effects-gallery/` (Mercator) |

Use `examples/manifest.json` to select an example without opening every README. Its `siteScenes` array is the technical source of truth for website links and generated Agent prompts; select an entry by `exampleId`. A recipe marker is evidence: ✅ verified, 🔬 reproduced, 📋 reported, ⚠️ unverified. Do not present an unverified section as fact.

## Component, fixture, and task contract

Name the reusable rendering behavior as the component and the bundled sample as the fixture. `Satellite orbital rings` is a component demonstrated with three schematic orbit definitions. `Vertical boundary walls` is a component demonstrated with a Taiwan ADIZ schematic. Do not rename the generic wall component to `3D ADIZ`, and do not imply the fixture is authoritative operational data.

Before implementation, make the task contract explicit:

- target repository, map entrypoint, engine, and pinned versions;
- input shape, feature count, update rate, coordinate order, and units;
- missing, invalid, stale, and error behavior rather than silently treating them as zero;
- interaction and playback requirements, lifecycle ownership, and cleanup;
- source, licence, coverage, and whether the input is measured, synthetic, or schematic;
- acceptance cells for unit tests, typecheck, build, WebGL browser behavior, data readback, and production deployment.

For the two reusable components, the accepted inputs are deliberately separate from their bundled fixtures:

- `createOrbitLayer(orbits, controls)` accepts validated closed orbit samples in `[longitude, latitude]` degrees with `altitudeMeters`; simulation time and display-only altitude scale are controls, not data mutation.
- `createVerticalBoundaryWallLayer(data, controls)` accepts GeoJSON-like `Polygon` or `MultiPolygon` boundaries in `[longitude, latitude]` degrees. Exterior rings and holes become side walls without a top surface; display height is metres and does not assert a legal ceiling.

## Copying and adapting

Copy the complete standalone example and every `requiredFiles` entry from the manifest; do not copy only `main.ts` or a fixture. Put target data in a separate application-owned module, keep the reusable renderer injectable, and replace fixture imports only at the application boundary. Remove a copied fixture only after replacing its import and preserving its provenance note where relevant. Retain the example or repository `LICENSE`, pinned dependencies, and data-source notices. Standalone examples must not import another example.

Reject non-finite coordinates, invalid latitude, unsupported geometry, empty or degenerate rings, negative altitude, and malformed closed paths before creating GPU resources. For dateline-crossing geometry, preserve continuous world copies instead of drawing across the map. For long boundary edges, densify geodesically so the wall follows the globe rather than cutting through it.

## Verification evidence

Report each evidence cell independently. `npm ci`, unit tests, TypeScript, and a Vite build establish reproducibility but do not prove shader compilation, horizon clipping, interaction, real tiles, or deployment. A map `load` event is not shader evidence. Browser acceptance should observe the requested data and controls on globe and Mercator endpoints, projection transition, front/back visibility, dateline behavior, pause/resume or parameter updates, console errors, and WebGL resource cleanup where applicable.

When evaluating whether another Agent can reproduce the work, record the fixed source commit, model, full prompt, generated output, non-fixture input, commands, browser observations, and unverified cells. Do not upgrade a status because inherited tests passed against unchanged fixture data.

## Lifecycle and performance

Custom layers share the map WebGL context. Remove listeners and map layers, dispose geometries, materials, textures, render targets, and renderer-owned resources when the layer is removed. For a black map, depth/blending failure, sizing problem, or silent shader error, read [discipline](04-discipline/). For scale work, measure the actual CPU, GPU, draw-call, allocation, and data-upload bottleneck before changing batching or instancing; use [debugging performance](03-scaling-up/debugging-performance.md).

## Repository invariants

Examples are standalone: do not cross-import between them. Never expose or commit a token. Preserve data source, licence, completeness, and synthetic-data labels; see [data sources](data-sources.md). The pinned example baseline is `mapbox-gl` 3.30.0 and `three` 0.172.0; historic investigations use Mapbox 3.18.1 and MapLibre 5.24.0. Consult [the implementation record](demo-implementation-plan.md) for current verification. Custom layers must unregister listeners, remove owned map layers, dispose geometries/materials/textures/render targets, and dispose renderer-owned resources.
