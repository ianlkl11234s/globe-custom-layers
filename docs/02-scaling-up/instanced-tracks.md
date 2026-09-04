# 2.2 Instanced tracks

> **Status:** 📋 Reported — running in production, not yet reproduced as an example in this repo.
> **Applies to:** `three` 0.172.x — `InstancedMesh`, `Material.onBeforeCompile`, `customProgramCacheKey`.

## The symptom

`InstancedMesh` gets you thousands of objects sharing one draw call. It exposes per-instance transform (`instanceMatrix`) and, if you opt in, per-instance color (`instanceColor`). It does not expose per-instance **opacity**. If your points need to fade in, fade out, or dim independently of each other — a vessel appearing mid-transition, a marker aggregating several members and shrinking as they disperse — the built-in material has no attribute for that, and every workaround that avoids touching the shader (separate materials per instance, faking it with scale) either defeats the point of instancing or doesn't read as a fade at all.

## Why it happens

WebGL doesn't have a native "per-instance uniform." Three's `InstancedMesh` ships exactly two per-instance channels — `instanceMatrix` and `instanceColor` — because those are the two the built-in materials were written to consume. Anything past that requires patching the material's own shader.

## Step 1: inject a per-instance attribute with `onBeforeCompile`

`onBeforeCompile` runs once, when the material's shader is about to link, with the generated GLSL source in hand as plain strings. Add an attribute, thread it through as a varying, and multiply it into the final alpha:

```ts
material.onBeforeCompile = (shader) => {
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nattribute float aAlpha;\nvarying float vAlpha;")
    .replace("#include <color_vertex>", "#include <color_vertex>\nvAlpha = aAlpha;");
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", "#include <common>\nvarying float vAlpha;")
    .replace(
      "vec4 diffuseColor = vec4( diffuse, opacity );",
      "vec4 diffuseColor = vec4( diffuse, opacity );\ndiffuseColor.a *= clamp( vAlpha, 0.0, 1.0 );",
    );
};
```

The attribute itself is a normalized `Uint8Array` `InstancedBufferAttribute` — one byte per instance, `0–255` mapped to `0.0–1.0` — attached to the geometry, not the material. Uploading a per-instance fade is then a single-byte write per instance instead of a full uniform buffer swap.

## Step 2: `customProgramCacheKey` — and why it isn't optional here

Three's default `customProgramCacheKey()` (verified against the shipped source) is literally `this.onBeforeCompile.toString()` — the *source text* of the callback, stringified. That text, plus a set of other compile-time parameters, is what decides whether two materials are allowed to share one compiled GL program.

The trap: if two different `onBeforeCompile` callbacks happen to stringify to identical text — the same boilerplate, injecting a *different* attribute name or constant via a closure variable that never appears in the function's literal source — Three's program cache sees them as interchangeable. It can then hand one material a compiled program built for the other's attribute layout, silently binding the wrong buffer to the wrong location. Nothing throws. It just renders wrong.

Pin an explicit, static key instead of trusting the stringified closure:

```ts
material.customProgramCacheKey = () => "trackscene-head-instance-alpha-v1";
```

Worth noting: not every `onBeforeCompile` patch in this codebase sets one. A companion component (`InstancedOrbs`, covered below) patches four materials without an explicit key — safe there specifically because all four closures inject byte-for-byte identical GLSL every time they run, so there's no divergent text to be confused with anything else. That's a coincidence of that particular code, not a rule. An explicit static key is the cheap, future-proof default; relying on the stringified-closure fallback is a bet that nothing else in a growing codebase ever produces matching source text with different intent.

## Step 3: fixed capacity, and turn off automatic frustum culling

`InstancedMesh` computes its default bounding sphere from the *unshared* geometry as authored — for a unit icosahedron, that's a sphere of radius ~1 centered at the origin. It does not account for where the per-instance transforms actually place the instances. When instances are scattered across real geographic coordinates far from the origin, Three's automatic frustum test checks the wrong sphere, concludes the whole mesh is outside the view, and the entire `InstancedMesh` disappears — not clipped, just gone:

