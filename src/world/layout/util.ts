import type { Rng } from '../../logic/rng';
import type { LevelBuilder } from '../builder';
import type { MaterialLib } from '../materials';
import type { LevelDataBuilder } from './data';

export interface Ctx {
  b: LevelBuilder;
  d: LevelDataBuilder;
  rng: Rng;
  mats: MaterialLib;
  /** Footprints of things placed so far, used to keep procedural scatter from overlapping. */
  placed: { x: number; z: number; r: number }[];
}

/** ISO container dimensions (metres). */
export const CL = 12.19;
export const CS = 6.06;
export const CW = 2.44;
export const CH = 2.59;

export const HALF_PI = Math.PI / 2;

/** True when a circle at (x,z,r) does not overlap anything already recorded in `placed`. */
export function isFree(c: Ctx, x: number, z: number, r: number): boolean {
  for (const p of c.placed) {
    const dx = p.x - x;
    const dz = p.z - z;
    const rr = p.r + r;
    if (dx * dx + dz * dz < rr * rr) return false;
  }
  return true;
}

export function reserve(c: Ctx, x: number, z: number, r: number): void {
  c.placed.push({ x, z, r });
}

/** Call fn for evenly spaced points along a segment (inclusive of the start, exclusive of the end). */
export function along(x0: number, z0: number, x1: number, z1: number, spacing: number, fn: (x: number, z: number, i: number, angle: number) => void): void {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const L = Math.hypot(dx, dz);
  const n = Math.max(1, Math.floor(L / spacing));
  const angle = Math.atan2(-dz, dx);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    fn(x0 + dx * t, z0 + dz * t, i, angle);
  }
}
