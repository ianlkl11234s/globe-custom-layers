/**
 * A fixed-capacity ring buffer of trail samples for many particles at once,
 * stored flat (one big Float32Array per field, not one object per
 * particle -- object-per-particle would mean tens of thousands of small
 * heap allocations for a large particle count).
 *
 * This is a genuine circular buffer addressed by a per-particle write-head
 * index (`head[particle]`), unlike the O(trail length) array-shift used in
 * mini-taiwan-pulse/src/map/climateParticleLineLayer.ts's `step()` (it
 * shifts every history slot down by one on every particle, every frame).
 * The doc (docs/03-scaling-up/vector-field-particles.md) describes that
 * source technique as "a short ring buffer of past normalized positions",
 * but shifting isn't actually how a ring buffer works -- a real ring
 * buffer overwrites the oldest slot in O(1) via a wrapping index, with no
 * per-frame O(capacity) copy. This module is that: `push()` is O(1)
 * regardless of trail length. See the README's "Where this differs from
 * the source" section.
 *
 * Each pushed sample also caches its mercator-space (x, y) at push time --
 * the one thing worth caching per docs/03-scaling-up/vector-field-particles
 * .md's "What is cached" section, since a written trail point's geographic
 * position never changes again for the rest of its life in the buffer.
 *
 * No `mapbox-gl` or WebGL import here -- plain data structure, testable
 * under Node (see particleTrailBuffer.test.ts). The mercator projection
 * itself lives in particleFieldLayer.ts and is passed in as a callback so
 * this module stays a pure ring buffer with no projection-math dependency.
 */

export class ParticleTrailBuffer {
  readonly particleCapacity: number;
  readonly trailLength: number;

  // Flat [particle * trailLength + slot] layout for every field.
  private lon: Float32Array;
  private lat: Float32Array;
  private mercX: Float32Array;
  private mercY: Float32Array;
  private valid: Uint8Array;

  /** Next slot each particle will write into. */
  private head: Int32Array;
  /** How many samples each particle has ever written, capped at trailLength -- lets forEachAgeOrdered know how many of a not-yet-full particle's slots are real vs. still empty. */
  private writeCount: Int32Array;

  constructor(particleCapacity: number, trailLength: number) {
    if (particleCapacity < 1) throw new Error("particleCapacity must be >= 1");
    if (trailLength < 2) throw new Error("trailLength must be >= 2");
    this.particleCapacity = particleCapacity;
    this.trailLength = trailLength;
    const n = particleCapacity * trailLength;
    this.lon = new Float32Array(n);
    this.lat = new Float32Array(n);
    this.mercX = new Float32Array(n);
    this.mercY = new Float32Array(n);
    this.valid = new Uint8Array(n);
    this.head = new Int32Array(particleCapacity);
    this.writeCount = new Int32Array(particleCapacity);
  }

  private index(particle: number, slot: number): number {
    return particle * this.trailLength + slot;
  }

  /**
   * Pushes one new head sample for `particle`, overwriting whatever was in
   * the oldest slot (the one `head[particle]` currently points at) and
   * advancing the write head by one, wrapping at `trailLength`. O(1),
   * regardless of how full the buffer is.
   */
  push(particle: number, lon: number, lat: number, mercX: number, mercY: number): void {
    const slot = this.head[particle]!;
    const idx = this.index(particle, slot);
    this.lon[idx] = lon;
    this.lat[idx] = lat;
    this.mercX[idx] = mercX;
    this.mercY[idx] = mercY;
    this.valid[idx] = 1;
    this.head[particle] = (slot + 1) % this.trailLength;
    if (this.writeCount[particle]! < this.trailLength) this.writeCount[particle]!++;
  }

  /** Marks a particle's entire trail empty and resets its write head -- used when a particle respawns somewhere new, so no stale sample from its previous life leaks into the new trail. */
  resetParticle(particle: number): void {
    const base = particle * this.trailLength;
    this.valid.fill(0, base, base + this.trailLength);
    this.head[particle] = 0;
    this.writeCount[particle] = 0;
  }

  /** How many of a particle's slots hold a real (written) sample -- less than trailLength until it has lived long enough to fill the buffer once. */
  liveCount(particle: number): number {
    return this.writeCount[particle]!;
  }

  /**
   * Reads one particle's samples ordered from newest (age 0, the point most
   * recently pushed) to oldest (age = liveCount-1), calling `fn` once per
   * live slot. Never visits a slot that has never been written.
   */
  forEachAgeOrdered(
    particle: number,
    fn: (age: number, lon: number, lat: number, mercX: number, mercY: number) => void,
  ): void {
    const live = this.writeCount[particle]!;
    const head = this.head[particle]!; // next slot to be written = one past the newest
    for (let age = 0; age < live; age++) {
      // newest sample is at head-1 (mod trailLength); walking backward by
      // age steps through progressively older samples.
      const slot = (((head - 1 - age) % this.trailLength) + this.trailLength) % this.trailLength;
      const idx = this.index(particle, slot);
      fn(age, this.lon[idx]!, this.lat[idx]!, this.mercX[idx]!, this.mercY[idx]!);
    }
  }
}
