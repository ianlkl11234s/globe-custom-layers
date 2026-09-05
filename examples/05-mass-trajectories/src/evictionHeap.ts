/**
 * Binary min-heap keyed on `endTime`, ties broken by `seq` (ascending --
 * whoever acquired their slot earliest loses first). This is
 * docs/03-scaling-up/batched-trails.md's "Step 5: eviction" data structure,
 * extracted from plan-art's `BatchedTrails.ts` (its `heapPush` /
 * `heapPopMin` / `heapSiftDown` private methods) into a standalone,
 * independently testable class -- no knowledge of slots, trails, or
 * `three` here at all, just entries.
 *
 * This class does NOT know about "staleness" (a popped entry whose slot
 * has since been reassigned to someone else). That check needs the slot
 * pool's own bookkeeping (`slotPool.ts`'s `slotSeq` array) as the source of
 * truth, so it lives in the caller, not here -- see slotPool.ts's
 * `evictViaHeap` for where the popped entry's `seq` gets checked before
 * being trusted.
 */

export interface HeapEntry {
  readonly endTime: number;
  readonly slot: number;
  readonly seq: number;
}

function less(a: HeapEntry, b: HeapEntry): boolean {
  return a.endTime < b.endTime || (a.endTime === b.endTime && a.seq < b.seq);
}

export class EvictionHeap {
  private heap: HeapEntry[] = [];

  get size(): number {
    return this.heap.length;
  }

  clear(): void {
    this.heap.length = 0;
  }

  push(entry: HeapEntry): void {
    const h = this.heap;
    h.push(entry);
    let i = h.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!less(entry, h[parent]!)) break;
      h[i] = h[parent]!;
      i = parent;
    }
    h[i] = entry;
  }

  /** Removes and returns the entry with the smallest (endTime, seq). O(log n). */
  popMin(): HeapEntry | undefined {
    const h = this.heap;
    if (h.length === 0) return undefined;
    const top = h[0]!;
    const last = h.pop()!;
    if (h.length > 0) {
      h[0] = last;
      this.siftDown(0);
    }
    return top;
  }

  /** Non-destructive peek at the current minimum, for tests. */
  peekMin(): HeapEntry | undefined {
    return this.heap[0];
  }

  private siftDown(i: number): void {
    const h = this.heap;
    const n = h.length;
    const entry = h[i]!;
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let smallest = i;
      let smallestEntry = entry;
      if (l < n && less(h[l]!, smallestEntry)) {
        smallest = l;
        smallestEntry = h[l]!;
      }
      if (r < n && less(h[r]!, smallestEntry)) {
        smallest = r;
        smallestEntry = h[r]!;
      }
      if (smallest === i) break;
      h[i] = smallestEntry;
      i = smallest;
    }
    h[i] = entry;
  }

  /** Discards all entries and rebuilds from a fresh list (only currently-valid occupants) -- bounds memory when stale entries pile up. See slotPool.ts's rebuild-threshold trigger. */
  rebuildFrom(entries: HeapEntry[]): void {
    this.heap = entries.slice();
    for (let i = (this.heap.length >> 1) - 1; i >= 0; i--) this.siftDown(i);
  }

  /** Snapshot for tests -- NOT heap order, just current contents. */
  toArray(): HeapEntry[] {
    return this.heap.slice();
  }
}
