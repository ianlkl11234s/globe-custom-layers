/**
 * Lays a slot's vertices out inside the mega-buffer's raw Float32Arrays --
 * docs/03-scaling-up/batched-trails.md's "Step 1" (fixed slots) and "Step
 * 2" (guard vertices), as pure functions over plain typed arrays. No
 * `THREE.BufferAttribute`, no `THREE.BufferGeometry`, no `three` import at
 * all: `THREE.BufferAttribute` is just a thin wrapper around one of these
 * arrays (see trajectoryScene.ts), and keeping this file free of that
 * wrapper is what makes slot-bounds / guard-vertex / stale-residue
 * correctness testable under plain vitest, no WebGL context required.
 *
 * Buffer layout, per slot: `SLOT_VERTS = SLOT_POINTS + 2`. Index `base =
 * slot * SLOT_VERTS` is the LEADING guard; `base + 1 .. base + count` hold
 * the real vertices this frame (`writeSlotVertices` returns `count`);
 * `base + count + 1` is the TRAILING guard. Everything from `base + count +
 * 2` through the end of the slot is stale leftover from a previous, longer
 * write -- `clearTrailingResidue` zeroes exactly that range's opacity so it
 * stays invisible without needing a full-slot rewrite.
 */

export const SLOT_POINTS = 56;
export const SLOT_VERTS = SLOT_POINTS + 2;

/** One vertex's worth of raw floats, matching leg.ts's `TrailVertex` shape but framed as what actually goes into the buffer. */
export interface RawVertex {
  mercX: number;
  mercY: number;
  ecefX: number;
  ecefY: number;
  ecefZ: number;
  dynamic: boolean;
  progress: number;
}

/** The five parallel Float32Arrays backing the mega-buffer -- one property per `THREE.BufferAttribute` trajectoryScene.ts wraps them in. */
export interface TrailBuffers {
  position: Float32Array; // 3 per vertex: mercX, mercY, 0
  ecef: Float32Array; // 3 per vertex
  dynamic: Float32Array; // 1 per vertex: 0 or 1
  color: Float32Array; // 3 per vertex
  opacity: Float32Array; // 1 per vertex
  progress: Float32Array; // 1 per vertex
}

export function createTrailBuffers(capacity: number): TrailBuffers {
  const totalVerts = capacity * SLOT_VERTS;
  return {
    position: new Float32Array(totalVerts * 3),
    ecef: new Float32Array(totalVerts * 3),
    dynamic: new Float32Array(totalVerts),
    color: new Float32Array(totalVerts * 3),
    opacity: new Float32Array(totalVerts), // starts all-zero: every slot begins invisible
    progress: new Float32Array(totalVerts),
  };
}

function writeOne(buffers: TrailBuffers, v: number, vert: RawVertex, r: number, g: number, b: number, opacity: number): void {
  const v3 = v * 3;
  buffers.position[v3] = vert.mercX;
  buffers.position[v3 + 1] = vert.mercY;
  buffers.position[v3 + 2] = 0;
  buffers.ecef[v3] = vert.ecefX;
  buffers.ecef[v3 + 1] = vert.ecefY;
  buffers.ecef[v3 + 2] = vert.ecefZ;
  buffers.dynamic[v] = vert.dynamic ? 1 : 0;
  buffers.color[v3] = r;
  buffers.color[v3 + 1] = g;
  buffers.color[v3 + 2] = b;
  buffers.opacity[v] = opacity;
  buffers.progress[v] = vert.progress;
}

