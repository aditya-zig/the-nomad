/**
 * Core utilities for procedural texture generation: seeded PRNG, periodic (seamless) noise fields, a shared
 * noise bank that every material painter samples cheaply, the `TexBuilder` pixel canvas (albedo / ORM / height /
 * emissive), height -> normal-map conversion and DataTexture creation.
 *
 * Performance idea: expensive noise is evaluated ONCE into a small "bank" of periodic fields (512x512). Painters
 * then combine bank samples (with integer offsets / scales, which preserve periodicity) using cheap typed-array
 * lookups instead of evaluating noise per material.
 */
import * as THREE from 'three';

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

/** Integer hash to [0,1). */
export function hash2(x: number, y: number, seed = 0): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
export const sstep = (a: number, b: number, x: number): number => {
  let t = (x - a) / (b - a);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
};

/** Bank field resolution (the period of every bank field, in pixels). */
export const S = 512;
export const SM = S - 1;
export const SS = 9; // log2(S)

// ---------------------------------------------------------------------------------------------
// periodic noise
// ---------------------------------------------------------------------------------------------

/** Adds `amp * valueNoise` (periodic over the tile, quintic interpolation) into `out`. */
export function addValueNoise(out: Float32Array, N: number, cx: number, cy: number, seed: number, amp: number): void {
  const rng = mulberry32(seed);
  const lat = new Float32Array(cx * cy);
  for (let i = 0; i < lat.length; i++) lat[i] = rng();
  const xi0 = new Int32Array(N);
  const xi1 = new Int32Array(N);
  const xw = new Float32Array(N);
  const yi0 = new Int32Array(N);
  const yi1 = new Int32Array(N);
  const yw = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let f = (i * cx) / N;
    let k = Math.floor(f);
    let t = f - k;
    xi0[i] = k % cx;
    xi1[i] = (k + 1) % cx;
    xw[i] = t * t * t * (t * (t * 6 - 15) + 10);
    f = (i * cy) / N;
    k = Math.floor(f);
    t = f - k;
    yi0[i] = k % cy;
    yi1[i] = (k + 1) % cy;
    yw[i] = t * t * t * (t * (t * 6 - 15) + 10);
  }
  for (let y = 0; y < N; y++) {
    const ra = yi0[y]! * cx;
    const rb = yi1[y]! * cx;
    const wy = yw[y]!;
    const o = y * N;
    for (let x = 0; x < N; x++) {
      const x0 = xi0[x]!;
      const x1 = xi1[x]!;
      const a = lat[ra + x0]!;
      const b = lat[ra + x1]!;
      const c = lat[rb + x0]!;
      const d = lat[rb + x1]!;
      const w = xw[x]!;
      const top = a + (b - a) * w;
      const bot = c + (d - c) * w;
      out[o + x]! += amp * (top + (bot - top) * wy);
    }
  }
}

/** Contrast-stretch a field in place so mean -> 0.5 and +-`sigmas` standard deviations span 0..1. */
export function stretch(field: Float32Array, sigmas = 2.4): Float32Array {
  let sum = 0;
  for (let i = 0; i < field.length; i++) sum += field[i]!;
  const mean = sum / field.length;
  let v = 0;
  for (let i = 0; i < field.length; i++) {
    const d = field[i]! - mean;
    v += d * d;
  }
  const sd = Math.sqrt(v / field.length) || 1;
  const k = 0.5 / (sd * sigmas);
  for (let i = 0; i < field.length; i++) {
    const t = 0.5 + (field[i]! - mean) * k;
    field[i] = t < 0 ? 0 : t > 1 ? 1 : t;
  }
  return field;
}

/** Fractal periodic noise, normalised to 0..1. */
export function fbm(N: number, cx: number, cy: number, octaves: number, seed: number, gain = 0.5): Float32Array {
  const out = new Float32Array(N * N);
  let amp = 1;
  let ccx = cx;
  let ccy = cy;
  for (let o = 0; o < octaves; o++) {
    addValueNoise(out, N, ccx, ccy, seed + o * 101, amp);
    amp *= gain;
    ccx *= 2;
    ccy *= 2;
  }
  return stretch(out);
}

export interface WorleyResult {
  /** Distance to the nearest feature point, in cell units. */
  f1: Float32Array;
  /** F2 - F1 in cell units (small near cell borders: use it for cracks / mortar / pebble gaps). */
  edge: Float32Array;
  /** Random 0..1 value per cell. */
  id: Float32Array;
}

