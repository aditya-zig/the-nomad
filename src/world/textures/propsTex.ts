/**
 * Prop material painters: barrels, canvas / sandbag / tarp fabrics, wooden and military crates, pallets, cardboard.
 */
import * as THREE from 'three';
import {
  type PaintCtx,
  SM,
  SS,
  TexBuilder,
  clamp,
  finishMaterial,
  hash2,
  makeDataTexture,
  mix,
  sstep,
} from './core';
import { drawFittedText, overlayCanvas } from './stencil';

const MASK512 = 512 * 512 - 1;

// ---------------------------------------------------------------------------------------------
// barrels (cylinder UV: u around the drum, v up its height)
// ---------------------------------------------------------------------------------------------

export interface BarrelSpec {
  color: [number, number, number];
  rust: number;
  kind: 'plain' | 'bio' | 'chem';
  seed: number;
}

function barrelProfile(v: number): number {
  // raised hoops at 1/3 and 2/3 height, chime rims at both ends
  const h1 = Math.exp(-(((v - 0.33) / 0.02) ** 2));
  const h2 = Math.exp(-(((v - 0.67) / 0.02) ** 2));
  const rimB = sstep(0.06, 0.02, v);
  const rimT = sstep(0.94, 0.98, v);
  return Math.max(h1, h2, rimB * 0.9, rimT * 0.9);
}

