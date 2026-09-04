# 2.3 Vector field particles

> **Status:** 📋 Reported — running in production, not yet reproduced as an example in this repo.
> **Applies to:** raw WebGL2, no Three.js dependency. `mapbox-gl` 3.9.x for the `CustomLayerInterface` render-argument shape.

## The symptom

Wind or ocean-current visualization — a nullschool-style field of short, flowing, fading streaks — needs tens of thousands of line segments that all move every single frame, react to zoom, and still have to sit correctly on a globe. This recipe is the one page in this section that isn't Three.js. Every other technique here batches or instances geometry inside a Three scene; this one is a hand-rolled `CustomLayerInterface` talking to WebGL2 directly, and that choice is deliberate enough to explain before the technique.

## Why raw WebGL2, not Three

This is inferred from the shape of the code, not a recorded design note — worth stating plainly rather than presenting as fact. A Three renderer sharing Mapbox's GL context has real bookkeeping cost: [2.2](instanced-tracks.md)'s scene calls `renderer.resetState()` before and after every render, and manually saves and restores seven pieces of GL blend state (enable flag, source/destination factors for RGB and alpha, blend equations, blend color) so that Three doesn't leave Mapbox's own next draw call in a corrupted state. A layer that only needs one shader program, one VAO, and two buffers sidesteps all of that — it never owns a competing renderer, scene graph, or camera object on a context it doesn't exclusively control. For a field of uniform, simple quads, that's a smaller surface to get wrong.

## CPU-side Euler advection

Each particle keeps a short ring buffer of past normalized positions. Every frame, for every particle: sample the flow field at its current position, convert the sampled velocity (m/s) into a fractional-degree step over the frame's `dt`, and integrate one step forward — a first-order (Euler) integrator, not RK4 or similar. Frame `dt` is clamped to a low ceiling (1/20 s) specifically so a backgrounded tab returning after several real seconds doesn't fling every particle a huge distance forward in one jump before anyone notices.

```ts
const lat = latMax - y * latSpan;
const metersPerDegLon = Math.max(20_000, EARTH_METERS_PER_DEG_LON_AT_EQUATOR * Math.cos(lat * PI / 180));
const nx = x + (vec.u * flowSeconds / metersPerDegLon) / lonSpan;
const ny = y - (vec.v * flowSeconds / EARTH_METERS_PER_DEG_LAT) / latSpan;
```

## The field lives in a PNG, sampled bilinearly

The u/v vector field is baked into a texture ahead of time and read back as a plain `Uint8ClampedArray` (an `<img>` drawn to an offscreen canvas, not a WebGL texture) — sampling happens on the CPU, during advection, not in the fragment shader. The encoding: **R channel** holds the u component, **G channel** holds v, both linearly remapped from the field's own `[min, max]` into `[0, 255]`; the **alpha channel** — not blue — holds a binary validity mask (`>= 128` is a valid sample), with an optional erosion radius so currents don't paint over nearby coastline pixels. The blue channel exists in the PNG format but carries nothing. Each sample point is a manual 4-tap bilinear blend of the four surrounding texels before decoding back to real u/v units.

## Why per-vertex trigonometry is *correct* here, unlike almost everywhere else

[1.1](../01-hugging-the-globe/mapbox.md) precomputes ECEF per vertex specifically to avoid `sin`/`cos`/`atan`/`exp` running on the GPU every frame for geometry that isn't moving. [2.1](batched-trails.md) goes further and skips per-frame recompute even for the mercator projection math, because most of a trail's history is frozen. This layer's vertex shader does exactly the trig those two pages tell you to avoid — `atan(exp(...))`, `sin`, `cos`, for every corner of every segment, every frame — and that's the right call, not an oversight: nothing here is static. Every particle's position changes every frame; that's the entire point of a flow field. There's nothing to cache in the globe-projection step, because caching it would just mean recomputing the cache every frame anyway.

What *is* cached, and this is the part worth copying: each history point's mercator-space coordinate is computed exactly once, the frame it's created, then carried forward by cheap array-shift copies for the rest of its lifetime in the trail — never recomputed on the frames it merely ages through:

```ts
for (let s = trailPoints - 1; s >= 1; s--) {
  historyMX[base + s] = historyMX[base + s - 1];   // shift, no recompute
  historyMY[base + s] = historyMY[base + s - 1];
}
const [mx, my] = mercatorFromNorm(nx, ny);           // computed once, for the new head only
historyMX[base] = mx;
historyMY[base] = my;
```

The distinction that matters: cache what's *static across frames*. The globe-projection trig depends on the current camera and transition state — it has to run every frame no matter what. The mercator projection of a given point depends only on that point's fixed geographic position — compute it once, shift it forward.

