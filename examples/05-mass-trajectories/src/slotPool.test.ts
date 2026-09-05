import { describe, expect, it } from "vitest";
import { SlotPool } from "./slotPool";

describe("SlotPool: basic allocation", () => {
  it("hands out free slots low-index-first", () => {
    const pool = new SlotPool(8);
    expect(pool.acquire(1, 100, "heap")).toBe(0);
    expect(pool.acquire(2, 200, "heap")).toBe(1);
    expect(pool.acquire(3, 300, "heap")).toBe(2);
  });

  it("release returns a slot to the free pool, and it gets reused before higher indices", () => {
    const pool = new SlotPool(4);
    pool.acquire(1, 10, "heap");
    pool.acquire(2, 20, "heap");
    pool.release(1); // frees slot 0
    pool.acquire(3, 30, "heap"); // 2 currently occupies slot1; slot0 should come back first
    expect(pool.getSlot(3)).toBe(0);
  });

  it("getSlot returns undefined for an id never acquired", () => {
    const pool = new SlotPool(4);
    expect(pool.getSlot(999)).toBeUndefined();
  });

  it("never allocates the same slot to two live ids at once", () => {
    const pool = new SlotPool(16);
    const used = new Set<number>();
    for (let i = 0; i < 16; i++) {
      const slot = pool.acquire(i, i, "heap");
      expect(used.has(slot)).toBe(false);
      used.add(slot);
    }
  });
});

describe("SlotPool: eviction under pressure", () => {
  it("evicts the globally smallest endTime when the pool is full (heap strategy)", () => {
    const pool = new SlotPool(3);
    pool.acquire(1, 50, "heap");
    pool.acquire(2, 10, "heap"); // smallest
    pool.acquire(3, 30, "heap");

    const evictedSlot = pool.getSlot(2)!;
    const newSlot = pool.acquire(4, 999, "heap");
    expect(newSlot).toBe(evictedSlot);
    expect(pool.getSlot(2)).toBeUndefined();
    expect(pool.getSlot(4)).toBe(evictedSlot);
    expect(pool.getEvictionCount()).toBe(1);
  });

  it("evicts the globally smallest endTime when the pool is full (linear strategy)", () => {
    const pool = new SlotPool(3);
    pool.acquire(1, 50, "linear");
    pool.acquire(2, 10, "linear"); // smallest
    pool.acquire(3, 30, "linear");

    const evictedSlot = pool.getSlot(2)!;
    const newSlot = pool.acquire(4, 999, "linear");
    expect(newSlot).toBe(evictedSlot);
    expect(pool.getSlot(2)).toBeUndefined();
  });

  it("evicted slot is fully rewritten by the new occupant -- no residual ownership", () => {
    const pool = new SlotPool(2);
    pool.acquire(1, 1, "heap");
    pool.acquire(2, 2, "heap");
    pool.acquire(3, 100, "heap"); // evicts id 1 (smaller endTime)
    expect(pool.getOccupiedCount()).toBe(2);
    expect(pool.getSlot(1)).toBeUndefined();
    expect(new Set([pool.getSlot(2), pool.getSlot(3)]).size).toBe(2);
  });

  it("stale heap entries (from a slot released and reassigned without an intervening eviction) are skipped, not trusted", () => {
    // release() deliberately does NOT touch the heap (slotPool.ts's
    // docstring) -- so freeing a slot via release() and having the free
    // pool immediately hand it to a new occupant leaves the OLD occupant's
    // heap entry sitting in the heap, stale, potentially with a smaller
    // endTime than anything currently live. A later eviction must skip it,
    // not resurrect it as if it still described slot 0's real occupant --
    // this is batched-trails.md's "trap that costs the most time".
    const pool = new SlotPool(2);
    pool.acquire(1, 5, "heap"); // slot 0, smallest endTime
    pool.acquire(2, 100, "heap"); // slot 1
    pool.release(1); // slot 0 freed via explicit release; its heap entry (endTime 5) is now stale
    pool.acquire(3, 200, "heap"); // reclaims slot 0 from the free pool -- NOT via eviction, so the stale entry is never popped here

    // Pool is full again (slot0=id3, slot1=id2). Forcing an eviction must
    // NOT resurrect the stale endTime=5 entry -- the true minimum among
    // CURRENT occupants is id 2 (endTime 100), not the long-gone id 1.
    const newSlot = pool.acquire(4, 1, "heap");
    expect(pool.getSlot(2)).toBeUndefined();
    expect(pool.getSlot(3)).toBe(0); // untouched by the eviction
    expect(pool.getSlot(4)).toBe(newSlot);
    expect(newSlot).toBe(1); // the slot id 2 used to hold, not slot 0's stale entry
  });

  it("rebuildHeap fires once stale entries pile up (capacity * 8) and the pool keeps working correctly afterward", () => {
    const capacity = 4;
    const pool = new SlotPool(capacity);
    // Churn far past the rebuild threshold through pure eviction (pool
    // always full -> heap grows by one stale-prone entry per acquire).
    let nextId = 0;
    for (let i = 0; i < capacity; i++) pool.acquire(nextId++, i, "heap");
    for (let round = 0; round < capacity * 8 + 20; round++) {
      pool.acquire(nextId++, round + capacity, "heap");
    }
    expect(pool.getOccupiedCount()).toBe(capacity);
    expect(pool.getHeapSize()).toBeLessThanOrEqual(capacity * 8 + capacity); // rebuild actually ran, heap didn't grow unbounded
  });
});

describe("SlotPool: dirty range tracking", () => {
  it("takeDirtyRange covers every touched slot, and only touched slots", () => {
    const pool = new SlotPool(10);
    pool.markDirty(3);
    pool.markDirty(7);
    pool.markDirty(5);
    const range = pool.takeDirtyRange();
    expect(range).toEqual({ startSlot: 3, slotCount: 5 }); // covers 3..7 inclusive
  });

  it("returns null when nothing was marked dirty since the last take", () => {
    const pool = new SlotPool(10);
    expect(pool.takeDirtyRange()).toBeNull();
    pool.markDirty(1);
    pool.takeDirtyRange();
    expect(pool.takeDirtyRange()).toBeNull();
  });

  it("a single dirty slot produces a range of exactly that one slot", () => {
    const pool = new SlotPool(10);
    pool.markDirty(4);
    expect(pool.takeDirtyRange()).toEqual({ startSlot: 4, slotCount: 1 });
  });

  it("acquire and release both mark their slot dirty automatically", () => {
    const pool = new SlotPool(4);
    const slot = pool.acquire(1, 10, "heap");
    expect(pool.takeDirtyRange()).toEqual({ startSlot: slot, slotCount: 1 });
    pool.release(1);
    expect(pool.takeDirtyRange()).toEqual({ startSlot: slot, slotCount: 1 });
  });
});
