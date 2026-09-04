# 1.3 Porting a Three.js custom layer between Mapbox GL JS and MapLibre GL JS

> **Status:** 📋 Reported for the mercator half — measured in production against `mapbox-gl` 3.18.1 and `maplibre-gl` 5.24.0, not yet reproduced in this repo. ⚠️ **Unverified** for the globe half; see [1.2](maplibre.md).

The two libraries share an ancestor, so the port looks trivial and mostly is. The parts that are not trivial fail in ways that do not look like porting bugs at all — one of them puts your geometry roughly 54,000 pixels off screen, which reads as a broken matrix rather than a wrong field name.

## What is identical

Measured, not assumed:

- `MercatorCoordinate.fromLngLat` and `meterInMercatorCoordinateUnits` — same names, **bit-identical results**
- `renderer.autoClear = false`, `renderer.resetState()` bracketing each frame
- Manual save/restore of GL blend state
- `map.triggerRepaint()` as the animation driver
- `gl.canvas === map.getCanvas()` holds in both

A Three.js `InstancedMesh` layer ported between them aligned with `map.project()` to `dx = dy = 0.00px` at z7 and z10, at pitch 45° and 60°, bearing 20° and 30°. The coordinate systems do not drift; only the plumbing differs.

## What differs

### 1. The render signature

Mapbox passes positional arguments. MapLibre passes one options object.

```ts
// mapbox-gl
render(gl, matrix /* number[16] */, projection?, projectionToMercatorMatrix?, ...)

// maplibre-gl
render(gl, options /* CustomRenderMethodInput */)
```

`CustomRenderMethodInput` carries `farZ`, `nearZ`, `fov`, `modelViewProjectionMatrix`, `projectionMatrix`, `shaderData` and `defaultProjectionData`.

### 2. Which matrix to use — the expensive one

**Use `options.defaultProjectionData.mainMatrix`.**

`options.modelViewProjectionMatrix` is a different coordinate system. Feeding it geometry built for mercator world space projects that geometry roughly **−54,000 px** off screen. Nothing errors; the layer is simply not where you are looking, and the natural conclusion is that your own matrix maths broke.

`mainMatrix` is a `Float64Array(16)`; Three.js wants `Float32Array`, so convert on the way in.

### 3. The `gl` type

MapLibre types `onAdd`'s context as `WebGLRenderingContext | WebGL2RenderingContext` and hands you WebGL2 in practice. Mapbox's typings declare only `WebGLRenderingContext`. If you narrow on the type rather than on capability, one of the two will not compile.

### 4. `renderingMode` is not optional in practice

In MapLibre `renderingMode` defaults to `"2d"`. Write `renderingMode: "3d"` explicitly or you do not get the depth buffer behaviour you expect.

## The globe half

This is where the libraries genuinely diverge, and where a mechanical port will produce a mirror-image bug.

### The transition coefficient runs in opposite directions

| Library | Field | `0` means | `1` means |
|---|---|---|---|
| Mapbox | `projectionToMercatorTransition` | **sphere** | **flat plane** |
| MapLibre | `ProjectionData.projectionTransition` | **mercator** | **globe** |

Every `mix(globe, flat, t)` you wrote for one library must become `mix(flat, globe, t)` for the other. Ported unchanged, the code compiles, runs, and produces a layer that goes flat exactly when the basemap goes spherical — which looks like a projection bug rather than an inverted constant.

Likewise your zero-cost early-out flips: `if (t >= 1.0) return flatPosition;` on Mapbox becomes `if (t <= 0.0) return flatPosition;` on MapLibre.

### MapLibre gives you machinery Mapbox does not

From `maplibre-gl@5.24.0` typings (`dist/maplibre-gl.d.ts`, `ProjectionData`):

| Field | Uniform | What it replaces |
|---|---|---|
| `mainMatrix` | `u_projection_matrix` | In globe projection this projects a **unit sphere** to the screen |
| `clippingPlane` | `u_projection_clipping_plane` | A plane through the planet's horizon, assuming a unit sphere — the library's answer to hand-rolled backface culling |
| `projectionTransition` | `u_projection_transition` | Mapbox's `projectionToMercatorTransition`, inverted |
| `fallbackMatrix` | `u_projection_fallback_matrix` | Animated fallback to mercator |
| `tileMercatorCoords` | `u_projection_tile_mercator_coords` | In-tile → mercator conversion (tile-based layers) |
| `shaderData.vertexShaderPrelude` | — | Injectable GLSL exposing MapLibre's own `projectTile()` |
| `shaderData.variantName` | — | A cache key that changes whenever the shader variant does |

### Do not carry the constants across

Mapbox's globe radius is `8192 / 2π` and its ECEF convention has a negated `y`, matching its internals. MapLibre's `mainMatrix` documents itself as projecting a **unit sphere**. The scale bases are different, so the numbers from [1.1](mapbox.md) are wrong here even though the reasoning transfers.

### `projectTile()` versus your own projection

MapLibre's prelude is written for hand-authored raw-GL shaders. Three.js `ShaderMaterial` brings its own prelude and its own `projectionMatrix`/`modelViewMatrix` conventions, so splicing MapLibre's in is not free of conflicts.

The alternative, unverified but cheap to test: since `mainMatrix` projects a unit sphere, scale your precomputed ECEF positions to unit length and multiply by `mainMatrix` directly — no prelude, no collision. [1.2](maplibre.md) records the outcome once it has actually been run.

## Which to target

If you are choosing rather than porting:

|  | Mapbox GL JS | MapLibre GL JS |
|---|---|---|
| Licence | Proprietary since v2.0.0; account required | BSD-3-Clause |
| Globe + custom layers | Officially unsupported; achievable via undocumented arguments | Documented since v5.0.0 |
| Durability of these recipes | Lower — they rest on unadvertised API | Higher |
| Horizon clipping | Hand-rolled | `clippingPlane` provided |

Undocumented arguments can change in a patch release. Documented ones are a contract.

## Source

Extracted from `mini-taiwan-pulse`: `src/spike/threeMaplibreSpike.ts` (a deliberate, measured port spike) and `src/embed/threeReplayLayer.ts`. Field semantics read from installed `maplibre-gl@5.24.0` typings.
