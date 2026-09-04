# 4.3 Sharing a WebGL context

> **Status:** 📋 Reported — running in production; not yet reproduced in this repo's example.
> **Applies to:** `mapbox-gl` 3.x, `three` 0.172.x.

## The symptom

You want two Three.js visual effects on the same map — an A/B comparison of an old and a new glow layer, mounted side by side. You wire up a second `CustomLayerInterface`, each with its own scene. Both scenes log a successful `setData()` with the expected point count. Both `onAdd` handlers fire. Nothing throws. And the second layer draws nothing — not corrupted, not a black square, just absent, with no console error pointing at why.

## Why it happens

A `CustomLayerInterface`'s `onAdd(map, gl)` hands you the map's own `WebGLRenderingContext` — the one Mapbox itself paints with. Wrapping it in `new THREE.WebGLRenderer({ context: gl })` does not give you an isolated GPU state; it gives you a second bookkeeper watching the same GL state the first renderer is already tracking.

Three's `WebGLRenderer` keeps an internal cache of what it believes is currently bound — the active shader program, VBOs, textures, blend function — specifically so it can skip redundant `gl.*` calls. Two independent renderer instances each keep their own cache, and neither knows the other exists. Renderer A runs, changes real GL state, and updates only *its own* cache. Renderer B, still trusting *its* stale cache, skips rebinding things that changed underneath it. The draw call it issues points at whatever program, buffer, or uniform was last bound by A — not what B intended.

## The rule: one context, one renderer

**One Mapbox `gl` context supports exactly one Three.js `WebGLRenderer`.** If you need several visual effects on one map, put them in the **same** `THREE.Scene`, managed by the **same** `CustomLayerInterface` and the **same** renderer — separate them with mesh groups, materials, or per-object uniforms, not with a second `onAdd(map, gl)`.

If the two effects genuinely need to be mountable and removable independently — the A/B comparison case above — two options avoid the collision without giving up the comparison:

- Keep both mesh groups in one scene, toggle `.visible` on each independently.
- If one side of the comparison doesn't need Three.js at all, render it as a native Mapbox paint layer (stacked `line-blur` passes, for instance) and keep the Three.js side to one renderer.

The failure isn't limited to two effects mounted deliberately. Forgetting to `map.removeLayer()` an existing Three.js custom layer before a hot-reload cycle re-adds a new instance of it produces the identical symptom — two renderers on one context, one of them orphaned but still technically attached.

## The renderer setup that makes sharing work at all

Even with one renderer per context, that renderer still has to coexist with Mapbox's *own* GL calls on every single frame:

```ts
this.renderer = new THREE.WebGLRenderer({ canvas: gl.canvas, context: gl, antialias: true });
this.renderer.autoClear = false; // never clear Mapbox's own framebuffer contents
```

`autoClear = false` is not optional — the default would erase whatever Mapbox has already painted this frame before your layer even runs.

Inside `render()`, two separate concerns get two separate fixes, and conflating them is the easy mistake:

```ts
this.renderer.resetState();       // fixes THREE's own internal cache
this.renderer.render(this.scene, this.camera);
this.renderer.resetState();
```

`resetState()` clears *Three's* belief about what's currently bound, so this render call doesn't skip binds based on stale assumptions about state Mapbox changed since Three last ran. It says nothing about what Mapbox itself expects to find afterward — that's the next block's job:

```ts
const blendEnabled = gl.isEnabled(gl.BLEND);
const blendSrc = gl.getParameter(gl.BLEND_SRC_RGB);
const blendDst = gl.getParameter(gl.BLEND_DST_RGB);
// ... render ...
if (blendEnabled) gl.enable(gl.BLEND); else gl.disable(gl.BLEND);
gl.blendFuncSeparate(blendSrc, blendDst, blendSrcA, blendDstA);
```

This restores what has been observed to matter to the map's own paint pipeline afterward. A more complete version, used where blend *equation* and blend *color* were also observed to drift, additionally saves and restores `BLEND_EQUATION_RGB` / `BLEND_EQUATION_ALPHA` and `BLEND_COLOR`. Save everything your renderer touches; a partial restore is a state leak with a longer fuse than a missing one.

## `render()` runs inside Mapbox's own paint pass

