/**
 * Wall and cladding painters: poured concrete, brick, plaster, corrugated sheet (galvanised / rusted),
 * industrial panel siding, olive drab military metal, lab tile, weathered planks, lab equipment panels.
 */
import * as THREE from 'three';
import { getCracks512 } from './cracks';
import { type PaintCtx, SM, SS, TexBuilder, clamp, finishMaterial, hash2, makeDataTexture, mix, sstep } from './core';

const N = 512;
const MASK = N * N - 1;

// ---------------------------------------------------------------------------------------------
// poured concrete
// ---------------------------------------------------------------------------------------------

export function paintConcreteWall(ctx: PaintCtx, dark: boolean): THREE.MeshStandardMaterial {
  const tb = new TexBuilder(N);
  const { bank } = ctx;
  const { albedo, orm, height } = tb;
  const base = dark ? 70 : 106;
  const panelW = 256;
  const panelH = 128;
  for (let y = 0; y < N; y++) {
    const rowB = y << SS;
    const row = Math.floor(y / panelH);
    const yin = y % panelH;
    const dyj = Math.min(yin, panelH - yin);
    const shift = dark ? 0 : (row & 1) * 128;
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const bw = rowB | x;
      const xs = (x + shift) % N;
      const xin = xs % panelW;
      const dxj = Math.min(xin, panelW - xin);
      const panel = hash2(Math.floor(xs / panelW), row, 3);
      const mac = bank.macro[bw]!;
      const md = bank.mid[(bw + 15003) & MASK]!;
      const fn = bank.fine[bw]!;
      const wn = bank.white[bw]! / 255;
      const sv = bank.streakV[(bw + 3001) & MASK]!;
      let v = base + (panel - 0.5) * 9 + (mac - 0.5) * 24 + (fn - 0.5) * 10 + (wn - 0.5) * 9;
      if (wn < 0.018) v -= 14; // pores / bug holes
      // rain streaks and grime running down
      const streak = sstep(0.6, 0.9, sv) * sstep(0.3, 0.7, md);
      v -= streak * (dark ? 16 : 17);
      // efflorescence and damp
      const eff = sstep(0.74, 0.88, fn * 0.5 + mac * 0.5);
      v += eff * 9;
      const damp = sstep(0.68, 0.86, bank.mid[(bw + 60011) & MASK]!) * (0.4 + 0.9 * fn);
      v *= 1 - damp * 0.14;
      // spalling with exposed aggregate
      const sp = sstep(0.83, 0.9, bank.mid[(bw + 121003) & MASK]!) * (0.4 + 0.4 * wn);
      // formwork joints and tie holes
      const dj = Math.min(dxj, dyj);
      const joint = 1 - sstep(0.8, 2.2, dj);
      const hx = (x % 128) - 64;
      const hy = (y % 128) - 64;
      const hd = Math.sqrt(hx * hx + hy * hy);
      const hole = 1 - sstep(2.2, 4.4, hd);
      const holeRim = 1 - sstep(4.4, 7, hd);
      let r = v * 0.99;
      let g = v * 1.0 + 0.5;
      let b = v * 1.03 + 2;
      r = mix(r, dark ? 50 : 66, sp * 0.6);
      g = mix(g, dark ? 52 : 68, sp * 0.6);
      b = mix(b, dark ? 56 : 72, sp * 0.6);
      r *= 1 - joint * 0.45 - hole * 0.6 - holeRim * 0.05;
      g *= 1 - joint * 0.45 - hole * 0.6 - holeRim * 0.05;
      b *= 1 - joint * 0.42 - hole * 0.55 - holeRim * 0.05;
      const o = i * 4;
      albedo[o] = r;
      albedo[o + 1] = g;
      albedo[o + 2] = b;
      orm[o + 1] = 225 + (fn - 0.5) * 40 - damp * 55 + sp * 20;
      height[i] = 0.5 + (fn - 0.5) * 0.1 + (wn - 0.5) * 0.06 - joint * 0.35 - hole * 0.5 - sp * 0.3;
    }
  }
  return finishMaterial(ctx, tb, { tile: 4, normalStrength: 3.6 });
}

