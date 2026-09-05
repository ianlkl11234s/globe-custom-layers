# 00-native-choropleth

> Status: ⚠️ **Unverified in a real Mapbox browser session** — the native Mapbox `fill` implementation, attributed fixture, tests, typecheck and build are included. The retained screenshot shows the token-free MapLibre counterpart; supply a valid public token before treating Mapbox rendering as reproduced.

This example renders a native `fill` layer with opacity, palette and border controls. The `gdp_usd` property is GDP (current US$), 2023, from the World Bank (CC BY 4.0), joined to Natural Earth 1:50m de facto boundaries (public domain). The fill expression applies logarithmic thresholds only to positive values; `null`, zero, and invalid values are gray and must never be presented as a measured zero. See [`../../docs/data-sources.md`](../../docs/data-sources.md) for lineage and limitations.

Run `npm install`, copy `.env.example` to `.env`, set a public `VITE_MAPBOX_TOKEN`, then run `npm run dev`. Run `npm test && npm run typecheck && npm run build` for non-browser checks.