An uncaught exception thrown from inside `render()` does not stay contained to your layer — it propagates out of Mapbox's paint pass and **stops the map from painting anything else that frame**. A budget check that would normally `throw` on overflow has to become a `console.warn`-once-and-clamp instead, and the outer `render()` should wrap its own body in `try/catch` regardless of how careful the code inside it is:

```ts
render(_gl, matrix) {
  try {
    // ...
  } catch (error) {
    if (!warnedRenderFailure) {
      warnedRenderFailure = true;
      console.warn("[layer] render skipped", error);
    }
  }
}
```

This is a discipline specific to sharing someone else's render loop: code you own outright can afford to let an exception crash a subsystem; a `render()` callback handed to a host application cannot.

## Attaching the layer at all: don't trust `isStyleLoaded()`

A `CustomLayerInterface` mounted from its own independent hook — not alongside the rest of your layers in the map's main `load` handler — has no guarantee the style is actually ready when its effect runs. The textbook pattern fails silently:

```ts
if (map.isStyleLoaded()) attach();
else map.once("load", attach); // ❌ 'load' only ever fires once, ever
```

`isStyleLoaded()` can read `false` transiently — a source swap in progress, unrelated to your layer — and the `load` event has usually already fired for good by the time an independent hook runs. `once("load", ...)` registers a listener for an event that will never happen again. Nothing throws. The scene builds, the data fetches, the layer is simply never `addLayer`'d.

```ts
const tryMount = () => {
  if (map.getLayer(LAYER_ID)) return;
  try { map.addLayer(layer); }
  catch { map.once("idle", tryMount); } // style still mutating — wait, retry
};
tryMount();
map.on("style.load", tryMount); // re-attach on every basemap switch
```

Every style switch — not just the first load — removes and requires re-adding every custom layer. `map.on("style.load", tryMount)` covers that; a one-time `isStyleLoaded()` check at mount time does not.

## Portable across map libraries: inject the coordinate engine, don't import it

If the same rendering code needs to run against both `mapbox-gl` and `maplibre-gl` builds — a lighter embed target, say — importing either library directly into a shared coordinate-conversion module drags its whole bundle into every entry point that touches Three.js. The alternative is an injected interface:

```ts
export interface MercatorEngine {
  fromLngLat(lngLat: [number, number], altitude?: number): MercatorPoint;
}
let engine: MercatorEngine | null = null;
export function setMercatorEngine(ctor: MercatorEngine): void { engine = ctor; }
```

Each entry point calls `setMercatorEngine(mapboxgl.MercatorCoordinate)` or `setMercatorEngine(maplibregl.MercatorCoordinate)` before creating its map. The two libraries' `MercatorCoordinate` implementations are separately typed but shape-identical, so this compiles against either without a shared dependency on the library itself. Calling a conversion function before the engine is injected throws immediately, by design — the alternative, silently returning `0`, turns a wiring bug into "everything renders at the map's origin," which is a far worse thing to debug than a thrown error at startup.

## The trap that costs the most time

`map.once("load", attach)` produces **no error anywhere** — not in the console, not in TypeScript, not in a stack trace. Every upstream signal you'd normally check (data fetched, scene built, `tsc` clean) reports success. The only observable fact is that an `addLayer` call visible right there in the source simply never runs. This is expensive specifically because there's nothing to search for: no error message to paste anywhere, no line that looks obviously wrong read in isolation. The fix is procedural, not code-level — build a layer's mount sequence with try/`addLayer`/catch/retry from the start, and don't trust `isStyleLoaded()` as your only gate, even the second time you write this hook and are sure this time will be different.

## Source

Extracted from `mini-taiwan-pulse`: `src/three/FlightScene.ts`, `src/three/GlowPointsScene.ts`, `src/map/gfwV4TrackCustomLayer.ts`, `src/three/GfwV4TrackScene.ts`, `src/utils/coordinates.ts`, and internal engineering notes describing this attach-timing failure recurring across two independent layers roughly two months apart; `plan-art`: `src/map/customLayer.ts`.

## Next

- [1.1 Mapbox GL JS](../01-hugging-the-globe/mapbox.md) — what the shared `gl` context hands you every frame
- [1.3 Porting between the two](../01-hugging-the-globe/porting.md) — the same save/restore pattern holds for MapLibre, confirmed bit-identical for the coordinate math
- [4.2 Depth and blending](depth-and-blending.md) — once your renderer is correctly shared, draw order inside it is still yours to manage
