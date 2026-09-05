/**
 * `npx vitest bench --run` -- the "node-runnable, no browser needed"
 * benchmark this repo's README reports numbers from. Exercises ONLY
 * `slotPool.ts` (+ `evictionHeap.ts`), with zero `three`, zero
 * `mapbox-gl`, zero WebGL: a synthetic workload shaped like the real
 * example (`OBJECT_COUNT` >> `CAPACITY`, so most acquisitions every
 * simulated "frame" are evictions -- see docs/03-scaling-up/batched-trails.md's
 * "when demand outstrips capacity by a wide margin, most acquisitions in a
 * given frame ARE evictions").
 *
 * The two `bench()` calls run the IDENTICAL operation sequence (same seed,
 * same id/endTime schedule) through a fresh SlotPool each -- one forced to
 * evict via `"heap"`, one via `"linear"` -- so the reported time difference
 * is entirely the eviction strategy, nothing else. See this file's
 * `runWorkload` for the exact per-frame shape.
 */

import { bench, describe } from "vitest";
import { SlotPool, type EvictionStrategy } from "./slotPool";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Smaller than the live example's own SLOT_CAPACITY=4096/MAX_OBJECTS=12000
// (that combination's O(capacity) linear-scan case alone runs into the
// hundreds of millions of scan-steps per call -- representative of
// batched-trails.md's stated worst case, but too slow to sample repeatedly
// under `vitest bench`'s default time budget). This is the same shape of
// oversubscription (roughly 3x, same as the "10000 objects" HUD tier over
// capacity) at a scale that still finishes a full multi-sample bench run
// in a few seconds -- see this repo's README for the numbers measured at
// this scale, and for why the *ratio* is what transfers, not the absolute
// capacity.
const CAPACITY = 1024;
const OBJECT_COUNT = 3000;
const FRAMES = 20;

/**
 * One synthetic "frame": for every id, if it already holds a slot, give it
 * a small (2%) chance of releasing early (a leg naturally finishing);
 * otherwise (the common case once the population exceeds capacity) attempt
 * to acquire one, which means evicting the pool's current minimum-endTime
 * occupant. This mirrors trajectoryScene.ts's own per-frame loop shape
 * closely enough to be representative, without any of the leg/great-circle
 * math that loop also does -- see this repo's README for why isolating
 * JUST the allocator's cost is the right thing to benchmark.
 */
function runWorkload(strategy: EvictionStrategy): void {
  const pool = new SlotPool(CAPACITY);
  const rand = mulberry32(20260905);

  for (let frame = 0; frame < FRAMES; frame++) {
    for (let id = 0; id < OBJECT_COUNT; id++) {
      if (pool.getSlot(id) !== undefined) {
        if (rand() < 0.02) pool.release(id);
        continue;
      }
      const endTime = frame + rand() * 12;
      pool.acquire(id, endTime, strategy);
    }
  }
}

describe(`SlotPool eviction, ${OBJECT_COUNT} objects / ${CAPACITY} slots / ${FRAMES} frames`, () => {
  // Explicit, small time budget: each call is already representative (see
  // runWorkload's docstring); this just bounds how many samples `vitest
  // bench` collects so the whole file finishes quickly instead of running
  // for however long its own time-boxed default would allow.
  bench(
    "heap (O(log capacity) find-and-remove)",
    () => {
      runWorkload("heap");
    },
    { time: 1000 },
  );

  bench(
    "linear scan (O(capacity) find-and-remove)",
    () => {
      runWorkload("linear");
    },
    { time: 1000 },
  );
});