/** Periodic cellular (Worley) noise with `cells` x `cells` jittered feature points. */
export function worley(N: number, cells: number, seed: number): WorleyResult {
  const rng = mulberry32(seed);
  const n = cells * cells;
  const fx = new Float32Array(n);
  const fy = new Float32Array(n);
  const fid = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    fx[i] = 0.12 + rng() * 0.76;
    fy[i] = 0.12 + rng() * 0.76;
    fid[i] = rng();
  }
  const f1 = new Float32Array(N * N);
  const edge = new Float32Array(N * N);
  const id = new Float32Array(N * N);
  const scale = cells / N;
  for (let y = 0; y < N; y++) {
    const py = (y + 0.5) * scale;
    const cy = Math.floor(py);
    for (let x = 0; x < N; x++) {
      const px = (x + 0.5) * scale;
      const cx = Math.floor(px);
      let d1 = 1e9;
      let d2 = 1e9;
      let best = 0;
      for (let dj = -1; dj <= 1; dj++) {
        const gy = cy + dj;
        const wy = gy < 0 ? gy + cells : gy >= cells ? gy - cells : gy;
        const rowBase = wy * cells;
        for (let di = -1; di <= 1; di++) {
          const gx = cx + di;
          const wx = gx < 0 ? gx + cells : gx >= cells ? gx - cells : gx;
          const k = rowBase + wx;
          const ddx = px - (gx + fx[k]!);
          const ddy = py - (gy + fy[k]!);
          const d = ddx * ddx + ddy * ddy;
          if (d < d1) {
            d2 = d1;
            d1 = d;
            best = k;
          } else if (d < d2) {
            d2 = d;
          }
        }
      }
      const o = y * N + x;
      const s1 = Math.sqrt(d1);
      f1[o] = s1;
      edge[o] = Math.sqrt(d2) - s1;
      id[o] = fid[best]!;
    }
  }
  return { f1, edge, id };
}

/** Periodic separable box blur (radius in pixels), returns a new field. */
export function blurField(src: Float32Array, N: number, radius: number): Float32Array {
  const tmp = new Float32Array(N * N);
  const out = new Float32Array(N * N);
  const w = radius * 2 + 1;
  for (let y = 0; y < N; y++) {
    const o = y * N;
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += src[o + ((k + N) % N)]!;
    for (let x = 0; x < N; x++) {
      tmp[o + x] = sum / w;
      sum += src[o + ((x + radius + 1) % N)]! - src[o + ((x - radius + N) % N)]!;
    }
  }
  for (let x = 0; x < N; x++) {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += tmp[((k + N) % N) * N + x]!;
    for (let y = 0; y < N; y++) {
      out[y * N + x] = sum / w;
      sum += tmp[((y + radius + 1) % N) * N + x]! - tmp[((y - radius + N) % N) * N + x]!;
    }
  }
  return out;
}

function transpose(src: Float32Array, N: number): Float32Array {
  const out = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) out[x * N + y] = src[y * N + x]!;
  return out;
}

// ---------------------------------------------------------------------------------------------
// noise bank
// ---------------------------------------------------------------------------------------------

export interface NoiseBank {
  /** Big soft blotches (period S). */
  macro: Float32Array;
  /** Medium stains / patches. */
  mid: Float32Array;
  /** Fine, high frequency. */
  fine: Float32Array;
  /** Anisotropic streaks running along Y (rain streaks, drips). */
  streakV: Float32Array;
  /** Anisotropic streaks running along X (brushed metal, wood grain). */
  streakH: Float32Array;
  /** Coarse Worley (cells = 10): large cells for cracks and patches. */
  wf1: Float32Array;
  wedge: Float32Array;
  wid: Float32Array;
  /** Fine Worley (cells = 38): pebbles, chips, tiny cells. */
  vf1: Float32Array;
  vedge: Float32Array;
  vid: Float32Array;
  /** Very coarse Worley edges (cells = 4): sparse long cracks. */
  bedge: Float32Array;
  /** White noise 0..255. */
  white: Uint8Array;
}

let bankCache: NoiseBank | null = null;

export function getBank(): NoiseBank {
  if (bankCache) return bankCache;
  const macro = fbm(S, 3, 3, 4, 11);
  const mid = fbm(S, 7, 7, 5, 23);
  const fine = fbm(S, 24, 24, 4, 37, 0.6);
  const sv = new Float32Array(S * S);
  addValueNoise(sv, S, 120, 6, 401, 1);
  addValueNoise(sv, S, 240, 12, 409, 0.5);
  addValueNoise(sv, S, 60, 3, 419, 0.7);
  stretch(sv);
  const streakH = transpose(sv, S);
  const w1 = worley(S, 10, 71);
  const w2 = worley(S, 38, 83);
  const w0 = worley(S, 4, 97);
  const white = new Uint8Array(S * S);
  const rng = mulberry32(9001);
  for (let i = 0; i < white.length; i++) white[i] = (rng() * 256) | 0;
  bankCache = {
    macro,
    mid,
    fine,
    streakV: sv,
    streakH,
    wf1: w1.f1,
    wedge: w1.edge,
    wid: w1.id,
    vf1: w2.f1,
    vedge: w2.edge,
    vid: w2.id,
    bedge: w0.edge,
    white,
  };
  return bankCache;
}