// ---------------------------------------------------------------------------------------------
// brick
// ---------------------------------------------------------------------------------------------

export function paintBrick(ctx: PaintCtx): THREE.MeshStandardMaterial {
  const tb = new TexBuilder(N);
  const { bank } = ctx;
  const { albedo, orm, height } = tb;
  const cols = 12;
  const rows = 40;
  const bw = N / cols; // 42.67
  const bh = N / rows; // 12.8
  for (let y = 0; y < N; y++) {
    const rowB = y << SS;
    const rowF = y / bh;
    const row = Math.floor(rowF);
    const yin = (rowF - row) * bh;
    const dy = Math.min(yin, bh - yin);
    const shift = (row & 1) * bw * 0.5;
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const bi = rowB | x;
      const bxF = (x + shift) / bw;
      const col = Math.floor(bxF) % cols;
      const xin = (bxF - Math.floor(bxF)) * bw;
      const dx = Math.min(xin, bw - xin);
      const dEdge = Math.min(dx, dy);
      const h = hash2(col, row, 7);
      const h2 = hash2(col, row, 19);
      const mac = bank.macro[bi]!;
      const fn = bank.fine[bi]!;
      const wn = bank.white[bi]! / 255;
      const sv = bank.streakV[(bi + 777) & MASK]!;
      const md = bank.mid[(bi + 9101) & MASK]!;
      // brick colour: fired clay range, desaturated for the cold palette
      let r = 106 + (h - 0.5) * 34;
      let g = 68 + (h - 0.5) * 22;
      let b = 58 + (h - 0.5) * 18;
      if (h2 > 0.9) {
        r = 70 + h * 16; // heavily scorched / blue-black
        g = 56 + h * 10;
        b = 54 + h * 10;
      } else if (h2 < 0.1) {
        r += 20; // paler, sand-faced brick
        g += 22;
        b += 18;
      }
      const surf = 0.86 + fn * 0.22 + (wn - 0.5) * 0.14 + (mac - 0.5) * 0.14;
      // soot / rain streaks
      const streak = sstep(0.66, 0.95, sv) * sstep(0.35, 0.7, md);
      const k = surf * (1 - streak * 0.2);
      r *= k;
      g *= k;
      b *= k;
      // salts
      const salt = sstep(0.78, 0.92, fn * 0.6 + bank.mid[(bi + 5)&MASK]! * 0.4) * 0.5;
      r = mix(r, 152, salt * 0.5);
      g = mix(g, 148, salt * 0.5);
      b = mix(b, 140, salt * 0.5);
      // brick edge chipping
      const chip = (1 - sstep(0.4, 1.6, dEdge)) * (wn > 0.62 ? 1 : 0.2);
      r = mix(r, 74, chip * 0.4);
      g = mix(g, 58, chip * 0.4);
      // cracks on a few bricks
      if (h > 0.965) {
        const cr = Math.abs(xin - bw * (0.3 + h2 * 0.4) + (yin - bh * 0.5) * 0.7);
        const c = 1 - sstep(0.4, 1.0, cr);
        r = mix(r, 30, c * 0.8);
        g = mix(g, 28, c * 0.8);
        b = mix(b, 28, c * 0.8);
      }
      // mortar
      const mortar = 1 - sstep(0.6, 1.9, dEdge);
      const mv = 118 + (fn - 0.5) * 30 + (wn - 0.5) * 24 - streak * 24;
      r = mix(r, mv * 1.0, mortar);
      g = mix(g, mv * 0.98, mortar);
      b = mix(b, mv * 0.92, mortar);
      const o = i * 4;
      albedo[o] = r;
      albedo[o + 1] = g;
      albedo[o + 2] = b;
      orm[o + 1] = 232 + (fn - 0.5) * 30 - mortar * 8;
      height[i] = 0.25 + sstep(0, 2.2, dEdge) * 0.55 + (fn - 0.5) * 0.12 + (wn - 0.5) * 0.06 - chip * 0.1;
    }
  }
  return finishMaterial(ctx, tb, { tile: 3, normalStrength: 4.4 });
}

