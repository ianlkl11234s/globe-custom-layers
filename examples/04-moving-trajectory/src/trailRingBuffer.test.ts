import { describe, expect, it } from "vitest";
import { TrailRingBuffer, UNSET_TICK } from "./trailRingBuffer";

describe("TrailRingBuffer", () => {
  it("starts with every slot unwritten", () => {
    const ring = new TrailRingBuffer(4);
    for (let i = 0; i < 4; i++) {
      expect(ring.readSlot(i).tick).toBe(UNSET_TICK);
    }
  });

  it("pushing more samples than capacity overwrites the oldest, not the newest", () => {
    const ring = new TrailRingBuffer(3);
    for (let tick = 0; tick < 5; tick++) {
      ring.writeAtTick(tick, tick * 10, tick * 100);
    }
    // ticks 0..4 into capacity 3: tick 3 overwrites tick 0's slot, tick 4
    // overwrites tick 1's slot; tick 2's slot is never touched again.
    expect(ring.readSlot(0).tick).toBe(3);
    expect(ring.readSlot(1).tick).toBe(4);
    expect(ring.readSlot(2).tick).toBe(2);
  });

  it("each slot's position and tick stay paired -- no mixing between pushes", () => {
    const ring = new TrailRingBuffer(3);
    for (let tick = 0; tick < 5; tick++) {
      ring.writeAtTick(tick, tick * 10, tick * 100);
    }
    const slot0 = ring.readSlot(0);
    expect(slot0.mercX).toBe(30); // tick 3's data, not tick 0's
    expect(slot0.mercY).toBe(300);
    const slot2 = ring.readSlot(2);
    expect(slot2.mercX).toBe(20); // tick 2's data survives untouched
    expect(slot2.mercY).toBe(200);
  });

  it("preserves insertion order across the wrap: reading slots by ascending tick recovers 2,3,4", () => {
    const ring = new TrailRingBuffer(3);
    for (let tick = 0; tick < 5; tick++) {
      ring.writeAtTick(tick, tick, tick);
    }
    const ticks = [0, 1, 2].map((slot) => ring.readSlot(slot).tick).sort((a, b) => a - b);
    expect(ticks).toEqual([2, 3, 4]);
  });

  it("writeAtTick is idempotent: writing the same tick twice leaves one consistent value, not a mix", () => {
    const ring = new TrailRingBuffer(5);
    ring.writeAtTick(7, 1, 2);
    ring.writeAtTick(7, 1, 2);
    const slot = ring.slotForTick(7);
    expect(ring.readSlot(slot)).toEqual({ mercX: 1, mercY: 2, tick: 7 });
  });

  it("reset() clears every slot back to unwritten, no residue from before the reset", () => {
    const ring = new TrailRingBuffer(3);
    for (let tick = 0; tick < 5; tick++) ring.writeAtTick(tick, tick, tick);
    ring.reset();
    for (let i = 0; i < 3; i++) {
      expect(ring.readSlot(i).tick).toBe(UNSET_TICK);
    }
  });

  it("handles negative ticks (the scrub-rebuild path samples ticks before 0) without slot collisions or throwing", () => {
    const ring = new TrailRingBuffer(4);
    for (let tick = -6; tick <= -3; tick++) {
      ring.writeAtTick(tick, tick, tick);
    }
    const slots = new Set([-6, -5, -4, -3].map((t) => ring.slotForTick(t)));
    expect(slots.size).toBe(4); // four consecutive ticks occupy four distinct slots
    for (let tick = -6; tick <= -3; tick++) {
      expect(ring.readSlot(ring.slotForTick(tick)).tick).toBe(tick);
    }
  });

  it("incremental writes across the whole range converge with a single windowed rebuild of just the trailing window", () => {
    // Sequence A: one incremental push per tick, 0..9, in ascending order --
    // ticks 5..9 each overwrite ticks 0..4's slots as the buffer wraps, so
    // only the last 5 (= capacity) ticks survive.
    const ringA = new TrailRingBuffer(5);
    for (let tick = 0; tick <= 9; tick++) {
      ringA.writeAtTick(tick, tick * 2, tick * 3);
    }

    // Sequence B: the "scrub rebuild" shape objectPath.ts's syncTrailToTick
    // actually performs -- write only the trailing window (ticks 5..9, still
    // ascending order; a ring buffer's slot assignment is order-sensitive
    // when two ticks map to the same slot, so this is NOT testing "order
    // doesn't matter", it's testing "you don't have to replay the whole
    // history, just the window that's still visible, to reach the same
    // state").
    const ringB = new TrailRingBuffer(5);
    for (let tick = 5; tick <= 9; tick++) {
      ringB.writeAtTick(tick, tick * 2, tick * 3);
    }

    for (let slot = 0; slot < 5; slot++) {
      expect(ringB.readSlot(slot)).toEqual(ringA.readSlot(slot));
    }
  });
});
