/** Deterministic PRNG and cheap value noise used to bake zombie appearance and per-instance variation. */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer lattice hash -> [0, 1). */
export function ihash(x: number, y: number, z: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const smooth = (t: number): number => t * t * (3 - 2 * t);

/** Trilinear value noise in [0, 1). */
export function noise3(x: number, y: number, z: number, seed = 0): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = smooth(x - ix);
  const fy = smooth(y - iy);
  const fz = smooth(z - iz);
  const s = seed * 131;
  const a = ihash(ix + s, iy, iz);
  const b = ihash(ix + 1 + s, iy, iz);
  const c = ihash(ix + s, iy + 1, iz);
  const d = ihash(ix + 1 + s, iy + 1, iz);
  const e = ihash(ix + s, iy, iz + 1);
  const f = ihash(ix + 1 + s, iy, iz + 1);
  const g = ihash(ix + s, iy + 1, iz + 1);
  const h = ihash(ix + 1 + s, iy + 1, iz + 1);
  const x00 = a + (b - a) * fx;
  const x10 = c + (d - c) * fx;
  const x01 = e + (f - e) * fx;
  const x11 = g + (h - g) * fx;
  const y0 = x00 + (x10 - x00) * fy;
  const y1 = x01 + (x11 - x01) * fy;
  return y0 + (y1 - y0) * fz;
}

/** 3-octave fractal noise in [0, 1). */
export function fbm3(x: number, y: number, z: number, seed = 0): number {
  return noise3(x, y, z, seed) * 0.55 + noise3(x * 2.1, y * 2.1, z * 2.1, seed + 7) * 0.3 + noise3(x * 4.3, y * 4.3, z * 4.3, seed + 13) * 0.15;
}

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
