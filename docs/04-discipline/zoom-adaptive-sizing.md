# 4.1 Zoom-adaptive sizing

> **Status:** 📋 Reported — running in production; not yet reproduced in this repo's example.
> **Applies to:** `mapbox-gl` 3.x, `three` 0.172.x (the same screen-space rule applies to MapLibre's own paint properties).

## The symptom

A glow layer looks right at the zoom level you built it at. Zoom out to see a whole country, or a whole planet, and the glow doesn't shrink with everything else on screen — it stays the same number of pixels, so it now covers a city, then a region, then most of the visible map. Points that used to read as separate dots merge into a single white blob.

Reported case: a power-plant glow layer tuned by eye at a city zoom, opened at zoom 5 for a whole-country view — each plant's halo covered roughly a quarter of Taiwan.

## Why it happens

Two things you draw in a `CustomLayerInterface` live in different coordinate systems, and only one of them is zoom-aware by default.

**`gl_PointSize` is always screen pixels.** The GLSL/WebGL spec defines it that way — it is not run through your projection matrix, it is not affected by the map's zoom. A `Points` material sized for 60px at zoom 12 is still 60px at zoom 5, even though the map now shows roughly 100× more geographic area in the same viewport. Mapbox's own screen-space paint properties (`line-blur`, `circle-blur`) behave the same way — they're pixel values, not world values, and don't move on their own as you zoom.

**Mesh scale in Mercator world units is the opposite: zoom-coupled, and exponentially so.** An `InstancedMesh` sized in the same 0–1 Mercator world space `MercatorCoordinate.fromLngLat` returns does *not* stay a fixed pixel size as you zoom — the projection matrix that turns world units into screen pixels scales with `2^zoom`, so a mesh with a constant world-space radius balloons in screen pixels as you zoom in.

Neither default is "right" — they're two different failure directions for the same fact: **screen size and zoom are decoupled unless you explicitly couple them, and the coupling you need depends on which coordinate space your size lives in.**

## Two ways to couple them

### Pixel-space: multiply a zoom scalar into `gl_PointSize`

```glsl
uniform float uZoomScale;
gl_PointSize = aSize * uPixelRatio * uZoomScale;
```

```ts
setZoom(zoom: number, referenceZoom = 10) {
  const raw = Math.pow(1.5, zoom - referenceZoom);
  this.material.uniforms.uZoomScale.value = Math.max(0.15, Math.min(3.5, raw));
}
```

Base `1.5`, not `2`. Base `2` would exactly track the Mercator projection's own scale factor — full geographic constancy, meaning the halo covers the same ground area at every zoom, which for a glow effect reads as static and lifeless. `1.5` is partial coupling: the halo still visibly grows as you zoom in (a useful cue that you're looking at one thing up close, not several), but it doesn't reach the pixel footprint that swallowed a quarter of the country at zoom 5.

### World-space: divide a mesh's scale by the projection's own growth factor

```ts
const headScale = 2.8 / (512 * 2 ** zoom);
this.matrix.makeScale(headScale, headScale, headScale);
```

This solves the inverse problem. The mesh is *already* zoom-coupled — it grows with `2^zoom` for free — so to hold it at a roughly constant pixel footprint, the way a Mapbox `circle-radius` marker behaves, you divide out the growth instead of multiplying one in.

Which one applies to your layer depends on which primitive you're sizing: `gl_PointSize` and screen-space paint properties need the multiply; scaled meshes need the divide.

## Clamping is not optional

Both formulas are exponential in zoom. Without a clamp, a `pow()` curve or a `1 / 2^zoom` curve will hit either `0` (invisible past some zoom) or a value large enough to be effectively unbounded, and you find out at whatever zoom a user happens to test, not at whatever zoom you tested. `Math.max(0.15, Math.min(3.5, raw))` is a real production bound — it exists because someone hit both ends of that range without it.

## Density needs the same treatment, and needs quantizing too

A particle-density layer (an ocean current or wind field) has the same problem one level up: at low zoom, a fixed particle count looks sparse across a huge visible area. The fix has the same shape — boost the count as zoom drops below a base level, and clamp the boost:

```ts
const ADAPTIVE_BASE_ZOOM = 5.5;
const ADAPTIVE_PER_LEVEL = 0.7;
const ADAPTIVE_MAX_BOOST = 6;
const ADAPTIVE_QUANTUM = 4000; // round to this multiple

function adaptiveCount(base: number, zoom: number): number {
  const boost = clamp(1 + Math.max(0, ADAPTIVE_BASE_ZOOM - zoom) * ADAPTIVE_PER_LEVEL, 1, ADAPTIVE_MAX_BOOST);
  if (boost <= 1) return base;
  return Math.round((base * boost) / ADAPTIVE_QUANTUM) * ADAPTIVE_QUANTUM || base;
}
```

The `Math.round(... / QUANTUM) * QUANTUM` step is not about visual correctness — it's about frame budget. A continuous zoom gesture fires dozens of frames per second, and a naive `base * boost` recomputes a slightly different particle count on nearly every one of them, which means reallocating and re-uploading the entire particle buffer nearly every frame. Quantizing to steps of 4000 means the count — and the buffer rebuild — only changes a handful of times across a full zoom gesture. The trailing `|| base` guards the one case quantization can produce a literal `0` (a `boost` just above `1` rounding down to nothing) — fall back to the unboosted base rather than allocate an empty buffer.

## A manual slider on top, not instead

Automatic zoom scaling gets you into a reasonable range; it will not match what looks right for every dataset. Production practice here keeps a manual multiplier (`uSizeMul`, clamped roughly 0.1–5) alongside the automatic `uZoomScale`, the two multiplied together. Automatic scaling means users rarely need the slider; the slider means you're never stuck shipping a hardcoded curve that's tuned for one dataset and wrong for the next one.

## The trap that costs the most time

Once a zoom-scale factor exists, it's tempting to treat it as *the* fix and stop measuring. The constants — base `1.5`, the clamp bounds, the reference zoom — were tuned against one dataset (power plants, whole-Taiwan extent) at the zoom level someone happened to test. They will be wrong, in either direction, for a denser or sparser dataset, or a different reference zoom. Reproduce the original failure at the zoom level it was reported at before trusting a fix; a formula that "looks reasonable" in isolation can still cover a quarter of a country at a zoom nobody tried.

## Source

Extracted from `mini-taiwan-pulse`: `src/three/GlowPointsScene.ts` (`setZoom`), `src/three/GfwV4TrackScene.ts` (`headScale`), `src/map/climateParticleLineLayer.ts` (`adaptiveCount`), and internal engineering notes on a power-plant glow layer that shipped without zoom scaling.

## Next

- [1.1 Mapbox GL JS](../01-hugging-the-globe/mapbox.md) — the globe-hugging groundwork this sizing sits on top of
- [4.2 Depth and blending](depth-and-blending.md) — once size is under control, draw order is the next thing you own
- [3.3 Vector field particles](../03-scaling-up/vector-field-particles.md) — the density side of this problem, at scale