export function paintBarrel(ctx: PaintCtx, spec: BarrelSpec): THREE.MeshStandardMaterial {
  const N = 512;
  const tb = new TexBuilder(N);
  const { bank } = ctx;
  const { albedo, orm, height } = tb;
  const ox = Math.floor(hash2(spec.seed, 4, 7) * 400);
  const oy = Math.floor(hash2(spec.seed, 5, 7) * 400);
  for (let y = 0; y < N; y++) {
    const v = y / N;
    const rowB = ((y + oy) & SM) << SS;
    const prof = barrelProfile(v);
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const bi = rowB | ((x + ox) & SM);
      const mac = bank.macro[bi]!;
      const md = bank.mid[(bi + 3131) & MASK512]!;
      const fn = bank.fine[bi]!;
      const wn = bank.white[bi]! / 255;
      const sv = bank.streakV[(bi + 909) & MASK512]!;
      let k = 0.78 + prof * 0.2 + (mac - 0.5) * 0.24 + (fn - 0.5) * 0.1;
      // dents show as broad shading
      k *= 1 + (md - 0.5) * 0.16;
      const drip = sstep(0.62, 0.9, sv) * (0.35 + 0.65 * sstep(0.5, 0.9, 1 - Math.abs(v - 0.5) * 2));
      k *= 1 - drip * 0.3;
      let r = spec.color[0] * k;
      let g = spec.color[1] * k;
      let b = spec.color[2] * k;
      // chipped paint on hoops and rims -> steel -> rust
      const edgeWear = Math.max(prof, 0.15);
      const chipN = wn * 0.35 + fn * 0.35 + bank.vf1[bi]! * 0.3;
      const chip = sstep(0.7 - spec.rust * 0.18, 0.8 - spec.rust * 0.18, chipN) * edgeWear;
      const bloom = sstep(0.55 - spec.rust * 0.3, 0.8 - spec.rust * 0.3, md * 0.55 + sv * 0.35 + (prof * 0.2)) * spec.rust;
      const rusted = clamp(chip * (0.4 + spec.rust) + bloom, 0, 1);
      const rt = 0.72 + fn * 0.55;
      r = mix(r, 134 * rt, rusted);
      g = mix(g, 74 * rt, rusted);
      b = mix(b, 42 * rt, rusted);
      const bare = chip * (1 - rusted) * 0.7;
      r = mix(r, 116, bare);
      g = mix(g, 118, bare);
      b = mix(b, 120, bare);
      const o = i * 4;
      albedo[o] = r;
      albedo[o + 1] = g;
      albedo[o + 2] = b;
      orm[o + 1] = clamp(120 + rusted * 100 - bare * 40 + (fn - 0.5) * 50 + (1 - prof) * 10, 0, 255);
      orm[o + 2] = clamp(90 + bare * 150 + chip * 30 - rusted * 50, 0, 255);
      height[i] = 0.4 + prof * 0.5 + (md - 0.5) * 0.06 + (fn - 0.5) * 0.02;
    }
  }
  // stencilled labels / hazard markings
  overlayCanvas(
    tb,
    bank,
    (g, n) => {
      const labels = [0.25, 0.75];
      for (const cx of labels) {
        const w = n * 0.24;
        const h = n * 0.26;
        const x = n * cx - w / 2;
        const y = n * 0.37;
        if (spec.kind === 'bio') {
          g.fillStyle = 'rgba(24,24,22,0.94)';
          g.fillRect(x, y - n * 0.04, w, h + n * 0.08);
          g.strokeStyle = 'rgba(214,176,36,0.95)';
          g.lineWidth = 3;
          g.strokeRect(x + 6, y - n * 0.04 + 6, w - 12, h + n * 0.08 - 12);
          // biohazard emblem: three lobes and a ring
          g.save();
          g.translate(x + w / 2, y + h / 2 - 4);
          g.strokeStyle = 'rgba(214,176,36,0.95)';
          g.fillStyle = 'rgba(214,176,36,0.95)';
          for (let k = 0; k < 3; k++) {
            g.save();
            g.rotate((k * Math.PI * 2) / 3);
            g.beginPath();
            g.arc(0, -h * 0.22, h * 0.2, 0, Math.PI * 2);
            g.fill();
            g.globalCompositeOperation = 'destination-out';
            g.beginPath();
            g.arc(0, -h * 0.27, h * 0.14, 0, Math.PI * 2);
            g.fill();
            g.globalCompositeOperation = 'source-over';
            g.restore();
          }
          g.lineWidth = 4;
          g.beginPath();
          g.arc(0, 0, h * 0.08, 0, Math.PI * 2);
          g.stroke();
          g.restore();
          drawFittedText(g, 'BIOHAZARD', x, y + h * 0.78, w, h * 0.3, { color: 'rgba(214,176,36,0.95)', font: 'sans', fill: 0.9 });
        } else {
          g.fillStyle = 'rgba(222,220,208,0.9)';
          g.fillRect(x, y, w, h);
          g.strokeStyle = 'rgba(20,20,20,0.85)';
          g.lineWidth = 2.5;
          g.strokeRect(x + 4, y + 4, w - 8, h - 8);
          drawFittedText(g, spec.kind === 'chem' ? 'CAUSTIC\nUN 1A1 220L' : 'NGF-44\nDRUM 220L', x + 8, y + 8, w - 16, h * 0.6, { color: 'rgba(20,20,20,0.9)', font: 'stencil', fill: 0.92 });
          // hazard diamond
          g.save();
          g.translate(x + w * 0.5, y + h * 0.8);
          g.rotate(Math.PI / 4);
          g.fillStyle = spec.kind === 'chem' ? 'rgba(200,60,30,0.95)' : 'rgba(30,30,30,0.9)';
          g.fillRect(-h * 0.09, -h * 0.09, h * 0.18, h * 0.18);
          g.restore();
        }
      }
    },
    0.3,
    spec.seed,
  );
  // hoops and dents are identical for every barrel: share one normal map
  let normal = ctx.shared.get('barrelNormal');
  if (!normal) {
    normal = ctx.track(makeDataTexture(tb.toNormal(5), N, N, false));
    ctx.shared.set('barrelNormal', normal);
  }
  return finishMaterial(ctx, tb, { tile: 1, normalMap: normal, metal: true });
}

// ---------------------------------------------------------------------------------------------
// fabrics
// ---------------------------------------------------------------------------------------------