// ---------------------------------------------------------------------------------------------
// plaster / stucco
// ---------------------------------------------------------------------------------------------

export function paintPlaster(ctx: PaintCtx): THREE.MeshStandardMaterial {
  const tb = new TexBuilder(N);
  const { bank } = ctx;
  const { albedo, orm, height } = tb;
  for (let y = 0; y < N; y++) {
    const rowB = y << SS;
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const bi = rowB | x;
      const mac = bank.macro[bi]!;
      const md = bank.mid[(bi + 21) & MASK]!;
      const fn = bank.fine[bi]!;
      const wn = bank.white[bi]! / 255;
      const sv = bank.streakV[(bi + 4004) & MASK]!;
      let v = 134 + (mac - 0.5) * 22 + (fn - 0.5) * 12 + (wn - 0.5) * 12;
      // water staining
      const st = sstep(0.6, 0.86, md);
      const stk = sstep(0.62, 0.9, sv) * sstep(0.35, 0.7, mac);
      v -= st * 20 + stk * 22;
      // cracks
      const cset = getCracks512();
      const crack = Math.max(cset.sparse[(bi + 11111) & MASK]!, cset.dense[(bi + 777) & MASK]! * 0.8);
      // peeled patches reveal brick / render beneath
      const peelN = bank.mid[(bi + 150001) & MASK]!;
      const peel = sstep(0.76, 0.8, peelN);
      const peelEdge = sstep(0.74, 0.76, peelN) - peel;
      let r = v * 1.0;
      let g = v * 0.985;
      let b = v * 0.94;
      // stains pull the tone brown-grey
      r = mix(r, r * 0.92, st * 0.4);
      b = mix(b, b * 0.94, st * 0.4);
      if (peel > 0) {
        const under = 86 + fn * 26;
        r = mix(r, under * 1.0, peel);
        g = mix(g, under * 0.94, peel);
        b = mix(b, under * 0.9, peel);
      }
      r = mix(r, r * 1.12, peelEdge);
      g = mix(g, g * 1.12, peelEdge);
      b = mix(b, b * 1.1, peelEdge);
      r = mix(r, 40, crack * 0.75);
      g = mix(g, 38, crack * 0.75);
      b = mix(b, 36, crack * 0.75);
      const o = i * 4;
      albedo[o] = r;
      albedo[o + 1] = g;
      albedo[o + 2] = b;
      orm[o + 1] = 238 + (fn - 0.5) * 30 - peel * 12;
      height[i] = 0.55 + (fn - 0.5) * 0.28 + (wn - 0.5) * 0.14 - peel * 0.25 - crack * 0.3 + peelEdge * 0.08;
    }
  }
  return finishMaterial(ctx, tb, { tile: 4, normalStrength: 4 });
}

// ---------------------------------------------------------------------------------------------
// corrugated sheet metal
// ---------------------------------------------------------------------------------------------

