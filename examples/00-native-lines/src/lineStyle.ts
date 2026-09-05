export interface LineControls { width: number; opacity: number; color: string }

export const DEFAULT_LINE_CONTROLS: LineControls = { width: 2, opacity: 0.8, color: "#43d6c7" };

export function clampLineControls(next: Partial<LineControls>): LineControls {
  return {
    width: Math.max(0.5, Math.min(12, next.width ?? DEFAULT_LINE_CONTROLS.width)),
    opacity: Math.max(0.05, Math.min(1, next.opacity ?? DEFAULT_LINE_CONTROLS.opacity)),
    color: /^#[0-9a-f]{6}$/i.test(next.color ?? "") ? next.color! : DEFAULT_LINE_CONTROLS.color,
  };
}