export function paintCanvas(ctx: PaintCtx, tan: boolean): THREE.MeshStandardMaterial {
  const n = 256;
  const tb = new TexBuilder(n);
  const { bank } = ctx;
  const { albedo, orm, height } = tb;
  const base: [number, number, number] = tan ? [148, 136, 104] : [82, 90, 62];
  for (let y = 0; y < n; y++) {
    const rowB = ((y * 2) & SM) << SS;
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const bi = rowB | ((x * 2) & SM);
      const cx = Math.floor(x / 4);
      const cy = Math.floor(y / 4);
      const over = (cx + cy) & 1;
      const fx = (x % 4) / 4;
      const fy = (y % 4) / 4;
      const warp = 0.5 + 0.5 * Math.cos(fx * Math.PI * 2 - Math.PI);
      const weft = 0.5 + 0.5 * Math.cos(fy * Math.PI * 2 - Math.PI);
      const hgt = over ? 0.55 + warp * 0.4 : 0.55 + weft * 0.4;
      const th = hash2(cx & 63, cy & 63, 3);
      const mac = bank.macro[bi]!;
      const md = bank.mid[(bi + 100) & MASK512]!;
      const fn = bank.fine[bi]!;
      let k = 0.74 + hgt * 0.3 + (th - 0.5) * 0.14 + (mac - 0.5) * 0.12;
      // dirt and mildew
      const dirt = sstep(0.45, 0.95, md + (fn - 0.5) * 0.3);
      const mildew = sstep(0.84, 0.95, bank.mid[(bi + 700) & MASK512]!) * (fn > 0.5 ? 1 : 0.3);
      k *= 1 - dirt * 0.16;
      let r = base[0] * k;
      let g = base[1] * k;
      let b = base[2] * k;
      r = mix(r, 36, mildew * 0.35);
      g = mix(g, 44, mildew * 0.35);
      b = mix(b, 32, mildew * 0.35);
      // stitched seams at y = 0 and y = 128
      const sy = Math.min(y % 128, 128 - (y % 128));
      const seam = 1 - sstep(1.2, 2.4, sy);
      const dash = seam * (x % 12 < 7 ? 1 : 0.35);
      r = mix(r, base[0] * 0.5, dash * 0.7);
      g = mix(g, base[1] * 0.5, dash * 0.7);
      b = mix(b, base[2] * 0.5, dash * 0.7);
      const o = i * 4;
      albedo[o] = r;
      albedo[o + 1] = g;
      albedo[o + 2] = b;
      orm[o + 1] = 250;
      height[i] = hgt * 0.8 + (fn - 0.5) * 0.1 - seam * 0.2;
    }
  }
  return finishMaterial(ctx, tb, { tile: 1.2, normalStrength: 3.2 });
}

export function paintSandbag(ctx: PaintCtx): THREE.MeshStandardMaterial {
  const N = 512;
  const tb = new TexBuilder(N);
  const { bank } = ctx;
  const { albedo, orm, height } = tb;
  for (let y = 0; y < N; y++) {
    const rowB = y << SS;
    const v = y / N;
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const bi = rowB | x;
      const mac = bank.macro[bi]!;
      const md = bank.mid[(bi + 2222) & MASK512]!;
      const fn = bank.fine[bi]!;
      const wn = bank.white[bi]! / 255;
      // coarse burlap weave with slubs
      const cx = Math.floor(x / 8);
      const cy = Math.floor(y / 8);
      const over = (cx + cy) & 1;
      const fx = (x % 8) / 8;
      const fy = (y % 8) / 8;
      const wave = over ? 0.5 + 0.5 * Math.cos(fx * Math.PI * 2 - Math.PI) : 0.5 + 0.5 * Math.cos(fy * Math.PI * 2 - Math.PI);
      const slub = hash2(cx, cy, 11) * 0.5 + (over ? hash2(cx, 0, 13) : hash2(0, cy, 17)) * 0.5; // 64 threads per tile
      // wrinkles: ridged noise drives folds
      const wr = 1 - Math.abs(2 * md - 1);
      const fold = wr * wr;
      let k = 0.7 + wave * 0.16 + slub * 0.22 + fold * 0.2 + (mac - 0.5) * 0.1;
      const damp = sstep(0.55, 0.95, bank.mid[(bi + 4001) & MASK512]! + (fn - 0.5) * 0.3);
      k *= 1 - damp * 0.16 - sstep(0.7, 0.92, fn) * 0.06;
      let r = 142 * k;
      let g = 124 * k;
      let b = 92 * k;
      // stitched seam near the mouth of the bag
      const sd = Math.abs(v - 0.88) * N;
      const stitch = (1 - sstep(1.2, 2.4, sd)) * (x % 10 < 6 ? 1 : 0.2);
      r = mix(r, 60, stitch * 0.7);
      g = mix(g, 52, stitch * 0.7);
      b = mix(b, 40, stitch * 0.7);
      const o = i * 4;
      albedo[o] = r;
      albedo[o + 1] = g;
      albedo[o + 2] = b;
      orm[o + 1] = 252;
      height[i] = wave * 0.3 + slub * 0.15 + fold * 0.55 + (wn - 0.5) * 0.04;
    }
  }
  return finishMaterial(ctx, tb, { tile: 1, normalStrength: 4 });
}