export function paintCorrugated(ctx: PaintCtx, rusty: boolean): THREE.MeshStandardMaterial {
  const tb = new TexBuilder(N);
  const { bank } = ctx;
  const { albedo, orm, height } = tb;
  const ribs = 32;
  const pitch = N / ribs; // 16 px
  const prof = new Float32Array(N);
  const slope = new Float32Array(N);
  for (let x = 0; x < N; x++) {
    const ph = ((x + 0.5) / pitch) * Math.PI * 2;
    prof[x] = 0.5 + 0.5 * Math.sin(ph);
    slope[x] = Math.cos(ph);
  }
  const screwRows = 6;
  const screwSpacing = N / screwRows;
  for (let y = 0; y < N; y++) {
    const rowB = y << SS;
    const dyScrew = (y % screwSpacing) - screwSpacing * 0.25; // screws sit 1/4 of the way into each row band
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const bi = rowB | x;
      const p = prof[x]!;
      const sl = slope[x]!;
      const mac = bank.macro[bi]!;
      const md = bank.mid[(bi + 300) & MASK]!;
      const fn = bank.fine[bi]!;
      const wn = bank.white[bi]! / 255;
      const sv = bank.streakV[(bi + 6001) & MASK]!;
      const sh = bank.streakH[(bi + 1500) & MASK]!;
      // galvanised finish: bright ridges, shaded troughs
      let v = 144 + (mac - 0.5) * 30 + (fn - 0.5) * 12;
      v *= 0.7 + 0.3 * p;
      v += sl * 6;
      const scratch = sstep(0.83, 0.93, sh) * 0.5;
      v += scratch * 14;
      // rust: streaks running down + pitting; more in troughs (water collects)
      const rust = rusty
        ? clamp(0.8 + (md - 0.5) * 0.5 + (sv - 0.5) * 0.4 + (fn - 0.5) * 0.3 - (p > 0.85 ? 0.12 : 0), 0.4, 1)
        : sstep(0.66, 0.86, sv) * 0.6;
      // screws
      const ridgeIdx = Math.floor(x / pitch);
      let screw = 0;
      let screwRust = 0;
      if ((ridgeIdx & 1) === 0) {
        const cx = (ridgeIdx + 0.25) * pitch; // crest of this ridge
        const dx = x - cx;
        const d = Math.sqrt(dx * dx + dyScrew * dyScrew);
        screw = 1 - sstep(2.0, 3.0, d);
        // texture rows grow upward (v), so rust runs toward smaller y (down the wall)
        screwRust = dyScrew < 0 ? (1 - sstep(0, 3.6, Math.abs(dx))) * (1 - sstep(0, 26, -dyScrew)) * 0.6 : 0;
      }
      let r = v * 0.97;
      let g = v * 1.0;
      let b = v * 1.05 + 3;
      const rr = clamp(rust + screwRust, 0, 1);
      const rt = 0.7 + fn * 0.45 + (rusty ? (mac - 0.5) * 0.4 : 0);
      r = mix(r, (rusty ? 136 : 128) * rt, rr);
      g = mix(g, (rusty ? 78 : 70) * rt, rr);
      b = mix(b, (rusty ? 46 : 40) * rt, rr);
      if (rusty) {
        // remaining galvanised specks on ridge tops
        const spec = sstep(0.75, 0.95, p) * sstep(0.7, 0.9, wn * 0.5 + fn * 0.6) * 0.5;
        r = mix(r, 138, spec);
        g = mix(g, 142, spec);
        b = mix(b, 146, spec);
      }
      r = mix(r, 40, screw * 0.6);
      g = mix(g, 42, screw * 0.6);
      b = mix(b, 46, screw * 0.6);
      const o = i * 4;
      albedo[o] = r;
      albedo[o + 1] = g;
      albedo[o + 2] = b;
      orm[o + 1] = clamp((rusty ? 175 : 96) + (1 - p) * 30 + rr * 100 + (fn - 0.5) * 50, 0, 255);
      orm[o + 2] = clamp((rusty ? 130 : 215) * (1 - rr * 0.7) - screw * 20, 0, 255);
      height[i] = 0.25 + p * 0.55 + (fn - 0.5) * 0.06 - rr * 0.05 + screw * 0.05 - (wn < 0.01 ? 0.04 : 0);
    }
  }
  // the ribs are identical for both variants: share one normal map
  let normal = ctx.shared.get('corrugatedNormal');
  if (!normal) {
    normal = ctx.track(makeDataTexture(tb.toNormal(6.5), N, N, false));
    ctx.shared.set('corrugatedNormal', normal);
  }
  return finishMaterial(ctx, tb, { tile: 2.4, normalMap: normal, metal: true });
}

