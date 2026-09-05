# Globe Custom Layers atlas demo

The cartographic-lab workspace puts scene selection on the left, an interactive globe in the center, and recipes/source/Agent prompts in the inspector. It starts with **Native foundations**: local MapLibre point, line, and polygon layers can be independently shown and tuned before moving into the Three.js custom scenes. The free basics view deliberately shows all three together; its Mapbox counterpart is the existing `00-native-vs-custom` point-focused comparison.

The default mode is **Mapbox full example**, with a translucent globe and an explicit runtime-token entry form. Visitors may choose **Free MapLibre preview**, which uses MapLibre GL JS 5.24.0's prelude-based custom-layer adapter and local geographic data without a Mapbox token or external tile service. It reuses the original Three.js scene geometry and fragment shaders for airport points, raised arcs and mass tracks; a visible notice explains the horizon/limb, blending and depth differences. These are different implementations, not an engine capability comparison.

The interface and selected embedded examples support Traditional Chinese/English and light/dark themes. Parameter panels start collapsed in embedded views and expand only on request; changing the selected free scene collapses the panel again so it does not cover the globe. The free HUD exposes local-only Atlas, Midnight, and Blueprint basemap presets (ocean/land/border/grid colours only); no tile endpoint is added. Points expose size, opacity, core boost, and Solar/Aurora/Plasma/Ice palettes; arcs and tracks retain their scene-specific controls. Light custom geometry uses normal alpha blending for visibility on pale paper; dark mode retains additive glow. Use dark mode when studying additive highlight accumulation.

Both modes support the site's light/dark appearance. The interface offers Traditional Chinese and English, larger text, and a direct path from the effect to its GitHub source and an Agent task prompt. This remains a cookbook entry point, not a data service or an engine-independent rendering library.

## Why MapLibre works here

