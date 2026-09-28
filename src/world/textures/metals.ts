/**
 * Metal, rubber, glass, fence and vehicle / container paint painters.
 */
import * as THREE from 'three';
import {
  type PaintCtx,
  SM,
  SS,
  TexBuilder,
  clamp,
  coverageMips,
  finishMaterial,
  hash2,
  makeDataTexture,
  mix,
  sstep,
} from './core';

const N = 512;
const MASK = N * N - 1;

// ---------------------------------------------------------------------------------------------
// steel / rust / rubber
// ---------------------------------------------------------------------------------------------

export function paintSteel(ctx: PaintCtx, dark: boolean): THREE.MeshStandardMaterial {
  const tb = new TexBuilder(N);
  const { bank } = ctx;
  const { albedo, orm, height } = tb;
  const base = dark ? 74 : 152;
  for (let y = 0; y < N; y++) {
    const rowB = y << SS;
    const rowB2 = ((y * 3 + 40) & SM) << SS;
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const bi = rowB | x;
      const sh = bank.streakH[bi]!;
      const sh2 = bank.streakH[rowB2 | ((x * 2 + 9) & SM)]!;
      const mac = bank.macro[bi]!;
      const md = bank.mid[(bi + 2500) & MASK]!;
      const wn = bank.white[bi]! / 255;
      let v = base + (sh - 0.5) * (dark ? 20 : 38) + (sh2 - 0.5) * (dark ? 12 : 22) + (mac - 0.5) * (dark ? 12 : 22);
      const scratch = sstep(0.9, 0.96, sh2) * 0.9;
      v += scratch * (dark ? 34 : 26);
      const smudge = sstep(0.66, 0.84, md);
      v -= smudge * (dark ? 6 : 14);
      const o = i * 4;
      albedo[o] = v * 0.97;
      albedo[o + 1] = v * 1.0;
      albedo[o + 2] = v * 1.06 + 2;
      orm[o + 1] = (dark ? 120 : 84) + sh * 44 + smudge * 60 - scratch * 20;
      orm[o + 2] = dark ? 236 : 245;
      height[i] = 0.5 + (sh - 0.5) * 0.16 + (wn - 0.5) * 0.03 - scratch * 0.15;
    }
  }
  return finishMaterial(ctx, tb, { tile: 2, normalStrength: 2, metal: true });
}

export function paintRust(ctx: PaintCtx): THREE.MeshStandardMaterial {
  const tb = new TexBuilder(N);
  const { bank } = ctx;
  const { albedo, orm, height } = tb;
  for (let y = 0; y < N; y++) {
    const rowB = y << SS;
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const bi = rowB | x;
      const mac = bank.macro[bi]!;
      const md = bank.mid[(bi + 77) & MASK]!;
      const fn = bank.fine[bi]!;
      const wn = bank.white[bi]! / 255;
      const id = bank.vid[bi]!;
      const edge = bank.vedge[bi]!;
      const flake = sstep(0.0, 0.16, edge);
      // three-tone oxide: dark, orange, light tan flake tops
      const t = clamp(mac * 0.5 + md * 0.4 + (id - 0.5) * 0.3, 0, 1);
      let r = mix(64, 168, t);
      let g = mix(38, 100, t);
      let b = mix(26, 54, t);
      const shade = 0.7 + flake * 0.3 + (fn - 0.5) * 0.3 + (wn - 0.5) * 0.15;
      r *= shade;
      g *= shade;
      b *= shade;
      // patches of bare dark steel
      const bare = sstep(0.86, 0.94, bank.mid[(bi + 5150) & MASK]!) * 0.6;
      r = mix(r, 70, bare * 0.6);
      g = mix(g, 66, bare * 0.6);
      b = mix(b, 62, bare * 0.6);
      const o = i * 4;
      albedo[o] = r;
      albedo[o + 1] = g;
      albedo[o + 2] = b;
      orm[o + 1] = 205 + (fn - 0.5) * 60 - bare * 90;
      orm[o + 2] = 40 + bare * 180;
      height[i] = 0.4 + flake * 0.3 + (fn - 0.5) * 0.3 + (wn - 0.5) * 0.12 - (wn < 0.02 ? 0.15 : 0);
    }
  }
  return finishMaterial(ctx, tb, { tile: 2, normalStrength: 5, metal: true });
}

