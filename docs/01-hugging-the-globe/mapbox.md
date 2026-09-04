# 1.1 Hugging the globe: Mapbox GL JS

> **Status:** ✅ Verified — running in production, and reproduced in [`examples/globe-hugging-points`](../../examples/globe-hugging-points/): 13/13 unit tests on the projection maths, plus visual confirmation of all three states (sphere at `transition` 0.00, mid-blend at 0.24 with points still correctly registered, flat mercator at 1.00).
> **Applies to:** `mapbox-gl` 3.x. The source projects declare `^3.9.0`; the behaviour described here was observed at **3.18.1**. None of it is part of a public API contract, so pin a version and re-check on upgrade.

## The symptom

You have a working Three.js `CustomLayerInterface`. You zoom out. One of two things happens:

- **Your geometry stays flat.** It sits on a plane beside the planet, drifting away from the coastlines it is supposed to sit on.
- **Your geometry disappears entirely.** Not clipped, not dimmed — gone, with nothing in the console.

Both are the same root cause, and which one you get depends on a single material flag. Read both halves of this page before you start debugging, because **the two failure modes below produce visually identical symptoms** and it is easy to spend a day fixing the wrong one.

## Why it happens

In globe projection, Mapbox's own layer types — circle, line, fill, symbol, heatmap — are projected onto the sphere inside their shaders. Custom layers are not. The `matrix` handed to your `render()` is the flat Web Mercator world matrix, so your geometry is drawn where it would be on a flat map, next to a planet that is no longer flat.