[MapLibre officially supports globe rendering](https://maplibre.org/maplibre-gl-js/docs/examples/display-a-globe-with-an-atmosphere/), including [custom layers through its own projection API](https://maplibre.org/maplibre-gl-js/docs/examples/add-a-simple-custom-layer-on-a-globe/). This website uses the MapLibre projection prelude in `maplibreCustom.ts` to reproduce the selected Three.js scenes locally. The direct ECEF/mainMatrix path remains unverified; terrain, depth-tested 3D and all-nine example portability are outside this status. The token-free bundle aliases `mapbox-gl` to a MercatorCoordinate-only shim and contains no Mapbox SDK.

The browser reproduction covers 190 raised arcs / 8,740 vertices and 5,000 tracks in 4,096 slots with one draw call. Points retain the source point-size path; the adapter supplies `vCull = 1` and MapLibre's official horizon clip. Light mode uses normal blending for visibility on white, while dark mode uses additive blending for highlights. The limb soft fade therefore differs from Mapbox and is not pixel-identical. The adapter uses `projectTileWithElevation()` with metre heights and `depthTest: false`; measured depth-tested 3D cut points, so this README makes no terrain/depth claim.

MapLibre's license is bundled in `dist/vendor/maplibre-LICENSE.txt`. Local Natural Earth and OurAirports files avoid dependence on a third party's free tile quota or demo-server policy. Hosting and bandwidth still belong to whoever serves the site; this is not a promise that arbitrary commercial basemap services are free.

## Preview data

- `land.json`: Natural Earth 1:110m land polygons, downloaded 2026-09-05 from the [Natural Earth vector repository](https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_110m_land.geojson). [Natural Earth data is public domain](https://www.naturalearthdata.com/about/terms-of-use/). It is generalized cartography, not precise survey geometry.
- `airports.json`: the existing 1,174-record OurAirports fixture copied from example 01, including its source metadata. Airport locations are not a live event feed.
- Preview routes and moving tracks are synthetic illustrations. Their appearance/counts are not runtime performance measurements from the WebGL examples.

These small data files are bundled locally; browsing the free globe does not request Mapbox tiles or require a Mapbox token. The site build embeds the native-foundations comparison plus three selected Three.js scenes without changing the examples' self-contained copy-out contract.

## Fresh clone

Install the pinned MapLibre dependency for the site and the four independently bundled example dependencies before building:

```sh
(cd site && npm ci)
(cd examples/00-native-vs-custom && npm ci)
(cd examples/01-points-on-globe && npm ci)
(cd examples/02-arcs-on-globe && npm ci)
(cd examples/05-mass-trajectories && npm ci)
node site/scripts/build.mjs
```

The build writes `site/dist`. It sets `VITE_MAPBOX_TOKEN` to an empty string and gives Vite a newly-created empty `envDir`; it never reads an example `.env`.

## Container deployment

Build from the repository root, then run the static image on port 8080:

```sh
docker build -t globe-custom-layers .
docker run --rm -p 8080:8080 globe-custom-layers
```

The multi-stage image uses Node 22 to run `npm ci` independently for `site` and examples 00, 01, 02, and 05, then runs the existing token-clearing site build. Its final Nginx image contains only `site/dist` and the port-8080 static-server configuration. The Docker allowlist and `.dockerignore` exclude local `.env` files, so no deployment token or runtime API is required.

On Zeabur, deploy this repository's `main` branch from the repository root. Its [Dockerfile deployment](https://zeabur.com/docs/en-US/deploy/methods/dockerfile) detects the root Dockerfile and exposed port 8080. Do not configure `VITE_MAPBOX_TOKEN`: visitors supply their own public token in the browser.

For Zeabur, deploy the GitHub repository with the service Root Directory left empty. Zeabur automatically detects this root `Dockerfile` and its `EXPOSE 8080`; this static site needs no service environment variables. See Zeabur's [Dockerfile deployment documentation](https://zeabur.com/docs/en-US/deploy/methods/dockerfile).

## Preview and deployment base path

Serve `site/dist` as the static document root:

```sh
cd site/dist && python3 -m http.server 4173
```

Open `http://localhost:4173`. All shell, preview-data, screenshot, iframe, and iframe-asset URLs are relative, so the directory may also be served under a project subpath such as `/demos/globe/`. The parent and iframe must share an origin for the handshake.

A visitor enters a public token at runtime. The shell holds it only in JavaScript memory and gives it to the single selected iframe after a source-and-origin-checked `postMessage` handshake. Only one iframe is mounted at once so the demo does not retain inactive WebGL contexts. `ready` means the iframe is waiting for a runtime token; it is separate from the `map.on("load")` signal shown in the shell. The shell also reports sanitized Mapbox error codes and times out independently when either handshake or map load does not arrive.

In explicit embed mode, the iframe gives the Mapbox SDK a memory-backed `localStorage` surface. This prevents its token-keyed telemetry identifiers from reaching the origin's persistent storage. Removing the iframe discards that state; standalone examples retain the SDK's normal storage behavior. The public token is sent to Mapbox in map requests, but is not put in the demo page URL or saved by the demo.

Reset and leaving the page explicitly forget the token, including a page restored from the browser's back/forward cache. The demo does not submit it to an application backend or put it in cookies or sessionStorage. This describes the application's storage behavior; it does not claim that Mapbox or browser network tooling never sees a token-bearing request. Create a public token through [Mapbox account signup](https://account.mapbox.com/auth/signup/) and [token management](https://account.mapbox.com/access-tokens/); [Mapbox documents public token scopes and URL restrictions](https://docs.mapbox.com/accounts/guides/tokens/).

## Verification boundary

The site tests cover handshake origin/source checks, token-forget iframe unload, and the static DOM/control contract for foundations, local basemap presets, native layers, and glow controls. Typechecking and the build cover the selected iframe bundles, including their relative fixture path. They do not prove real Mapbox tiles, a valid visitor token, actual GPU palette rendering, or visual globe/shader behavior. Those require browser inspection (and a deliberately supplied runtime token for Mapbox).

The [implementation record](../docs/demo-implementation-plan.md) separates completed local browser checks with a synthetic offline style from unverified real Mapbox tile access and public deployment. That test-only Mapbox style interception is not shipped. Free MapLibre mode is a locally reproduced custom-layer port preview; it does not verify the direct ECEF/mainMatrix hypothesis, terrain/depth behaviour, or all nine examples.


To repeat the token-free GPU checks after building, copy `site/tests/maplibre-port.html` to `site/dist/port-check.html`, serve `site/dist`, and open `/port-check.html`. The page reports geometry counts, changed height, paused/resumed GPU image hashes, front/back clipping, projection endpoints and the 0.5 transition coefficient. Remove that copied test page before publication. These browser checks require WebGL; the two default Node tests do not. Initially paused/reduced-motion tracks display a synthetic time-five-seconds snapshot so existing trails are visible.

Mass trajectories now start at **1,500 objects** in both engines. Controls include object count (100–12,000), speed (0.1–4×), opacity (0.1–1), pause/resume, and Multicolor/Cool/Warm palettes. Colors distinguish synthetic objects; they do not encode real flight categories. Palette changes update shader uniforms, and count changes also take effect while paused. The 5,000-object figures above describe the retained capacity stress check.
