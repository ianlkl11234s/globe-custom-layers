import { describe, expect, it } from "vitest";
import {
  ADAPTIVE_BASE_ZOOM,
  ADAPTIVE_QUANTUM,
  MAX_PARTICLES,
  MIN_PARTICLES,
  quantizedDensity,
  rawDensity,
} from "./adaptiveDensity";

describe("quantizedDensity", () => {
  it("equals the base count exactly at and above ADAPTIVE_BASE_ZOOM", () => {
    expect(quantizedDensity(8000, ADAPTIVE_BASE_ZOOM)).toBe(8000);
    expect(quantizedDensity(8000, ADAPTIVE_BASE_ZOOM + 3)).toBe(8000);
  });

  it("only changes on quantum boundaries across a dense, continuous zoom sweep", () => {
    const base = 8000;
    const seen = new Set<number>();
    for (let zoom = 0; zoom <= ADAPTIVE_BASE_ZOOM; zoom += 0.01) {
      seen.add(quantizedDensity(base, zoom));
    }
    // ~550 distinct zoom samples went in; if every one produced a
    // different particle count, quantization would be doing nothing.
    expect(seen.size).toBeLessThan(30);
  });

  it("is a step function: within one quantum-sized zoom range the count is identical, not merely close", () => {
    const base = 8000;
    const a = quantizedDensity(base, 2.0);
    const b = quantizedDensity(base, 2.001);
    const c = quantizedDensity(base, 2.005);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("every output is a multiple of ADAPTIVE_QUANTUM once boosted (away from the base-zoom exact case)", () => {
    for (let zoom = 0; zoom < ADAPTIVE_BASE_ZOOM; zoom += 0.7) {
      const d = quantizedDensity(6000, zoom);
      if (d === 6000) continue; // base-zoom edge case, exact by design
      expect(d % ADAPTIVE_QUANTUM).toBe(0);
    }
  });

  it("never exceeds MAX_PARTICLES or drops below MIN_PARTICLES", () => {
    expect(quantizedDensity(MAX_PARTICLES * 10, 0)).toBeLessThanOrEqual(MAX_PARTICLES);
    expect(quantizedDensity(1, 0)).toBeGreaterThanOrEqual(MIN_PARTICLES);
  });

  it("boosts monotonically as zoom decreases (never fewer particles from zooming further out)", () => {
    const base = 4000;
    let prev = quantizedDensity(base, ADAPTIVE_BASE_ZOOM);
    for (let zoom = ADAPTIVE_BASE_ZOOM - 0.5; zoom >= 0; zoom -= 0.5) {
      const cur = quantizedDensity(base, zoom);
      expect(cur).toBeGreaterThanOrEqual(prev);
      prev = cur;
    }
  });
});

describe("rawDensity vs quantizedDensity", () => {
  it("the raw (unquantized) variant produces far more distinct values across the same zoom sweep", () => {
    const base = 8000;
    const rawSeen = new Set<number>();
    const quantSeen = new Set<number>();
    for (let zoom = 0; zoom <= ADAPTIVE_BASE_ZOOM; zoom += 0.01) {
      rawSeen.add(rawDensity(base, zoom));
      quantSeen.add(quantizedDensity(base, zoom));
    }
    expect(rawSeen.size).toBeGreaterThan(quantSeen.size * 3);
  });

  it("both variants agree at the base zoom (no boost applied)", () => {
    expect(rawDensity(5000, ADAPTIVE_BASE_ZOOM)).toBe(quantizedDensity(5000, ADAPTIVE_BASE_ZOOM));
  });
});