## Zoom-adaptive density has to be quantized

Particle count scales up as the camera pulls back, so a wide view doesn't look sparse — more particles fill the larger visible area, tapering back to the slider's base value on approach. The naive version recomputes a target count from continuous zoom every frame:

```ts
function adaptiveCount(base: number, zoom: number): number {
  const boost = clamp(1 + Math.max(0, ADAPTIVE_BASE_ZOOM - zoom) * ADAPTIVE_PER_LEVEL, 1, ADAPTIVE_MAX_BOOST);
  if (boost <= 1) return base;
  return Math.round(base * boost / ADAPTIVE_QUANTUM) * ADAPTIVE_QUANTUM || base;
}
```

That final rounding to a fixed quantum (steps of 4,000 particles) is not cosmetic. `resize()` reallocates every backing typed array — position history, mercator cache, ages, speeds, the instance buffer — from scratch whenever the target count changes at all:

```ts
resize(nextCountRaw: number) {
  const nextCount = clamp(Math.floor(nextCountRaw), MIN_PARTICLES, MAX_PARTICLES);
  if (nextCount === this.count) return;   // no-op unless the quantized target actually moved
  // ... every typed array reallocated here
}
```

Without quantization, a continuous zoom gesture recomputes a slightly different target every single frame, and every frame triggers a full reallocation of every buffer — a GC storm during exactly the interaction (smooth zooming) that most needs to stay smooth. Quantizing means `resize()` is a no-op for the overwhelming majority of zoom deltas.

## Instanced fat lines: 8 floats carry a whole segment

Each line segment is drawn as two triangles from a static, six-vertex quad (`CORNERS`, uploaded once, divisor 0). The only thing that varies per segment is a divisor-1 instance record: `a_from` (vec2), `a_to` (vec2), `a_color` (vec4) — 8 floats, 32 bytes, uploaded once per segment regardless of how many vertices it expands to on the GPU. Before this rewrite, the layer rebuilt a fully expanded per-vertex buffer every frame — six vertices per segment, ten floats per vertex. Going from `6 × 10 = 60` floats per segment to `8` floats per instance is roughly an 87% cut in bytes uploaded per frame, for the same visual result.

## A VAO keeps this layer from corrupting Mapbox's own draw state

Mapbox's renderer and this layer's draw calls share one GL context. Every `vertexAttribPointer`/`enableVertexAttribArray` call permanently mutates the *default* vertex array state unless it's scoped inside its own `WebGLVertexArrayObject`. Bind a VAO once in `onAdd()`, wrap all attribute and divisor setup inside it, and bind/unbind it around each draw:

```ts
gl.bindVertexArray(vao);
gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
gl.vertexAttribPointer(aFrom, 2, gl.FLOAT, false, stride, 0);
gl.vertexAttribDivisor(aFrom, 1);
// ...
gl.bindVertexArray(null);
```

Without it, this layer's attribute bindings leak into whatever Mapbox — or another custom layer — draws next on the same context.

## Zero runtime dependency on `mapbox-gl`

The only import from `mapbox-gl` in this file is `import type { CustomLayerInterface, Map, ProjectionSpecification } from "mapbox-gl"` — type-only, erased entirely at build time. The file's real runtime dependencies are Vite's `import.meta.env.BASE_URL` for resolving asset paths, and the DOM (`<canvas>`, `<img>`, `fetch`). Practically: this single file can be copied into an unrelated Mapbox or MapLibre project with almost no adaptation, because it never actually imports either library's runtime.

## The trap that costs the most time

The `dt` clamp (`MAX_FRAME_DT = 1/20`) looks like a minor safety rail until you hit it in practice. Without it, returning to a backgrounded browser tab after several real seconds hands the advection step one enormous `dt` on the next frame — every particle jumps a huge distance along its current vector in a single step, producing a burst of long, wrong-looking streaks across the whole map before particles reset and recover. It reproduces only after backgrounding the tab, which makes it easy to misfile as a data or shader bug the first time someone sees it, since it never shows up in a normal foreground debugging session.

## Source

Extracted from `mini-taiwan-pulse`: `src/map/climateParticleLineLayer.ts`.

## Next

- [1.1 Mapbox GL JS](../01-hugging-the-globe/mapbox.md) — the globe culling math reused unchanged in this layer's vertex shader
- [2.1 Batched trails](batched-trails.md) — the mirror image: what to cache when geometry *is* mostly static
- [3.1 Zoom-adaptive sizing](../03-discipline/zoom-adaptive-sizing.md) — the same quantization discipline applied to on-screen size instead of particle count
- [3.3 Sharing a WebGL context](../03-discipline/shared-gl-context.md) — VAO and GL-state discipline on a context you don't own
