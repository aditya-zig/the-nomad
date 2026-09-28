/**
 * Ground and floor material painters: asphalt, sidewalk, industrial concrete, dirt, grass, gravel, rubble,
 * roofing, warehouse / store / lab floors. All are seamless at their tile size.
 */
import * as THREE from 'three';
import { getCracks1k, getCracks512 } from './cracks';
import {
  type PaintCtx,
  SM,
  SS,
  TexBuilder,
  clamp,
  finishMaterial,
  getBank1k,
  hash2,
  mix,
  mulberry32,
  sstep,
} from './core';

const cool = (v: number, tr = 0.985, tg = 1.0, tb = 1.035): [number, number, number] => [v * tr, v * tg + 0.5, v * tb + 1.5];

// ---------------------------------------------------------------------------------------------
// asphalt (1024, tile 8)
// ---------------------------------------------------------------------------------------------

export function paintAsphalt(ctx: PaintCtx, wet: boolean): THREE.MeshStandardMaterial {
  const N = 1024;
  const tb = new TexBuilder(N);
  const { bank } = ctx;
  const b1 = getBank1k();
  const cracks = getCracks1k();
  const { albedo, orm, height } = tb;
  const rng = mulberry32(wet ? 7717 : 5511);

  // rectangular repair patches (wrapping) with sealed seams
  const patchTone = new Float32Array(N * N);
  const patchSeam = new Uint8Array(N * N);
  for (let k = 0; k < 8; k++) {
    const px = Math.floor(rng() * N);
    const py = Math.floor(rng() * N);
    const pw = 90 + Math.floor(rng() * 360);
    const ph = 70 + Math.floor(rng() * 240);
    const tone = (rng() - 0.5) * 9;
    for (let yy = 0; yy < ph; yy++) {
      const y = (py + yy) % N;
      for (let xx = 0; xx < pw; xx++) {
        const x = (px + xx) % N;
        patchTone[y * N + x] = tone;
        if (yy < 2 || yy >= ph - 2 || xx < 2 || xx >= pw - 2) patchSeam[y * N + x] = 1;
      }
    }
  }

  for (let y = 0; y < N; y++) {
    const rowB = (y & SM) << SS;
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const bw = rowB | (x & SM);
      const mac = b1.macro[i]!;
      const md = b1.mid[i]!;
      const wn = bank.white[bw]! / 255;
      const fn = bank.fine[bw]!;
      let v = 54 + (mac - 0.5) * 17 + patchTone[i]!;
      v += (wn - 0.5) * 21 + (fn - 0.5) * 12;
      if (wn > 0.988) v += 24 + fn * 14;
      else if (wn < 0.014) v -= 12;
      if (patchSeam[i]) v -= 5;

      // oil stains
      const oil = sstep(0.68, 0.84, md * 0.7 + mac * 0.3) * 0.5;
      // cracks: meandering hairline cracks, tar-sealed cracks, small patches of alligator cracking
      const allig = sstep(0.76, 0.86, mac * 0.55 + md * 0.45);
      const cf = (1 - sstep(0.02, 0.045, b1.crackFine[i]!)) * allig * 0.55;
      const hair = cracks.fine[i]!;
      const tar = cracks.tar[i]!;
      const crack = Math.max(hair * 0.92, cf);

      let r: number;
      let g: number;
      let b: number;
      [r, g, b] = cool(v);
      const wetk = wet ? 0.8 : 1;
      r *= wetk;
      g *= wetk;
      b *= wetk;
      // puddles (wet variant): dark, mirror-like
      let pud = 0;
      let damp = 0;
      if (wet) {
        // soft wet / very-wet mottling (no hard-edged puddles: those repeat visibly every 8 m; use the `puddle` decal for standing water)
        const lvl = mac * 0.7 + md * 0.3;
        pud = sstep(0.5, 0.95, lvl + (fn - 0.5) * 0.12) * 0.55;
        damp = sstep(0.35, 0.8, lvl);
        const k = 1 - pud * 0.3 - damp * 0.06;
        r *= k * 0.95;
        g *= k * 0.98;
        b *= k * 1.06;
      }
      r = mix(r, 22, oil * 0.9);
      g = mix(g, 24, oil * 0.9);
      b = mix(b, 30, oil * 0.9);
      r = mix(r, 15, crack * 0.85);
      g = mix(g, 15, crack * 0.85);
      b = mix(b, 18, crack * 0.85);
      r = mix(r, 10, tar * 0.92);
      g = mix(g, 10, tar * 0.92);
      b = mix(b, 12, tar * 0.92);

      const o = i * 4;
      albedo[o] = r;
      albedo[o + 1] = g;
      albedo[o + 2] = b;

      let rough = wet ? 92 + fn * 60 - damp * 34 : 218 + (wn - 0.5) * 34;
      rough = mix(rough, wet ? 16 : 235, wet ? pud : 0);
      rough = mix(rough, 150, oil);
      rough += crack * 22;
      rough = mix(rough, 70, tar);
      orm[o + 1] = rough;

      height[i] = 0.5 + (wn - 0.5) * 0.12 + (patchTone[i]! + (patchSeam[i] ? -6 : 0)) * 0.004 - crack * 0.3 - tar * 0.2 - pud * 0.03;
    }
  }
  return finishMaterial(ctx, tb, { tile: 8, normalStrength: 3.2 });
}

