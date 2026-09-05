# Demo implementation plan

Decision recorded 2026-09-05. This is an implementation plan, not a release claim.

## Product decision

Keep Globe Custom Layers a **Mapbox-first rendering cookbook for developers and AI agents**. The website is its visual entry point: choose an effect, inspect it, adjust a few parameters, then open its recipe/source or copy a task prompt. MapLibre remains an explicitly unverified porting track; the Mercator gallery is separate inspiration. This project does not become a flight-data backend, events platform, or npm rendering framework.

Version baseline for the next verification pass: Mapbox GL JS **3.30.0** and Three.js **0.172.0**, matching the resolved example dependencies. Earlier source investigations used Mapbox 3.18.1 and MapLibre 5.24.0; preserve that provenance rather than retroactively changing historical measurements.

## First demo scope

- Three scenes: glowing points, great-circle routes, and mass trajectory playback. Airport fixtures remain labelled airports; generated routes remain labelled synthetic.
- One live example at a time, hosted in a same-origin iframe. Preserve each example as an independent copyable app; no cross-imports between example source folders.
- Visitors without a token can browse existing screenshots, explanations, provenance, limits, recipe/source links, and Agent prompts.
- Live mode accepts the visitor's Mapbox public token in memory and sends it to Mapbox for map requests. No token in the page URL, local/session storage, logs, screenshots, or built assets. Standalone examples retain their existing environment-variable setup.
- A small set of controls; mass trajectories gain play/pause. Combined time seeking plus picking remains a separate P4 integration evaluation, not a promise of this first website.
- Responsive, keyboard-usable layout with explicit loading, missing-token, failed-load, and copied-prompt states. A preview image must not be described as a live rendering.
- Static build works under a project URL subpath. Publication is a later release step.

## Work allocation

| Work | Owner | Write scope | Acceptance |
|---|---|---|---|
| A: reproducibility and CI | Luna | Example package/lock/TypeScript configs, example license notices, CI and lightweight validation scripts | Exact dependencies; isolated clean installation for affected examples; typecheck/tests/build; CI defined without deployment |
| B: demo and embedding | Terra | `site/`, selected 01/02/05 entrypoints and self-contained embed bridges | Three scenes; one iframe; useful token-free mode; prompts and source links; runtime token origin/source checks; empty-env static build |
| C: documentation and positioning | Main agent | Root entrypoints, this plan, relevant stale status text | Honest support/version statements, Agent usage instructions, related-project comparison, copy-out guidance |
| D: integrated acceptance | Main agent | Focused fixes and evidence updates | Inspect changes; run necessary checks once; browser checks for preview, navigation, token flow, responsive layout, runtime where available; list unverified gates separately |

Tasks A and B run in parallel with disjoint ownership. Main agent owns integration and final acceptance. Use Terra for bounded implementation/reasoning and Luna for mechanical checks. Sol is reserved for a demonstrated blocker after a bounded attempt, with the reason recorded. Do not spawn duplicate explorers, repeatedly rerun unchanged tests, or pass full conversation history to workers. Report actual costs only if supplied by tooling; no invented token accounting.

## Acceptance gates and evidence

| Gate | Current state (2026-09-05) | Evidence / remaining boundary |
|---|---|---|
| Decision and plan | Recorded | This file |
| Clean example installation | Passed locally | All nine installed, typechecked, tested where applicable, and built in isolated temporary copies |
| Dependency baseline | Implemented | Exact manifests/lockfiles; explicit TypeScript types; Mapbox CSS bundled from the same installed SDK |
| Example tests/build | Passed locally | 278 example tests: 274 math tests plus four embed tests; all nine builds passed; gallery has no math tests |
| Static website build | Passed locally | Empty-env build; three independent embedded outputs; relative assets and airport fixture verified under `/dist/`; two site tests passed |
| Browser usability | Passed within stated scope | Desktop/mobile previews, keyboard scene navigation, scene-specific links/prompts, copy success feedback, token error/reset states, one active iframe |
| WebGL with offline map fixture | Passed locally | Three actual WebGL scenes using a fake token and test-only style interception; projection transition, arc subdivision and trajectory pause/resume checked |
| Real Mapbox service and full rendering regression | Pending | Real token permissions/tiles, backside and antimeridian regression, and quantitative alignment checks are not established by the offline fixture |
| CI execution on GitHub | Pending publication | A defined workflow is not a successful remote run |
| Public demo deployment | Not requested in this batch | Published URL plus live readback |
| Full P4 agent evaluation | Follow-up | Fixed prompt, agent/model and commit, generated app, new behavior checks and browser evidence |

Prior audit evidence: 274 math tests, 9 examples, 13 docs pages at commit `a52c001060b8c26002e5f630b54a017efaf197dd`. A clean-context Terra generated a 5,000-track app with playback/seek/picking and passed compilation and inherited tests; new interactions and browser behavior were not verified. This is preliminary integration evidence, not completed P4.

