export interface EcefPoint { x: number; y: number; z: number; }

/** Whether the camera-to-point segment stays outside the globe sphere. */
export function isEcefPointVisible(camera: EcefPoint, target: EcefPoint, radius: number): boolean {
  const sx = target.x - camera.x, sy = target.y - camera.y, sz = target.z - camera.z;
  const denominator = sx * sx + sy * sy + sz * sz;
  const t = denominator === 0 ? 0 : Math.max(0, Math.min(1, -(camera.x * sx + camera.y * sy + camera.z * sz) / denominator));
  const x = camera.x + sx * t, y = camera.y + sy * t, z = camera.z + sz * t;
  return Math.hypot(x, y, z) >= radius;
}