// ---------------------------------------------------------------------------------------------
// sidewalk / industrial concrete pad
// ---------------------------------------------------------------------------------------------

function paintSlabs(ctx: PaintCtx, cfg: { slabs: number; base: number; tile: number; jointPx: number; tar: boolean; seed: number }): THREE.MeshStandardMaterial {
  const N = 512;
  const tb = new TexBuilder(N);
  const { bank } = ctx;
  const crackSet = getCracks512();
  const { albedo, orm, height } = tb;
  const cell = N / cfg.slabs;
  const hw = cfg.jointPx;
  for (let y = 0; y < N; y++) {
    const rowB = y << SS;
    const sy = Math.floor(y / cell);
    const dyj = Math.min(y % cell, cell - (y % cell));
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const bw = rowB | x;
      const sx = Math.floor(x / cell);
      const dxj = Math.min(x % cell, cell - (x % cell));
      const slabTone = (hash2(sx, sy, cfg.seed) - 0.5) * 11;
      const mac = bank.macro[bw]!;
      const md = bank.mid[(bw + 73000) & 262143]!;
      const fn = bank.fine[bw]!;
      const wn = bank.white[(bw + 91) & 262143]! / 255;
      // slab surface: trowel drift + pores
      let v = cfg.base + slabTone + (mac - 0.5) * 20 + (fn - 0.5) * 9 + (wn - 0.5) * 8;
      if (wn < 0.02) v -= 16; // pores
      // stains
      const stain = sstep(0.64, 0.82, md) * (0.55 + 0.8 * fn);
      v -= stain * 9;
      // cracks (1 m cells, broken by noise)
      const crk = crackSet.sparse[(bw + cfg.seed * 977) & 262143]!;
      // joints
      const dj = Math.min(dxj, dyj);
      const joint = 1 - sstep(hw - 1.2, hw + 1.2, dj);
      const lip = 1 - sstep(hw + 1.2, hw + 4.5, dj);
      v += lip * 4; // slight arris highlight
      let r = v * 0.99;
      let g = v * 1.0 + 0.5;
      let b = v * 1.03 + 1.5;
      if (crk > 0) {
        r = mix(r, 40, crk * 0.8);
        g = mix(g, 42, crk * 0.8);
        b = mix(b, 46, crk * 0.8);
      }
      if (joint > 0) {
        const grime = cfg.tar ? 30 : 46 + fn * 26;
        let jr = grime;
        let jg = cfg.tar ? grime - 2 : grime + 1;
        let jb = cfg.tar ? grime - 3 : grime + 1;
        // weeds and moss creeping out of joints
        if (!cfg.tar && fn > 0.6 && wn > 0.4) {
          jr = 62;
          jg = 72;
          jb = 44;
        }
        r = mix(r, jr, joint);
        g = mix(g, jg, joint);
        b = mix(b, jb, joint);
      }
      const o = i * 4;
      albedo[o] = r;
      albedo[o + 1] = g;
      albedo[o + 2] = b;
      orm[o + 1] = 205 + (fn - 0.5) * 40 - stain * 60 + joint * 25;
      height[i] = 0.5 + (fn - 0.5) * 0.1 + (wn - 0.5) * 0.05 - joint * 0.5 - crk * 0.28 + lip * 0.04;
    }
  }
  return finishMaterial(ctx, tb, { tile: cfg.tile, normalStrength: 3.4 });
}

