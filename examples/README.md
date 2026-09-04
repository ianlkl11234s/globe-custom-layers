# Examples

Each example is a self-contained Vite app. There is no workspace, no shared build step, and no imports that reach outside the example's own folder. Copy any folder out of this repo and it still runs.

That duplication is deliberate. A cookbook reader wants to read one directory top to bottom and understand it, not trace a dependency graph.

## Running one

```bash
cd examples/<name>
npm install
cp .env.example .env      # add your own map token
npm run dev
```

You need your own token. None is committed here, and none will be.

## Index

Read them in order if you are new here. `00` tells you whether you need any of the rest. If you are a program rather than a person, [`manifest.json`](manifest.json) has the same index with knob ranges, API lists and limitations in structured form.

| Example | What it settles | Recipe | Tests |
|---|---|---|---|
| [`00-native-vs-custom`](00-native-vs-custom/) | Whether you need a custom layer at all. Same airports, native `circle` layer and custom Three.js layer, switchable. Click one and get a popup; click the other and get nothing. | [0.1 Decision tree](../docs/00-start-here/decision-tree.md) | 20 |
| [`01-points-on-globe`](01-points-on-globe/) | The core projection recipe, plus the spark/glow shader. The flagship. | [1.1 Mapbox](../docs/01-hugging-the-globe/mapbox.md) · [2.1 Spark points](../docs/02-effects/spark-points.md) | 13 |
| [`02-arcs-on-globe`](02-arcs-on-globe/) | Great-circle arcs, and **why lines cut through the planet** — the subdivision slider goes down to 2 so you can watch it happen. | [1.1 Mapbox](../docs/01-hugging-the-globe/mapbox.md) | 35 |
| [`03-areas-on-globe`](03-areas-on-globe/) | Filled areas and outlines. A 500 km circle is a *small circle* on a sphere, and looks different at every latitude. | [1.1 Mapbox](../docs/01-hugging-the-globe/mapbox.md) | 15 |
| [`04-moving-trajectory`](04-moving-trajectory/) | Geometry that moves: ECEF derived in the vertex shader instead of precomputed, plus timeline scrubbing. | [1.1 §"Unless your geometry moves"](../docs/01-hugging-the-globe/mapbox.md) | 41 |

Every one of them passes `npx tsc --noEmit`, `npx vitest run` and `npm run build`. 124 tests in total, all on the maths — the part you can check without a browser, a GPU, or a token.

All five have also been opened in a browser with a real token and confirmed rendering correctly on the globe; each example's README carries its own screenshot and status.

## Sample data

Examples use public-domain data or generate their own:

- **Airport positions** — [OurAirports](https://ourairports.com/data/), released to the public domain. A fetch script produces a trimmed local copy; the full dataset is not vendored.
- **Trajectories** — synthesised at runtime. No licence to honour, and you can raise the object count until your machine complains.

Where a value is synthetic rather than measured (point sizes standing in for traffic volume, for instance), the example's README says so explicitly. A demo that looks like real data but isn't is worse than an obviously fake one.