```ts
this.mesh = new THREE.InstancedMesh(geometry, material, MAX_INSTANCES);
// Default frustum culling reads a bounding sphere computed from the unit
// geometry, not from where the instances actually sit — turn it off and
// cull on the CPU side instead.
this.mesh.frustumCulled = false;
```

## Step 4: cull before you upload, not after

With automatic culling off, culling has to happen somewhere else — before data reaches the GPU, not as a GPU-side discard. The viewport test runs on the CPU (or in a Worker, for a higher-throughput path) against the current map bounds, and only the surviving points and segments get written into the fixed-capacity buffers at all. `render()` never sees more geometry than fits on screen.

## Step 5: two failure strategies for "more instances than budget," and why they differ

This is the part worth sitting with. The same codebase has two entry points for feeding an `InstancedMesh` scene, and they handle a budget overrun in opposite ways:

- One path is called from ordinary application code and **throws** a diagnostic error the moment culled counts exceed capacity — `heads=N/max, trailVertices=M/max` spelled out in the message.
- The other path runs every frame **from inside the map's own paint callback**, and instead **clamps** silently to the budget and logs a warning exactly once per session, guarded by a module-level flag so it never repeats:

```ts
if (frame.buckets.length > budget.maxHeads && !warnedHeadBudget) {
  warnedHeadBudget = true;
  console.warn(`GPU budget clamped: heads=${frame.buckets.length}/${budget.maxHeads}`);
}
```

The reasoning is about *where the code runs*, not the data: an exception from a normal function call fails that one call. An exception thrown from inside a map library's render pass propagates up through code that isn't expecting it and can take the whole map down with it. Match the failure strategy to the position in the pipeline — throw where a caller can catch it and retry or report; clamp-and-warn-once where the alternative is crashing something you don't own.

## The other half of the picture: lines don't need any of this

Not every geometry type needs the `onBeforeCompile` route. Trail segments in the same scene are drawn as plain `LineSegments`, not instances, and their per-vertex color already carries alpha for free — a `vec4` normalized `Uint8Array` color attribute, no shader patch required, because `LineSegments` isn't instanced and Three's built-in vertex-color path already includes the alpha channel. Only the genuinely instanced geometry — where the built-in per-instance channels stop at color — needs step 1 through 3 at all. Knowing which kind of geometry you're looking at decides whether you need a shader patch or just the right typed array.

## Shader animation, computed once, read every frame

A related pattern worth carrying over: breathing/pulsing/blinking animation for instanced points doesn't need the CPU at all. Drive it from a `uTime` uniform plus a per-instance `aPhase` attribute set once at construction — a deterministic sequence (golden-angle spacing, not `Math.random()`, so frozen-frame visual regression tests stay reproducible) — and do the oscillation math entirely in the vertex/fragment shader. The CPU side only writes the handful of matrix fields that actually change per instance (position and uniform scale — six of sixteen column-major entries, written directly into the cached `instanceMatrix.array` rather than composed through `Object3D.updateMatrix()`), and skips the upload entirely on any frame where nothing changed. The net effect measured in one such scene: four `InstancedMesh` objects (four fixed draw calls) replacing what had been five separate meshes per tracked object.

## Source

Extracted from `mini-taiwan-pulse`: `src/three/GfwV4TrackScene.ts` (and its test suite, `src/three/GfwV4TrackScene.test.ts`) and `plan-art`: `src/three/InstancedOrbs.ts`.

## Next

- [2.1 Batched trails](batched-trails.md) — the same fixed-capacity, cull-before-upload discipline applied to line geometry instead of instances
- [3.1 Zoom-adaptive sizing](../03-discipline/zoom-adaptive-sizing.md) — the screen-space scale formula used for instance size
- [3.3 Sharing a WebGL context](../03-discipline/shared-gl-context.md) — restoring GL state a Three renderer leaves behind on a shared context
- [1.1 Mapbox GL JS](../01-hugging-the-globe/mapbox.md) — why `depthTest: false` applies to instanced materials too