export function releaseBank(): void {
  bankCache = null;
  bank1kCache = null;
}

/** Extra large-period fields for 1024 px textures (asphalt), so the 8 m tile has unique macro structure. */
export interface Bank1k {
  macro: Float32Array;
  mid: Float32Array;
  crackFine: Float32Array;
}
let bank1kCache: Bank1k | null = null;
export function getBank1k(): Bank1k {
  if (bank1kCache) return bank1kCache;
  const N = 1024;
  const macro = fbm(N, 4, 4, 3, 517);
  const mid = fbm(N, 9, 9, 4, 523);
  const crackFine = worley(N, 22, 541).edge;
  bank1kCache = { macro, mid, crackFine };
  return bank1kCache;
}

// ---------------------------------------------------------------------------------------------
// TexBuilder & texture creation
// ---------------------------------------------------------------------------------------------

/**
 * Pixel canvas for one material. Painters write sRGB albedo (RGBA), an ORM-style map (G = roughness 0..255,
 * B = metalness 0..255), a height field (0..1, 0.5 neutral) and optionally an emissive map.
 */
export class TexBuilder {
  readonly N: number;
  readonly albedo: Uint8ClampedArray;
  readonly orm: Uint8ClampedArray;
  readonly height: Float32Array;
  emissive: Uint8ClampedArray | null = null;

  constructor(N: number, opts: { emissive?: boolean } = {}) {
    this.N = N;
    this.albedo = new Uint8ClampedArray(N * N * 4);
    this.orm = new Uint8ClampedArray(N * N * 4);
    this.height = new Float32Array(N * N).fill(0.5);
    for (let i = 0; i < N * N; i++) {
      this.albedo[i * 4 + 3] = 255;
      this.orm[i * 4] = 255;
      this.orm[i * 4 + 1] = 200;
      this.orm[i * 4 + 3] = 255;
    }
    if (opts.emissive) this.emissive = new Uint8ClampedArray(N * N * 4);
  }

  /** Height field -> tangent-space normal map (OpenGL convention), periodic. `strength` ~ 2..10. */
  toNormal(strength: number): Uint8ClampedArray {
    return heightToNormal(this.height, this.N, strength);
  }
}

export function heightToNormal(h: Float32Array, N: number, strength: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(N * N * 4);
  const s = strength * 0.5;
  for (let y = 0; y < N; y++) {
    const ym = ((y - 1 + N) % N) * N;
    const yp = ((y + 1) % N) * N;
    const yo = y * N;
    for (let x = 0; x < N; x++) {
      const xm = (x - 1 + N) % N;
      const xp = (x + 1) % N;
      const dx = (h[yo + xp]! - h[yo + xm]!) * s;
      const dy = (h[yp + x]! - h[ym + x]!) * s;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const o = (yo + x) * 4;
      out[o] = (-dx * inv * 0.5 + 0.5) * 255;
      out[o + 1] = (-dy * inv * 0.5 + 0.5) * 255;
      out[o + 2] = (inv * 0.5 + 0.5) * 255;
      out[o + 3] = 255;
    }
  }
  return out;
}

export type TextureTracker = <T extends THREE.Texture>(t: T) => T;

