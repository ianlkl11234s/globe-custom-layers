# AGENTS.md

This repo is a Mapbox-first cookbook for standalone custom globe-rendering examples, not a library. Read only the relevant recipe, example, and [agent guide](docs/agent-guide.md); the guide routes rendering choice, verification status, lifecycle, and performance work.

For website and Agent-task metadata, `examples/manifest.json` `siteScenes` is the technical source of truth. Preserve its component/fixture distinction, `inputContract`, complete `requiredFiles`, and acceptance gates.

Use native map layers when they meet the requirement. Use a custom layer only for rendering work native layers cannot express. Recipes carry evidence markers; retain their verified, reproduced, reported, or unverified status in any claim.

Keep every example self-contained. Do not expose tokens, cross-import between examples, or erase source, licence, missing-data, or synthetic-data semantics. Custom WebGL layers must clean up GPU resources and be profiled before scaling.

The pinned example baseline is `mapbox-gl` 3.30.0 and `three` 0.172.0. The [implementation record](docs/demo-implementation-plan.md) distinguishes it from historical and unverified tracks. Deployment, publishing, and other external actions require the applicable existing authorization.
