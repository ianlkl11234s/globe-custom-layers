/**
 * Zoom-adaptive particle density: pull the camera back and more particles
 * fill the larger visible area; approach the base slider value again on
 * zoom-in. Ported from climateParticleLineLayer.ts's `adaptiveCount`
 * (see docs/03-scaling-up/vector-field-particles.md's "Zoom-adaptive
 * density has to be quantized" section for the full explanation of *why*
 * the quantizing step below isn't cosmetic).
 *
 * Two versions are exported on purpose:
 * - `quantizedDensity` is what the layer actually uses.
 * - `rawDensity` is the naive, unquantized version, kept around
 *   specifically so the demo's "quantize density" HUD toggle can call it
 *   instead and let you watch `ms per update` jitter as a continuous zoom
 *   gesture reallocates every backing buffer on every single frame -- see
 *   the README's "Why quantization matters" section and main.ts's toggle
 *   wiring.
 *
 * No `mapbox-gl` or WebGL import here -- plain math, testable under Node
 * (see adaptiveDensity.test.ts).
 */

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Zoom at or above this uses the slider's base value exactly, no boost. */
export const ADAPTIVE_BASE_ZOOM = 5.5;
/** Boost multiplier added per zoom level below ADAPTIVE_BASE_ZOOM. */
export const ADAPTIVE_PER_LEVEL = 0.7;
/** Ceiling on the boost multiplier, however far you zoom out. */
export const ADAPTIVE_MAX_BOOST = 6;
/** Quantum the *quantized* variant rounds its boosted count to -- see the module doc comment. */
export const ADAPTIVE_QUANTUM = 2_000;

export const MIN_PARTICLES = 1_000;
export const MAX_PARTICLES = 50_000;

/** The multiplier alone, as a function of zoom -- exported mainly so tests (and the HUD, if it wants to show it) don't have to reverse-engineer it from the two density functions below. */
export function densityBoost(zoom: number): number {
  return clamp(1 + Math.max(0, ADAPTIVE_BASE_ZOOM - zoom) * ADAPTIVE_PER_LEVEL, 1, ADAPTIVE_MAX_BOOST);
}

/**
 * Naive version: recomputes a boosted target from continuous zoom, with no
 * rounding. Two visually indistinguishable zoom levels almost always
 * produce two different particle counts -- which is exactly the point of
 * keeping this variant around as the "what if we didn't quantize" demo.
 */
export function rawDensity(base: number, zoom: number): number {
  const boost = densityBoost(zoom);
  return clamp(Math.round(base * boost), MIN_PARTICLES, MAX_PARTICLES);
}

/**
 * The version the layer actually uses: same boost curve, but rounded to
 * the nearest ADAPTIVE_QUANTUM. `resize()` in particleFieldLayer.ts is a
 * no-op unless the quantized target actually changes, so a continuous zoom
 * gesture reallocates the particle buffers only when it crosses a quantum
 * boundary -- not on every frame.
 */
export function quantizedDensity(base: number, zoom: number): number {
  const boost = densityBoost(zoom);
  if (boost <= 1) return clamp(Math.round(base), MIN_PARTICLES, MAX_PARTICLES); // near/at base zoom: exact slider value, no quantization noise
  const boosted = base * boost;
  const quantized = Math.round(boosted / ADAPTIVE_QUANTUM) * ADAPTIVE_QUANTUM;
  return clamp(quantized || base, MIN_PARTICLES, MAX_PARTICLES);
}