export function paintRubber(ctx: PaintCtx): THREE.MeshStandardMaterial {
  const n = 256;
  const tb = new TexBuilder(n);
  const { bank } = ctx;
  const { albedo, orm, height } = tb;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const bi = ((y * 2) << SS) | ((x * 2) & SM);
      const fn = bank.fine[bi]!;
      const wn = bank.white[bi]! / 255;
      const mac = bank.macro[bi]!;
      const v = 20 + (fn - 0.5) * 10 + (wn - 0.5) * 8 + sstep(0.65, 0.85, mac) * 8;
      const o = i * 4;
      albedo[o] = v;
      albedo[o + 1] = v;
      albedo[o + 2] = v * 1.05 + 1;
      orm[o + 1] = 232 + (wn - 0.5) * 30;
      height[i] = 0.5 + (fn - 0.5) * 0.3 + (wn - 0.5) * 0.1;
    }
  }
  return finishMaterial(ctx, tb, { tile: 1.2, normalStrength: 2.4 });
}

export function paintTire(ctx: PaintCtx): THREE.MeshStandardMaterial {
  const n = 256;
  const tb = new TexBuilder(n);
  const { bank } = ctx;
  const { albedo, orm, height } = tb;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const bi = ((y * 2) << SS) | ((x * 2) & SM);
      const fn = bank.fine[bi]!;
      const wn = bank.white[bi]! / 255;
      const md = bank.mid[bi]!;
      const groove = 0.5 + 0.5 * Math.cos((y / n) * Math.PI * 2 * 6);
      const dust = sstep(0.62, 0.85, md) * 12;
      const v = 17 + (fn - 0.5) * 8 + (wn - 0.5) * 6 + dust + groove * 2;
      const o = i * 4;
      albedo[o] = v;
      albedo[o + 1] = v;
      albedo[o + 2] = v * 1.04 + 1;
      orm[o + 1] = 225 + (fn - 0.5) * 40;
      height[i] = 0.5 + groove * 0.2 + (fn - 0.5) * 0.15;
    }
  }
  return finishMaterial(ctx, tb, { normalStrength: 3 });
}

// ---------------------------------------------------------------------------------------------
// grating, hazard, chain-link
// ---------------------------------------------------------------------------------------------

export function paintGrating(ctx: PaintCtx): THREE.MeshStandardMaterial {
  const tb = new TexBuilder(N);
  const { bank } = ctx;
  const { albedo, orm, height } = tb;
  const pitch = N / 40;
  const cross = pitch * 4;
  for (let y = 0; y < N; y++) {
    const rowB = y << SS;
    const cy = y % cross;
    const dCross = Math.min(cy, cross - cy);
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const bi = rowB | x;
      const px = x % pitch;
      const dBar = Math.min(px, pitch - px);
      const bar = 1 - sstep(1.3, 2.2, dBar); // load-bearing bars along Y
      const cbar = (1 - sstep(1.1, 1.9, dCross)) * 0.9; // cross rods
      const solid = Math.max(bar, cbar);
      const md = bank.mid[(bi + 313) & MASK]!;
      const fn = bank.fine[bi]!;
      const wn = bank.white[bi]! / 255;
      const rust = sstep(0.6, 0.82, md) * (0.5 + 0.5 * fn);
      let v = 112 + (fn - 0.5) * 26 + (wn - 0.5) * 10;
      let r = v * 0.97;
      let g = v * 1.0;
      let b = v * 1.05 + 2;
      r = mix(r, 122, rust * 0.7);
      g = mix(g, 74, rust * 0.7);
      b = mix(b, 44, rust * 0.7);
      v = 20 + (fn - 0.5) * 6;
      r = mix(v, r, solid);
      g = mix(v, g, solid);
      b = mix(v * 1.1, b, solid);
      const o = i * 4;
      albedo[o] = r;
      albedo[o + 1] = g;
      albedo[o + 2] = b;
      orm[o + 1] = 130 + rust * 80 + (fn - 0.5) * 40;
      orm[o + 2] = (1 - rust * 0.7) * 205;
      height[i] = 0.1 + solid * 0.85;
    }
  }
  return finishMaterial(ctx, tb, { tile: 1.5, normalStrength: 5, metal: true });
}

