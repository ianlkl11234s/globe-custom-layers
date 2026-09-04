# Globe Custom Layers

**Rendering tens of thousands of geodata objects on a Mapbox / MapLibre globe with Three.js — the part the official docs stop at.**

> Throughout these pages, *globe-hugging* is shorthand for geometry that sits on the sphere's surface rather than floating beside it on a flat plane. There is no official term for this, because there is no official support for it.

This is a cookbook, not a library. There is nothing to `npm install`. Every recipe is a page of docs plus a standalone runnable example you can read end to end in one sitting, copy, and adapt.

---

## Why this exists

If you put a Three.js custom layer on a web map and then zoom out until the map becomes a globe, your layer does not come with it. Your lines and points stay on a flat plane floating next to the planet, or vanish entirely. Both of those are the same bug wearing different clothes, and neither is covered by the official documentation.

Two facts define the gap this repo fills:

1. **Mapbox GL JS says this is not supported.** Their [globe guide](https://docs.mapbox.com/mapbox-gl-js/guides/globe/) states plainly: *"Globe does not yet support `CustomLayerInterface`."* It is nonetheless achievable — the render callback passes more arguments than the public typings advertise, and with them you can project your own geometry onto the globe. [Recipe 1.1](docs/01-hugging-the-globe/mapbox.md) is how.

2. **MapLibre GL JS does support it, and stops at one object.** Since v5.0.0 it exposes `clippingPlane`, `projectionTransition` and a `projectTile()` shader prelude, and its [official Three.js globe example](https://maplibre.org/maplibre-gl-js/docs/examples/add-a-3d-model-to-globe-using-threejs/) renders exactly one static GLTF building with a CPU-computed matrix. No horizon clipping, no backface handling, no discussion of the depth buffer the globe basemap has already written into.

Everything between "one static model" and "forty thousand moving objects at 60fps" is undocumented. That everything is what is written down here.

## What this is not

- Not a library, not a framework, not an abstraction layer. If you want one of those, [threebox](https://github.com/jscastro76/threebox) wraps Mapbox × Three.js nicely (though it predates globe projection), and [deck.gl](https://deck.gl/) will aggregate large datasets on the GPU for you (its `GlobeView` is still marked experimental).
- Not a general Three.js tutorial. Start with [three.js fundamentals](https://threejs.org/manual/) or [WebGL fundamentals](https://webglfundamentals.org/) if shaders and buffers are new.
- Not a substitute for reading your map library's source. Several recipes here exist *because* someone read it.

## Recipes

### 1. Hugging the globe

Getting your own geometry to sit on the sphere instead of floating beside it.

| | |
|---|---|
| [1.1 Mapbox GL JS](docs/01-hugging-the-globe/mapbox.md) | The undocumented render arguments, the ECEF math, and why every material needs `depthTest: false` |
| [1.2 MapLibre GL JS](docs/01-hugging-the-globe/maplibre.md) | `mainMatrix`, `clippingPlane`, `projectionTransition`, and the shader prelude |
| [1.3 Porting between the two](docs/01-hugging-the-globe/porting.md) | A field-tested difference table. Read this before you port anything — the transition coefficient runs in **opposite directions** in the two libraries |

### 2. Scaling up

From one object to tens of thousands, without dropping frames.

| | |
|---|---|
| [2.1 Batched trails](docs/02-scaling-up/batched-trails.md) | Thousands of moving polylines in a single draw call |
| [2.2 Instanced tracks](docs/02-scaling-up/instanced-tracks.md) | `InstancedMesh` with per-instance attributes the built-in materials don't expose |
| [2.3 Vector field particles](docs/02-scaling-up/vector-field-particles.md) | Ocean currents and wind, advected on the CPU and drawn as instanced fat lines |
| [2.4 Finding the actual bottleneck](docs/02-scaling-up/debugging-performance.md) | A case study in being wrong three times before measuring |

### 3. Discipline

The rules that stop working code from breaking a week later.

| | |
|---|---|
| [3.1 Zoom-adaptive sizing](docs/03-discipline/zoom-adaptive-sizing.md) | Screen-space sizes are decoupled from zoom, so glow eats the viewport when you fly out |
| [3.2 Depth and blending](docs/03-discipline/depth-and-blending.md) | Additive blending, render order, and the depth buffer the basemap already owns |
| [3.3 Sharing a WebGL context](docs/03-discipline/shared-gl-context.md) | State save/restore, disposal, and why two renderers on one context go black |
| [3.4 GLSL gotchas](docs/03-discipline/glsl-gotchas.md) | Silent failures that cost hours |

## Examples

Each example is an independent Vite app with no shared build and no cross-imports. Copy the folder out of this repo and it still runs.

```bash
cd examples/<name>
npm install
cp .env.example .env      # add your own map token
npm run dev
```

See [examples/README.md](examples/README.md) for the index.

## Prerequisites and licensing

**You need your own map token.** None is included here, and none of the recipes will run without one.

- **Mapbox GL JS is not open source.** Since v2.0.0 it ships under a [proprietary Mapbox license](https://raw.githubusercontent.com/mapbox/mapbox-gl-js/main/LICENSE.txt) and requires a Mapbox account. It is a normal npm dependency of the examples that use it, but nothing in this repo redistributes its source, and its terms are yours to comply with.
- **MapLibre GL JS is BSD-3-Clause** and needs no account — though you still need a tile source.
- **Everything in this repo is MIT** (see [LICENSE](LICENSE)).
- **Sample data is public domain.** Airport positions come from [OurAirports](https://ourairports.com/data/) (*"All data is released to the Public Domain"*). Trajectories are synthesised at runtime, so you can turn the object count up until your machine complains without asking anyone's permission.

## Verification status

Recipes are marked with how thoroughly each has been confirmed, because "it worked in my app" and "it works" are different claims.

| Mark | Meaning |
|---|---|
| ✅ **Verified** | Running in production, and reproduced in this repo's example |
| 🔬 **Reproduced** | Reproduced in this repo's example |
| 📋 **Reported** | Working in production elsewhere, not yet reproduced here |
| ⚠️ **Unverified** | Reasoned from source or typings, not yet run |

Nothing here is marked higher than it has earned. If you hit something that contradicts a page, that page is wrong — please open an issue.

## Provenance

These recipes were extracted from two production visualisation projects: a global flight-trajectory explorer rendering tens of thousands of arcs on a globe, and a multi-modal live map of Taiwan running several dozen data layers. Each page's **Source** section names the files it came from.

The bugs were expensive the first time. They should be cheap for you.
