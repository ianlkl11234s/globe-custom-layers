# 1.2 Hugging the globe: MapLibre GL JS

> **Status:** mixed, deliberately. MapLibre's official projection API is 📋 **Reported**. The site's prelude-based Three.js adapter for examples 01/02/05 and focused adapters for 09/10 are 🔬 **Reproduced** in a local browser without a token. The direct ECEF/mainMatrix path below remains ⚠️ **Unverified**. This does not verify terrain or depth interaction.
>
> The mercator half of this story *is* measured — see [1.3 Porting](porting.md).

## Where MapLibre starts you off

Unlike Mapbox, MapLibre documents custom layers under globe projection, and has done since v5.0.0. The render callback receives a `ProjectionData` object carrying, among other fields:

- `mainMatrix` — in globe projection, *"projects a unit sphere planet to screen"*
- `clippingPlane` — a plane equation through the planet's horizon, assuming a unit sphere
- `projectionTransition` — `0` = mercator, `1` = globe
- `shaderData.vertexShaderPrelude` — GLSL exposing MapLibre's own `projectTile()`

So the three hard problems from [1.1](mapbox.md) — projecting onto the sphere, hiding the far side, and following the basemap's own transition — all have library-provided answers here, rather than reverse-engineered ones.

## What the official examples already cover

There are three, and they do not agree with each other about how to do this — which is worth knowing before you pick one to copy.

