# 09-satellite-orbits

> Status: ⚠️ **Unverified in browser** — unit geometry checks, TypeScript, and build are provided; browser validation still requires a real Mapbox token.

![Labelled schematic of three elevated orbital rings](screenshots/schematic.svg)

<sup>Illustration only; not browser-rendering evidence.</sup>

Mapbox-first custom-layer demo of the reusable **Satellite orbital rings** component plus its **schematic circular-orbit set** fixture. Each ring is a closed, densely sampled inclined path at a radial altitude above the globe, with an optional moving satellite marker. They are intentionally not two-point great-circle arcs and not surface-hugging trajectory data.

The fixture's orbital elements are illustrative only: no live TLE is loaded, propagated, or implied. The HUD keeps this visible and exposes altitude exaggeration plus playback speed.

## Component input

`createOrbitLayer(orbits, controls)` accepts injected `OrbitDefinition[]`; `src/main.ts` is the only place that injects `createSchematicOrbits()`. An orbit has `{ id, label, color, path, satelliteAt? }`. `path` is an ordered, closed array of `{ longitudeDeg, latitudeDeg, altitudeMeters }`: longitude/latitude use WGS84 degrees, altitude is metres above mean Earth radius, and the final sample repeats the first. `satelliteAt(simSec)` is optional, returns the unexaggerated same sample shape, and the renderer alone applies the UI altitude scale. The schematic fixture internally keeps its illustrative values in km and converts them to metres at this boundary.

The renderer retains closed ECEF segments on the globe, unwraps each flat Mercator dateline endpoint to a locally continuous world copy, and uses camera-to-point Earth-sphere clearance rather than a surface-normal far-side test. Consequently, elevated sections beyond the surface horizon remain visible when they are physically not occulted.

This component does not propagate TLE/SGP4, infer timestamps, repair open paths, support latitudes at the Web Mercator poles, or turn untrusted track data into an orbit. Precompute/validate those concerns upstream, then inject a closed sampled path.

## Run

```bash
cd examples/09-satellite-orbits
npm ci
cp .env.example .env # set VITE_MAPBOX_TOKEN
npm run dev
```

## Checks

`npm run test` checks closed/elevated/inclined fixture geometry, injected-data validation, Earth-ray occlusion, high-altitude horizon visibility, and antimeridian segmentation. `npm run typecheck` and `npm run build` are separate checks. The custom layer disables depth testing, resets shared WebGL state before and after render, and disposes all Three.js geometry/material/renderer resources in `onRemove`; remove/re-add rebuilds those resources safely.