export function paintHazard(ctx: PaintCtx): THREE.MeshStandardMaterial {
  const tb = new TexBuilder(N);
  const { bank } = ctx;
  const { albedo, orm, height } = tb;
  const stripes = 4;
  for (let y = 0; y < N; y++) {
    const rowB = y << SS;
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const bi = rowB | x;
      const t = (((x + y) / N) * stripes) % 1;
      const edge = Math.min(t, Math.abs(t - 0.5), 1 - t);
      const isY = t < 0.5 ? 1 : 0;
      const aa = sstep(0, 0.006, edge);
      const mac = bank.macro[bi]!;
      const md = bank.mid[(bi + 444) & MASK]!;
      const fn = bank.fine[bi]!;
      const wn = bank.white[bi]! / 255;
      const sh = bank.streakH[(bi + 1200) & MASK]!;
      const yy = mix(28, 194, isY * aa + (1 - aa) * 0.5) + (mac - 0.5) * 20;
      const yg = mix(28, 156, isY * aa + (1 - aa) * 0.5) + (mac - 0.5) * 16;
      const yb = mix(30, 30, 0);
      let r = yy * (0.9 + fn * 0.2);
      let g = yg * (0.9 + fn * 0.2);
      let b = yb * (0.9 + fn * 0.2) + (isY ? 0 : 2);
      // dirt, chips and scuffs
      const dirt = sstep(0.62, 0.86, md) * 0.35;
      r *= 1 - dirt;
      g *= 1 - dirt;
      b *= 1 - dirt * 0.5;
      const chip = sstep(0.78, 0.88, wn * 0.4 + fn * 0.4 + bank.vf1[bi]! * 0.2);
      const scuff = sstep(0.85, 0.95, sh) * 0.6;
      const bare = clamp(chip * 0.8 + scuff, 0, 1);
      r = mix(r, 116, bare * 0.75);
      g = mix(g, 118, bare * 0.75);
      b = mix(b, 118, bare * 0.75);
      const o = i * 4;
      albedo[o] = r;
      albedo[o + 1] = g;
      albedo[o + 2] = b;
      orm[o + 1] = 165 + dirt * 120 - bare * 30 + (fn - 0.5) * 30;
      orm[o + 2] = bare * 200;
      height[i] = 0.5 + (fn - 0.5) * 0.06 - bare * 0.08;
    }
  }
  return finishMaterial(ctx, tb, { tile: 1, normalStrength: 2, metal: true });
}

export function paintChainlink(ctx: PaintCtx): THREE.MeshStandardMaterial {
  const P = N / 40; // diamond width in px
  const data = new Uint8Array(N * N * 4);
  const { bank } = ctx;
  const orm = new Uint8Array(N * N * 4);
  const inv = 1 / Math.SQRT2;
  for (let y = 0; y < N; y++) {
    const rowB = y << SS;
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const bi = rowB | x;
      const a = (x + y) % P;
      const b2 = (((x - y) % P) + P) % P;
      const dA = Math.min(a, P - a) * inv;
      const dB = Math.min(b2, P - b2) * inv;
      const w = 1.1;
      const wireA = 1 - sstep(w - 0.3, w + 0.5, dA);
      const wireB = 1 - sstep(w - 0.3, w + 0.5, dB);
      const knuckle = 1 - sstep(1.4, 2.4, Math.sqrt(dA * dA + dB * dB));
      const alpha = Math.max(wireA, wireB, knuckle * 0.8);
      const mac = bank.macro[bi]!;
      const fn = bank.fine[bi]!;
      const rusty = sstep(0.68, 0.8, mac) * 0.5;
      // cylindrical shading across each wire: lit from one side
      const shade = 0.78 + 0.32 * (1 - Math.min(dA, dB) / 1.4);
      const v = (168 + (fn - 0.5) * 26 + (mac - 0.5) * 24) * shade;
      let r = v * 0.97;
      let g = v * 1.0;
      let bl = v * 1.05 + 2;
      r = mix(r, 124, rusty);
      g = mix(g, 84, rusty);
      bl = mix(bl, 54, rusty);
      const o = i * 4;
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = bl;
      data[o + 3] = alpha * 255;
      orm[o] = 255;
      orm[o + 1] = 120 + rusty * 90;
      orm[o + 2] = 205 * (1 - rusty);
      orm[o + 3] = 255;
    }
  }
  const map = ctx.track(makeDataTexture(data, N, N, true));
  // coverage-preserving mip chain so thin wires survive at distance
  const mips = coverageMips(data, N, 0.4);
  map.mipmaps = mips;
  map.generateMipmaps = false;
  map.needsUpdate = true;
  const ormTex = ctx.track(makeDataTexture(orm, N, N, false));
  const m = new THREE.MeshStandardMaterial({
    map,
    roughnessMap: ormTex,
    metalnessMap: ormTex,
    roughness: 1,
    metalness: 1,
    alphaTest: 0.4,
    side: THREE.DoubleSide,
    transparent: false,
  });
  m.alphaToCoverage = true;
  m.userData.tile = 2.4;
  return m;
}