The official position is that this is simply unsupported. From the [globe guide](https://docs.mapbox.com/mapbox-gl-js/guides/globe/):

> Globe does not yet support `CustomLayerInterface`.

The [projections guide](https://docs.mapbox.com/mapbox-gl-js/guides/projections/) puts it more broadly — *"CustomLayerInterface can only be used only with Mercator"* — and that wording has been there since v2.6.0. So this is not a globe-specific gap; **no non-Mercator projection officially supports custom layers.** Globe is just the one everybody hits.

That is accurate as a statement about supported API surface. It is not, however, the end of the story.

### One thing to fix before you start

Vertices get projected; the segments between them do not. **A straight line between two distant points is a chord, not an arc** — it will cut through the planet no matter how correct both endpoints are. If your geometry has long spans, subdivide it into enough intermediate vertices that each segment is short relative to the sphere's curvature. Nothing in the library does this for you. Dense sampled data (a flight track, a GPS trace) already satisfies this by accident; a two-point great-circle arc does not.

## The undocumented render arguments

`CustomLayerRenderMethod` is typed in `mapbox-gl.d.ts` as receiving more than the two arguments every tutorial uses. In globe projection it is called with seven:

```ts
render(
  gl,
  matrix,                          // flat mercator world matrix (what tutorials use)
  projection?,                     // projection.name === "globe" when the globe is active
  projectionToMercatorMatrix?,     // mat4: ECEF -> mercator world
  projectionToMercatorTransition?, // 0 = sphere, 1 = flat plane
  centerInMercator?,
  pixelsPerMeterRatio?,
) {}
```

Two of these do all the work:

- **`projectionToMercatorMatrix`** takes a point in Earth-Centered-Earth-Fixed space and lands it in the same mercator world space your existing geometry already lives in. That means you do not have to rewrite your scene — you convert ECEF into the space you already use.
- **`projectionToMercatorTransition`** is the blend factor Mapbox uses internally to fade the globe into a flat map as you zoom in (somewhere around z5–z6). You get it for free, and honouring it means your layer transitions exactly in step with the basemap.

> Note the direction: **0 means sphere, 1 means plane.** MapLibre's equivalent runs the other way. See [1.3 Porting](porting.md).

If you are looking for `defaultProjectionData` or `CustomRenderMethodInput`, stop — those are MapLibre's API. `mapbox-gl` has no such thing.

## Step 1: precompute ECEF per vertex

Mapbox's internal globe radius is derived from its tile extent, not from metres:

```
GLOBE_RADIUS = 8192 / (2 * PI)   // ~= 1303.797
```

For latitude φ and longitude λ in radians:

```
x =  cos(φ) * sin(λ) * R
y = -sin(φ) * R
z =  cos(φ) * cos(λ) * R
```

**The negative `y` is not a typo.** Get the axis signs wrong and your data appears mirrored or rotated — a failure that looks like a data problem rather than a maths problem. If you are porting this to another library, re-derive the signs rather than copying them; these match Mapbox's internal convention specifically.

Altitude becomes a radial offset. Mapbox's own `globeMetersToEcef` is equivalent to:

```
hEcef = mercatorZ * 8192 * cos(latitude)
```

Store the resulting ECEF position as a vertex attribute at buffer-build time. Doing it per frame means running `sin`/`cos`/`exp`/`atan` for every vertex, every frame, which is exactly the cost you are trying to avoid.

### Unless your geometry moves — then do it in the shader

Precomputing only works when a vertex stays at the same place on Earth. Particles in a flow field, or a trail whose points advance every frame, have no fixed position to precompute. For those, derive ECEF inside the vertex shader from the mercator coordinate you already have:

```glsl
// merc: mercator unit coordinates, x and y in [0,1] — the position you just moved
float lngRad = (merc.x - 0.5) * 2.0 * PI;
float latRad = 2.0 * atan(exp(PI * (1.0 - 2.0 * merc.y))) - PI * 0.5;  // inverse Mercator
float cosLat = cos(latRad);
vec3 dir  = vec3(cosLat * sin(lngRad), -sin(latRad), cosLat * cos(lngRad));
vec3 ecef = dir * GLOBE_RADIUS;   // surface-bound; add a radial factor if you need altitude
```

Everything downstream is identical — same `uGlobeToMerc` multiply, same blend, same ECEF-space cull using `dir` as the normal, same early-out.

|  | Static geometry | Moving geometry |
|---|---|---|
| Where ECEF comes from | CPU, once, as a vertex attribute | Vertex shader, every frame |
| Cost | Paid at buffer build | Four transcendentals per vertex per frame |
| Examples | Airports, fixed routes, station markers | Flow-field particles, advancing trails |

The per-frame cost is real but bounded, and the early-out means you pay none of it once the map is flat. A production ocean-current layer runs this path in raw WebGL2 — no Three.js — which is worth noting on its own: **the recipe is not Three.js-specific.** Anything that can write a vertex shader and read the render arguments can hug the globe.

## Step 2: blend in the vertex shader

The whole projection change is four lines, and it leaves your CPU-side geometry untouched:

```glsl
uniform mat4  uGlobeToMerc;   // projectionToMercatorMatrix
uniform float uTransition;    // projectionToMercatorTransition

// position: your existing flat mercator vertex
// aEcef:    the attribute from step 1
vec3 globeMerc = (uGlobeToMerc * vec4(aEcef, 1.0)).xyz;
vec3 world     = mix(globeMerc, position, uTransition);
```

At `uTransition == 1` this returns your original flat coordinate, bit for bit. That property is worth protecting with an early-out, so that zoomed-in rendering costs exactly what it cost before:

```glsl
if (uTransition >= 1.0) return position;
```

When `render()` receives only two arguments — no globe, older version, mercator-only style — set `uGlobeToMerc` to identity and `uTransition` to `1.0`. The same shader then serves both projections with no branching on the CPU side.

## Step 3: turn off depth testing (this is the surprising part)

Before your custom layer runs, Mapbox has already drawn a **solid sphere into the main framebuffer with depth writes enabled** (`drawTerrainForGlobe` uses `DepthMode(LEQUAL, ReadWrite)`).

Three.js materials default to `depthTest: true`. So your globe-hugging lines are depth-tested against a solid planet that occupies the same space they do — and they lose. Not just the far side: **the near side disappears too**, because the sphere is drawn with an infinite far plane while your geometry uses a finite one, putting coincident points about 0.005 NDC apart.

> **In globe projection, every Three.js material in your layer needs `depthTest: false`.**

Do not conclude from partial evidence here. In one real instance the trails vanished while glowing point sprites survived — because those sprites bulged slightly toward the camera — and "the points are still there" was taken as evidence against the depth hypothesis. It wasn't. On a later camera change the points went too. **Objects surviving does not clear the depth buffer as a suspect.**

## Step 4: cull the far side yourself

Once depth testing is off, nothing hides the hemisphere behind the planet. With additive blending, the far side bleeds through the middle of the Earth and looks like ghost-light leaking out of the core.

Do the culling **in ECEF space**, not in mercator space. In mercator space the sphere is distorted and surface normals do not point where you expect, so a dot product there misjudges entire regions at once.

```glsl
uniform vec3 uCameraEcef;

vec3 dir   = normalize(aEcef);        // outward surface normal
vec3 surf  = dir * GLOBE_RADIUS;
vec3 toCam = normalize(uCameraEcef - surf);
float d    = dot(dir, toCam);         // d == 0 is the true horizon
float vis  = smoothstep(-0.08, 0.02, d);
vis        = mix(vis, 1.0, uTransition);   // no culling once flat
```

Multiply `vis` into your alpha rather than discarding vertices — a soft edge at the limb reads as atmosphere, a hard one reads as a bug.

To get `uCameraEcef`, take the camera in mercator space and transform it back:

```ts
const camMerc = map.getFreeCameraOptions().position;   // works in globe projection
// uCameraEcef = inverse(projectionToMercatorMatrix) * camMerc
```

### The trap that costs the most time

**Order matters:** load the matrix, *then* invert it. If you forget to set `uCameraEcef` at all it defaults to `(0,0,0)` — the centre of the Earth — where `dot(dir, toCam)` is `-1` everywhere, so `vis` is zero everywhere and **your entire layer disappears.**

That is pixel-for-pixel the same symptom as the depth-buffer failure in step 3. Two unrelated causes, one appearance. The only way to tell them apart is to change one thing at a time: force `vis = 1.0` and see whether geometry returns.

For comparison, Mapbox's own symbol shader culls with a `u_camera_forward` dot against a plane through the sphere's centre — looser than the true horizon. The formulation above is stricter and softer-edged.

### There is a cheaper approximation, and it is worth knowing why it survives

Two variants of this cull coexist in the codebase these recipes came from, and the difference is instructive:

| | Point sprites (older) | Lines and instanced meshes (newer) |
|---|---|---|
| Normal | `normalize(mat3(uGlobeToMerc) * aEcef)` — rotated into mercator space | `normalize(aEcef)` — true ECEF |
| Camera | mercator position, used directly | transformed back into ECEF |
| Edge | `smoothstep(-0.25, 0.05, d)` | `smoothstep(-0.08, 0.02, d)` |

The mercator-space version is wrong in the way this page warns about — but it is wrong *tolerably* for round, screen-space-sized point sprites, because a sprite has no orientation to get wrong and its footprint is small enough that a misjudged limb reads as a slightly early fade. Its much wider `smoothstep` band is doing the covering: it starts fading well before the true horizon, so the error hides inside the gradient.

Extended geometry has no such luck. A polyline spans many degrees of latitude, so a per-vertex normal that points the wrong way puts part of the line on the wrong side of the horizon while the rest is correct — visible as a line that punches through the limb. **If you are drawing anything larger than a point, do it in ECEF space.**

## Step 5: sanity checks before you trust it

- **Log what you actually get.** `map.getProjection().name` and `arguments.length` inside `render()`, at low and high zoom, for **each basemap style you ship**. Whether an unconfigured map starts in globe or mercator depends on the style, and it is faster to measure than to reason about.
- **Hard-reload after editing the layer.** Vite HMR does not replace a module singleton that Mapbox is holding a reference to. You will edit a shader, see no change, and doubt a correct fix.
- **Watch your buffer ceiling.** Fixed-capacity attribute buffers are the right call here, but the cap is a real limit — clamp and warn once rather than throwing per frame.
- **Custom layers do not hit-test.** `queryRenderedFeatures` sees native layers only. If you need popups, keep an invisible native circle layer alongside the custom one and let it own interaction.

## Source

Extracted from `plan-art` (Flight Arc). The ECEF-space cull and the shader blend come from `src/three/shaders/globeProject.ts`, used by `src/map/customLayer.ts` for trails and instanced meshes; the wider-band point-sprite variant comes from `src/three/GlowPointsScene.ts` and `src/map/atlasGlowLayer.ts`. The depth-buffer and camera-uniform incidents are recorded in `docs/features/atlas-bloom-globe.md`.

## Next

- [1.2 MapLibre GL JS](maplibre.md) — the same problem where the library helps you
- [1.3 Porting between the two](porting.md) — the difference table
- [3.2 Depth and blending](../03-discipline/depth-and-blending.md) — render order once depth testing is gone
