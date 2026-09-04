# 2.1 Spark points: glow points without `UnrealBloomPass`

> **Status:** 🔬 Reproduced — the shader and the globe-hugging attribute both run in [`examples/01-points-on-globe`](../../examples/01-points-on-globe/), visually confirmed across all three projection states (sphere, mid-transition, flat mercator — see the example's `screenshots/`). The same technique also runs in production in two other codebases this repo draws from; only the worked example carries the "Reproduced" mark.
> **Applies to:** `three` 0.172.x for the material itself — nothing here is Mapbox- or MapLibre-specific except the globe-hugging attribute (`aEcef`), which needs `mapbox-gl` 3.x ([1.1](../01-hugging-the-globe/mapbox.md)) or `maplibre-gl` 5.x ([1.2](../01-hugging-the-globe/maplibre.md)) if you want that part too.

## The symptom

You have a `THREE.Points` cloud sitting on the map — airports, power plants, substations, whatever the dataset is — and it looks like a pile of flat, matte dots. You want it to read as *light*: something with intensity, that blows out where points cluster and fades cleanly where they thin out. People call this a few different things depending on who's asking — spark points, glow points, fake bloom, pseudo-bloom — it's the same shader trick under every one of those names.

The reflexive answer, if you've done this in a standalone Three.js scene before, is `UnrealBloomPass`. Wire it up here and you either can't, or you regret it.

## Why it happens

`UnrealBloomPass` — like any postprocessing pass — needs its own render target(s), an `EffectComposer`, and at least one extra full-screen blur/composite draw stacked on top of what you already render. That's a reasonable cost when you own the renderer. You don't, here: inside a `CustomLayerInterface`, Mapbox owns the WebGL context and the framebuffer, has already drawn the basemap into it this frame, and expects you to leave both exactly as you found them ([1.1](../01-hugging-the-globe/mapbox.md), [4.3](../04-discipline/shared-gl-context.md)). Standing up a composer chain inside someone else's context is invasive, and it costs real frame budget on every pixel, whether or not anything is actually glowing there.

The fix used here doesn't post-process anything. A single `THREE.Points` draw call with a hand-written `ShaderMaterial` fakes the "light source" look entirely inside one fragment shader: three concentric radial falloffs, drawn additively, so that only where sprites actually overlap does the color sum toward white. Nothing is blurred and nothing bleeds past a sprite's own footprint — it's a cheaper illusion of bloom, not the real thing. For a field of point markers, nobody can tell the difference.

## Step 1: three nested halos in one fragment shader

Everything happens inside `gl_PointCoord`, the `[0,1]²` UV Three gives you across each point sprite. Recenter it to `[-1,1]²` and take its length, and every falloff below becomes a 1D function of distance from the sprite's center:

```glsl
vec2 uv = gl_PointCoord - 0.5;
float d = length(uv) * 2.0;
if (d > 1.0) discard; // outside the circle — cheaper than blending a square

float core = smoothstep(0.18, 0.0,  d);         // tight bright center
float mid  = smoothstep(0.55, 0.18, d) * 0.55;  // mid glow
float far  = smoothstep(1.0,  0.55, d) * 0.22;  // soft outer falloff
float a = (core + mid + far) * uOpacity;
```

Each ring does a different job. `core` is the part that reads as "this is a light source" — a small, near-opaque disc. `mid` is the glow around it, dimmer and wider, weighted down to `0.55` so it doesn't compete with the core for attention. `far` is the longest tail, weighted down further to `0.22`, and it's what makes the point feel like it has *falloff* rather than a hard edge — the difference between a dot and a glow. Three `smoothstep`s and two multiplies is the whole "bloom" budget, per pixel.

One more knob worth knowing about, even though it isn't a halo: a slow size pulse — `0.9 + 0.1 * sin(uTime * 1.8 + position.x * 200.0)` — folded into `gl_PointSize` in the vertex shader. The `position.x * 200.0` phase offset means points don't pulse in lockstep; a whole field of static markers reads as more alive without any per-point animation logic beyond one `sin()`.

## Step 2: additive blending is where the glow comes from

```ts
new THREE.ShaderMaterial({
  transparent: true,
  depthTest: false,   // unconditional here — see 1.1 step 3 for why globe mode needs it
  depthWrite: false,  // transparent objects shouldn't write depth — see 3.2
  blending: THREE.AdditiveBlending,
});
```

`AdditiveBlending` sums color values — `a + b`, not `over(a, b)`. Draw two overlapping sprites and their colors literally add, so a cluster of nearby points blows toward white exactly the way overexposed light does in a photo. That's the entire "glow" effect once you step back from any single sprite: it isn't a property of one point, it's a property of what happens where several overlap. Sparse points stay their own color; dense clusters wash out. No blur pass produces that gradient — the geometry of overlapping circles does.

This is also why draw order stops mattering for this material specifically (`a + b == b + a`) — see [4.2 Depth and blending](../04-discipline/depth-and-blending.md) for what changes the moment this gets mixed with a material that *isn't* additive.

## Step 3: push the center toward white

```glsl
vec3 col = mix(vColor, vec3(1.0), core * uCoreBoost);  // uCoreBoost ≈ 0.7–0.85
gl_FragColor = vec4(col, a);
```

A saturated color rendered at full opacity across its own core looks flat — a colored disc, not a light. Real light sources are white or near-white at the point of emission and only take on color toward the edges. Mixing the fragment's color toward white, weighted by how deep into the `core` falloff the pixel sits, fakes that: the center of a red point still reads as *red light*, not a red sticker, because it's white-hot in the middle and only fully saturated a little further out. `uCoreBoost` is the knob for how strong that pull is — `0.7` in the reference example, `0.85` in production deployments that want a hotter-looking core.

## Step 4: size from data, not from vibes

```ts
const norm = Math.max(0, Math.min(1, r.sizeNorm)); // clamp; the caller already computed this
const sizePx = MIN_POINT_SIZE_PX + (MAX_POINT_SIZE_PX - MIN_POINT_SIZE_PX) * norm;
```

`sizeNorm` arrives pre-normalized to `[0,1]` — the scene never sees a raw value. What the caller does *before* handing it over matters: a plain `value / max` looks wrong whenever the underlying distribution is right-skewed, which real-world magnitude data almost always is. A handful of huge airports, power plants, or high-traffic days sit near `1.0` and drag every ordinary point down near `0`, so the whole field looks the same size except for two or three outliers. Every call site that feeds this scene uses `sqrt`, not a raw ratio:

```ts
const sizeNorm = Math.sqrt(value / max);
```

`sqrt` compresses the top of the distribution and expands the bottom, so the *visible* size spread tracks perceived magnitude instead of raw magnitude. This isn't a one-off trick — it's the same line normalizing daily flight-traffic counts in one production glow layer and power-plant `capacity_mw` in another, and it's what the reference example does to a synthetic hash purely for visual variety. Whenever you feed this scene a size, assume the input is skewed and compress it before it arrives — the shader never gets a chance to fix it, because by the time it sees `aSize` the value has already been mapped to pixels.

## Step 5: `uPixelRatio`, and the zoom scale this page doesn't own

```glsl
gl_PointSize = aSize * uPixelRatio * pulse * uZoomScale * uSizeMul;
```

`gl_PointSize` is specified in device pixels, not CSS pixels. Skip the `uPixelRatio` multiply and every point renders at half its intended size on any 2x-density screen — not corrupted, just wrong, and easy to miss if you only ever test on a 1x display. The uniform is set once and clamped:

```ts
uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) }
```

The clamp to `2` matters as much as the multiply itself — an uncapped `devicePixelRatio` on a 3x phone would blow every sprite's footprint up 50% over what a 2x device gets, for no visual benefit and a real fill-rate cost.

`uZoomScale` is the other multiplier in that line, and it isn't this page's subject: `gl_PointSize` doesn't change with map zoom on its own, so without it a glow tuned at one zoom either vanishes at another or swallows the whole viewport. That's [4.1 Zoom-adaptive sizing](../04-discipline/zoom-adaptive-sizing.md) in full — the short version is `uZoomScale = clamp(pow(1.5, zoom - referenceZoom), min, max)`, computed once per frame from `map.getZoom()` and multiplied straight into the line above.

## The interface has no opinion about your data

The scene's entire public input is one shape (`GlowPoint` in the production versions, `AirportPoint` with identical fields in the reference example):

```ts
interface GlowPoint {
  lon: number;
  lat: number;
  colorHex: string;
  sizeNorm: number; // 0..1
}
```

Nothing about fuel type, capacity, airport traffic, or voltage class lives inside this file. Every business-specific decision — which color a fuel type gets, how a capacity number becomes `sizeNorm`, which rows even qualify to be drawn — happens in the caller, before `setData()` runs. The scene just draws whatever colors and sizes it's handed.

That's the reason the same file shows up, near-verbatim, behind three unrelated layers across two production codebases: airports, power plants, substations. None of them required touching the shader. Keeping semantics out of the shader is what makes a visual effect portable between projects — the moment a shader starts branching on `fuel_type === 'coal'`, it stops being copyable into the next dataset without a rewrite.

## What a `gl.POINTS` draw call won't do for you

Three limits are worth knowing before you reach for this technique at a larger scale:

- **The buffer has a fixed ceiling.** These implementations allocate `Float32Array`s sized for a `MAX_POINT_COUNT` (4096 in the reference example) up front, not per dataset — growing a WebGL buffer means reallocating and re-uploading the whole thing, so the cap is deliberate. Feed it more rows than that and `setData()` clamps silently past a single `console.warn`; if your console isn't open, the extra points just aren't there, and it looks like a data problem.
- **Point sprites don't hit-test.** Like every custom layer, `queryRenderedFeatures` doesn't see this draw call at all — see [1.1](../01-hugging-the-globe/mapbox.md)'s sanity-check list. If you need a popup on click, pair this with an invisible native `circle` layer at the same coordinates and let that own interaction.
- **`gl_PointSize` has a hardware ceiling you don't control.** See the trap below.

## The trap that costs the most time

You tune the size formula, it looks right at your test zoom, you ship it. Weeks later someone reports the glow "stopped scaling" past a certain zoom on their machine — the halo just plateaus instead of continuing to grow the way it did everywhere else you tested.

`gl_PointSize` isn't unbounded. `ALIASED_POINT_SIZE_RANGE` is implementation-defined, and on a real range of driver stacks — particularly some ANGLE/D3D backends on Windows — the practical ceiling sits well under the values a size formula can produce once `aSize` (already up to `MAX_POINT_SIZE_PX`), `uPixelRatio` (up to `2`), `uZoomScale`, and `uSizeMul` all multiply together. The GPU clamps silently: no error, no console warning, just a size that stops responding to a formula that, on paper, is still increasing. It reads exactly like a bug in your zoom-scale math, and it isn't — the formula is fine, the hardware has an opinion nobody asked it for.

Check it once per target device rather than guessing:

```js
console.log(gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)); // e.g. Float32Array [1, 255]
```

If your worst-case computed size can exceed the reported max, the clamp isn't a formula bug to chase — it's a ceiling to design around: lower the multiplier bounds, or accept that very close zoom-ins plateau.

## Source

Extracted from the runnable example in this repo — `examples/01-points-on-globe/src/glowPointsScene.ts` (the shader and material) and `globeProject.ts` (the `aEcef` attribute and globe-hugging blend, shared with [1.1](../01-hugging-the-globe/mapbox.md)). The business-agnostic interface and the `sqrt` size-compression pattern also appear in `mini-taiwan-pulse`: `src/three/GlowPointsScene.ts`, `src/map/powerPlantGlowCustomLayer.ts`; and in `plan-art`: `src/three/GlowPointsScene.ts`, `src/map/atlasGlowLayer.ts`.

## Next

- [1.1 Mapbox GL JS](../01-hugging-the-globe/mapbox.md) — get this same scene hugging the globe in the first place
- [4.1 Zoom-adaptive sizing](../04-discipline/zoom-adaptive-sizing.md) — the `uZoomScale` half of the size formula above
- [4.2 Depth and blending](../04-discipline/depth-and-blending.md) — why additive blending makes draw order stop mattering, and what breaks when it isn't additive
- [`examples/01-points-on-globe`](../../examples/01-points-on-globe/) — the runnable version of everything on this page