// ---------------------------------------------------------------------------------------------
// industrial panel siding and olive drab metal
// ---------------------------------------------------------------------------------------------

function paintPaneled(ctx: PaintCtx, cfg: { color: [number, number, number]; cols: number; rows: number; olive: boolean }): THREE.MeshStandardMaterial {
  const tb = new TexBuilder(N);
  const { bank } = ctx;
  const { albedo, orm, height } = tb;
  const pw = N / cfg.cols;
  const ph = N / cfg.rows;
  for (let y = 0; y < N; y++) {
    const rowB = y << SS;
    const row = Math.floor(y / ph);
    const yin = y % ph;
    const dy = Math.min(yin, ph - yin);
    const shift = (row & 1) * pw * 0.5;
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const bi = rowB | x;
      const xs = (x + shift) % N;
      const col = Math.floor(xs / pw);
      const xin = xs % pw;
      const dx = Math.min(xin, pw - xin);
      const dj = Math.min(dx, dy);
      const panel = hash2(col, row, cfg.olive ? 41 : 43);
      const mac = bank.macro[bi]!;
      const md = bank.mid[(bi + 99) & MASK]!;
      const fn = bank.fine[bi]!;
      const wn = bank.white[bi]! / 255;
      const sv = bank.streakV[(bi + 2222) & MASK]!;
      const sh = bank.streakH[(bi + 6262) & MASK]!;
      let k = 0.94 + (panel - 0.5) * 0.1 + (mac - 0.5) * 0.2 + (fn - 0.5) * 0.08;
      const streak = sstep(0.65, 0.9, sv) * sstep(0.35, 0.7, md);
      k *= 1 - streak * 0.28;
      let [r, g, b] = cfg.color;
      r *= k;
      g *= k;
      b *= k;
      // seams and rivets
      const seam = 1 - sstep(0.7, 2.0, dj);
      const rivPitch = 32;
      const rvx = ((x + shift) % rivPitch) - rivPitch / 2;
      const rvy = dy - 6;
      const rivetRow = (1 - sstep(0.6, 1.4, Math.abs(rvy))) * 1;
      const rd = Math.sqrt(rvx * rvx + rvy * rvy);
      const rivet = (1 - sstep(1.5, 2.4, rd)) * (rivetRow > 0 ? 1 : 0.0) * (dy < 10 ? 1 : 0);
      r *= 1 - seam * 0.4;
      g *= 1 - seam * 0.4;
      b *= 1 - seam * 0.4;
      r += rivet * 26;
      g += rivet * 26;
      b += rivet * 28;
      let metalK = cfg.olive ? 0.4 : 0.72;
      let rough = cfg.olive ? 178 : 128;
      if (cfg.olive) {
        // chipped paint: exposes steel and rust, mostly along seams and edges
        const edgeNear = 1 - sstep(2, 16, dj);
        const chipN = wn * 0.45 + fn * 0.4 + bank.vf1[bi]! * 0.15;
        const chip = sstep(0.72 - edgeNear * 0.2, 0.8 - edgeNear * 0.2, chipN) * (0.35 + 0.65 * sstep(0.35, 0.6, md + edgeNear * 0.3));
        const scr = sstep(0.86, 0.94, sh) * 0.7;
        const bare = clamp(chip + scr * 0.5, 0, 1);
        const rustish = sstep(0.62, 0.8, bank.vid[bi]!) * bare * 0.7;
        r = mix(r, mix(112, 128, rustish), bare * 0.9);
        g = mix(g, mix(114, 70, rustish), bare * 0.9);
        b = mix(b, mix(112, 40, rustish), bare * 0.9);
        metalK = mix(0.4, 0.8, bare * (1 - rustish));
        rough = mix(178, 140, bare) + rustish * 60;
      } else {
        const scr = sstep(0.85, 0.94, sh);
        r += scr * 14;
        g += scr * 14;
        b += scr * 16;
        rough = 118 + (fn - 0.5) * 50 + streak * 40;
      }
      const o = i * 4;
      albedo[o] = r;
      albedo[o + 1] = g;
      albedo[o + 2] = b;
      orm[o + 1] = rough + (wn - 0.5) * 16;
      orm[o + 2] = metalK * 255;
      height[i] = 0.5 - seam * 0.3 + rivet * 0.25 + (fn - 0.5) * 0.04 + (wn - 0.5) * 0.02;
    }
  }
  return finishMaterial(ctx, tb, { tile: 3, normalStrength: 3, metal: true });
}

