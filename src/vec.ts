/** Tiny 3-vector helpers. World axes: x = east/right, y = up, z = north/forward. */
export type Vec3 = readonly [number, number, number];
export type RGB = readonly [number, number, number];

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const length = (a: Vec3): number => Math.sqrt(dot(a, a));
export const normalize = (a: Vec3): Vec3 => {
  const n = length(a);
  return n < 1e-9 ? [0, 0, 0] : scale(a, 1 / n);
};
export const dist = (a: Vec3, b: Vec3): number => length(sub(a, b));
export const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/**
 * (forward, right, up) for the given angles in radians.
 * yaw 0 faces +z and positive yaw turns toward +x; positive pitch is nose up;
 * positive roll banks to the right (right wing down).
 */
export function eulerBasis(yaw: number, pitch: number, roll: number): [Vec3, Vec3, Vec3] {
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const fwd0: Vec3 = [sy, 0, cy], right0: Vec3 = [cy, 0, -sy], up0: Vec3 = [0, 1, 0];

  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const fwd = add(scale(fwd0, cp), scale(up0, sp));
  let up = add(scale(up0, cp), scale(fwd0, -sp));

  const cr = Math.cos(roll), sr = Math.sin(roll);
  const right = add(scale(right0, cr), scale(up, -sr));
  up = add(scale(up, cr), scale(right0, sr));
  return [fwd, right, up];
}
