export function isTrustedReadyEvent(event, frame, expectedOrigin) {
  return event.origin === expectedOrigin
    && event.source === frame.contentWindow
    && event.data?.type === "globe-demo:ready";
}

export function unloadFrame(frame, stage) {
  if (!frame) return null;
  frame.src = "about:blank";
  frame.remove();
  stage.hidden = true;
  return null;
}

export const RUNTIME_TOKEN_KEY = "gcl.mapbox-public-token";

function usableStorage(storage) {
  return storage && typeof storage.getItem === "function" && typeof storage.setItem === "function" && typeof storage.removeItem === "function";
}

export function isPublicMapboxToken(value) {
  return typeof value === "string" && value.startsWith("pk.") && value.length > 3;
}

export function readRuntimeToken(storage) {
  if (!usableStorage(storage)) return "";
  try {
    const token = storage.getItem(RUNTIME_TOKEN_KEY) ?? "";
    return isPublicMapboxToken(token) ? token : "";
  } catch {
    return "";
  }
}

export function saveRuntimeToken(storage, value) {
  if (!usableStorage(storage) || !isPublicMapboxToken(value)) return "";
  try {
    storage.setItem(RUNTIME_TOKEN_KEY, value);
    return value;
  } catch {
    return "";
  }
}

export function forgetRuntimeToken(storage) {
  if (usableStorage(storage)) {
    try { storage.removeItem(RUNTIME_TOKEN_KEY); } catch { /* session storage can be unavailable */ }
  }
  return "";
}
