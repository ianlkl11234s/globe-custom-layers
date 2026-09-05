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

export function forgetRuntimeToken() {
  return "";
}