export const paintMetalPanel = (ctx: PaintCtx) => paintPaneled(ctx, { color: [122, 131, 140], cols: 2, rows: 4, olive: false });
export const paintOliveMetal = (ctx: PaintCtx) => paintPaneled(ctx, { color: [70, 80, 52], cols: 2, rows: 2, olive: true });

// ---------------------------------------------------------------------------------------------
// tile, wood, lab panel
// ---------------------------------------------------------------------------------------------

export function paintTile(ctx: PaintCtx): THREE.MeshStandardMaterial {
  const tb = new TexBuilder(N);
  const { bank } = ctx;
  const { albedo, orm, height } = tb;
  const tiles = 8;
  const cell = N / tiles;
  for (let y = 0; y < N; y++) {
    const rowB = y << SS;
    const ty = Math.floor(y / cell);
    const yin = y % cell;
    const dyj = Math.min(yin, cell - yin);
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const bi = rowB | x;
      const tx = Math.floor(x / cell);
      const xin = x % cell;
      const dxj = Math.min(xin, cell - xin);
      const mac = bank.macro[bi]!;
      const md = bank.mid[(bi + 606) & MASK]!;
      const fn = bank.fine[bi]!;
      const wn = bank.white[bi]! / 255;
      const sv = bank.streakV[(bi + 808) & MASK]!;
      const th = hash2(tx, ty, 61);
      let v = 176 + (th - 0.5) * 12 + (mac - 0.5) * 14 + (fn - 0.5) * 6;
      const grime = sstep(0.55, 0.95, md + (fn - 0.5) * 0.3) * 0.12 + sstep(0.72, 0.92, sv) * 0.09;
      v *= 1 - grime;
      let r = v * 0.97;
      let g = v * 1.0 + 1;
      let b = v * 1.04 + 4;
      // cracked tiles
      if (th > 0.9) {
        const c = Math.abs(xin - yin * 0.8 - cell * 0.15);
        const cr = (1 - sstep(0.4, 1.1, c)) * (yin > 6 && yin < cell - 6 ? 1 : 0);
        r = mix(r, 50, cr * 0.85);
        g = mix(g, 52, cr * 0.85);
        b = mix(b, 56, cr * 0.85);
      }
      // grout
      const dj = Math.min(dxj, dyj);
      const grout = 1 - sstep(0.9, 2.5, dj);
      const gv = 104 - sstep(0.5, 0.8, md) * 34 + (wn - 0.5) * 20;
      r = mix(r, gv, grout);
      g = mix(g, gv, grout);
      b = mix(b, gv * 0.98, grout);
      // chipped corner (dark) on some tiles
      if (th < 0.08) {
        const cd = Math.sqrt(xin * xin + yin * yin);
        const ch = 1 - sstep(4, 9, cd);
        r = mix(r, 84, ch * 0.8);
        g = mix(g, 86, ch * 0.8);
        b = mix(b, 88, ch * 0.8);
      }
      const o = i * 4;
      albedo[o] = r;
      albedo[o + 1] = g;
      albedo[o + 2] = b;
      orm[o + 1] = 58 + grime * 260 + grout * 90 + (fn - 0.5) * 24;
      height[i] = 0.5 - grout * 0.4 + (wn - 0.5) * 0.02;
    }
  }
  return finishMaterial(ctx, tb, { tile: 2, normalStrength: 3 });
}

