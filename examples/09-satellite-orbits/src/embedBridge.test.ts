import { describe, expect, it } from "vitest";
import { createMemoryStorage, getEmbedPreferencesFor, installEmbedMemoryStorage, isEmbedModeFor, isTrustedRuntimeTokenMessage } from "./embedBridge";

describe("embed storage isolation", () => {
  it("implements the Storage surface without persisting outside this object", () => {
    const storage = createMemoryStorage();
    storage.setItem("a", "1");
    storage.setItem("b", 2 as unknown as string);
    expect(storage.length).toBe(2);
    expect(storage.getItem("a")).toBe("1");
    expect(storage.key(0)).toBe("a");
    expect(storage.key(2)).toBeNull();
    storage.removeItem("a");
    expect(storage.getItem("a")).toBeNull();
    storage.clear();
    expect(storage.length).toBe(0);
  });

  it("only overrides storage for an explicit embedded window", () => {
    const standalone = { parent: null as unknown, location: { search: "" }, localStorage: { marker: "real" } };
    standalone.parent = standalone;
    expect(isEmbedModeFor(standalone)).toBe(false);
    expect(installEmbedMemoryStorage(standalone)).toBe(true);
    expect(standalone.localStorage).toEqual({ marker: "real" });

    const parent = {};
    const embedded = { parent, location: { search: "?embed=1" } };
    expect(isEmbedModeFor(embedded)).toBe(true);
    expect(installEmbedMemoryStorage(embedded)).toBe(true);
    (embedded as typeof embedded & { localStorage: Storage }).localStorage.setItem("sdk", "memory-only");
    expect((embedded as typeof embedded & { localStorage: Storage }).localStorage.getItem("sdk")).toBe("memory-only");
    expect((parent as { localStorage?: Storage }).localStorage).toBeUndefined();
  });

  it("fails closed when the embedded storage surface cannot be isolated", () => {
    const embedded = Object.freeze({ parent: {}, location: { search: "?embed=1" } });
    expect(installEmbedMemoryStorage(embedded)).toBe(false);
  });

  it("accepts a token only from the expected parent and origin", () => {
    const parent = {} as WindowProxy;
    const origin = "https://demo.example";
    const event = { origin, source: parent, data: { type: "globe-demo:token", token: "pk.test" } };
    expect(isTrustedRuntimeTokenMessage(event, parent, origin)).toBe(true);
    expect(isTrustedRuntimeTokenMessage({ ...event, origin: "https://elsewhere.example" }, parent, origin)).toBe(false);
    expect(isTrustedRuntimeTokenMessage({ ...event, source: null }, parent, origin)).toBe(false);
    expect(isTrustedRuntimeTokenMessage({ ...event, data: null }, parent, origin)).toBe(false);
  });

  it("uses light English preferences by default for an explicit embed", () => {
    const parent = {};
    expect(getEmbedPreferencesFor({ parent, location: { search: "?embed=1" } })).toEqual({
      embed: true, theme: "light", lang: "en",
    });
    expect(getEmbedPreferencesFor({ parent, location: { search: "?embed=1&theme=dark&lang=zh-TW" } })).toEqual({
      embed: true, theme: "dark", lang: "zh-TW",
    });
  });

  it("preserves the standalone dark English defaults", () => {
    const standalone = { parent: null as unknown, location: { search: "?theme=light&lang=zh-TW" } };
    standalone.parent = standalone;
    expect(getEmbedPreferencesFor(standalone)).toEqual({ embed: false, theme: "dark", lang: "en" });
  });
});
