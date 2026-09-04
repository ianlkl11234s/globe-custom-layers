# 1.2 Hugging the globe: MapLibre GL JS

> **Status:** ⚠️ **Unverified.** This page is reasoned from the `maplibre-gl@5.24.0` typings and the official example, not yet from running code. It states a hypothesis and how to falsify it. Do not treat it as a recipe until the status changes.
>
> The mercator half of this story *is* measured — see [1.3 Porting](porting.md).

## Where MapLibre starts you off

Unlike Mapbox, MapLibre documents custom layers under globe projection, and has done since v5.0.0. The render callback receives a `ProjectionData` object carrying, among other fields:

- `mainMatrix` — in globe projection, *"projects a unit sphere planet to screen"*
- `clippingPlane` — a plane equation through the planet's horizon, assuming a unit sphere
- `projectionTransition` — `0` = mercator, `1` = globe
- `shaderData.vertexShaderPrelude` — GLSL exposing MapLibre's own `projectTile()`

So the three hard problems from [1.1](mapbox.md) — projecting onto the sphere, hiding the far side, and following the basemap's own transition — all have library-provided answers here, rather than reverse-engineered ones.

## Where the official example stops

The [official Three.js globe example](https://maplibre.org/maplibre-gl-js/docs/examples/add-a-3d-model-to-globe-using-threejs/) is a useful starting point and an incomplete one. It:

- renders **one** GLTF model plus two directional lights
- computes the model matrix **on the CPU**, branching on `projectionTransition > 0` and building a rotation from lat/lon, then scaling into unit-sphere coordinates using an Earth radius of 6,371,008.8 m
- does **not** use `shaderData.vertexShaderPrelude`
- does **not** use `clippingPlane`, relying on Three.js frustum culling
- leaves backface culling at Three.js defaults
- does not discuss the depth buffer the globe basemap has already written

A per-object CPU matrix is a sound approach for one building. It is the wrong shape for forty thousand moving objects, where the projection has to happen per vertex on the GPU.

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
