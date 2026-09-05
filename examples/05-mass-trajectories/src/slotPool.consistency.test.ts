import { describe, expect, it } from "vitest";
import { SlotPool } from "./slotPool";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Op = { kind: "acquire"; id: number; endTime: number } | { kind: "release"; id: number };

/**
 * Replays the identical operation sequence against two SlotPool instances,
 * one forced to evict via "heap", the other via "linear" -- and asserts
 * that after EVERY step, the set of ids currently holding a slot is
 * identical between the two. Membership, not physical slot NUMBER, is the
 * thing this asserts: slotPool.ts's docstring explains why the tie-break
 * (heap: ascending seq; linear: Map insertion order, strict less-than) is
 * designed to make the two strategies pick the exact same victim on every
 * exact-endTime tie, not merely "a legal one" -- this test is what proves
 * that design choice actually holds under random data, not just by
 * inspection.
 */
function generateOps(seed: number, opCount: number, idPoolSize: number, tieProbability: number): Op[] {
  const rand = mulberry32(seed);
  const ops: Op[] = [];
  const live = new Set<number>();
  let nextId = 0;
  const ids: number[] = [];

  for (let i = 0; i < opCount; i++) {
    const wantRelease = live.size > 0 && rand() < 0.2;
    if (wantRelease) {
      const idx = Math.floor(rand() * ids.length);
      const id = ids[idx]!;
      if (live.has(id)) {
        ops.push({ kind: "release", id });
        live.delete(id);
        continue;
      }
    }
    const id = nextId < idPoolSize ? nextId++ : ids[Math.floor(rand() * ids.length)]!;
    if (nextId <= idPoolSize) ids.push(id);
    // Deliberately force exact-endTime ties at a configurable rate --
    // production measured ~28% real-world ties from timestamp
    // quantization; this exercises the tie-break explicitly rather than
    // leaving it to chance.
    const endTime = rand() < tieProbability ? Math.floor(rand() * 20) : rand() * 10000;
    ops.push({ kind: "acquire", id, endTime });
    live.add(id);
  }
  return ops;
}

describe("SlotPool: heap vs linear-scan eviction consistency", () => {
  it("produce identical held-id membership after every step, across many random seeds and a high tie rate", () => {
    // Default 5s timeout can be tight under system load (12 seeds x 400 ops
    // x up to 40 tracked ids of membership re-checking each step) --
    // generous explicit budget below, not a sign the algorithm is slow.
    for (let seed = 1; seed <= 12; seed++) {
      const capacity = 6;
      const poolHeap = new SlotPool(capacity);
      const poolLinear = new SlotPool(capacity);
      const ops = generateOps(seed, 400, 40, 0.4);

      const knownIds = new Set<number>();
      for (const op of ops) {
        knownIds.add(op.id);
        if (op.kind === "acquire") {
          if (poolHeap.getSlot(op.id) === undefined) poolHeap.acquire(op.id, op.endTime, "heap");
          if (poolLinear.getSlot(op.id) === undefined) poolLinear.acquire(op.id, op.endTime, "linear");
        } else {
          poolHeap.release(op.id);
          poolLinear.release(op.id);
        }

        for (const id of knownIds) {
          const inHeap = poolHeap.getSlot(id) !== undefined;
          const inLinear = poolLinear.getSlot(id) !== undefined;
          expect(inHeap).toBe(inLinear);
        }
      }

      expect(poolHeap.getOccupiedCount()).toBe(poolLinear.getOccupiedCount());
    }
  }, 20000);

  it("without forced ties, eviction counts still match exactly (sanity check with more entropy)", () => {
    const capacity = 10;
    const poolHeap = new SlotPool(capacity);
    const poolLinear = new SlotPool(capacity);
    const ops = generateOps(99, 600, 80, 0);

    for (const op of ops) {
      if (op.kind === "acquire") {
        if (poolHeap.getSlot(op.id) === undefined) poolHeap.acquire(op.id, op.endTime, "heap");
        if (poolLinear.getSlot(op.id) === undefined) poolLinear.acquire(op.id, op.endTime, "linear");
      } else {
        poolHeap.release(op.id);
        poolLinear.release(op.id);
      }
    }

    expect(poolHeap.getEvictionCount()).toBe(poolLinear.getEvictionCount());
  });
});
