import { describe, expect, it } from "vitest";
import { EvictionHeap, type HeapEntry } from "./evictionHeap";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function isLessOrEqual(a: HeapEntry, b: HeapEntry): boolean {
  return a.endTime < b.endTime || (a.endTime === b.endTime && a.seq <= b.seq);
}

describe("EvictionHeap", () => {
  it("popMin always returns the global minimum (endTime, then seq) among current entries", () => {
    const rand = mulberry32(1);
    const heap = new EvictionHeap();
    const entries: HeapEntry[] = [];
    for (let i = 0; i < 500; i++) {
      const entry: HeapEntry = { endTime: Math.floor(rand() * 100), slot: i, seq: i };
      entries.push(entry);
      heap.push(entry);
    }

    entries.sort((a, b) => (a.endTime !== b.endTime ? a.endTime - b.endTime : a.seq - b.seq));
    for (const expected of entries) {
      const got = heap.popMin();
      expect(got).toEqual(expected);
    }
    expect(heap.popMin()).toBeUndefined();
  });

  it(
    "maintains the heap property through interleaved push/pop (a common pattern is 'pop then immediately push a replacement', mirroring acquire-after-evict)",
    () => {
      // O(rounds * live-set-size) by design (every pop is checked against
      // every still-live entry) -- 800 rounds keeps this comfortably inside
      // the explicit 15s budget below even under system load; the
      // fixed-seed sorted-reference test above already covers the
      // stronger/cheaper "always the global min" property at higher N.
      const rand = mulberry32(2);
      const heap = new EvictionHeap();
      const live = new Map<number, HeapEntry>();
      let nextSlot = 0;

      for (let round = 0; round < 800; round++) {
        if (rand() < 0.5 || heap.size === 0) {
          const slot = nextSlot++;
          const entry: HeapEntry = { endTime: Math.floor(rand() * 1000), slot, seq: slot };
          heap.push(entry);
          live.set(slot, entry);
        } else {
          const popped = heap.popMin();
          expect(popped).toBeDefined();
          // Every entry still in `live` at pop time must be >= the popped one.
          for (const other of live.values()) {
            if (other.slot === popped!.slot) continue;
            expect(isLessOrEqual(popped!, other)).toBe(true);
          }
          live.delete(popped!.slot);
        }
      }
    },
    15000,
  );

  it("ties on endTime are broken by ascending seq", () => {
    const heap = new EvictionHeap();
    heap.push({ endTime: 10, slot: 0, seq: 5 });
    heap.push({ endTime: 10, slot: 1, seq: 2 });
    heap.push({ endTime: 10, slot: 2, seq: 9 });
    const first = heap.popMin();
    expect(first?.seq).toBe(2);
    expect(first?.slot).toBe(1);
  });

  it("rebuildFrom discards prior entries and heapifies the new list correctly", () => {
    const heap = new EvictionHeap();
    heap.push({ endTime: 1, slot: 0, seq: 0 });
    heap.push({ endTime: 2, slot: 1, seq: 1 });

    heap.rebuildFrom([
      { endTime: 50, slot: 10, seq: 100 },
      { endTime: 5, slot: 11, seq: 101 },
      { endTime: 30, slot: 12, seq: 102 },
    ]);

    expect(heap.size).toBe(3);
    expect(heap.popMin()).toEqual({ endTime: 5, slot: 11, seq: 101 });
    expect(heap.popMin()).toEqual({ endTime: 30, slot: 12, seq: 102 });
    expect(heap.popMin()).toEqual({ endTime: 50, slot: 10, seq: 100 });
  });

  it("clear empties the heap", () => {
    const heap = new EvictionHeap();
    heap.push({ endTime: 1, slot: 0, seq: 0 });
    heap.clear();
    expect(heap.size).toBe(0);
    expect(heap.popMin()).toBeUndefined();
  });
});
