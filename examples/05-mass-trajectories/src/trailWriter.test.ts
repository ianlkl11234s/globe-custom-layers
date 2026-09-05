import { describe, expect, it } from "vitest";
import {
  SLOT_POINTS,
  SLOT_VERTS,
  clearSlot,
  clearTrailingResidue,
  createTrailBuffers,
  writeSlotVertices,
  type RawVertex,
} from "./trailWriter";

function makeVertex(mercX: number, dynamic: boolean, progress: number): RawVertex {
  return { mercX, mercY: 0.5, ecefX: mercX * 10, ecefY: 1, ecefZ: 2, dynamic, progress };
}

describe("createTrailBuffers", () => {
  it("sizes every array to capacity * SLOT_VERTS (times itemSize where relevant), all-zero initially", () => {
    const capacity = 5;
    const buffers = createTrailBuffers(capacity);
    expect(buffers.position.length).toBe(capacity * SLOT_VERTS * 3);
    expect(buffers.opacity.length).toBe(capacity * SLOT_VERTS);
    expect(buffers.opacity.every((v) => v === 0)).toBe(true); // every slot starts invisible
  });
});

describe("writeSlotVertices", () => {
  it("writes real vertices starting at base+1, leaving the leading guard at base", () => {
    const buffers = createTrailBuffers(2);
    const slot = 1;
    const base = slot * SLOT_VERTS;
    const verts = [makeVertex(0.1, false, 0), makeVertex(0.2, true, 1)];
    const count = writeSlotVertices(buffers, slot, verts, { r: 1, g: 0, b: 0 }, 1);

    expect(count).toBe(2);
    // toBeCloseTo(x, 6): these buffers are Float32Array (32-bit), so a
    // JS-double literal like 0.1 is only recoverable to ~7 significant
    // digits, not the 9 vitest's default precision would demand.
    expect(buffers.position[(base + 1) * 3]).toBeCloseTo(0.1, 6);
    expect(buffers.position[(base + 2) * 3]).toBeCloseTo(0.2, 6);
    expect(buffers.dynamic[base + 1]).toBe(0);
    expect(buffers.dynamic[base + 2]).toBe(1);
  });

  it("never writes outside the slot's own [base, base+SLOT_VERTS) range", () => {
    const buffers = createTrailBuffers(3);
    const slot = 1; // middle slot -- neighbours on both sides must stay untouched
    const neighbourBaseBefore = 0;
    const neighbourBaseAfter = 2 * SLOT_VERTS;
    // Poison neighbouring slots with a sentinel so any out-of-bounds write is caught.
    buffers.opacity[neighbourBaseBefore] = 0.777;
    buffers.opacity[neighbourBaseAfter] = 0.777;

    const verts = new Array(SLOT_POINTS).fill(0).map((_, i) => makeVertex(i / SLOT_POINTS, false, i / SLOT_POINTS));
    writeSlotVertices(buffers, slot, verts, { r: 0, g: 1, b: 0 }, 1);

    // Float32Array storage rounds the 0.777 sentinel -- compare with
    // tolerance, same reasoning as above; what this test actually asserts
    // (neighbouring slots untouched) doesn't depend on exact float bits.
    expect(buffers.opacity[neighbourBaseBefore]).toBeCloseTo(0.777, 6);
    expect(buffers.opacity[neighbourBaseAfter]).toBeCloseTo(0.777, 6);
  });

  it("throws rather than silently overflowing when given more than SLOT_POINTS vertices", () => {
    const buffers = createTrailBuffers(1);
    const tooMany = new Array(SLOT_POINTS + 1).fill(0).map((_, i) => makeVertex(i, false, 0));
    expect(() => writeSlotVertices(buffers, 0, tooMany, { r: 1, g: 1, b: 1 }, 1)).toThrow();
  });

  it("guard vertices land exactly on their neighbour's position/ecef/dynamic, with opacity forced to 0", () => {
    const buffers = createTrailBuffers(1);
    const verts = [makeVertex(0.3, true, 0), makeVertex(0.4, false, 0.5), makeVertex(0.5, true, 1)];
    const count = writeSlotVertices(buffers, 0, verts, { r: 0.2, g: 0.4, b: 0.6 }, 1);
    const base = 0;

    // Leading guard copies the first real vertex (base+1).
    expect(buffers.position[base * 3]).toBeCloseTo(buffers.position[(base + 1) * 3]!, 9);
    expect(buffers.ecef[base * 3]).toBeCloseTo(buffers.ecef[(base + 1) * 3]!, 9);
    expect(buffers.dynamic[base]).toBe(buffers.dynamic[base + 1]);
    expect(buffers.opacity[base]).toBe(0);

    // Trailing guard copies the last real vertex (base+count).
    const trailingGuard = base + count + 1;
    const lastReal = base + count;
    expect(buffers.position[trailingGuard * 3]).toBeCloseTo(buffers.position[lastReal * 3]!, 9);
    expect(buffers.ecef[trailingGuard * 3]).toBeCloseTo(buffers.ecef[lastReal * 3]!, 9);
    expect(buffers.dynamic[trailingGuard]).toBe(buffers.dynamic[lastReal]);
    expect(buffers.opacity[trailingGuard]).toBe(0);
  });

  it("guard opacity 0 holds regardless of whether the copied neighbour happens to be static or dynamic", () => {
    // Neighbour is STATIC (dynamic=false) at both ends this time.
    const buffers = createTrailBuffers(1);
    const verts = [makeVertex(0.1, false, 0), makeVertex(0.2, false, 1)];
    const count = writeSlotVertices(buffers, 0, verts, { r: 1, g: 1, b: 1 }, 1);
    expect(buffers.dynamic[0]).toBe(0); // leading guard mirrors the static neighbour
    expect(buffers.dynamic[count + 1]).toBe(0); // trailing guard too
    expect(buffers.opacity[0]).toBe(0);
    expect(buffers.opacity[count + 1]).toBe(0);
  });
});