export const paintSidewalk = (ctx: PaintCtx) => paintSlabs(ctx, { slabs: 2, base: 98, tile: 4, jointPx: 3, tar: false, seed: 31 });
export const paintConcreteSlab = (ctx: PaintCtx) => paintSlabs(ctx, { slabs: 2, base: 92, tile: 6, jointPx: 4.5, tar: true, seed: 57 });

// ---------------------------------------------------------------------------------------------
// dirt, grass, gravel, rubble
// ---------------------------------------------------------------------------------------------

export function paintDirt(ctx: PaintCtx): THREE.MeshStandardMaterial {
  const N = 512;
  const tb = new TexBuilder(N);
  const { bank } = ctx;
  const { albedo, orm, height } = tb;
  for (let y = 0; y < N; y++) {
    const rowB = y << SS;
    const v = y / N;
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const bw = rowB | x;
      const u = x / N;
      const mac = bank.macro[bw]!;
      const md = bank.mid[(bw + 12345) & 262143]!;
      const fn = bank.fine[bw]!;
      const wn = bank.white[bw]! / 255;
      const damp = sstep(0.62, 0.78, md);
      let val = 78 + (mac - 0.5) * 34 + (fn - 0.5) * 16 + (wn - 0.5) * 12 + (wn > 0.96 ? 16 : 0) - (wn < 0.03 ? 14 : 0);
      val *= 1 - damp * 0.22;
      // pebbles
      const pr = 0.14 + bank.vid[bw]! * 0.2;
      const peb = (1 - sstep(pr * 0.7, pr, bank.vf1[bw]!)) * (bank.vid[bw]! > 0.6 ? 1 : 0);
      // wheel ruts
      const rutC = 0.3 + 0.012 * Math.sin(u * 18.85) + 0.02 * (mac - 0.5);
      const rut1 = Math.exp(-(((v - rutC) / 0.011) ** 2));
      const rut2 = Math.exp(-(((v - rutC - 0.078) / 0.011) ** 2));
      const rut = Math.max(rut1, rut2);
      // dried mud cracks in pale areas
      const dry = sstep(0.62, 0.32, mac);
      const crk = (1 - sstep(0.012, 0.034, bank.wedge[bw]!)) * dry;
      val *= 1 - rut * 0.22 - crk * 0.4;
      let r = val * 1.02 + 5;
      let g = val * 0.93 + 2;
      let b = val * 0.78;
      if (peb > 0) {
        const pv = 70 + bank.vid[bw]! * 30;
        r = mix(r, pv, peb * 0.5);
        g = mix(g, pv * 0.97, peb * 0.5);
        b = mix(b, pv * 0.92, peb * 0.5);
      }
      const o = i * 4;
      albedo[o] = r;
      albedo[o + 1] = g;
      albedo[o + 2] = b;
      orm[o + 1] = 240 - damp * 55 - peb * 20;
      height[i] = 0.5 + (fn - 0.5) * 0.3 + peb * (1 - bank.vf1[bw]! * 2.4) * 0.16 - rut * 0.35 - crk * 0.25 + (wn - 0.5) * 0.12;
    }
  }
  return finishMaterial(ctx, tb, { tile: 6, normalStrength: 4.5 });
}

