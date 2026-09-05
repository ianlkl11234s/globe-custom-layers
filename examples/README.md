# Examples

Each example is a self-contained Vite app. There is no workspace, no shared build step, and no imports that reach outside the example's own folder. Copy a complete folder, including its lockfile and LICENSE, then run `npm ci` in the destination. If your copy does not contain a LICENSE, include the repository's root LICENSE.

That duplication is deliberate. A cookbook reader wants to read one directory top to bottom and understand it, not trace a dependency graph.

## Running one

```bash
cd examples/<name>
npm ci
cp .env.example .env      # add your own map token
npm run dev
```

You need your own token. None is committed here, and none will be.

## Index

Read them in order if you are new here. `00` tells you whether you need any of the rest. If you are a program rather than a person, [`manifest.json`](manifest.json) has the same index with knob ranges, API lists and limitations in structured form.

| Example | What it settles | Recipe | Tests |
|---|---|---|---|
| [`00-native-vs-custom`](00-native-vs-custom/) | Whether you need a custom layer at all. Same airports, native `circle` layer and custom Three.js layer, switchable. Click one and get a popup; click the other and get nothing. | [0.1 Decision tree](../docs/00-start-here/decision-tree.md) | 20 |
| [`01-points-on-globe`](01-points-on-globe/) | The core projection recipe, plus the spark/glow shader. The flagship. | [1.1 Mapbox](../docs/01-hugging-the-globe/mapbox.md) · [2.1 Spark points](../docs/02-effects/spark-points.md) | 19 |
| [`02-arcs-on-globe`](02-arcs-on-globe/) | Great-circle arcs, and **why lines cut through the planet** — the subdivision slider goes down to 2 so you can watch it happen. | [1.1 Mapbox](../docs/01-hugging-the-globe/mapbox.md) | 35 |
| [`03-areas-on-globe`](03-areas-on-globe/) | Filled areas and outlines. A 500 km circle is a *small circle* on a sphere, and looks different at every latitude. | [1.1 Mapbox](../docs/01-hugging-the-globe/mapbox.md) | 15 |
| [`04-moving-trajectory`](04-moving-trajectory/) | Geometry that moves: ECEF derived in the vertex shader instead of precomputed, plus timeline scrubbing. | [1.1 §"Unless your geometry moves"](../docs/01-hugging-the-globe/mapbox.md) | 41 |
| [`05-mass-trajectories`](05-mass-trajectories/) | 5,000 trajectories in **one** draw call. Switch eviction between min-heap and linear scan and watch `ms / update` change on your own machine. | [3.1 Batched trails](../docs/03-scaling-up/batched-trails.md) | 57 |
| [`06-particle-field`](06-particle-field/) | Wind/current streaks from a synthetic flow field, in raw WebGL2 with no Three.js. Needs no tiling service. | [3.3 Vector field particles](../docs/03-scaling-up/vector-field-particles.md) | 48 |
| [`07-picking-and-popups`](07-picking-and-popups/) | Clicks on a layer that cannot be hit-tested. Two working strategies, and the candidate count that proves why backface culling matters. | [0.1 Q5](../docs/00-start-here/decision-tree.md) | 45 |
| [`08-effects-gallery`](08-effects-gallery/) | 68 procedural Three.js effects, each with a prompt template you can hand to an agent. **Mercator, not globe** — see its README. | [2.1 Spark points](../docs/02-effects/spark-points.md) | — |

Every one of them passes `npx tsc --noEmit` and `npm run build`; all but the gallery also carry unit tests, **280 in total**: 274 math tests plus six checks for the demo's embedded-token, memory-storage and presentation-preference boundary. The website has two additional iframe-state tests. These checks run without a browser, a GPU, or a token; live interactions remain a separate browser gate.

All nine have been opened in a browser with a real token and confirmed rendering; each example's README carries its own screenshot, its measured numbers where it has any, and its own status marker. Read that marker rather than assuming.

## Sample data

Examples use public-domain data or generate their own:

- **Airport positions** — [OurAirports](https://ourairports.com/data/), released to the public domain. A fetch script produces a trimmed local copy; the full dataset is not vendored.
- **Trajectories** — synthesised at runtime. No licence to honour, and you can raise the object count until your machine complains.

Where a value is synthetic rather than measured (point sizes standing in for traffic volume, for instance), the example's README says so explicitly. A demo that looks like real data but isn't is worse than an obviously fake one.
