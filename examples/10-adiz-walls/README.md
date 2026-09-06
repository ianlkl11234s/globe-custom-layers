# 10 — Vertical boundary walls

> Status: ⚠️ **Unverified in browser** — globe projection, antimeridian-safe wall geometry, GPU cleanup, typecheck and unit checks are included. Browser visual verification still requires a real Mapbox token.

![Labelled schematic of the vertical boundary wall component using Taiwan ADIZ data](screenshots/schematic.svg)

<sup>Illustration only; not browser, legal-boundary, or Mapbox-service evidence.</sup>

A Mapbox GL JS + Three.js custom-layer demonstration of a reusable *vertical boundary wall* component. The current fixture uses a Taiwan ADIZ schematic to make the component legible. It renders only the sides and luminous top edge implied by the gradient; it is intentionally **not** a flat area fill.

## Important interpretation boundary

- An ADIZ is **not sovereign airspace**.
- The bundled five-corner ring is an **illustrative schematic approximation**, not an AIP, legal, navigation, or operational boundary. This example intentionally does not bundle a claimed-authoritative ADIZ source or licence.
- The slider is **schematic display height**, not a published ceiling. No verified ceiling is available to this example; unknown is kept unknown rather than converted to `0` or presented as an upper limit.

## Run

```bash
cd examples/10-adiz-walls
npm install
cp .env.example .env
# Set VITE_MAPBOX_TOKEN in .env
npm run dev
```

## What the custom layer does

- `src/wallGeometry.ts` removes the duplicate closing coordinate, closes the last edge itself, and makes two triangles per edge. It unwraps longitude incrementally, so a future ring crossing ±180° does not streak across a flat map.
- `src/adizWallLayer.ts` precomputes both Web Mercator and ECEF attributes. On a globe it uses Mapbox's `projectionToMercatorMatrix`, blends through Mapbox's globe-to-mercator transition, disables depth testing, and applies ECEF-space far-side culling.
- One renderer owns the one custom layer. `onRemove()` disposes the mesh geometry and shader material; it does not leave a second Three renderer attached to Mapbox's shared WebGL context.

## Checks

```bash
npm ci
npm run typecheck
npm test
npm run build
```

The unit tests prove the wall's bottom/top layout, closed final edge, and antimeridian unwrapping. They cannot prove real WebGL appearance or make the schematic boundary authoritative.