export function paintWood(ctx: PaintCtx): THREE.MeshStandardMaterial {
  const tb = new TexBuilder(N);
  const { bank } = ctx;
  const { albedo, orm, height } = tb;
  const planks = 8;
  const pw = N / planks; // plank width in px (64)
  for (let y = 0; y < N; y++) {
    const rowB = y << SS;
    const p = Math.floor(y / pw);
    const yin = y % pw;
    const dyj = Math.min(yin, pw - yin);
    const xj = Math.floor(hash2(p, 3, 71) * (N - 160) + 80);
    const gapY = 1 - sstep(0.6, 1.9, dyj);
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const bi = rowB | x;
      const seg = x >= xj ? 1 : 0;
      const piece = hash2(p, seg, 73);
      const dxj = Math.min(Math.abs(x - xj), x, N - x);
      const gapX = 1 - sstep(0.6, 1.9, dxj);
      const md = bank.mid[(bi + 9999) & MASK]!;
      const mac = bank.macro[bi]!;
      const fn = bank.fine[bi]!;
      const wn = bank.white[bi]! / 255;
      // long grain lines along X
      const gy = (y + Math.floor(piece * 211)) & SM;
      const gx = (x * 1 + Math.floor(piece * 331)) & SM;
      const grain = bank.streakH[(gy << SS) | gx]!;
      const ring = 0.5 + 0.5 * Math.sin((yin / pw) * 18.8 + fn * 4 + piece * 6);
      let v = 100 + (piece - 0.5) * 22 + (grain - 0.5) * 34 + ring * 8 + (mac - 0.5) * 18;
      // bleached weathering / dark stain
      const weather = sstep(0.55, 0.8, md);
      v += weather * 14;
      const dark = sstep(0.68, 0.9, bank.mid[(bi + 41) & MASK]!);
      v -= dark * 18;
      // knots
      const kx = hash2(p, seg, 83) * 300 + xj * (seg ? 0.5 : 0) + 50;
      const ky = pw * (0.3 + 0.4 * hash2(p, seg, 89));
      const kd = Math.sqrt(((x - kx) * 0.6) ** 2 + (yin - ky) ** 2);
      const knot = hash2(p, seg, 97) > 0.5 ? 1 - sstep(4, 10, kd) : 0;
      let r = v * 1.03 + 2;
      let g = v * 0.94;
      let b = v * 0.8 + 2;
      // silver-grey weathering tint
      r = mix(r, v * 0.98, weather * 0.5);
      g = mix(g, v * 0.97, weather * 0.5);
      b = mix(b, v * 0.95, weather * 0.5);
      const kk = 1 - knot * 0.45 - (kd < 10 && kd > 5 ? 0.05 : 0);
      r *= kk;
      g *= kk;
      b *= kk;
      // splits along the grain
      const split = sstep(0.9, 0.97, grain) * sstep(0.6, 0.8, fn) * 0.6;
      r *= 1 - split * 0.6;
      g *= 1 - split * 0.6;
      b *= 1 - split * 0.6;
      // nails near piece ends
      const dxEnd = Math.min(Math.abs(x - xj), x, N - x);
      const nailY = Math.abs(yin - pw * 0.5) - 14;
      const nail = dxEnd > 4 && dxEnd < 12 && Math.abs(nailY) < 2.5 ? 1 - sstep(1.4, 2.6, Math.sqrt((dxEnd - 8) ** 2 + nailY * nailY)) : 0;
      r = mix(r, 40, nail * 0.8);
      g = mix(g, 40, nail * 0.8);
      b = mix(b, 42, nail * 0.8);
      const gap = Math.max(gapX, gapY);
      r = mix(r, 22, gap * 0.9);
      g = mix(g, 20, gap * 0.9);
      b = mix(b, 18, gap * 0.9);
      const o = i * 4;
      albedo[o] = r;
      albedo[o + 1] = g;
      albedo[o + 2] = b;
      orm[o + 1] = 215 + (grain - 0.5) * 40 + weather * 20;
      height[i] = 0.55 + (grain - 0.5) * 0.14 + (wn - 0.5) * 0.04 - gap * 0.45 + nail * 0.08 - split * 0.2 + sstep(0, 3, Math.min(dyj, dxj)) * 0.05;
    }
  }
  return finishMaterial(ctx, tb, { tile: 2, normalStrength: 3.8 });
}