export function paintTarp(ctx: PaintCtx): THREE.MeshStandardMaterial {
  const n = 256;
  const tb = new TexBuilder(n);
  const { bank } = ctx;
  const { albedo, orm, height } = tb;
  for (let y = 0; y < n; y++) {
    const rowB = ((y * 2) & SM) << SS;
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const bi = rowB | ((x * 2) & SM);
      const mac = bank.macro[bi]!;
      const md = bank.mid[(bi + 1600) & MASK512]!;
      const fn = bank.fine[bi]!;
      const crease = 1 - Math.abs(2 * md - 1);
      const gx = Math.min(x % 32, 32 - (x % 32));
      const gy = Math.min(y % 32, 32 - (y % 32));
      const grid = 1 - sstep(0.4, 1.3, Math.min(gx, gy));
      let k = 0.88 + (mac - 0.5) * 0.14 + crease * crease * 0.12 + grid * 0.05 + (fn - 0.5) * 0.06;
      k *= 1 - sstep(0.7, 0.95, md) * 0.08;
      const o = i * 4;
      albedo[o] = 82 * k;
      albedo[o + 1] = 94 * k;
      albedo[o + 2] = 106 * k;
      orm[o + 1] = 145 + (fn - 0.5) * 40;
      height[i] = crease * crease * 0.6 + grid * 0.1;
    }
  }
  return finishMaterial(ctx, tb, { tile: 2, normalStrength: 3 });
}

// ---------------------------------------------------------------------------------------------
// crates, pallet, cardboard
// ---------------------------------------------------------------------------------------------

