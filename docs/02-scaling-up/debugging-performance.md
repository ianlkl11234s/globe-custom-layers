# 2.4 Finding the actual bottleneck

> **Status:** 📋 Reported — a narrative account of one production incident. There is nothing to reproduce as a standalone example; the fix it describes is the min-heap eviction covered in [2.1](batched-trails.md).
> **Applies to:** no specific API — this is a measurement methodology, illustrated with `BatchedTrails.ts` under `three` 0.172.x.

## The symptom

A world-scale view — every airborne flight on the planet, all at once — dropped frames badly. Nothing was obviously broken; it just wasn't fast. The instinct was to guess at the biggest, most obvious pile of data on screen and go optimize it. That instinct was wrong three times in a row before anyone measured anything.

## Wrong guess #1: static trajectory volume

The world view also renders a large volume of static historical trajectory geometry, scanned progressively each frame. That looked like the obvious suspect — it's the largest single pile of vertices on screen. Moving the progressive scan entirely into the shader produced almost no change: 72.01 → 71.29 ms/frame, inside measurement noise. A follow-up check — disabling progressive filtering entirely — landed at 69.5 ms/frame, the same order of magnitude. Hypothesis dead.

## Wrong guess #2: the light-ball count

Next suspect: the instanced markers ("orbs") drawn at each aircraft's current position. The world view pushes the concurrently-visible count from roughly 500 up to nearly 8,000. Optimizing the per-frame update path for that instanced mesh cut its own cost by 42% — a real win, but that whole subsystem turned out to be only about 1.4% of total frame time to begin with. A 42% cut of 1.4% is not the fix anyone was looking for.

## What the clock actually showed

Wrapping the update loop in `performance.now()` segments — not a profiler, just manual timestamps around each major call — settled it immediately:

```
BatchedTrails.writeTrail        62–67 ms/update   ~93%
rest of the loop                 ~3.8 ms          ~5.7%
InstancedOrbs.updateAll          0.91 ms          ~1.4%
```

One function, ~93% of the frame. Going one level deeper, inside that function, the dominant cost was the trail buffer's slot-eviction search (see [2.1](batched-trails.md) for the mechanism): a fixed slot capacity far below the number of concurrently active flights, so most flights competing for a slot each frame *lost*, and each loser scanned the entire occupied-slot map looking for the one with the nearest end time to evict. At the scale of this incident, that worked out to roughly 1,857 flights per frame, each running a full linear scan — **about 11.14 million iterations per frame**, plus the garbage a `for..of`-over-entries loop generates by allocating a fresh pair per iteration, adding another 5–6 ms/frame in GC pressure on top of the scan itself.

Replacing the linear scan with a binary min-heap (keyed on end time, with the stale-entry and tie-break handling described in [2.1](batched-trails.md)) turned this specific change into:

- Script time: **72.62 → 14.03 ms/frame**
- Frame rate: roughly doubled
- GPU hardware utilization: **66% → 97–98%**

That last number is worth pausing on.

## Why 97–98% GPU utilization is the finish line, not a warning sign

It reads, at first glance, like the GPU is now "maxed out" — a number to worry about. It's the opposite. The GPU was always going to need to draw roughly the same amount of geometry; the only open question was whether the CPU could keep it fed. At 66% utilization, the GPU was sitting idle roughly a third of the time, waiting on a CPU that was busy running around 1,857 separate linear scans a frame over a ~6,000-entry map — about 11 million iterations in total — instead of handing over the next batch of work. Once the CPU stopped being the bottleneck, the GPU's utilization rose because it was finally being used — the frame went from CPU-bound to GPU-bound. From here, the only way to go faster is to reduce what's actually drawn or uploaded; fighting the utilization number back down would be optimizing the wrong side of the boundary.

One important scope note: the 72.62 → 14.03 ms/frame and doubled frame rate above are the heap change measured in isolation. A separate, later, broader effort on the same codebase reported a larger cumulative improvement (roughly 75.79 → 10.47 ms/frame, and 11.9 → 25.5 fps) across several unrelated fixes bundled together — a different measurement, of a different scope, not this one restated.

## Five lessons that generalize past this incident

**A symptom disappearing for one object doesn't clear a hypothesis for the whole system.** Earlier in the same project, a suspected depth-buffer bug made trail geometry vanish under globe projection, while glow-point markers stayed visible — read at the time as evidence the depth buffer wasn't the culprit. It wasn't evidence of anything: the markers survived by pure geometric coincidence (their shape happened to bulge slightly toward the camera, escaping the same culling), not because the underlying mechanism was different. A later camera change made them fail the same way. Partial survival is not partial proof.

**Two unrelated root causes can produce the exact same visible symptom.** "The entire layer disappears" happened twice in the same codebase, from two completely different mechanisms — once from the depth buffer described above, and once from a forgotten camera-position uniform silently defaulting to the origin, which zeroed out a horizon-culling dot product and marked every vertex invisible. Pixel-for-pixel identical failure, two unrelated fixes. Seeing a known symptom is a reason to check, not a reason to assume you already know the cause.

**Stacking a heuristic on top of a heuristic compounds error instead of correcting it.** One data source reports low-altitude readings in feet instead of meters, and an early fix applied a threshold-based unit-conversion heuristic to compensate. Later, a second, independent heuristic was added upstream to detect and correct suspected unit mismatches — and on sparsely sampled paths, both heuristics fired on the same points, applying the same conversion twice. The result was roughly a 10.8× altitude compression affecting the large majority of one dataset's flights, unnoticed for months. It wasn't fixed by adding a third layer of correction — it was fixed by deleting both heuristics and replacing them with a deterministic fact about the data source that made guessing unnecessary.

**Don't reason about performance from intuition once you can actually measure it.** Disabling terrain rendering barely moved frame rate — not the bottleneck. Nearly quadrupling the rendered pixel count (via device pixel ratio) cost only about 10% of frame rate — ruling out fill-rate and pointing at vertex-bound work instead. Both were settled the moment they were measured; re-raising them later as live possibilities wastes time re-litigating a closed question.

**Ordering dependencies can look exactly like random noise.** A long-standing, unexplained flake in visual regression testing was eventually traced to a color-assignment scheme that depended on the order in which data finished loading — which varies between runs. It had been filed, for a long time, as unavoidable rendering or environment randomness. It wasn't random at all; it was deterministic given the load order, and the load order was never fixed. Before calling something noise, check whether it depends on an order that isn't actually pinned down.

## The trap that costs the most time

An aggregate "GPU busy" percentage is not the same measurement as time actually spent per frame segment, and treating it as one costs real debugging time. A busy/utilization metric can read high while the frame is genuinely idle-waiting on something else, and it carries enough measurement noise (on the order of several percentage points) to make small real regressions invisible and small measurement noise look like a regression. Segment-level wall-clock timing — the `performance.now()` brackets that found the 93% figure above — is the only thing that reliably answers "where did the time go," not the summary percentage most tools show by default.

## Source

Extracted from `plan-art`: `docs/features/trajectory-rendering.md` and `src/three/BatchedTrails.ts`.

## Next

- [2.1 Batched trails](batched-trails.md) — the fix this case study measures
- [2.2 Instanced tracks](instanced-tracks.md) — the second wrong guess, and why a real 42% win didn't matter
- [1.1 Mapbox GL JS](../01-hugging-the-globe/mapbox.md) — the depth-buffer and camera-uniform failures behind lessons one and two