export function paintGrass(ctx: PaintCtx): THREE.MeshStandardMaterial {
  const N = 512;
  const tb = new TexBuilder(N);
  const { bank } = ctx;
  const { albedo, orm, height } = tb;
  for (let y = 0; y < N; y++) {
    const rowB = y << SS;
    const rowB2 = ((y * 2) & SM) << SS;
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const bw = rowB | x;
      const bw2 = rowB2 | ((x * 2 + 17) & SM);
      const mac = bank.macro[bw]!;
      const md = bank.mid[(bw + 200003) & 262143]!;
      const blade = bank.streakV[bw2]!; // vertical blades
      const blade2 = bank.streakV[(bw + 4111) & 262143]!;
      const wn = bank.white[bw]! / 255;
      const fnn = bank.fine[bw]!;
      const bare = sstep(0.34, 0.18, md + (fnn - 0.5) * 0.25) * 0.75; // bare dirt patches
      const green = sstep(0.62, 0.9, mac) * 0.5;
      const straw = sstep(0.2, 0.8, md);
      // straw (dead grass) vs olive (still green) vs dirt
      let r = mix(74, 128, straw);
      let g = mix(70, 116, straw);
      let b = mix(50, 76, straw);
      r = mix(r, 70, green * 0.55);
      g = mix(g, 86, green * 0.55);
      b = mix(b, 50, green * 0.55);
      const bl = (blade - 0.5) * 0.9 + (blade2 - 0.5) * 0.5;
      const shade = 0.86 + bl * 0.42 + (wn - 0.5) * 0.2 + (fnn - 0.5) * 0.12;
      r *= shade;
      g *= shade;
      b *= shade;
      // bare soil
      r = mix(r, 72, bare * 0.85);
      g = mix(g, 62, bare * 0.85);
      b = mix(b, 50, bare * 0.85);
      const o = i * 4;
      albedo[o] = r;
      albedo[o + 1] = g;
      albedo[o + 2] = b;
      orm[o + 1] = 235 + (wn - 0.5) * 20;
      height[i] = 0.5 + bl * 0.35 - bare * 0.1 + (wn - 0.5) * 0.06;
    }
  }
  return finishMaterial(ctx, tb, { tile: 6, normalStrength: 3.6 });
}

export function paintGravel(ctx: PaintCtx): THREE.MeshStandardMaterial {
  const N = 512;
  const tb = new TexBuilder(N);
  const { bank } = ctx;
  const { albedo, orm, height } = tb;
  for (let y = 0; y < N; y++) {
    const rowB = y << SS;
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const bw = rowB | x;
      const f1 = bank.vf1[bw]!;
      const edge = bank.vedge[bw]!;
      const id = bank.vid[bw]!;
      const wn = bank.white[bw]! / 255;
      const dome = 1 - clamp(f1 / 0.62, 0, 1);
      const gap = 1 - sstep(0.03, 0.26, edge);
      const warm = ((id * 7919) % 1) - 0.5;
      const base = 80 + id * 62;
      const shade = (0.5 + 0.5 * dome) * (1 - 0.65 * gap) * (0.94 + wn * 0.12);
      const o = i * 4;
      albedo[o] = (base + warm * 14 + 2) * shade;
      albedo[o + 1] = base * shade;
      albedo[o + 2] = (base - warm * 12 - 3) * shade;
      orm[o + 1] = 215 + (id - 0.5) * 50;
      height[i] = 0.5 + dome * 0.55 - gap * 0.35 + (wn - 0.5) * 0.06;
    }
  }
  return finishMaterial(ctx, tb, { tile: 4, normalStrength: 5 });
}

