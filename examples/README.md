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

| Example | Recipe | Status |
|---|---|---|
| [`globe-hugging-points`](globe-hugging-points/) | [1.1 Hugging the globe: Mapbox](../docs/01-hugging-the-globe/mapbox.md) | Builds and unit-tested |

## Sample data

Examples use public-domain data or generate their own:

- **Airport positions** — [OurAirports](https://ourairports.com/data/), released to the public domain. A fetch script produces a trimmed local copy; the full dataset is not vendored.
- **Trajectories** — synthesised at runtime. No licence to honour, and you can raise the object count until your machine complains.

Where a value is synthetic rather than measured (point sizes standing in for traffic volume, for instance), the example's README says so explicitly. A demo that looks like real data but isn't is worse than an obviously fake one.