**[Simple custom layer on a globe](https://maplibre.org/maplibre-gl-js/docs/examples/add-a-simple-custom-layer-on-a-globe/)** — raw WebGL, one magenta triangle spanning Helsinki–Berlin–Kyiv, toggling between globe and mercator. This is the one that does it *properly*: it splices in the prelude and lets MapLibre do the projection.

```glsl
${shaderDescription.vertexShaderPrelude}
${shaderDescription.define}
...
gl_Position = projectTile(a_pos);
```

It passes `u_projection_matrix`, `u_projection_fallback_matrix`, `u_projection_tile_mercator_coords` and `u_projection_clipping_plane` as uniforms, so horizon clipping is handled by the library rather than by hand.

**[Custom layer with tiles on a globe](https://maplibre.org/maplibre-gl-js/docs/examples/add-a-custom-layer-with-tiles-to-a-globe/)** — also raw WebGL, renders a hierarchy of subdivided tile meshes across zoom 0–7, switching behaviour on `args.shaderData.variantName === 'globe'`. This is the closest thing in any official documentation to "a lot of geometry on a globe".

**[3D model on a globe using Three.js](https://maplibre.org/maplibre-gl-js/docs/examples/add-a-3d-model-to-globe-using-threejs/)** — the only Three.js one, and the least complete. It renders one GLTF building plus two lights, computes the model matrix **on the CPU** (branching on `projectionTransition > 0`, building a rotation from lat/lon, scaling to unit-sphere with an Earth radius of 6,371,008.8 m), does **not** use the prelude, does **not** use `clippingPlane`, leaves backface culling at Three's defaults, and does not discuss the depth buffer.

### So where is the gap

Not in "can custom layers work on a MapLibre globe" — they can, officially, with library support. The gap is the intersection:

| | Official coverage |
|---|---|
| Raw WebGL, small geometry, prelude-based | ✅ two examples |
| Raw WebGL, many subdivided tiles | ✅ one example |
| **Three.js, per-vertex GPU projection** | Not covered by these official examples; local reproduction below |
| **Tens of thousands of independently moving objects** | Not covered; the local port below was exercised at 5,000 objects |
| Additive blending, depth interaction with the basemap | Not covered by these official examples; local blending and clipping findings below |

A per-object CPU matrix is a sound approach for one building and the wrong shape for forty thousand moving ones. Splicing MapLibre's prelude into a Three.js `ShaderMaterial` — which brings its own prelude and its own matrix conventions — is the specific unknown this page exists to resolve.

### Subdivide your geometry

The tile example's documentation notes that geometry subdivision is advisable under globe projection, and this generalises to anything you draw. **A straight line between two distant points is a chord, not an arc** — it will cut through the planet rather than follow its surface, which is the single most common way "my line goes behind the globe" actually happens.

Vertices are projected; the segments between them are not. Two vertices give you a straight line in screen space no matter how correct each endpoint is. Subdivide long spans into enough intermediate vertices that each segment is short relative to the sphere's curvature — the same constraint applies on Mapbox, where nothing in the library will do it for you either.

## 🔬 Reproduced locally: prelude-based Three.js adapter

`site/maplibreCustom.ts` keeps the original Three.js scene geometry and fragment shaders, then replaces only the vertex projection with MapLibre's `shaderData.vertexShaderPrelude` and `projectTileWithElevation()`. `site/specialScenes.ts` supplies focused orbit and boundary-wall adapters using the same projection prelude. The local browser reproduction covers:

- 01 points: original point-size path, `vCull = 1`, and MapLibre's official horizon clip;
- 02 arcs: 190 raised arcs / 19,760 vertices at the current 53-sample default, with normal blending in light mode and additive blending in dark mode;
- 05 tracks: 5,000 tracks in 4,096 slots and one draw call.
- 09 orbits: three closed inclined paths, moving markers, altitude scale, speed, pause/resume, and high-altitude horizon visibility;
- 10 walls: an injected Taiwan ADIZ schematic fixture, geodesically densified wall segments, antimeridian-safe copies, and adjustable display height.

The adapter keeps custom-layer coordinates in `[0,1]` for x/y and passes height in metres. MapLibre 5.24's `defaultProjectionData.projectionTransition` is only binary in this callback, so the adapter obtains the basemap coefficient from `map.transform.getProjectionData({overscaledTileID: null, applyGlobeMatrix: true}).projectionTransition`; this is pinned internal integration, not a public portability contract. The prelude's horizon clip plus `vCull = 1` does not reproduce Mapbox's soft limb fade pixel-for-pixel. `projectTileWithElevation()` is used with `depthTest: false`; measured depth-tested 3D rendering cut points, so terrain/depth correctness is not claimed.

The site's free mode is this MapLibre custom-layer preview, not a native `circle`/`line` substitute. Its token-free bundle aliases `mapbox-gl` to a MercatorCoordinate-only shim and does not ship the Mapbox SDK. The site build reuses selected example TypeScript sources without changing the examples' self-contained copy-out contract. The special adapters are site integration code, not files required when copying a standalone example.

## ⚠️ Unverified: direct ECEF/mainMatrix hypothesis

`mainMatrix` projects a **unit sphere**. A layer that already precomputes ECEF positions per vertex (as [1.1](mapbox.md) does, for its own reasons) is therefore two steps from working here:

1. Normalise the precomputed ECEF attribute to unit length — the direction is already correct, only the scale basis differs. Altitude becomes a radial factor slightly greater than 1.
2. Multiply by `mainMatrix` in the vertex shader instead of by Mapbox's `projectionToMercatorMatrix`.

If that holds, the `projectTile()` prelude is unnecessary — which is convenient, because Three.js `ShaderMaterial` supplies its own prelude and its own matrix conventions, and splicing MapLibre's into it invites a collision.

**How to falsify it:** render a known great-circle arc between two cities at z2 and compare against `map.project()` for sampled points along it. Agreement within a pixel confirms the hypothesis. Systematic radial error suggests the altitude factor; a rotation or mirror suggests axis conventions differ from Mapbox's.

## Open questions

These are genuinely unknown and should not be guessed at in a doc:

- Does MapLibre's globe basemap write depth before custom layers run, as Mapbox's does? If it does, [1.1 step 3](mapbox.md) applies here too and every material needs `depthTest: false`.
- Is `clippingPlane` a hard clip or does it leave the limb aliased? Hand-rolled culling used a soft `smoothstep` edge specifically so the limb reads as atmosphere.
- What is the ECEF axis convention? Mapbox negates `y`; MapLibre's is undocumented in the typings.
- Does `variantName` change often enough that shader recompilation shows up in a frame budget?

## Next

- [1.3 Porting between the two](porting.md) — the measured difference table, including the inverted transition coefficient
- [1.1 Mapbox GL JS](mapbox.md) — the verified recipe this page is a port of
