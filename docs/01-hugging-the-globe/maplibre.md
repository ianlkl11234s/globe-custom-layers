# 1.2 Hugging the globe: MapLibre GL JS

> **Status:** mixed, deliberately. The survey of what MapLibre provides and what its official examples cover is 📋 **Reported** — read from the `maplibre-gl@5.24.0` typings and from the examples themselves. The Three.js porting hypothesis in the second half is ⚠️ **Unverified**: reasoned, not run. It is stated with a way to falsify it, and should not be repeated as fact until someone does.
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
| **Three.js, per-vertex GPU projection** | ❌ nothing |
| **Tens of thousands of independently moving objects** | ❌ nothing |
| Additive blending, depth interaction with the basemap | ❌ nothing |

A per-object CPU matrix is a sound approach for one building and the wrong shape for forty thousand moving ones. Splicing MapLibre's prelude into a Three.js `ShaderMaterial` — which brings its own prelude and its own matrix conventions — is the specific unknown this page exists to resolve.

### Subdivide your geometry

The tile example's documentation notes that geometry subdivision is advisable under globe projection, and this generalises to anything you draw. **A straight line between two distant points is a chord, not an arc** — it will cut through the planet rather than follow its surface, which is the single most common way "my line goes behind the globe" actually happens.

Vertices are projected; the segments between them are not. Two vertices give you a straight line in screen space no matter how correct each endpoint is. Subdivide long spans into enough intermediate vertices that each segment is short relative to the sphere's curvature — the same constraint applies on Mapbox, where nothing in the library will do it for you either.

## The hypothesis worth testing first

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
