import { describe, expect, it } from "vitest";
import { companionCircleRadiusExpression } from "./nativeCompanionLayer";

/**
 * Regression guard for a bug an earlier draft of this example almost shipped
 * with: `["zoom"]` may ONLY be used as the input to a TOP-LEVEL
 * `interpolate`/`step` expression -- Mapbox's style spec rejects it (at
 * `addLayer()` time, with
 * `"zoom" expression may only be used as input to a top-level "step" or
 * "interpolate" expression") if it's nested inside anything else, such as a
 * `*` multiply. That failure mode is invisible to `tsc` (the expression's
 * TypeScript type, `ExpressionSpecification = [string, ...any[]]`, accepts
 * both the valid and the invalid shape) and invisible to `vitest` unless a
 * test actually inspects the expression's structure -- neither catches a
 * style-spec violation that only surfaces inside a running Mapbox GL
 * instance. This test is that inspection, run without needing one.
 *
 * See `companionCircleRadiusExpression`'s own docstring in
 * nativeCompanionLayer.ts for the full story.
 */
describe("companionCircleRadiusExpression", () => {
  it("is a top-level interpolate expression", () => {
    const expr = companionCircleRadiusExpression();
    expect(expr[0]).toBe("interpolate");
  });

  it("uses ['zoom'] (not ['get', 'sizeNorm'] or anything else) as its top-level input", () => {
    const expr = companionCircleRadiusExpression();
    // Style-spec shape: ["interpolate", <interpolation>, <input>, stop, value, ...]
    // -- index 2 is the input expression.
    expect(expr[2]).toEqual(["zoom"]);
  });

  it("never nests a ['zoom', ...] expression anywhere below the top level", () => {
    // Walks the whole expression tree looking for a second "zoom" -- the
    // exact shape of the bug this test exists to catch (a zoom-interpolate
    // living inside a "*" multiply one level down).
    function containsNestedZoom(node: unknown, depth: number): boolean {
      if (!Array.isArray(node)) return false;
      if (depth > 0 && node[0] === "zoom") return true;
      return node.some((child) => containsNestedZoom(child, depth + 1));
    }
    const expr = companionCircleRadiusExpression();
    // depth starts at 0 for the expression itself; its own top-level
    // ["zoom"] input (checked above) sits at depth 1, which is exactly the
    // ONE place a "zoom" node is allowed -- everywhere else, at any depth,
    // it must not appear.
    const [, , zoomInput, ...stopsAndValues] = expr;
    expect(zoomInput).toEqual(["zoom"]);
    for (const node of stopsAndValues) {
      expect(containsNestedZoom(node, 1)).toBe(false);
    }
  });

  it("every zoom-stop output, once sizeNorm resolves to a fixed value, produces a plausible pixel radius", () => {
    // Can't run a real style-expression evaluator without mapbox-gl's
    // internals, but the multiplier stops are plain numeric literals
    // (`["*", <constant>, sizeFromNorm]`) -- pull them out positionally and
    // sanity-check the constants themselves, which is what actually
    // encodes the pow(1.4, zoom-3) approximation described in the
    // docstring.
    const expr = companionCircleRadiusExpression();
    const stops = expr.slice(3); // [zoomStop0, outputExpr0, zoomStop1, outputExpr1, ...]
    const multipliers: number[] = [];
    for (let i = 1; i < stops.length; i += 2) {
      const outputExpr = stops[i] as [string, number, unknown];
      expect(outputExpr[0]).toBe("*");
      multipliers.push(outputExpr[1]);
    }
    // Monotonically non-decreasing, and bounded to roughly the shader's
    // clamp(pow(1.4, zoom-3), 0.35, 4) range -- see glowPointsScene.ts.
    expect(multipliers[0]).toBeGreaterThan(0.3);
    expect(multipliers[multipliers.length - 1]).toBeCloseTo(4, 5);
    for (let i = 1; i < multipliers.length; i++) {
      expect(multipliers[i]!).toBeGreaterThanOrEqual(multipliers[i - 1]!);
    }
  });
});
