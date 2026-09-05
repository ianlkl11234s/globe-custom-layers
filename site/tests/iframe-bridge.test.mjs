import assert from "node:assert/strict";
import test from "node:test";
import { forgetRuntimeToken, isTrustedReadyEvent, unloadFrame } from "../bridgeState.js";

test("accepts ready only from the current same-origin iframe", () => {
  const frame = { contentWindow: { id: "current" } };
  const expectedOrigin = "http://localhost:4173";
  assert.equal(isTrustedReadyEvent({ origin: expectedOrigin, source: frame.contentWindow, data: { type: "globe-demo:ready" } }, frame, expectedOrigin), true);
  assert.equal(isTrustedReadyEvent({ origin: "https://elsewhere.invalid", source: frame.contentWindow, data: { type: "globe-demo:ready" } }, frame, expectedOrigin), false);
  assert.equal(isTrustedReadyEvent({ origin: expectedOrigin, source: { id: "stale" }, data: { type: "globe-demo:ready" } }, frame, expectedOrigin), false);
});

test("forgetting a live scene clears its token state and unloads its iframe", () => {
  const stage = { hidden: false };
  const frame = { src: "./examples/01-points-on-globe/index.html?embed=1", removed: false, remove() { this.removed = true; } };
  assert.equal(forgetRuntimeToken(), "");
  assert.equal(unloadFrame(frame, stage), null);
  assert.equal(frame.src, "about:blank");
  assert.equal(frame.removed, true);
  assert.equal(stage.hidden, true);
});
