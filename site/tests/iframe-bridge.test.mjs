import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { forgetRuntimeToken, isPublicMapboxToken, isTrustedReadyEvent, readRuntimeToken, RUNTIME_TOKEN_KEY, saveRuntimeToken, unloadFrame } from "../bridgeState.js";

function memorySession() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
}

test("accepts ready only from the current same-origin iframe", () => {
  const frame = { contentWindow: { id: "current" } };
  const expectedOrigin = "http://localhost:4173";
  assert.equal(isTrustedReadyEvent({ origin: expectedOrigin, source: frame.contentWindow, data: { type: "globe-demo:ready" } }, frame, expectedOrigin), true);
  assert.equal(isTrustedReadyEvent({ origin: "https://elsewhere.invalid", source: frame.contentWindow, data: { type: "globe-demo:ready" } }, frame, expectedOrigin), false);
  assert.equal(isTrustedReadyEvent({ origin: expectedOrigin, source: { id: "stale" }, data: { type: "globe-demo:ready" } }, frame, expectedOrigin), false);
});

test("explicit forgetting clears session token state and unloads its iframe", () => {
  const session = memorySession();
  assert.equal(saveRuntimeToken(session, "pk.session-only"), "pk.session-only");
  assert.equal(readRuntimeToken(session), "pk.session-only");
  const stage = { hidden: false };
  const frame = { src: "./examples/01-points-on-globe/index.html?embed=1", removed: false, remove() { this.removed = true; } };
  assert.equal(forgetRuntimeToken(session), "");
  assert.equal(session.getItem(RUNTIME_TOKEN_KEY), null);
  assert.equal(unloadFrame(frame, stage), null);
  assert.equal(frame.src, "about:blank");
  assert.equal(frame.removed, true);
  assert.equal(stage.hidden, true);
});

test("only public pk tokens enter session storage", () => {
  const session = memorySession();
  assert.equal(isPublicMapboxToken("pk.public"), true);
  assert.equal(isPublicMapboxToken("sk.secret"), false);
  assert.equal(saveRuntimeToken(session, "sk.secret"), "");
  assert.equal(readRuntimeToken(session), "");
});

test("sidebar exposes a session token form and an explicit forget control", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /id="sidebar-token-form"/);
  assert.match(html, /id="sidebar-token"/);
  assert.match(html, /id="forget-token"/);
});