export function paintRubble(ctx: PaintCtx): THREE.MeshStandardMaterial {
  const N = 512;
  const tb = new TexBuilder(N);
  const { bank } = ctx;
  const { albedo, orm, height } = tb;
  for (let y = 0; y < N; y++) {
    const rowB = y << SS;
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const bw = rowB | x;
      const id = bank.wid[bw]!;
      const edge = bank.wedge[bw]!;
      const f1 = bank.wf1[bw]!;
      const fn = bank.fine[bw]!;
      const wn = bank.white[bw]! / 255;
      const seam = 1 - sstep(0.02, 0.16, edge);
      const chunkTone = 96 + id * 36;
      const sooty = id > 0.9 ? 0.7 : 1;
      let v = chunkTone * sooty * (0.86 + fn * 0.28) * (0.92 + (1 - f1 * 0.5) * 0.08);
      v *= 1 - seam * 0.4;
      // exposed aggregate speckle
      v += (wn - 0.5) * 22;
      let r = v * 0.98;
      let g = v * 1.0 + 1;
      let b = v * 1.06 + 3;
      // occasional rusty rebar streak in a chunk
      if (id > 0.93 && fn > 0.5) {
        r = mix(r, 122, 0.7);
        g = mix(g, 66, 0.7);
        b = mix(b, 36, 0.7);
      }
      const o = i * 4;
      albedo[o] = r;
      albedo[o + 1] = g;
      albedo[o + 2] = b;
      orm[o + 1] = 230 + (wn - 0.5) * 30;
      const plateau = sstep(0.0, 0.28, edge);
      height[i] = 0.35 + id * 0.3 * plateau + plateau * 0.25 + (fn - 0.5) * 0.12 + (wn - 0.5) * 0.06;
    }
  }
  return finishMaterial(ctx, tb, { tile: 2, normalStrength: 5.5 });
}

// ---------------------------------------------------------------------------------------------
// roofing and interior floors
// ---------------------------------------------------------------------------------------------

export function paintRoof(ctx: PaintCtx): THREE.MeshStandardMaterial {
  const N = 512;
  const tb = new TexBuilder(N);
  const { bank } = ctx;
  const { albedo, orm, height } = tb;
  const strips = 6;
  const cell = N / strips;
  for (let y = 0; y < N; y++) {
    const rowB = y << SS;
    const dy = Math.min(y % cell, cell - (y % cell));
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const bw = rowB | x;
      const mac = bank.macro[bw]!;
      const md = bank.mid[(bw + 999) & 262143]!;
      const wn = bank.white[bw]! / 255;
      const vid = bank.vid[(bw + 33) & 262143]!;
      const vf = bank.vf1[bw]!;
      const pebble = (1 - sstep(0.06, 0.16, vf)) * (vid > 0.5 ? 1 : 0) * 0.7 + (wn > 0.9 ? 0.35 : 0);
      let v = 44 + (mac - 0.5) * 16 + (wn - 0.5) * 12;
      const seam = 1 - sstep(1.2, 3.2, dy);
      v -= seam * 9;
      const dusty = sstep(0.66, 0.82, md);
      v += dusty * 16;
      let r = v * 0.98;
      let g = v * 1.01;
      let b = v * 1.06 + 2;
      if (pebble > 0) {
        const pv = 60 + vid * 28;
        r = mix(r, pv, Math.min(1, pebble) * 0.7);
        g = mix(g, pv, Math.min(1, pebble) * 0.7);
        b = mix(b, pv * 1.03, Math.min(1, pebble) * 0.7);
      }
      const o = i * 4;
      albedo[o] = r;
      albedo[o + 1] = g;
      albedo[o + 2] = b;
      orm[o + 1] = 245 - dusty * 40;
      height[i] = 0.5 + pebble * (1 - vf * 2) * 0.35 + (wn - 0.5) * 0.1 + seam * 0.1;
    }
  }
  return finishMaterial(ctx, tb, { tile: 6, normalStrength: 4 });
}