/** Copies vertex `src`'s position/ecef/dynamic (NOT opacity, NOT progress) onto vertex `dst`. Used for guard vertices: a guard must land EXACTLY where its real neighbor is, in whichever space that neighbor resolves to (static aEcef or dynamic shader-derived) -- copying only position and dropping the dynamic flag would leave the guard using the wrong branch and it would NOT coincide with its neighbor once reprojected, turning the "zero-length segment" into a visible streak. See this repo's README, "Where this differs from the source". */
function copyStaticFields(buffers: TrailBuffers, dst: number, src: number): void {
  const d3 = dst * 3;
  const s3 = src * 3;
  buffers.position[d3] = buffers.position[s3]!;
  buffers.position[d3 + 1] = buffers.position[s3 + 1]!;
  buffers.position[d3 + 2] = buffers.position[s3 + 2]!;
  buffers.ecef[d3] = buffers.ecef[s3]!;
  buffers.ecef[d3 + 1] = buffers.ecef[s3 + 1]!;
  buffers.ecef[d3 + 2] = buffers.ecef[s3 + 2]!;
  buffers.dynamic[dst] = buffers.dynamic[src]!;
}

/**
 * Writes `vertices` (oldest first, head last, as produced by
 * `leg.ts`'s `sliceWindow`) into `slot`'s real-vertex range, plus its two
 * guard vertices. Returns the number of real vertices written (callers must
 * remember this to pass as `prevCount` next time, so
 * `clearTrailingResidue` knows what to zero if the slice shrinks -- see
 * this module's docstring).
 *
 * Throws if `vertices.length > SLOT_POINTS` -- this example sizes
 * `SLOT_POINTS` with enough headroom over `PATH_SUBDIVISIONS` (leg.ts) that
 * this should never fire; it exists as a bounds guard, not a normal code
 * path (production's `BatchedTrails.writeTrail` instead silently trims the
 * oldest points on overflow -- this example skips that complexity, see
 * README "Deliberate simplifications").
 */
export function writeSlotVertices(
  buffers: TrailBuffers,
  slot: number,
  vertices: readonly RawVertex[],
  color: { r: number; g: number; b: number },
  opacity: number,
): number {
  const count = vertices.length;
  if (count > SLOT_POINTS) {
    throw new Error(`slot overflow: ${count} vertices > SLOT_POINTS (${SLOT_POINTS})`);
  }
  const base = slot * SLOT_VERTS;

  for (let i = 0; i < count; i++) {
    writeOne(buffers, base + 1 + i, vertices[i]!, color.r, color.g, color.b, opacity);
  }

  // Guard vertices: leading guard sits on the first real vertex, trailing
  // guard sits on the last -- both opacity 0. See batched-trails.md's
  // "Step 2: guard vertices" for why this is what stops one slot's line
  // from visually bridging into its neighbor's.
  if (count > 0) {
    copyStaticFields(buffers, base, base + 1);
    buffers.opacity[base] = 0;
    const lastReal = base + count;
    copyStaticFields(buffers, base + count + 1, lastReal);
    buffers.opacity[base + count + 1] = 0;
  }

  return count;
}

/**
 * Zeroes opacity for every vertex from `newCount + 2` through the end of
 * whatever range was live last frame (`prevCount + 1`, inclusive of the old
 * trailing guard) -- the stale-residue cleanup for when a slice shrinks
 * (rare here, since legs only ever grow their visible window until the
 * trailing edge starts sliding, but present for correctness and exercised
 * directly by trailWriter.test.ts). Position/ecef data is left alone: it's
 * invisible garbage, not incorrect geometry, since nothing with opacity 0
 * contributes to the rendered line either way.
 */
export function clearTrailingResidue(buffers: TrailBuffers, slot: number, newCount: number, prevCount: number): void {
  if (prevCount <= newCount) return;
  const base = slot * SLOT_VERTS;
  for (let k = newCount + 2; k <= prevCount + 1; k++) {
    buffers.opacity[base + k] = 0;
  }
}

/** Zeroes an ENTIRE slot's opacity (all SLOT_VERTS vertices) -- called on release/eviction so a freed slot renders nothing until reclaimed and rewritten, matching plan-art's `release()`. */
export function clearSlot(buffers: TrailBuffers, slot: number): void {
  const base = slot * SLOT_VERTS;
  for (let k = 0; k < SLOT_VERTS; k++) buffers.opacity[base + k] = 0;
}