export function paintLabPanel(ctx: PaintCtx): THREE.MeshStandardMaterial {
  const tb = new TexBuilder(N);
  const { bank } = ctx;
  const { albedo, orm, height } = tb;
  const cols = 4;
  const rows = 4;
  const pw = N / cols;
  const ph = N / rows;
  for (let y = 0; y < N; y++) {
    const rowB = y << SS;
    const row = Math.floor(y / ph);
    const yin = y % ph;
    const dy = Math.min(yin, ph - yin);
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const bi = rowB | x;
      const col = Math.floor(x / pw);
      const xin = x % pw;
      const dx = Math.min(xin, pw - xin);
      const dj = Math.min(dx, dy);
      const panel = hash2(col, row, 101);
      const mac = bank.macro[bi]!;
      const md = bank.mid[(bi + 700) & MASK]!;
      const fn = bank.fine[bi]!;
      const wn = bank.white[bi]! / 255;
      const sv = bank.streakV[(bi + 1717) & MASK]!;
      let v = 196 + (panel - 0.5) * 8 + (mac - 0.5) * 12 + (fn - 0.5) * 6;
      v *= 1 - sstep(0.6, 0.86, md) * 0.16 - sstep(0.7, 0.92, sv) * 0.1;
      let r = v * 0.96;
      let g = v * 1.0;
      let b = v * 1.03 + 3;
      const seam = 1 - sstep(0.7, 1.8, dj);
      r *= 1 - seam * 0.45;
      g *= 1 - seam * 0.45;
      b *= 1 - seam * 0.42;
      // screws in the corners
      const sx = Math.min(Math.abs(xin - 8), Math.abs(xin - (pw - 8)));
      const sy = Math.min(Math.abs(yin - 8), Math.abs(yin - (ph - 8)));
      const screw = 1 - sstep(1.6, 2.6, Math.sqrt(sx * sx + sy * sy));
      r = mix(r, 90, screw * 0.7);
      g = mix(g, 92, screw * 0.7);
      b = mix(b, 96, screw * 0.7);
      // vent slots on some panels
      if (panel > 0.55) {
        const vy = (yin - ph * 0.3) / 6;
        const inSlot = xin > pw * 0.2 && xin < pw * 0.8 && vy > 0 && vy < 6 && vy % 1 < 0.45;
        if (inSlot) {
          r *= 0.35;
          g *= 0.37;
          b *= 0.4;
        }
      }
      // status LED
      if (panel < 0.25) {
        const ld = Math.sqrt((xin - pw * 0.82) ** 2 + (yin - ph * 0.82) ** 2);
        const led = 1 - sstep(2, 3.2, ld);
        const lc = panel < 0.12 ? [60, 200, 90] : [230, 160, 60];
        r = mix(r, lc[0]!, led);
        g = mix(g, lc[1]!, led);
        b = mix(b, lc[2]!, led);
      }
      const o = i * 4;
      albedo[o] = r;
      albedo[o + 1] = g;
      albedo[o + 2] = b;
      orm[o + 1] = 82 + (fn - 0.5) * 40 + sstep(0.6, 0.86, md) * 60;
      orm[o + 2] = 40;
      height[i] = 0.5 - seam * 0.3 + (wn - 0.5) * 0.02 + screw * 0.1;
    }
  }
  return finishMaterial(ctx, tb, { tile: 1.5, normalStrength: 2.4, metal: true });
}
