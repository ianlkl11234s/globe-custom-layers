/**
 * A per-object fixed-capacity ring buffer of trail samples, addressed by an
 * integer "tick" rather than a mutable write-head pointer.
 *
 * The one design choice that makes everything downstream simple:
 * `slotForTick(tick)` is `tick mod capacity`, a pure function with no
 * internal state. That means `writeAtTick(tick, x, y)` is idempotent --
 * calling it twice with the same tick always lands in the same slot and
 * leaves the same value there -- and, more importantly, it means two
 * different *sequences* of writes that touch the same set of ticks converge
 * on the exact same final buffer contents, regardless of the order or
 * batching those writes happened in.
 *
 * That property is what makes the timeline's two update paths (advance one
 * tick per frame while playing vs. jump-rebuild the last N ticks after a
 * scrub) provably consistent with each other: see `objectPath.test.ts`'s
 * "rebuild after a scrub matches incremental playback" test, which asserts
 * exactly this by comparing a buffer built one way against one built the
 * other way.
 *
 * No `three` or `mapbox-gl` import here on purpose -- this is a plain data
 * structure, testable and reasoned about with no WebGL/DOM in the loop. The
 * GPU-facing wiring (which typed arrays get `needsUpdate` + which
 * `addUpdateRange` calls) lives in trajectoryScene.ts, which reads out of
 * instances of this class.
 */

/**
 * Sentinel written into every slot's tick at construction / reset, standing
 * in for "never written". Deliberately a large finite number rather than
 * `-Infinity`: some WebGL/driver combinations are cautious about uploading
 * IEEE-754 infinities in vertex attributes, and a plain float comfortably
 * outside any real tick value avoids the question entirely. `uCurrentTick -
 * UNSET_TICK` in the shader is astronomically larger than any `uTrailLength`
 * window, so an unset slot's fade-alpha clamps to 0 exactly the way a
 * "properly" unset value would.
 */
export const UNSET_TICK = -1e9;

export class TrailRingBuffer {
  readonly capacity: number;
  private mercX: Float32Array;
  private mercY: Float32Array;
  private tick: Float32Array;

  constructor(capacity: number) {
    if (capacity < 1) throw new Error("TrailRingBuffer capacity must be >= 1");
    this.capacity = capacity;
    this.mercX = new Float32Array(capacity);
    this.mercY = new Float32Array(capacity);
    this.tick = new Float32Array(capacity).fill(UNSET_TICK);
  }

  /** Pure: which physical slot a given tick belongs to. Handles negative ticks (ticks before t=0, which the scrub-rebuild path can produce -- see objectPath.ts's syncTrailToTick). */
  slotForTick(tick: number): number {
    const m = tick % this.capacity;
    return m < 0 ? m + this.capacity : m;
  }

  /** Writes one sample at the slot `tick` maps to. Returns that slot index (callers use it to mark the right GPU buffer range dirty). */
  writeAtTick(tick: number, mercX: number, mercY: number): number {
    const slot = this.slotForTick(tick);
    this.mercX[slot] = mercX;
    this.mercY[slot] = mercY;
    this.tick[slot] = tick;
    return slot;
  }

  /** Marks every slot unwritten again. Used before a scrub-triggered rebuild so no stale sample from a previous, unrelated tick range survives. */
  reset(): void {
    this.tick.fill(UNSET_TICK);
  }

  readSlot(slot: number): { mercX: number; mercY: number; tick: number } {
    return { mercX: this.mercX[slot]!, mercY: this.mercY[slot]!, tick: this.tick[slot]! };
  }
}