// ---------------------------------------------------------------------------------------------
// glass
// ---------------------------------------------------------------------------------------------

export function paintGlass(ctx: PaintCtx, dark: boolean): THREE.MeshStandardMaterial {
  const n = 256;
  const tb = new TexBuilder(n);
  const { bank } = ctx;
  const { albedo, orm, height } = tb;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const bi = ((y * 2) << SS) | ((x * 2) & SM);
      const sv = bank.streakV[bi]!;
      const mac = bank.macro[bi]!;
      const md = bank.mid[(bi + 800) & MASK]!;
      const fn = bank.fine[bi]!;
      const wn = bank.white[bi]! / 255;
      const streak = sstep(0.62, 0.92, sv) * sstep(0.3, 0.7, md);
      const dust = sstep(0.55, 0.85, mac) * 0.5 + streak * 0.6;
      // diagonal reflection band
      const tb1 = ((x + y) / n) % 1; // periodic diagonal bands so the pane tiles without a seam
      const band = Math.exp(-(((tb1 - 0.5) / 0.14) ** 2)) * 0.5 + Math.exp(-(((tb1 - 0.12) / 0.05) ** 2)) * 0.25;
      const crack = (1 - sstep(0.004, 0.012, bank.wedge[bi]!)) * (sstep(0.78, 0.9, md) * 0.9);
      const o = i * 4;
      if (dark) {
        const v = 16 + dust * 26 + band * 30 + (fn - 0.5) * 6;
        albedo[o] = v * 0.9;
        albedo[o + 1] = v * 1.05;
        albedo[o + 2] = v * 1.25 + 4;
        albedo[o + 3] = 255;
      } else {
        const v = 178 - dust * 60 + (fn - 0.5) * 10;
        albedo[o] = v * 0.94;
        albedo[o + 1] = v * 1.02;
        albedo[o + 2] = v * 1.08;
        albedo[o + 3] = clamp(255 * (0.16 + dust * 0.5 + band * 0.32 + crack * 0.6 + (wn < 0.004 ? 0.4 : 0)), 0, 255);
      }
      orm[o + 1] = 20 + dust * 130 + (dark ? 30 : 0);
      orm[o + 2] = dark ? 40 : 26;
      height[i] = 0.5 + (fn - 0.5) * 0.02 - crack * 0.1;
    }
  }
  const m = finishMaterial(ctx, tb, {
    tile: 2,
    normalStrength: 1.2,
    metal: true,
    params: dark ? { envMapIntensity: 1.4 } : { transparent: true, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.8 },
  });
  return m;
}

// ---------------------------------------------------------------------------------------------
// shipping containers
// ---------------------------------------------------------------------------------------------

export interface ContainerSpec {
  color: [number, number, number];
  rust: number;
  dirt: number;
  seed: number;
}

