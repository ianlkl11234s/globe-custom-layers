# 3.1 Batched trails

> **Status:** ✅ Verified — running in production, and reproduced in [`examples/05-mass-trajectories`](../../examples/05-mass-trajectories/): 5,000 objects against a 4,096-slot pool render in **one** draw call, and switching eviction from min-heap to linear scan on the same scene moves `ms / update` from 6.31 to 22.24.
> **Applies to:** `three` 0.172.x. The partial-upload step depends on `BufferAttribute.addUpdateRange` / `clearUpdateRanges` (a multi-range API); older Three versions only expose a single `updateRange` pair.

## The symptom

You are animating a few thousand moving polylines — flight trajectories, vessel tracks, anything with a fading tail. The obvious implementation is one `THREE.Line` per object. It works at a few hundred. Past a couple thousand concurrent trails, frame time climbs even though each individual line is trivial: a handful of points, a cheap gradient shader. Nothing about any single trail is expensive. The *count* is.

## Why it happens

Every `THREE.Line` is its own draw call, its own geometry, its own bit of JS object bookkeeping that Three has to walk each frame. None of that scales with how complex a trail is — it scales with how many trails exist. At world scale (tens of thousands of concurrently airborne flights) draw-call count and per-object CPU overhead dominate long before the GPU notices the geometry.

The fix is the standard batching move: one mesh, fixed-capacity buffers, and careful bookkeeping so that adding, updating, and evicting individual trails doesn't require touching the whole buffer.

## Step 1: one `THREE.Line`, fixed slots

Every trail gets a fixed-size **slot** in one shared buffer instead of its own geometry. A slot holds up to a fixed number of real points, plus two extra vertices used as separators (step 2). Draw call count is `1`, always, independent of how many trails are active — `mesh.frustumCulled = false` and a single `THREE.Line` object own the whole thing.

Capacity is dynamic, not a hardcoded constant: it's derived from the peak concurrent count in the current dataset, clamped between a floor (so small datasets don't thrash the buffer on minor fluctuations) and a hard ceiling (a memory guard — at the ceiling, a full buffer is on the order of tens of megabytes of GPU memory, and rebuilding happens only when demand moves far enough from the current allocation to be worth it, not on every minor change).

## Step 2: guard vertices — why slots need them

A `THREE.Line` draws a single connected line strip: every vertex connects to the next, with no built-in way to say "start a new line here." Lay two trails' slots back to back in one buffer and, without anything separating them, the last point of slot *N* draws a spurious line straight to the first point of slot *N+1* — two unrelated trails visually bridged.

The fix is a guard vertex at each end of a slot, positioned exactly on top of the adjacent real vertex with `opacity = 0`. **Copy every attribute, not just position** — any per-vertex attribute your shader branches on (an ECEF position, a dynamic/static flag) has to be duplicated too, or the guard will be projected differently from the vertex it is supposed to sit on top of. That produces two invisible segments per slot boundary — one zero-length (guard sitting on its neighbor), one bridging segment whose both endpoints are transparent — so nothing renders across the seam, and no `PRIMITIVE_RESTART`-style trick is needed.

## Step 3: partial buffer uploads, not a full re-upload

Rewriting a trail only touches its own slot, but a naive implementation re-uploads the *entire* position/color/opacity buffer every frame regardless. Instead, each write marks its slot's index range dirty; once per frame, the dirty range across all touched slots is merged into a single contiguous span and pushed with `addUpdateRange`:

```ts
private applyRange(attr: THREE.BufferAttribute, startV: number, countV: number, itemSize: number) {
  attr.clearUpdateRanges();
  attr.addUpdateRange(startV * itemSize, countV * itemSize);
  attr.needsUpdate = true;
}
```

This only pays off if the dirty range stays small relative to total capacity. It does, because of a second detail: the free-slot pool is kept sorted so the *lowest* free index is always handed out first. Active slots cluster at the low end of the buffer instead of scattering across it, so even with thousands of slots allocated, the touched range each frame stays compact.

## Step 4: precompute what doesn't move

Rendering onto a globe means every vertex needs an Earth-Centered-Earth-Fixed (ECEF) position for the projection shader (see [1.1](../01-hugging-the-globe/mapbox.md)). Most points in a trail are history — they were computed on a previous frame and don't move again. Only two points per trail actually need trigonometry on the current frame: the head (interpolated to the current playback time) and the tail (interpolated to the trailing edge of the time window). Every interior point's ECEF value is a straight array copy from a per-flight cache built once when the underlying path was loaded — no `sin`/`cos`/`atan` at all for those.

## Step 5: eviction — the part that matters most

When more objects are active than there are slots, something has to be evicted to make room, and the natural policy is: evict whichever trail is closest to its own natural end (it's about to disappear on its own — the smallest visual cost).

The obvious implementation scans the map of currently-occupied slots for the minimum `endTime`. That scan is O(capacity) per acquisition. At scale that's ruinous: when demand outstrips capacity by a wide margin, most acquisitions in a given frame *are* evictions, so an O(capacity) scan runs thousands of times per frame — measured at world scale as roughly 92% of this layer's own per-frame cost, tens of millions of iterations in a single frame. [3.4](debugging-performance.md) walks through that exact incident end to end.

The fix is a binary min-heap keyed on `endTime`, giving O(log capacity) find-and-remove instead. Two details make it correct, not just fast:

- **Stale entries.** A slot can be reassigned to a new trail after its old heap entry is still sitting in the heap. Each slot carries a sequence number, which does double duty as both the generation counter and the eviction tie-break; a popped heap entry is only trusted if its generation still matches the slot's current one, otherwise it's discarded and the pop repeats. The heap is periodically rebuilt from scratch (when stale entries pile up past a multiple of capacity) so memory doesn't grow unbounded.
- **Tie-breaking.** Source timestamps are quantized, so `endTime` ties are common — measured at roughly 28% of cases in one dataset. Ties break on acquisition order (earliest slot holder loses first), which is what a straightforward linear scan over a `Map`'s natural insertion order does implicitly. The heap has to replicate that tie-break explicitly, or its eviction choices diverge from the reference behavior frame to frame.

## The trap that costs the most time

The stale-entry check is easy to treat as an optimization detail and skip. It isn't one — it's a correctness requirement. Without the generation check, a heap pop can return a slot index that has since been reassigned to a completely different, currently-live trail. Evict on that basis and you silently kill an unrelated, healthy trail — not a crash, not a console warning, just a trail that vanishes mid-flight for no visible reason. Because it only happens under pool pressure (demand exceeding capacity), it won't show up in casual testing at low object counts, and by the time it does show up at scale it looks exactly like a data problem rather than a bookkeeping one.

## Source

Extracted from `plan-art`: `src/three/BatchedTrails.ts`.

## Next

- [3.4 Finding the actual bottleneck](debugging-performance.md) — the case study where this eviction scan was measured, not guessed at
- [3.2 Instanced tracks](instanced-tracks.md) — the companion pattern for point/instance data instead of line geometry
- [1.1 Mapbox GL JS](../01-hugging-the-globe/mapbox.md) — where the ECEF precompute and depth/cull setup this layer relies on come from
- [4.2 Depth and blending](../04-discipline/depth-and-blending.md) — render order and blending for a mesh like this one
