# 00-native-lines

> Status: ⚠️ **Unverified in a real Mapbox browser session** — the native Mapbox `line` implementation, attributed OSM fixture, tests, typecheck and build are included. The retained screenshot shows the token-free MapLibre counterpart; supply a valid public token before treating Mapbox rendering as reproduced.

This North Atlantic view uses one native Mapbox `line` layer. Its width, opacity and color controls call `setPaintProperty`; no custom layer is required. The fixture is a dated OpenStreetMap snapshot under ODbL; it is incomplete and non-engineering-grade. It must never be interpreted as a complete cable inventory, precise landing geometry, route, capacity, or operational/safety data. See [`../../docs/data-sources.md`](../../docs/data-sources.md) for lineage and limitations.

Run `npm install`, copy `.env.example` to `.env`, set a public `VITE_MAPBOX_TOKEN`, then run `npm run dev`. Run `npm test && npm run typecheck && npm run build` for non-browser checks.