export function paintFloorWarehouse(ctx: PaintCtx): THREE.MeshStandardMaterial {
  const N = 512;
  const tb = new TexBuilder(N);
  const { bank } = ctx;
  const { albedo, orm, height } = tb;
  const cell = N / 2;
  for (let y = 0; y < N; y++) {
    const rowB = y << SS;
    const dyj = Math.min(y % cell, cell - (y % cell));
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const bw = rowB | x;
      const u = x / N;
      const dxj = Math.min(x % cell, cell - (x % cell));
      const mac = bank.macro[bw]!;
      const md = bank.mid[(bw + 4321) & 262143]!;
      const fn = bank.fine[bw]!;
      const wn = bank.white[bw]! / 255;
      const sh = bank.streakH[(bw + 7777) & 262143]!;
      const slab = (hash2(Math.floor(x / cell), Math.floor(y / cell), 9) - 0.5) * 9;
      let v = 90 + slab + (mac - 0.5) * 16 + (fn - 0.5) * 8 + (wn - 0.5) * 6;
      // trowel swirl / tyre scuffs (dark streaks along X, sparse)
      const scuff = sstep(0.68, 0.86, sh) * sstep(0.35, 0.6, md);
      v -= scuff * 20;
      const oil = sstep(0.7, 0.84, md * 0.6 + mac * 0.4) * 0.5;
      v *= 1 - oil * 0.5;
      const dj = Math.min(dxj, dyj);
      const joint = 1 - sstep(1.4, 3.4, dj);
      // faded safety line (yellow) along Y at u ~ 0.25, worn away in places
      const line = (1 - sstep(5.5, 7, Math.abs(x - N * 0.25))) * (1 - sstep(0.62, 0.9, fn * 0.6 + wn * 0.5));
      let r = v * 0.98;
      let g = v * 1.0 + 1;
      let b = v * 1.06 + 3;
      r = mix(r, 40, joint * 0.85);
      g = mix(g, 40, joint * 0.85);
      b = mix(b, 42, joint * 0.85);
      r = mix(r, 152, line * 0.75);
      g = mix(g, 128, line * 0.75);
      b = mix(b, 46, line * 0.75);
      const o = i * 4;
      albedo[o] = r;
      albedo[o + 1] = g;
      albedo[o + 2] = b;
      orm[o + 1] = 150 + (fn - 0.5) * 50 + scuff * 50 - oil * 40 + (u > 2 ? 0 : 0);
      height[i] = 0.5 + (fn - 0.5) * 0.08 + (wn - 0.5) * 0.04 - joint * 0.45 - line * 0.02;
    }
  }
  return finishMaterial(ctx, tb, { tile: 6, normalStrength: 2.4 });
}