describe("clearTrailingResidue", () => {
  it("zeroes opacity for vertices between the new (shorter) count and the previous count", () => {
    const buffers = createTrailBuffers(1);
    const verts5 = new Array(5).fill(0).map((_, i) => makeVertex(i / 5, false, i / 5));
    const prevCount = writeSlotVertices(buffers, 0, verts5, { r: 1, g: 1, b: 1 }, 1);
    expect(prevCount).toBe(5);

    const verts2 = [makeVertex(0.1, false, 0), makeVertex(0.2, true, 1)];
    const newCount = writeSlotVertices(buffers, 0, verts2, { r: 1, g: 1, b: 1 }, 1);
    expect(newCount).toBe(2);

    clearTrailingResidue(buffers, 0, newCount, prevCount);

    // Vertices base+4 .. base+6 (old real verts 3,4,5 + old trailing guard)
    // should now be opacity 0; base+1, base+2 (the new real verts) and
    // base+3 (the new trailing guard, just written) must stay untouched.
    expect(buffers.opacity[1]).toBe(1);
    expect(buffers.opacity[2]).toBe(1);
    expect(buffers.opacity[3]).toBe(0); // new trailing guard
    expect(buffers.opacity[4]).toBe(0); // stale residue from the old, longer write
    expect(buffers.opacity[5]).toBe(0);
    expect(buffers.opacity[6]).toBe(0);
  });

  it("does nothing when the new count is >= the previous count", () => {
    const buffers = createTrailBuffers(1);
    buffers.opacity.fill(1);
    clearTrailingResidue(buffers, 0, 5, 3);
    expect(buffers.opacity.every((v) => v === 1)).toBe(true);
  });
});

describe("clearSlot", () => {
  it("zeroes opacity across the ENTIRE slot, including both guards, and touches no other slot", () => {
    const buffers = createTrailBuffers(3);
    buffers.opacity.fill(1);
    clearSlot(buffers, 1);
    const base = 1 * SLOT_VERTS;
    for (let k = 0; k < SLOT_VERTS; k++) expect(buffers.opacity[base + k]).toBe(0);
    // Neighbouring slots untouched.
    expect(buffers.opacity[0]).toBe(1);
    expect(buffers.opacity[2 * SLOT_VERTS]).toBe(1);
  });
});
