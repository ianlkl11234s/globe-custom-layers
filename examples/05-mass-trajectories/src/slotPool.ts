/**
 * Fixed-capacity slot allocator: docs/03-scaling-up/batched-trails.md's
 * "Step 1" (one shared buffer, fixed slots) and "Step 5" (min-heap
 * eviction) as a standalone, `three`-free data structure -- no vertex
 * buffers, no GLSL, not even knowledge of "trails". Just: N callers
 * (identified by an arbitrary integer id) competing for `capacity` slots,
 * each caller carrying an `endTime` used to pick an eviction victim when
 * the pool is full.
 *
 * This is deliberately the ONE module in this example capable of being
 * imported by both `vitest run` (correctness) and `vitest bench`
 * (eviction.bench.ts's heap-vs-linear-scan timing) with zero WebGL, zero
 * DOM, zero `three` -- see this repo's README, "Benchmarking it yourself".
 *
 * Extracted from plan-art's `BatchedTrails.ts` (`acquireSlot` / `release` /
 * `rebuildHeap` / the free-slot pool), generalized: production couples
 * this allocator directly to per-vertex Float32Arrays; here it's split out
 * so `trailWriter.ts` (which DOES own the Float32Arrays) and this file can
 * each be tested in isolation. See slotPool.test.ts and
 * slotPool.consistency.test.ts.
 */

import { EvictionHeap, type HeapEntry } from "./evictionHeap";

export type EvictionStrategy = "heap" | "linear";

interface SlotState {
  id: number;
  endTime: number;
}

/** Rebuild the heap once stale entries exceed this multiple of capacity -- see rebuildHeap()'s docstring. Same multiple as plan-art's BatchedTrails.ts. */
const REBUILD_MULTIPLIER = 8;

export interface DirtyRange {
  /** First dirty slot index. */
  startSlot: number;
  /** Number of contiguous slots covered, starting at startSlot. */
  slotCount: number;
}

export class SlotPool {
  readonly capacity: number;

  private states: (SlotState | null)[];
  private byId = new Map<number, number>();
  /** Free slot indices, kept DESCENDING so `.pop()` always returns the LOWEST free index -- see this class's acquire(), and batched-trails.md's "Step 3" note on why active slots clustering at the low end keeps addUpdateRange spans small. */
  private freeSlots: number[] = [];
  private slotSeq: Float64Array;
  private acquireSeq = 0;
  private heap = new EvictionHeap();

  private evictionCount = 0;
  private minDirtySlot = Infinity;
  private maxDirtySlot = -1;

  constructor(capacity: number) {
    if (capacity < 1) throw new Error("SlotPool capacity must be >= 1");
    this.capacity = capacity;
    this.states = new Array(capacity).fill(null);
    this.slotSeq = new Float64Array(capacity);
    for (let i = capacity - 1; i >= 0; i--) this.freeSlots.push(i);
  }

  getSlot(id: number): number | undefined {
    return this.byId.get(id);
  }

  getOccupiedCount(): number {
    return this.byId.size;
  }

  getEvictionCount(): number {
    return this.evictionCount;
  }

  getFreeCount(): number {
    return this.freeSlots.length;
  }

  /** Current heap size -- exposed for tests asserting the rebuild threshold actually fires. */
  getHeapSize(): number {
    return this.heap.size;
  }

  markDirty(slot: number): void {
    if (slot < this.minDirtySlot) this.minDirtySlot = slot;
    if (slot > this.maxDirtySlot) this.maxDirtySlot = slot;
  }

  /** Reads and clears the accumulated dirty range. Pure index math -- no Float32Array here, see trailWriter.ts / trajectoryScene.ts for what a caller does with the result. */
  takeDirtyRange(): DirtyRange | null {
    if (this.maxDirtySlot < 0) return null;
    const range: DirtyRange = { startSlot: this.minDirtySlot, slotCount: this.maxDirtySlot - this.minDirtySlot + 1 };
    this.minDirtySlot = Infinity;
    this.maxDirtySlot = -1;
    return range;
  }