## Local implementation result — 2026-09-05

A–D are implemented and locally reviewed within the gates above. Two workers were used: Terra for the demo and Luna for reproducibility/CI. The main agent integrated the changes, corrected documentation and ran browser acceptance. No Sol escalation was needed; exact token usage was not available. No commit, push, remote CI run or deployment was performed.

The browser checks rendered glowing airport points, 190 synthetic arcs, and 5,000 synthetic moving objects with 4,096 trail slots and one reported draw call. The points HUD moved from globe transition 0.00 through 0.63 to Mercator 1.00. Increasing arc subdivision changed the reported vertices from 8,740 to 23,940. Frame captures stayed equal while paused and changed after resume. These are functional checks with an offline graticule style, not performance benchmarks or proof of real Mapbox service access. The fake token and fetch interception existed only in the test browser, not in shipped source.

Browser testing exposed SDK-created localStorage keys containing the supplied token. Embedded examples now provide an iframe-local in-memory Storage implementation before constructing the map, and fail closed if isolation cannot be installed. Parent persistent storage remained empty after loading and resetting the final subpath build. Origin/source validation and fail-closed behavior also have focused tests. Standalone example behavior is unchanged.

The documentation/manifest checker passes. CI is defined for all nine examples and the static site on Node 22, but its remote execution still needs evidence. Node 22 was selected from the [official supported release list](https://nodejs.org/en/about/previous-releases).

Local preview during this session: <http://127.0.0.1:5378/>. Without a token, it shows labelled preview images and usable recipe/source/prompt navigation. To rebuild and serve it later, follow [the site instructions](../site/README.md).

## Follow-up order

1. Review this completed local demo batch; verify real Mapbox service access and the remaining rendering regression cases before making a broader runtime claim.
2. Run fixed P4 tasks: event points with popup; moving tracks with playback and picking; antimeridian and projection transition. Feed observed failures back into recipes.
3. Publish the reviewed demo with a deployment record when authorized.
4. Revisit MapLibre globe, instanced tracks, and two or three globe adaptations from the Mercator gallery. These do not block a Mapbox-first initial release.

## UI direction update — 2026-09-05

The user requested the map-workspace feel of Mini Taiwan Pulse with a white background, referencing scientific survey layouts, pale relief maps and a dotted globe. Replace the long editorial landing page with a compact header, scene navigation, a dominant globe and an inspector for explanation/source/Agent actions. Use white surfaces, thin cartographic lines and blue/teal accents. Mobile must keep the globe and effect selection readily accessible.

The default experience becomes a labelled, draggable Canvas 2D illustration backed by local Natural Earth land geometry and the existing OurAirports fixture. Synthetic routes/tracks remain explicitly synthetic. This gives visitors a useful white globe without requiring a token, while the separate runtime-token action still opens the original Mapbox WebGL example. The illustration is not shader verification. Preserve the one-iframe constraint and token isolation.

Terra owns the site interface and illustration; Luna performs a bounded read-only inventory of the current Pulse shell; the main agent owns data provenance/build integration and browser acceptance. This UI batch does not change projection recipes, original example shaders or deployment scope.

Local acceptance: the browser showed no horizontal overflow at 390, 820 and 1440px. Actual mouse dragging changed the globe image; keyboard rotation and zoom also changed it. The synthetic tracks preview changed between frame captures. Scene selection updated the matching source and prompt; the prompt shortcut brought its panel into view on mobile, and the Copy action reported success. Invalid token input was rejected, a fake public token mounted the original example iframe, scene switching retained exactly one iframe, and Reset removed it with empty token input and empty persistent storage. These embedding checks do not claim valid Mapbox service access.

Integration review removed duplicated event-handler workarounds, retained the actionable authentication-error timeout behavior, hid preview-only controls while the WebGL example is active, and kept static preview scenes from continuously requesting animation frames. Mobile shows compact effect choices above the globe, while the tablet inspector moves below the map. The original screenshots remain historical example evidence; the current token-free entry view is the labelled interactive illustration.

## Guided bilingual demo and free engine — 2026-09-05

The next user request supersedes the schematic-first entry: enlarge text, support Traditional Chinese/English and light/dark themes, clarify GitHub/Agent reuse, and make Mapbox's missing-token state an explicit translucent globe gate. The user also asked whether a free open-source map can supply the initial experience.

Decision: use MapLibre GL JS 5.24.0 with native layers and local Natural Earth/OurAirports data as the default free preview. It provides real globe interaction and a consistent visual context, without an external tile service or token. Mapbox mode supplies the cookbook's custom shaders and batched trajectories, and requires a visitor's public token. This is a native-layer preview, not completion of the unverified Three.js/MapLibre port. The main actions remain choose an effect, explore it, then take the recipe/source or Agent prompt into a project.

The free path was independently rendered in a browser with one WebGL canvas and 1,174 airport source records. Its observed resource requests were exclusively same-origin script, stylesheet and local data files. Light/dark scenes and synthetic routes rendered. This proves this native-layer path with its pinned SDK; it does not promise free access to arbitrary hosted basemaps. See [site setup and sources](../site/README.md).

Privacy audit: the shell keeps the token in a JavaScript variable and clears the input on submit. Embedded examples give SDK localStorage an isolated memory-backed implementation. SDK 3.30.0's `tile_request_cache.ts` (inspected through the installed source map) strips `access_token` from Cache API keys, retaining only language/worldview/jobid. Network requests to Mapbox still include the token. The prior parent `pagehide` handler failed to clear the token variable, so explicit pagehide/pageshow cleanup is part of this batch. Do not describe this as erasing provider logs, browser network tooling or HTTP cache; the promise is that this application does not persist the key and requires it again after leaving/reloading.

Allocation: Terra handles the bilingual guided shell; a second bounded Terra handles embedded presentation/palette changes; Luna audits persistence, and the main agent owns the free engine, integration and acceptance. No Sol was required. Public deployment and real Mapbox service verification remain separate gates.

Final integration acceptance for this batch: default MapLibre rendered 1,174 airport records with a single canvas and no external map/data requests. The body font is 14px. English/dark and Traditional Chinese/light switches were exercised, with a reachable token form and signup links at 390px and no horizontal overflow. A fake token plus browser-only local-style interception rendered the actual Mapbox custom points in both palettes; switching theme/language and scenes retained exactly one iframe and removed the free canvas. Invalid token input was rejected and cleared. Simulated persisted pagehide/pageshow and a real reload removed the iframe and required token re-entry; parent localStorage/sessionStorage stayed empty. This validates the application lifecycle, not valid access to Mapbox's hosted styles/tiles.

Light-theme custom geometry uses normal alpha blending with dark teal colors to remain visible on white; dark mode keeps the original additive glow. Accordingly, light mode does not demonstrate additive highlight accumulation. Projection, subdivision and batching algorithms are unchanged. The selected examples passed 111 tests (19 + 35 + 57) and typechecking; the site has two focused bridge tests. Across the repository the recorded total is now 280 example tests: 274 math tests plus six embedded-preference/storage tests. Earlier counts and Canvas 2D notes above are historical and superseded by this section.

Final build and UI follow-up passed: 390px and 820px layouts had no horizontal overflow; the mobile Agent prompt shortcut displayed its panel and copying reported success. The final desktop page reported no browser errors. Integration also fixed English inspector-label wrapping, mobile embedded HUD title/button overlap, and the stale MapLibre label during Mapbox rendering. The static build, two site tests, documentation checker and diff whitespace check passed. Test-only fixture pages and fake test tokens are absent from the built output. The local preview remains at port 5378; no commit, push or deployment was performed.


## Default-mode correction — 2026-09-05

User review found that the simplified MapLibre presentation differs too much from the actual cookbook examples to lead the experience. Make Mapbox full example the default on initial load, reload and back/forward-cache restoration, keeping runtime token clearing. Place it first in the mode switch. Label the optional free route as a simplified preview and display bilingual effect-difference guidance before entering it and throughout free mode. Native circles/lines, smaller synthetic datasets and the local basemap account for the present differences; this is not evidence that MapLibre cannot support comparable custom effects. No shader port is included in this correction.

## MapLibre custom-effect port — 2026-09-05

The user clarified that the free mode should reproduce the actual effects, especially raised arcs and moving trails. The simplified native overlay has now been replaced by a prelude-based custom layer reusing the existing GlowPointsScene, ArcsScene and TrajectoryScene geometry/material sources. The site's Vite build aliases their coordinate-only Mapbox import to MapLibre's MercatorCoordinate and deduplicates Three.js. The original standalone examples remain self-contained.

Mapbox remains the default with its token gate. The optional mode is now labelled MapLibre port preview; its notice identifies remaining basemap, horizon-edge and antialiasing differences. Source links and Agent prompts follow the chosen engine. This is effect parity for three selected scenes, not pixel-identical basemaps, terrain support, or all-nine portability.

Integration found and corrected three rendering failures: omitted vertex-to-fragment varying assignments made points invisible; depth-tested projectTileFor3D cut point sprites, so the adapter uses projectTileWithElevation and disables depth testing; MapLibre 5.24 custom-layer projection data reported only a binary globe coefficient, so the adapter reads the actual coefficient from the pinned transform's tile-projection path while retaining custom-layer matrices. Its x/y input is normalized Mercator, while elevation is metres. Paused initial trajectories need an existing trail window: reduced-motion mode starts at synthetic time five seconds, then remains still until Play.

The repeatable browser fixture is site/tests/maplibre-port.html (copy into the built directory only for testing). Twelve checks passed: 190 arcs / 8,740 vertices; pure-globe ground-point CPU reference alignment to map.project below 0.0001 px in the sampled view; height changes the actual GPU image and 64 samples produce 23,940 vertices; 5,000 objects use 4,096 slots and one draw call; paused GPU hashes stay equal and resume changes them; rendering continues at a dateline-centered view; the actual blend reaches 0.5; Mercator alignment remains below 0.1 px; returning to globe rebuilds the shader variant; a far-side test point yields the same GPU image as an empty scene, and a front-side point changes it. The alignment checks sample the endpoints, not a pixel-perfect comparison across engines or every geographic position. Desktop light/dark point, arc and track scenes were visually reviewed. Measurements came from software WebGL and are not hardware performance benchmarks.

Site TypeScript checking, two Node bridge tests, static build, documentation checks and whitespace checks passed. No Sol was used. No commit, push, remote CI or deployment was performed.

Final shell acceptance confirmed the Mapbox default gate on reload and persisted page restoration, empty token input and empty parent local/session storage. The 390px bilingual layout had no horizontal overflow; MapLibre source links and Agent prompts target the adapter. The final free view retained one canvas and zero iframes. A retained visual record is [the MapLibre arc screenshot](../site/screenshots/maplibre-arcs-dark.png). The temporary browser-test page was removed from dist after the successful run.


## Configurable mass trajectories — 2026-09-05

The user requested committing the accumulated demo work and adding adjustable mass trajectories with 1,500 objects by default and visibly different colors. Both engines now use the shared trajectory scene palette contract: multicolor by default, plus cool and warm palettes. Light mode preserves hue distinctions with normal alpha blending; dark mode retains additive blending. The free controller exposes object count (100–12,000), simulation speed (0.1–4), opacity (0.1–1), palette and pause/resume. Existing Mapbox controls are wired to the same palette choices and updated default. The previous 5,000-object / 4,096-slot measurements remain stress-test evidence, not the current default.

Validation for the parameter update: 57 trajectory tests and both site bridge tests passed, both affected TypeScript checks and the static site build passed, and the browser fixture passed all 16 checks. It verifies the 1,500-object default, increases/decreases while paused, all three palette outputs in both light and dark modes, then retains the prior projection and clipping checks. UI review confirmed speed, opacity and palette survive a theme change. Multi-color hues now use golden-angle spacing so the 1,500-object prefix spans the color wheel.

## Foundation-first atlas and glow controls — 2026-09-05

The atlas now leads with a `00` Native foundations scene before the selected Three.js scenes. The token-free MapLibre view renders local native point, line and polygon layers together, with independent visibility, point-size, line-width and area-opacity controls. It also offers Atlas, Midnight and Blueprint cartographic palettes by changing only the bundled ocean/land/border/grid paint values; it does not add a tile service or broaden the free-basemap claim. The Mapbox counterpart remains the narrower `00-native-vs-custom` point comparison and is labelled as such.

Glow points now expose size, opacity, core boost and Solar/Aurora/Plasma/Ice palettes in both the free atlas and the standalone Mapbox point example. These ramps recolor the existing deterministic synthetic airport weight; they are presentation choices, not airport categories or traffic. Light mode darkens the selected hue instead of collapsing every palette toward teal, while dark mode retains additive blending.

Integration added the same-origin runtime-token bridge and iframe-local memory storage to example 00, and the static site/Docker/CI build paths now include that example. A fake `pk.audit-placeholder` reached the expected HTTP 401 after the parent/iframe handshake, proving the new embedding path and sanitized error surface but not valid Mapbox service rendering. The input was cleared and one iframe remained mounted for retry.

Current local verification: all nine examples passed typecheck and build; the eight tested examples passed 285 tests in total, while the gallery has no unit suite. Six site tests, site typecheck/build, documentation checks and whitespace checks passed. Browser acceptance covered all four free scenes, visible palette changes in light/dark, basemap switching, native layer toggles, arc geometry changing from 8,740 to 23,940 vertices at 64 samples, 3,000 tracks with one reported draw call, and a 390px reload with the HUD initially collapsed and zero horizontal overflow. No commit, push or deployment was performed; the public Zeabur demo still represents the previously published three-scene version until a separate release is authorized.

## Collapsible effect controls — 2026-09-05

Embedded controls now start collapsed for the native-foundations comparison, glow points, arcs and mass trajectories. The compact title/button chip expands only the selected scene's controls; switching scenes collapses the token-free MapLibre panel again. Standalone desktop examples retain their original expanded presentation, while embedded views no longer cover the globe by default.
