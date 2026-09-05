export type RuntimeTokenMessage = { type: "globe-demo:token"; token: string };
type StorageHost = { parent: unknown; location: { search: string } } & object;
const isolatedStorageHosts = new WeakSet<object>();

export type EmbedLanguage = "zh-TW" | "en";
export type EmbedTheme = "light" | "dark";
export interface EmbedPreferences { embed: boolean; lang: EmbedLanguage; theme: EmbedTheme }

export function isEmbedModeFor(host: StorageHost): boolean {
  return host.parent !== host && new URLSearchParams(host.location.search).get("embed") === "1";
}

export function getEmbedPreferencesFor(host: StorageHost): EmbedPreferences {
  const embed = isEmbedModeFor(host);
  const params = new URLSearchParams(host.location.search);
  return {
    embed,
    lang: embed && params.get("lang") === "zh-TW" ? "zh-TW" : "en",
    theme: embed ? (params.get("theme") === "dark" ? "dark" : "light") : "dark",
  };
}

export function getEmbedPreferences(): EmbedPreferences {
  return getEmbedPreferencesFor(window);
}

export function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(String(key)) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(String(key)),
    setItem: (key, value) => values.set(String(key), String(value)),
  };
}

export function installEmbedMemoryStorage(host: StorageHost = window): boolean {
  if (!isEmbedModeFor(host)) return true;
  if (isolatedStorageHosts.has(host)) return true;
  try {
    const storage = createMemoryStorage();
    Object.defineProperty(host, "localStorage", { configurable: true, enumerable: true, get: () => storage });
    isolatedStorageHosts.add(host);
    return true;
  } catch {
    return false;
  }
}

export function isEmbedMode(): boolean {
  return isEmbedModeFor(window);
}

export function reportEmbedMapStatus(status: "loaded" | "error", code?: number): void {
  if (!isEmbedMode()) return;
  window.parent.postMessage({ type: "globe-demo:map-status", status, ...(code ? { code } : {}) }, window.location.origin);
}

export function isTrustedRuntimeTokenMessage(
  event: Pick<MessageEvent, "origin" | "source" | "data">,
  expectedParent: WindowProxy,
  expectedOrigin: string,
): event is Pick<MessageEvent, "origin" | "source"> & { data: RuntimeTokenMessage } {
  return event.origin === expectedOrigin
    && event.source === expectedParent
    && typeof event.data === "object"
    && event.data !== null
    && event.data.type === "globe-demo:token"
    && typeof event.data.token === "string"
    && event.data.token.length > 0;
}

export function getEmbeddedRuntimeToken(fallback: string): Promise<string> {
  if (!isEmbedMode()) return Promise.resolve(fallback);
  if (!installEmbedMemoryStorage()) {
    reportEmbedMapStatus("error");
    return new Promise<string>(() => {});
  }
  if (fallback) return Promise.resolve(fallback);
  const expectedOrigin = window.location.origin;
  return new Promise((resolve) => {
    const receive = (event: MessageEvent) => {
      if (!isTrustedRuntimeTokenMessage(event, window.parent, expectedOrigin)) return;
      window.removeEventListener("message", receive);
      resolve(event.data.token);
    };
    window.addEventListener("message", receive);
    window.parent.postMessage({ type: "globe-demo:ready" }, expectedOrigin);
  });
}