  /**
   * Frees `id`'s slot, if it currently has one, returning it to the free
   * pool (sorted-descending insert, keeping `.pop()` cheap and low-index-first
   * -- same technique as plan-art's `release()`). Marks that slot dirty so
   * the caller knows to zero its vertex data (see trailWriter.ts's
   * clearSlot). Does NOT touch the heap: a released slot's old heap entries
   * age out naturally via the seq/staleness check in evictViaHeap, or get
   * swept by rebuildHeap.
   */
  release(id: number): number | undefined {
    const slot = this.byId.get(id);
    if (slot === undefined) return undefined;
    this.byId.delete(id);
    this.states[slot] = null;
    this.markDirty(slot);

    let lo = 0;
    let hi = this.freeSlots.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.freeSlots[mid]! > slot) lo = mid + 1;
      else hi = mid;
    }
    this.freeSlots.splice(lo, 0, slot);
    return slot;
  }

  /**
   * Assigns `id` a slot, evicting the pool's current min-`endTime` occupant
   * if none is free. Assumes the caller already checked `getSlot(id) ===
   * undefined` (mirrors plan-art's `writeTrail`, which only calls
   * `acquireSlot` after its own `slotByFlight.get` misses -- see
   * trajectoryScene.ts).
   *
   * Both eviction strategies push a heap entry on every successful acquire,
   * REGARDLESS of `strategy` -- the toggle only changes which method finds
   * the victim when the pool is full. That keeps the two strategies'
   * bookkeeping cost identical except for the one step
   * docs/03-scaling-up/batched-trails.md is actually about (O(log
   * capacity) find-and-remove vs. O(capacity) scan), so `eviction.bench.ts`
   * measures that difference in isolation rather than "did we build a heap
   * at all".
   */
  acquire(id: number, endTime: number, strategy: EvictionStrategy): number {
    if (this.heap.size > this.capacity * REBUILD_MULTIPLIER) this.rebuildHeap();

    let slot: number;
    if (this.freeSlots.length > 0) {
      slot = this.freeSlots.pop()!;
    } else {
      const victimSlot = strategy === "heap" ? this.evictViaHeap() : this.evictViaLinearScan();
      if (victimSlot === -1) return -1; // pool non-empty but no valid victim found -- shouldn't happen, see evictViaHeap's fallback
      const victimId = this.states[victimSlot]!.id;
      this.release(victimId);
      this.evictionCount++;
      // freeSlots was empty before this release() (that's why we're in this
      // branch at all), so the victim's slot is the ONLY entry in it now --
      // pop() returns it regardless of index. Not "lowest wins" in general;
      // just the only candidate that exists at this specific point.
      slot = this.freeSlots.pop()!;
    }

    this.states[slot] = { id, endTime };
    this.byId.set(id, slot);
    const seq = ++this.acquireSeq;
    this.slotSeq[slot] = seq;
    this.heap.push({ endTime, slot, seq });
    this.markDirty(slot);
    return slot;
  }

  /**
   * O(log capacity): pop the heap's minimum repeatedly until one is found
   * whose `seq` still matches the slot's CURRENT occupant (a stale entry --
   * left behind by a slot that has since been reassigned -- has a seq that
   * no longer matches `slotSeq[slot]`, and is discarded). This is
   * batched-trails.md's "The trap that costs the most time": skipping this
   * check would let a stale pop evict a completely unrelated, currently
   * healthy occupant.
   */
  private evictViaHeap(): number {
    let entry: HeapEntry | undefined = this.heap.popMin();
    while (entry) {
      if (entry.seq === this.slotSeq[entry.slot]) return entry.slot;
      entry = this.heap.popMin();
    }
    // Heap exhausted with no valid entry, even though byId is non-empty --
    // shouldn't happen (every acquire pushes exactly one fresh entry), but
    // rebuild from ground truth once and retry as a defensive fallback
    // rather than silently failing to evict.
    if (this.byId.size > 0) {
      this.rebuildHeap();
      const retry = this.heap.popMin();
      if (retry && retry.seq === this.slotSeq[retry.slot]) return retry.slot;
    }
    return -1;
  }

  /**
   * O(capacity): the naive baseline this whole recipe replaces. Iterates
   * `byId` -- a `Map`, so insertion order -- tracking the running minimum
   * with a STRICT less-than, so the FIRST-inserted (earliest-acquired)
   * candidate wins any exact `endTime` tie. That is deliberately the same
   * tie-break the heap produces (ties broken by ascending `seq`, and
   * insertion order into `byId` tracks ascending `seq` one-for-one, since
   * every acquire -- first-time or after a release -- both inserts fresh)
   * -- see slotPool.consistency.test.ts, which asserts the two strategies
   * pick the identical victim given the identical operation sequence.
   */
  private evictViaLinearScan(): number {
    let bestSlot = -1;
    let bestEndTime = Infinity;
    for (const slot of this.byId.values()) {
      const endTime = this.states[slot]!.endTime;
      if (endTime < bestEndTime) {
        bestEndTime = endTime;
        bestSlot = slot;
      }
    }
    return bestSlot;
  }

  /**
   * Discards the heap and rebuilds it from only the slots currently
   * occupied (per `byId`), bounding memory: without this, `release()`
   * never removes a slot's old heap entries, so under steady churn with no
   * pool pressure (occupancy well under capacity, so eviction never runs to
   * sweep anything) the heap would grow without limit. Triggered from
   * `acquire()` once size exceeds `capacity * REBUILD_MULTIPLIER`.
   */
  private rebuildHeap(): void {
    const entries: HeapEntry[] = [];
    for (const [, slot] of this.byId) {
      entries.push({ endTime: this.states[slot]!.endTime, slot, seq: this.slotSeq[slot]! });
    }
    this.heap.rebuildFrom(entries);
  }
}