export function paintContainer(ctx: PaintCtx, spec: ContainerSpec): THREE.MeshStandardMaterial {
  const tb = new TexBuilder(N);
  const { bank } = ctx;
  const { albedo, orm, height } = tb;
  const ribs = 24;
  const pitch = N / ribs;
  const prof = new Float32Array(N);
  const slopeX = new Float32Array(N);
  for (let x = 0; x < N; x++) {
    const t = ((x + 0.5) / pitch) % 1;
    const tri = 1 - Math.abs(2 * t - 1);
    prof[x] = sstep(0.22, 0.78, tri);
    slopeX[x] = t < 0.5 ? 1 : -1;
  }
  const ox = Math.floor(hash2(spec.seed, 1, 5) * 400);
  const oy = Math.floor(hash2(spec.seed, 2, 5) * 400);
  for (let y = 0; y < N; y++) {
    const rowB = ((y + oy) & SM) << SS;
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const bi = rowB | ((x + ox) & SM);
      const p = prof[x]!;
      const mac = bank.macro[bi]!;
      const md = bank.mid[(bi + 1234) & MASK]!;
      const fn = bank.fine[bi]!;
      const wn = bank.white[bi]! / 255;
      const sv = bank.streakV[(bi + 5151) & MASK]!;
      const sh = bank.streakH[(bi + 2323) & MASK]!;
      // faded paint on ridges, shaded troughs
      let k = 0.72 + 0.28 * p + slopeX[x]! * 0.035 * (1 - Math.abs(p - 0.5) * 2);
      k *= 0.92 + (mac - 0.5) * 0.28 + (fn - 0.5) * 0.1;
      const fade = sstep(0.6, 0.85, md) * 0.16;
      k *= 1 - fade;
      // dirt streaks and grime
      const streak = sstep(0.64, 0.92, sv) * sstep(0.32, 0.7, md) * (0.4 + spec.dirt);
      k *= 1 - streak * 0.36;
      let r = spec.color[0] * k;
      let g = spec.color[1] * k;
      let b = spec.color[2] * k;
      // paint chipping on ridge tops -> bare steel -> rust
      const ridgeTop = sstep(0.6, 0.92, p);
      const chipN = wn * 0.35 + fn * 0.35 + bank.vf1[bi]! * 0.3;
      const cluster = sstep(0.3, 0.75, md + (mac - 0.5) * 0.3);
      const chip = sstep(0.62 - spec.rust * 0.2, 0.74 - spec.rust * 0.2, chipN) * (0.3 + ridgeTop * 0.7) * (0.25 + 0.9 * cluster);
      const rustBloom = sstep(0.55 - spec.rust * 0.3, 0.8 - spec.rust * 0.3, md * 0.5 + sv * 0.4 + (1 - p) * 0.1) * spec.rust;
      const rusted = clamp(chip * (0.35 + spec.rust) + rustBloom, 0, 1);
      const rt = 0.75 + fn * 0.5;
      r = mix(r, 138 * rt, rusted);
      g = mix(g, 78 * rt, rusted);
      b = mix(b, 46 * rt, rusted);
      const bare = chip * (1 - rusted) * 0.8;
      r = mix(r, 118, bare);
      g = mix(g, 120, bare);
      b = mix(b, 122, bare);
      // scratches
      const scr = sstep(0.9, 0.96, sh) * 0.5;
      r += scr * 24;
      g += scr * 24;
      b += scr * 24;
      const o = i * 4;
      albedo[o] = r;
      albedo[o + 1] = g;
      albedo[o + 2] = b;
      orm[o + 1] = clamp(150 + (1 - p) * 26 + rusted * 70 - bare * 60 + (fn - 0.5) * 40, 0, 255);
      orm[o + 2] = clamp(70 + bare * 170 + chip * 30, 0, 255);
      height[i] = 0.25 + p * 0.6 + (fn - 0.5) * 0.04 - rusted * 0.06;
    }
  }
  let normal = ctx.shared.get('containerNormal');
  if (!normal) {
    normal = ctx.track(makeDataTexture(tb.toNormal(6), N, N, false));
    ctx.shared.set('containerNormal', normal);
  }
  return finishMaterial(ctx, tb, { tile: 2.4, normalMap: normal, metal: true });
}

// ---------------------------------------------------------------------------------------------
// vehicle paints and charred wrecks
// ---------------------------------------------------------------------------------------------

