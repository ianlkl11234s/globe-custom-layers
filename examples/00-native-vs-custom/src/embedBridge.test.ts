import { describe, expect, it } from "vitest";
import { createMemoryStorage, getEmbedPreferencesFor, installEmbedMemoryStorage, isTrustedRuntimeTokenMessage } from "./embedBridge";

describe("embedded field-guide bridge", () => {
  it("uses isolated in-memory storage", () => {
    const parent = {};
    const embedded = { parent, location: { search: "?embed=1" } };
    expect(installEmbedMemoryStorage(embedded)).toBe(true);
    const storage = (embedded as typeof embedded & { localStorage: Storage }).localStorage;
    storage.setItem("sdk", "memory-only");
    expect(storage.getItem("sdk")).toBe("memory-only");
    expect((parent as { localStorage?: Storage }).localStorage).toBeUndefined();
  });

  it("accepts runtime tokens only from the expected parent and origin", () => {
    const parent = {} as WindowProxy;
    const origin = "https://demo.example";
    const event = { origin, source: parent, data: { type: "globe-demo:token", token: "pk.test" } };
    expect(isTrustedRuntimeTokenMessage(event, parent, origin)).toBe(true);
    expect(isTrustedRuntimeTokenMessage({ ...event, origin: "https://elsewhere.example" }, parent, origin)).toBe(false);
    expect(isTrustedRuntimeTokenMessage({ ...event, source: null }, parent, origin)).toBe(false);
  });

  it("keeps standalone English and reads embedded language", () => {
    const standalone = { parent: null as unknown, location: { search: "?lang=zh-TW" } };
    standalone.parent = standalone;
    expect(getEmbedPreferencesFor(standalone)).toEqual({ embed: false, lang: "en", theme: "dark" });
    expect(getEmbedPreferencesFor({ parent: {}, location: { search: "?embed=1&lang=zh-TW" } })).toEqual({ embed: true, lang: "zh-TW", theme: "light" });
    expect(getEmbedPreferencesFor({ parent: {}, location: { search: "?embed=1&theme=dark" } })).toEqual({ embed: true, lang: "en", theme: "dark" });
    expect(createMemoryStorage().length).toBe(0);
  });
});
