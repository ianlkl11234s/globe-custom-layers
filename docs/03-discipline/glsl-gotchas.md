# 3.4 GLSL gotchas

> **Status:** 📋 Reported for the Mapbox-expression and `addImage`-lifecycle sections below — running in production, not yet reproduced in this repo's example. ⚠️ **Unverified mechanism** for the vector-ternary section — read the caveat inline before repeating it as fact.
> **Applies to:** `mapbox-gl` 3.x, `three` 0.172.x, GLSL ES 1.00 shaders (WebGL1-style).

## The symptom

Four unrelated bugs, one shape: **nothing fails loudly.** No thrown exception, no TypeScript error, no failed network request, frequently no console output at all. A marker layer's icons silently shrink to nothing. A fat line renders as a row of X's instead of a continuous stroke. A vertex shader that should place geometry somewhere on screen places nothing. An image-dependent layer works on first load and never again after a hot reload. In every case the code in the diff looks reasonable, and the failure only shows up by looking at the rendered map.

This page is a checklist of specific instances, not a general theory — but the throughline is worth stating up front: **when a bug in this stack produces no error message, that absence is not evidence the code is fine.** Budget debugging time on that basis before you start.

## Mapbox expressions: input types are stricter than they look

```js
["match", ["get", "has_realtime"], true, 1, 0.3]
```

`match` only accepts `string` or `number` inputs. Feed it a `boolean` and the whole expression becomes invalid — Mapbox falls back silently, computing `0` for whatever paint property it drove, so markers built around it shrink to nothing or vanish. There is no console warning.

The fix is `case`, whose condition slot does accept booleans:

```js
["case", ["==", ["get", "has_realtime"], true], 1, 0.3]
```

Other expression restrictions worth checking before you reach for one:

| Expression | Input restriction |
|---|---|
| `match` | string or number only, never boolean |
| `case` | boolean condition, value of any type |
| `step` | number only |
| `interpolate` | number only |

Adjacent traps in the same family: `circle-stroke-dasharray` does not exist (a dashed outline needs a `line` layer); `icon-size` only works in `layout`, silently doing nothing set in `paint`; `icon-color` only affects images registered with `sdf: true`; and changing a `layout` property from application code needs `setLayoutProperty` (or a full `removeLayer`/`addLayer`) — calling `setPaintProperty` on a layout key is a no-op, not an error.

## Vector ternaries in GLSL — treat this one as unresolved, not settled

A vertex shader blending two clip-space positions with a scalar ternary produced a line with no visible position:

```glsl
vec4 clip = (along < 0.5) ? clipA : clipB; // reported: line vanished
```

Switching to `mix()` made the line reappear:

```glsl
vec4 clip = mix(clipA, clipB, along);
```

**Before repeating "GLSL vec4 ternaries silently fail" as established fact, two things are worth checking independently, because they don't hold up:** GLSL ES 1.00 permits a ternary on any type, vectors included, as long as both branches match — this is ordinary shader code, not something the spec forbids. And Three.js's default renderer configuration (`debug.checkShaderErrors: true`) does report real link/compile failures via `console.error` — a genuine compile failure here would not have been silent. On top of that, the fix that made the line reappear landed in the same change as an unrelated one — a fat-line normal computed per-vertex instead of per-segment, in the same shader (next section) — and the two were never isolated by reverting one at a time. Which change actually fixed the missing line was never established.

What's actually verifiable is narrower than the original claim: replacing the ternary with `mix()` correlated with the bug disappearing, in a change that also fixed something else in the same file. Use `mix()`/`step()` for vector conditionals regardless of what caused this specific bug — they're branchless, they read the same way across GLSL ES 1.00 and 3.00, and they cost nothing to write — but hold the causal story about *why* this particular line vanished loosely until someone isolates it.

## Fat-line normals: compute direction once per segment, not once per vertex

A quad-expansion fat line rendered as a row of X shapes instead of a continuous ribbon — each segment's quad was twisted, as if the two ends disagreed about which way was "outward."

```glsl
// wrong: normal computed from each vertex toward the *other* endpoint —
// vertex A points toward +x, vertex B points toward -x, quad twists into an X
vec2 other = mix(instancePosB, instancePosA, along);
vec2 dir = normalize(self - other);
```

The fix computes one direction for the whole segment and reuses it at both ends:

```glsl
vec4 clipA = uMatrix * vec4(instancePosA, 0., 1.);
vec4 clipB = uMatrix * vec4(instancePosB, 0., 1.);
vec2 dirPx = (clipB.xy / clipB.w - clipA.xy / clipA.w) * uResolution * 0.5;
vec2 dn = length(dirPx) > 1e-6 ? normalize(dirPx) : vec2(1., 0.);
vec2 normalPx = vec2(-dn.y, dn.x) * across * uHalfWidthPx;
```

`across` (±1, per-vertex) is the only thing that should differ between the two ends of a segment. Direction is a property of the whole segment, computed once and shared by both endpoints. A useful habit for any quad-expansion shader: work out on paper where all four vertices of one segment should land before writing the vertex shader, rather than reasoning about one vertex's math in isolation and assuming the other three follow the same logic.

## `addImage` needs three overlapping safety nets, not one

A `styleimagemissing` handler that fires `addImage` once, on the assumption that `style.load` will retry it if needed, has three independent ways to end up never registering the image:

1. `map.isStyleLoaded()` can read `false` at mount time and never become the trigger you were waiting for — the same one-shot `load`/`style.load` problem covered in [3.3](shared-gl-context.md).
2. A `mapRef.current` read inside a `useEffect` can be `null` on the very first render; assigning a ref does not trigger React to re-run the effect, so a `return` on that first null check can be permanent.
3. A layer that mounts before its image is registered logs `Image "xxx" could not be loaded` once and does not retry on its own.

All three compound, so the fix layers three safety nets rather than relying on any one of them:

```ts
const tryRegister = (): boolean => {
  const map = mapRef.current;
  if (!map || !map.isStyleLoaded()) return false;
  if (!map.hasImage(IMG_ID)) map.addImage(IMG_ID, buildIcon(), { sdf: true });
  map.on("style.load", () => addImage(...));        // net 1: basemap switches
  map.on("styleimagemissing", (e) => {                // net 2: layer mounted before image
    if (e.id === IMG_ID) addImage(...);
  });
  return true;
};
if (!tryRegister()) {
  const id = window.setInterval(() => tryRegister() && clearInterval(id), 100); // net 3: ref not ready yet
}
```

## The trap that costs the most time

None of the four bugs above produced a stack trace, a red underline, or a failed test. Each one was found by staring at a rendered map and reasoning backward from "this specific thing is missing" to "which line of code could produce exactly this absence, with no error." The actionable version of that lesson: when writing a visual layer in this stack, add checkpoint logging at every async gate — data fetched, scene built, layer attached, image registered — *before* you need it. By the time something is silently missing, you have no way to tell which of several possible gates failed without them already in place.

## Source

Extracted from `mini-taiwan-pulse`: internal engineering notes from a shader / expression / image-lifecycle debugging session, covering `mapbox-gl` expression evaluation, a fat-line vertex shader, and an `addImage` registration hook.

## Next

- [3.2 Depth and blending](depth-and-blending.md) — more silent failures in the same render path, one layer up
- [3.3 Sharing a WebGL context](shared-gl-context.md) — the `style.load` / `isStyleLoaded()` trap this page's `addImage` section leans on
- [2.3 Vector field particles](../02-scaling-up/vector-field-particles.md) — the fat-line technique above, at scale