/** Distance (in 0..1 units) from point to a rectangle's boundary lines is handled by callers; helpers below. */
export function paintCrateWood(ctx: PaintCtx): THREE.MeshStandardMaterial {
  const N = 512;
  const tb = new TexBuilder(N);
  const { bank } = ctx;
  const { albedo, orm, height } = tb;
  const b = 0.09; // frame width
  const planks = 4;
  const ph = (1 - 2 * b) / planks;
  for (let y = 0; y < N; y++) {
    const v = y / N;
    const rowB = y << SS;
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const u = x / N;
      const bi = rowB | x;
      // which piece are we on?
      const inLeft = u < b;
      const inRight = u > 1 - b;
      const inBottom = !inLeft && !inRight && v < b;
      const inTop = !inLeft && !inRight && v > 1 - b;
      let piece: number;
      let vertical = false;
      let edge: number; // distance to piece boundary in px
      if (inLeft) {
        piece = 1;
        vertical = true;
        edge = Math.min(u, b - u) * N;
      } else if (inRight) {
        piece = 2;
        vertical = true;
        edge = Math.min(1 - u, u - (1 - b)) * N;
      } else if (inBottom) {
        piece = 3;
        edge = Math.min(v, b - v) * N;
      } else if (inTop) {
        piece = 4;
        edge = Math.min(1 - v, v - (1 - b)) * N;
      } else {
        const p = Math.min(planks - 1, Math.floor((v - b) / ph));
        piece = 10 + p;
        const local = (v - b) - p * ph;
        edge = Math.min(local, ph - local) * N;
        // near frame edges the plank butts against the frame
        edge = Math.min(edge, (u - b) * N, (1 - b - u) * N);
      }
      // diagonal brace across the inner area
      const dBrace = Math.abs(u - v) * 0.7071;
      const brace = !inLeft && !inRight && !inBottom && !inTop ? 1 - sstep(0.048, 0.056, dBrace) : 0;
      const braceEdge = brace > 0 ? Math.min(Math.abs(dBrace - 0.052) * N, 3) : 9;
      const tone = hash2(piece, 0, 29);
      const grainSrc = vertical ? bank.streakV[((y + piece * 61) & SM) << SS | ((x * 2 + piece * 37) & SM)]! : bank.streakH[(((y * 2 + piece * 61) & SM) << SS) | ((x + piece * 37) & SM)]!;
      const mac = bank.macro[bi]!;
      const md = bank.mid[(bi + 5005) & MASK512]!;
      const fn = bank.fine[bi]!;
      const wn = bank.white[bi]! / 255;
      let val = 112 + (tone - 0.5) * 24 + (grainSrc - 0.5) * 40 + (mac - 0.5) * 20;
      const weather = sstep(0.55, 0.8, md);
      val += weather * 12;
      val -= sstep(0.7, 0.9, bank.mid[(bi + 61) & MASK512]!) * 22;
      if (brace > 0) val = val * 0.92 + 8;
      let r = val * 1.02 + 2;
      let g = val * 0.92;
      let bl = val * 0.78 + 2;
      // gaps between boards
      const gap = 1 - sstep(0.8, 2.4, edge);
      r = mix(r, 20, gap * 0.85);
      g = mix(g, 19, gap * 0.85);
      bl = mix(bl, 17, gap * 0.85);
      if (brace > 0) {
        const bg = 1 - sstep(0.6, 2.2, braceEdge);
        r = mix(r, 22, bg * 0.8);
        g = mix(g, 20, bg * 0.8);
        bl = mix(bl, 18, bg * 0.8);
      }
      // nails
      let nail = 0;
      const nx = [0.045, 0.955];
      for (const px of nx) {
        for (const py of [0.045, 0.5, 0.955]) {
          const d = Math.hypot((u - px) * N, (v - py) * N);
          nail = Math.max(nail, 1 - sstep(2.2, 3.6, d));
        }
      }
      r = mix(r, 44, nail * 0.85);
      g = mix(g, 40, nail * 0.85);
      bl = mix(bl, 38, nail * 0.85);
      const o = i * 4;
      albedo[o] = r;
      albedo[o + 1] = g;
      albedo[o + 2] = bl;
      orm[o + 1] = 228 + (fn - 0.5) * 30;
      height[i] = 0.55 + (grainSrc - 0.5) * 0.12 + (wn - 0.5) * 0.03 - gap * 0.5 + brace * 0.14 + nail * 0.06;
    }
  }
  return finishMaterial(ctx, tb, { tile: 1, normalStrength: 3.4 });
}