export function paintFloorStore(ctx: PaintCtx): THREE.MeshStandardMaterial {
  const N = 512;
  const tb = new TexBuilder(N);
  const { bank } = ctx;
  const { albedo, orm, height } = tb;
  const tiles = 10;
  const cell = N / tiles;
  for (let y = 0; y < N; y++) {
    const rowB = y << SS;
    const ty = Math.floor(y / cell);
    const dyj = Math.min(y % cell, cell - (y % cell));
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const bw = rowB | x;
      const tx = Math.floor(x / cell);
      const dxj = Math.min(x % cell, cell - (x % cell));
      const mac = bank.macro[bw]!;
      const md = bank.mid[(bw + 555) & 262143]!;
      const fn = bank.fine[bw]!;
      const wn = bank.white[bw]! / 255;
      const sv = bank.streakV[(bw + 2020) & 262143]!;
      const checker = (tx + ty) & 1;
      const tone = (hash2(tx, ty, 5) - 0.5) * 8;
      let r = checker ? 148 : 108;
      let g = checker ? 142 : 116;
      let b = checker ? 124 : 112;
      r += tone;
      g += tone;
      b += tone;
      // traffic wear + dirt
      const wear = sstep(0.3, 0.85, md);
      const dirt = 1 - wear * 0.13 - sstep(0.7, 0.9, sv) * 0.09;
      const scuff = sstep(0.75, 0.92, bank.streakH[(bw + 909) & 262143]!) * 0.16;
      const k = dirt * (1 - scuff) * (0.94 + (fn - 0.5) * 0.14 + (mac - 0.5) * 0.12);
      r *= k;
      g *= k;
      b *= k;
      const dj = Math.min(dxj, dyj);
      const grout = 1 - sstep(0.8, 2.2, dj);
      r = mix(r, 52, grout * 0.85);
      g = mix(g, 52, grout * 0.85);
      b = mix(b, 50, grout * 0.85);
      const crk = getCracks512().dense[(bw + 3131) & 262143]! * sstep(0.35, 0.6, md);
      r = mix(r, 44, crk * 0.7);
      g = mix(g, 44, crk * 0.7);
      b = mix(b, 42, crk * 0.7);
      const o = i * 4;
      albedo[o] = r;
      albedo[o + 1] = g;
      albedo[o + 2] = b;
      orm[o + 1] = 105 + wear * 50 + (fn - 0.5) * 40 + grout * 60;
      height[i] = 0.5 - grout * 0.4 - crk * 0.25 + (wn - 0.5) * 0.02;
    }
  }
  return finishMaterial(ctx, tb, { tile: 3, normalStrength: 3 });
}

export function paintLabFloor(ctx: PaintCtx): THREE.MeshStandardMaterial {
  const N = 512;
  const tb = new TexBuilder(N);
  const { bank } = ctx;
  const { albedo, orm, height } = tb;
  const tiles = 8;
  const cell = N / tiles;
  for (let y = 0; y < N; y++) {
    const rowB = y << SS;
    const ty = Math.floor(y / cell);
    const dyj = Math.min(y % cell, cell - (y % cell));
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const bw = rowB | x;
      const tx = Math.floor(x / cell);
      const dxj = Math.min(x % cell, cell - (x % cell));
      const mac = bank.macro[bw]!;
      const md = bank.mid[(bw + 8080) & 262143]!;
      const wn = bank.white[bw]! / 255;
      const wn2 = bank.white[(bw * 7 + 13) & 262143]! / 255;
      const tone = (hash2(tx, ty, 21) - 0.5) * 7;
      let v = 152 + tone + (mac - 0.5) * 10;
      // terrazzo flecks
      if (wn > 0.965) v += 26;
      else if (wn2 < 0.03) v -= 30;
      else if (wn < 0.012) v -= 20;
      // scuffs and cleaning marks
      const sc = sstep(0.72, 0.9, bank.streakH[(bw + 313) & 262143]!) * sstep(0.35, 0.6, md);
      v -= sc * 14;
      let r = v * 0.96;
      let g = v * 1.0 + 1;
      let b = v * 1.04 + 4;
      const dj = Math.min(dxj, dyj);
      const grout = 1 - sstep(0.7, 1.9, dj);
      r = mix(r, 92, grout * 0.8);
      g = mix(g, 96, grout * 0.8);
      b = mix(b, 98, grout * 0.8);
      const o = i * 4;
      albedo[o] = r;
      albedo[o + 1] = g;
      albedo[o + 2] = b;
      orm[o + 1] = 62 + sc * 90 + (bank.fine[bw]! - 0.5) * 30 + grout * 60;
      height[i] = 0.5 - grout * 0.35 + (wn - 0.5) * 0.02;
    }
  }
  return finishMaterial(ctx, tb, { tile: 4, normalStrength: 2 });
}