export function paintVehicle(ctx: PaintCtx, color: [number, number, number], seed: number): THREE.MeshStandardMaterial {
  const n = 256;
  const tb = new TexBuilder(n);
  const { bank } = ctx;
  const { albedo, orm, height } = tb;
  const ox = Math.floor(hash2(seed, 1, 9) * 400);
  const oy = Math.floor(hash2(seed, 2, 9) * 400);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const bi = ((((y + oy) * 2) & SM) << SS) | (((x + ox) * 2) & SM);
      const mac = bank.macro[bi]!;
      const md = bank.mid[(bi + 90) & MASK]!;
      const fn = bank.fine[bi]!;
      const wn = bank.white[bi]! / 255;
      const sv = bank.streakV[(bi + 606) & MASK]!;
      const sh = bank.streakH[(bi + 909) & MASK]!;
      const dirt = sstep(0.45, 0.95, md + (fn - 0.5) * 0.3) * 0.14 + sstep(0.66, 0.92, sv) * 0.14;
      const fade = sstep(0.55, 0.8, mac) * 0.06;
      const k = 1 - dirt + fade + (fn - 0.5) * 0.08;
      let r = color[0] * k;
      let g = color[1] * k;
      let b = color[2] * k;
      // road grime tint
      r = mix(r, r * 0.9 + 6, dirt);
      g = mix(g, g * 0.9 + 5, dirt);
      b = mix(b, b * 0.86 + 3, dirt);
      const scr = sstep(0.88, 0.95, sh) * 0.7 + sstep(0.9, 0.96, bank.streakV[(bi + 303) & MASK]!) * 0.4;
      r += scr * 34;
      g += scr * 34;
      b += scr * 34;
      const chip = wn > 0.9985 ? 1 : 0;
      r = mix(r, 92, chip);
      g = mix(g, 90, chip);
      b = mix(b, 88, chip);
      const o = i * 4;
      albedo[o] = r;
      albedo[o + 1] = g;
      albedo[o + 2] = b;
      orm[o + 1] = clamp(78 + dirt * 240 + fade * 100 + (fn - 0.5) * 24, 0, 255);
      orm[o + 2] = 118;
      height[i] = 0.5 + (fn - 0.5) * 0.12 - scr * 0.05;
    }
  }
  let normal = ctx.shared.get('paintNormal');
  if (!normal) {
    normal = ctx.track(makeDataTexture(tb.toNormal(2.2), n, n, false));
    ctx.shared.set('paintNormal', normal);
  }
  return finishMaterial(ctx, tb, { tile: 2, normalMap: normal, metal: true });
}

export function paintBurnt(ctx: PaintCtx): THREE.MeshStandardMaterial {
  const n = 256;
  const tb = new TexBuilder(n);
  const { bank } = ctx;
  const { albedo, orm, height } = tb;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const bi = ((y * 2) << SS) | ((x * 2) & SM);
      const mac = bank.macro[bi]!;
      const md = bank.mid[(bi + 41) & MASK]!;
      const fn = bank.fine[bi]!;
      const wn = bank.white[bi]! / 255;
      const sv = bank.streakV[(bi + 1515) & MASK]!;
      let v = 28 + (mac - 0.5) * 16 + (fn - 0.5) * 12;
      // burnt-through paint reveals brown oxide, ash streaks run down
      const oxide = sstep(0.55, 0.78, md);
      const ash = sstep(0.7, 0.92, sv) * 0.6;
      let r = v * 1.0;
      let g = v * 0.95;
      let b = v * 0.9;
      r = mix(r, 96 * (0.7 + fn * 0.5), oxide * 0.75);
      g = mix(g, 56 * (0.7 + fn * 0.5), oxide * 0.75);
      b = mix(b, 34 * (0.7 + fn * 0.5), oxide * 0.75);
      r = mix(r, 148, ash * 0.35);
      g = mix(g, 144, ash * 0.35);
      b = mix(b, 138, ash * 0.35);
      const flake = wn > 0.985 ? 1 : 0;
      r = mix(r, 12, flake * 0.7);
      g = mix(g, 11, flake * 0.7);
      b = mix(b, 10, flake * 0.7);
      const o = i * 4;
      albedo[o] = r;
      albedo[o + 1] = g;
      albedo[o + 2] = b;
      orm[o + 1] = 235 - ash * 20 + (fn - 0.5) * 30;
      orm[o + 2] = 80 + (1 - oxide) * 60;
      height[i] = 0.5 + (fn - 0.5) * 0.3 + (wn - 0.5) * 0.1 - flake * 0.1;
    }
  }
  return finishMaterial(ctx, tb, { tile: 2, normalStrength: 4, metal: true });
}