export function paintCrateMil(ctx: PaintCtx): THREE.MeshStandardMaterial {
  const N = 512;
  const tb = new TexBuilder(N);
  const { bank } = ctx;
  const { albedo, orm, height } = tb;
  const flange = 0.05;
  for (let y = 0; y < N; y++) {
    const v = y / N;
    const rowB = y << SS;
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const u = x / N;
      const bi = rowB | x;
      const mac = bank.macro[bi]!;
      const md = bank.mid[(bi + 606) & MASK512]!;
      const fn = bank.fine[bi]!;
      const wn = bank.white[bi]! / 255;
      const sh = bank.streakH[(bi + 44) & MASK512]!;
      const dEdge = Math.min(u, 1 - u, v, 1 - v);
      const inFlange = dEdge < flange;
      // stamped panel: recessed field inside the flange, three raised ribs
      const rib = Math.max(
        Math.exp(-(((v - 0.3) / 0.018) ** 2)),
        Math.exp(-(((v - 0.5) / 0.018) ** 2)),
        Math.exp(-(((v - 0.7) / 0.018) ** 2)),
      );
      const step = sstep(flange, flange + 0.012, dEdge);
      let k = 0.9 + (mac - 0.5) * 0.24 + (fn - 0.5) * 0.08 + rib * 0.06 - step * 0.02;
      // paint wear near edges + scuffs + dirt
      const edgeWear = 1 - sstep(0.0, 0.035, dEdge);
      const chipN = wn * 0.4 + fn * 0.3 + bank.vf1[bi]! * 0.3;
      const chip = sstep(0.68 - edgeWear * 0.18, 0.78 - edgeWear * 0.18, chipN) * (0.3 + edgeWear * 0.7);
      const scuff = sstep(0.82, 0.93, sh) * 0.5;
      k *= 1 - sstep(0.65, 0.88, md) * 0.22;
      let r = 70 * k;
      let g = 80 * k;
      let b = 52 * k;
      const rustish = sstep(0.5, 0.75, bank.vid[bi]!) * chip;
      const bare = clamp(chip + scuff * 0.4, 0, 1);
      r = mix(r, mix(112, 128, rustish), bare * 0.85);
      g = mix(g, mix(114, 70, rustish), bare * 0.85);
      b = mix(b, mix(112, 40, rustish), bare * 0.85);
      // panel seam lines (the flange edge)
      const seam = 1 - sstep(0.0015, 0.005, Math.abs(dEdge - flange));
      r *= 1 - seam * 0.4;
      g *= 1 - seam * 0.4;
      b *= 1 - seam * 0.4;
      const o = i * 4;
      albedo[o] = r;
      albedo[o + 1] = g;
      albedo[o + 2] = b;
      orm[o + 1] = clamp(170 + bare * -30 + (fn - 0.5) * 40, 0, 255);
      orm[o + 2] = clamp(60 + bare * 160, 0, 255);
      height[i] = 0.5 + (inFlange ? 0.15 : 0) + rib * 0.2 - seam * 0.2 + (fn - 0.5) * 0.03;
    }
  }
  overlayCanvas(
    tb,
    bank,
    (g, n) => {
      drawFittedText(g, 'AMMO', n * 0.1, n * 0.08, n * 0.5, n * 0.17, { color: 'rgba(226,222,196,0.95)', font: 'stencil', bridges: true, fill: 0.95, align: 'left', letterSpacing: 0.05 });
      drawFittedText(g, '5.56MM BALL M855', n * 0.1, n * 0.27, n * 0.7, n * 0.07, { color: 'rgba(226,222,196,0.95)', font: 'stencil', fill: 0.95, align: 'left' });
      drawFittedText(g, 'LOT 44-B  QTY 720\nNGF-0442-OD', n * 0.1, n * 0.36, n * 0.54, n * 0.1, { color: 'rgba(226,222,196,0.9)', font: 'mono', fill: 0.9, align: 'left' });
      // yellow band and small hazard block
      g.fillStyle = 'rgba(206,168,40,0.92)';
      g.fillRect(n * 0.1, n * 0.74, n * 0.8, n * 0.035);
      g.fillStyle = 'rgba(206,168,40,0.92)';
      g.fillRect(n * 0.74, n * 0.1, n * 0.16, n * 0.16);
      g.fillStyle = 'rgba(30,32,22,0.9)';
      g.beginPath();
      g.moveTo(n * 0.82, n * 0.12);
      g.lineTo(n * 0.885, n * 0.24);
      g.lineTo(n * 0.755, n * 0.24);
      g.closePath();
      g.fill();
      drawFittedText(g, 'HANDLE WITH CARE', n * 0.1, n * 0.82, n * 0.8, n * 0.06, { color: 'rgba(226,222,196,0.85)', font: 'sans', fill: 0.9, align: 'left' });
    },
    0.32,
    17,
  );
  return finishMaterial(ctx, tb, { tile: 1, normalStrength: 3.2, metal: true });
}