/** Create a mipmapped, repeating DataTexture from RGBA8 data. */
export function makeDataTexture(data: Uint8ClampedArray | Uint8Array, w: number, h: number, srgb: boolean): THREE.DataTexture {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const tex = new THREE.DataTexture(bytes, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Build coverage-preserving mip levels for alpha-tested textures (fences): each level's alpha is rescaled so the
 * fraction of texels passing `cutoff` stays constant, keeping thin wires visible at a distance.
 */
export function coverageMips(base: Uint8Array, N: number, cutoff: number): { data: Uint8Array; width: number; height: number }[] {
  const levels: { data: Uint8Array; width: number; height: number }[] = [{ data: base, width: N, height: N }];
  let target = 0;
  const c255 = cutoff * 255;
  for (let i = 3; i < base.length; i += 4) if (base[i]! >= c255) target++;
  target /= N * N;
  let cur = base;
  let size = N;
  while (size > 1) {
    const ns = size >> 1;
    const next = new Uint8Array(ns * ns * 4);
    for (let y = 0; y < ns; y++) {
      for (let x = 0; x < ns; x++) {
        const a = ((2 * y) * size + 2 * x) * 4;
        const b = a + 4;
        const c = a + size * 4;
        const d = c + 4;
        const o = (y * ns + x) * 4;
        for (let k = 0; k < 4; k++) next[o + k] = (cur[a + k]! + cur[b + k]! + cur[c + k]! + cur[d + k]!) >> 2;
      }
    }
    // rescale alpha to keep coverage
    const hist = new Uint32Array(256);
    for (let i = 3; i < next.length; i += 4) hist[next[i]!]!++;
    const total = ns * ns;
    let scale = 1;
    if (target > 0 && target < 1) {
      let lo = 0.5;
      let hi = 40;
      for (let it = 0; it < 18; it++) {
        const mid = (lo + hi) / 2;
        const thr = Math.ceil(c255 / mid);
        let pass = 0;
        for (let v = Math.min(255, thr); v < 256; v++) pass += hist[v]!;
        if (pass / total < target) lo = mid;
        else hi = mid;
      }
      scale = (lo + hi) / 2;
    }
    for (let i = 3; i < next.length; i += 4) next[i] = Math.min(255, next[i]! * scale);
    levels.push({ data: next, width: ns, height: ns });
    cur = next;
    size = ns;
  }
  return levels;
}

// ---------------------------------------------------------------------------------------------
// small painting helpers
// ---------------------------------------------------------------------------------------------

/** Parse '#rrggbb' or 0xrrggbb to [r,g,b] 0..255. */
export function rgb(hex: number): [number, number, number] {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

export interface PaintCtx {
  bank: NoiseBank;
  track: TextureTracker;
  /** Cache for textures shared between several materials (key -> texture). */
  shared: Map<string, THREE.Texture>;
}

/** Build the standard material from a finished TexBuilder. */
export interface FinishOpts {
  tile?: number;
  /** 0 disables the normal map. Ignored when `normalMap` is given. */
  normalStrength?: number;
  normalMap?: THREE.Texture;
  /** Multiplies the roughness map (default 1). */
  roughness?: number;
  /** Use the ORM blue channel as metalness. */
  metal?: boolean;
  params?: THREE.MeshStandardMaterialParameters;
  normalScale?: number;
}

/** Average 2x2 texels (roughness / metalness are low-frequency; halving them saves memory and upload time). */
function halveOrm(src: Uint8ClampedArray, n: number): Uint8ClampedArray {
  const h = n >> 1;
  const out = new Uint8ClampedArray(h * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < h; x++) {
      const a = (2 * y * n + 2 * x) * 4;
      const b = a + 4;
      const c = a + n * 4;
      const d = c + 4;
      const o = (y * h + x) * 4;
      out[o] = 255;
      out[o + 1] = (src[a + 1]! + src[b + 1]! + src[c + 1]! + src[d + 1]!) >> 2;
      out[o + 2] = (src[a + 2]! + src[b + 2]! + src[c + 2]! + src[d + 2]!) >> 2;
      out[o + 3] = 255;
    }
  }
  return out;
}

export function finishMaterial(ctx: PaintCtx, tb: TexBuilder, opts: FinishOpts = {}): THREE.MeshStandardMaterial {
  const N = tb.N;
  const map = ctx.track(makeDataTexture(tb.albedo, N, N, true));
  const orm = N >= 512 ? ctx.track(makeDataTexture(halveOrm(tb.orm, N), N >> 1, N >> 1, false)) : ctx.track(makeDataTexture(tb.orm, N, N, false));
  let normal: THREE.Texture | undefined = opts.normalMap;
  if (!normal && (opts.normalStrength ?? 0) > 0) {
    normal = ctx.track(makeDataTexture(tb.toNormal(opts.normalStrength!), N, N, false));
  }
  const m = new THREE.MeshStandardMaterial({
    map,
    roughnessMap: orm,
    roughness: opts.roughness ?? 1,
    metalness: opts.metal ? 1 : 0,
    ...(opts.metal ? { metalnessMap: orm } : {}),
    ...(normal ? { normalMap: normal } : {}),
    ...(opts.params ?? {}),
  });
  if (normal && opts.normalScale !== undefined) m.normalScale.set(opts.normalScale, opts.normalScale);
  if (tb.emissive) {
    m.emissiveMap = ctx.track(makeDataTexture(tb.emissive, N, N, true));
    m.emissive.set(0xffffff);
  }
  if (opts.tile) m.userData.tile = opts.tile;
  return m;
}
