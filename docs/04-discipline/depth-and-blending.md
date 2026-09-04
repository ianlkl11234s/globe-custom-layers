# 4.2 Depth and blending

> **Status:** 📋 Reported — running in production; not yet reproduced in this repo's example.
> **Applies to:** `mapbox-gl` 3.x, `three` 0.172.x.

## The symptom

Everything works in the dark theme. You switch to a light theme — which, for the same layer, switches `AdditiveBlending` to `NormalBlending` — and suddenly one mesh paints behind another that it should sit in front of. Nothing crashed, nothing logged a warning; the geometry is correct, the shader compiled, the mesh is definitely in the scene. It's just on the wrong side of something else.

## Why it happens

[1.1 Mapbox GL JS](../01-hugging-the-globe/mapbox.md) established that globe-hugging geometry needs `depthTest: false`, because the basemap has already written a solid sphere into the depth buffer with an infinite far plane, and your geometry will lose every depth comparison against it. That flag has a consequence the symptom above is the shape of: **with depth testing off, the GPU no longer resolves overlap for you.** Paint order becomes entirely your responsibility the moment you turn it off.

Three.js does have a fallback for transparent objects with no explicit order: it sorts by each object's `boundingSphere` distance to the camera. That fallback is not a substitute for `renderOrder`. When several meshes share nearly the same world position — four concentric shells built from one point, for instance — their bounding spheres differ only by radius, and which one wins the distance sort can flip between one shader recompile and the next. It's stable enough to ship without anyone noticing, and unstable enough to break the first time something unrelated changes.

## Additive blending hides this bug; normal blending exposes it

`AdditiveBlending` sums color values (`a + b == b + a`). Draw two overlapping additive meshes in either order and the pixel comes out the same — order-independence is *why* additive halos look right by accident even when `renderOrder` was never explicitly set. `NormalBlending` (alpha-over) is not commutative: draw the wrong one on top and it visibly, silently covers the one that should have won.

This is why a dark-theme-only layer can ship with broken draw order for months: additive blending was covering for it the whole time. The bug only becomes visible once something switches the layer to `NormalBlending` — a light theme, most commonly — and by then "why did this suddenly break" points at the wrong commit.

## The fix: explicit `renderOrder`, chosen to compose with what's already there

Four instanced layers sharing one object's position (two glow shells, a white core, a blink) need a fixed paint order regardless of blending mode or bounding-sphere tie-breaks:

```ts
mesh.renderOrder = 0.1; // outer glow
mesh.renderOrder = 0.2; // inner glow
mesh.renderOrder = 0.3; // white core
mesh.renderOrder = 0.4; // blink (topmost)
```

The values are deliberately fractional, in the open interval `(0, 1)`. Two other meshes already in the same scene were never given an explicit `renderOrder` and sit at the default, `0`; a separate trail mesh was explicitly set to `1`. Slotting these four layers into `0.1`–`0.4` composes the order (`static meshes (0) < these four shells (0.1–0.4) < the trail mesh (1)`) without touching either endpoint — and without relying on a Z-depth tie-break that had already been observed to flip between compiles.

## `depthWrite` and `depthTest` are two different questions

`depthTest` asks "should existing depth values stop me from drawing here." `depthWrite` asks "should my draw update the depth buffer for what comes after me." A transparent object almost always wants `depthWrite: false` regardless of what you decide about `depthTest` — an alpha-blended surface writing an opaque depth value would then wrongly occlude whatever is meant to blend behind it.

A vessel-track layer that has not implemented the globe-hugging escape hatch at all sets its two materials differently, and the difference is deliberate:

```ts
// heads: fully manual paint order, no depth interaction at all
new THREE.MeshBasicMaterial({ depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending });
// trails: still depth-tested, just doesn't occlude what's drawn after it
new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false });
```

The trail material's `depthTest` is left at Three's default (`true`). That only costs nothing for as long as this layer never actually renders while the basemap is in globe projection — the moment it does, the same solid-sphere depth write from [1.1](../01-hugging-the-globe/mapbox.md) applies here too, and the trails would lose against it exactly like any other globe-hugging geometry that skipped `depthTest: false`.

## When you don't need the full treatment — and how to actually know

Not every custom layer needs globe-hugging, and a layer that doesn't should not carry its cost. But "this layer doesn't do globe-hugging" is a claim about the layer's code, not about what basemap it will ship inside — a style swap, a projection toggle exposed to users, or simply reusing the layer in a different app can put it under globe projection without the layer noticing. Don't infer safety from "it hasn't broken yet." [1.1](../01-hugging-the-globe/mapbox.md)'s own sanity check applies here directly: log `map.getProjection().name` inside `render()`, at low and high zoom, for every basemap style the layer will actually ship with. If that never comes back `"globe"`, the escape hatch genuinely isn't needed. If it can, `depthTest: false` plus the culling from [1.1](../01-hugging-the-globe/mapbox.md) is the cost of admission, not an optional extra.

## The trap that costs the most time

Additive blending's order-independence means a broken `renderOrder` produces **zero visible symptoms** in the theme it shipped in. It will pass every visual check you run against the theme you're actively developing in. The only way to catch it before a user does is to deliberately test the *other* blending mode — switch themes, or force `NormalBlending` temporarily — rather than trusting that "it looks right" generalizes across a blend mode it was never actually checked in.

## Source

Extracted from `plan-art`: `src/three/InstancedOrbs.ts`, `src/three/BatchedTrails.ts`, `docs/features/atlas-bloom-globe.md`; `mini-taiwan-pulse`: `src/three/GlowPointsScene.ts`, `src/three/GfwV4TrackScene.ts`, `src/map/gfwV4TrackCustomLayer.ts`.

## Next

- [1.1 Mapbox GL JS](../01-hugging-the-globe/mapbox.md) — why `depthTest: false` becomes necessary in the first place
- [4.4 GLSL gotchas](glsl-gotchas.md) — more silent failures in the same rendering path
- [3.2 Instanced tracks](../03-scaling-up/instanced-tracks.md) — the multi-layer instancing pattern `renderOrder` is composing here