export function paintPallet(ctx: PaintCtx): THREE.MeshStandardMaterial {
  const n = 256;
  const tb = new TexBuilder(n);
  const { bank } = ctx;
  const { albedo, orm, height } = tb;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const bi = (((y * 2 + 30) & SM) << SS) | ((x * 2) & SM);
      const grain = bank.streakH[bi]!;
      const mac = bank.macro[bi]!;
      const md = bank.mid[(bi + 88) & MASK512]!;
      const fn = bank.fine[bi]!;
      const ring = 0.5 + 0.5 * Math.sin((y / n) * 25 + fn * 3);
      let v = 138 + (grain - 0.5) * 42 + ring * 8 + (mac - 0.5) * 22;
      const weather = sstep(0.55, 0.8, md);
      v = v * (1 - weather * 0.12) + weather * 8;
      const o = i * 4;
      albedo[o] = v * 1.03;
      albedo[o + 1] = v * 0.92;
      albedo[o + 2] = v * 0.76;
      orm[o + 1] = 225 + (grain - 0.5) * 30;
      height[i] = 0.5 + (grain - 0.5) * 0.18 + ring * 0.05;
    }
  }
  return finishMaterial(ctx, tb, { tile: 1.2, normalStrength: 3 });
}

export function paintCardboard(ctx: PaintCtx): THREE.MeshStandardMaterial {
  const n = 256;
  const tb = new TexBuilder(n);
  const { bank } = ctx;
  const { albedo, orm, height } = tb;
  for (let y = 0; y < n; y++) {
    const v = y / n;
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const bi = (((y * 2) & SM) << SS) | ((x * 2) & SM);
      const mac = bank.macro[bi]!;
      const md = bank.mid[(bi + 505) & MASK512]!;
      const fn = bank.fine[bi]!;
      const wn = bank.white[bi]! / 255;
      const fibre = bank.streakH[(bi + 11) & MASK512]!;
      let k = 0.9 + (fibre - 0.5) * 0.14 + (mac - 0.5) * 0.18 + (fn - 0.5) * 0.06;
      k *= 1 - sstep(0.65, 0.88, md) * 0.2;
      let r = 168 * k;
      let g = 134 * k;
      let b = 92 * k;
      // packing tape band
      const tape = 1 - sstep(0.055, 0.07, Math.abs(v - 0.5));
      r = mix(r, 198 * (0.9 + fn * 0.1), tape * 0.7);
      g = mix(g, 176 * (0.9 + fn * 0.1), tape * 0.7);
      b = mix(b, 132 * (0.9 + fn * 0.1), tape * 0.7);
      const o = i * 4;
      albedo[o] = r;
      albedo[o + 1] = g;
      albedo[o + 2] = b;
      orm[o + 1] = 232 - tape * 110;
      height[i] = 0.5 + (fibre - 0.5) * 0.1 + tape * 0.05 + (wn - 0.5) * 0.02;
    }
  }
  overlayCanvas(
    tb,
    bank,
    (g, nn) => {
      g.strokeStyle = 'rgba(40,30,24,0.55)';
      g.lineWidth = 3;
      g.strokeRect(nn * 0.08, nn * 0.08, nn * 0.84, nn * 0.28);
      drawFittedText(g, 'FRAGILE', nn * 0.12, nn * 0.1, nn * 0.5, nn * 0.14, { color: 'rgba(150,40,30,0.75)', font: 'sans', fill: 0.9, align: 'left' });
      // this-side-up arrows
      g.fillStyle = 'rgba(40,30,24,0.6)';
      for (const ax of [0.72, 0.84]) {
        g.beginPath();
        g.moveTo(nn * ax, nn * 0.12);
        g.lineTo(nn * (ax + 0.05), nn * 0.24);
        g.lineTo(nn * (ax + 0.02), nn * 0.24);
        g.lineTo(nn * (ax + 0.02), nn * 0.32);
        g.lineTo(nn * (ax - 0.02), nn * 0.32);
        g.lineTo(nn * (ax - 0.02), nn * 0.24);
        g.lineTo(nn * (ax - 0.05), nn * 0.24);
        g.closePath();
        g.fill();
      }
      drawFittedText(g, 'THIS SIDE UP', nn * 0.12, nn * 0.68, nn * 0.5, nn * 0.08, { color: 'rgba(40,30,24,0.6)', font: 'sans', fill: 0.9, align: 'left' });
    },
    0.3,
    5,
  );
  return finishMaterial(ctx, tb, { tile: 0.8, normalStrength: 2 });
}
