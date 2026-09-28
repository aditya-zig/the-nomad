/**
 * Procedural decal atlases (canvas-drawn once at start-up): bullet holes per surface, blood splats, scorch marks.
 * Every tile fades to fully transparent before its edge so neighbouring atlas cells never bleed.
 */
import * as THREE from 'three';
import { Rng } from './rng';

export const TILE = 256;
const HALF = TILE / 2;

type Ctx = CanvasRenderingContext2D;

function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: Ctx } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return { canvas, ctx };
}

/** Irregular closed blob path centred at (cx, cy). */
function blobPath(ctx: Ctx, rng: Rng, cx: number, cy: number, r: number, jag: number, points = 16): void {
  ctx.beginPath();
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2;
    const rr = r * (1 - jag * 0.5 + rng.next() * jag);
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** Jagged crack from (x, y) heading along `angle`, with a few side branches. */
function crack(ctx: Ctx, rng: Rng, x: number, y: number, angle: number, len: number, width: number, branch = 0.35): void {
  const segs = 4 + rng.int(3);
  let cx = x;
  let cy = y;
  let a = angle;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  const step = len / segs;
  for (let i = 0; i < segs; i++) {
    a += rng.signed() * 0.45;
    cx += Math.cos(a) * step;
    cy += Math.sin(a) * step;
    ctx.lineTo(cx, cy);
    if (rng.next() < branch && i > 0 && i < segs - 1) {
      const ba = a + (rng.next() < 0.5 ? 1 : -1) * (0.5 + rng.next() * 0.6);
      const bl = step * (0.8 + rng.next() * 1.2);
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(ba) * bl, cy + Math.sin(ba) * bl);
      ctx.moveTo(cx, cy);
    }
  }
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function radialMask(ctx: Ctx, inner = 0.62): void {
  ctx.globalCompositeOperation = 'destination-in';
  const g = ctx.createRadialGradient(HALF, HALF, HALF * inner, HALF, HALF, HALF * 0.98);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, TILE, TILE);
  ctx.globalCompositeOperation = 'source-over';
}

function speckle(ctx: Ctx, rng: Rng, n: number, rMin: number, rMax: number, spread: number, color: string): void {
  ctx.fillStyle = color;
  for (let i = 0; i < n; i++) {
    const a = rng.next() * Math.PI * 2;
    const d = Math.sqrt(rng.next()) * spread;
    const r = rMin + rng.next() * (rMax - rMin);
    ctx.beginPath();
    ctx.arc(HALF + Math.cos(a) * d, HALF + Math.sin(a) * d, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---------------------------------------------------------------------------------------------
// bullet holes
// ---------------------------------------------------------------------------------------------

export type HoleSurface = 'concrete' | 'metal' | 'wood' | 'glass' | 'dirt' | 'fabric';
export const HOLE_ROWS: Record<HoleSurface, number> = { concrete: 0, metal: 1, wood: 2, glass: 3, dirt: 4, fabric: 5 };
export const HOLE_VARIANTS = 4;

function drawConcreteHole(ctx: Ctx, rng: Rng): void {
  // pale chipped halo
  let g = ctx.createRadialGradient(HALF, HALF, 6, HALF, HALF, 104);
  g.addColorStop(0, 'rgba(176,174,166,0.62)');
  g.addColorStop(0.5, 'rgba(150,148,140,0.34)');
  g.addColorStop(1, 'rgba(120,118,112,0)');
  ctx.fillStyle = g;
  blobPath(ctx, rng, HALF, HALF, 104, 0.35, 22);
  ctx.fill();
  // fractured flakes
  for (let i = 0; i < 26; i++) {
    const a = rng.next() * Math.PI * 2;
    const d = 22 + rng.next() * 68;
    ctx.fillStyle = `rgba(${196 + rng.int(30)},${194 + rng.int(28)},${186 + rng.int(26)},${0.28 + rng.next() * 0.3})`;
    blobPath(ctx, rng, HALF + Math.cos(a) * d, HALF + Math.sin(a) * d, 3 + rng.next() * 8, 0.6, 7);
    ctx.fill();
  }
  // dark crater
  ctx.fillStyle = 'rgba(52,50,47,0.9)';
  blobPath(ctx, rng, HALF, HALF, 34 + rng.next() * 6, 0.4, 18);
  ctx.fill();
  g = ctx.createRadialGradient(HALF, HALF, 2, HALF, HALF, 24);
  g.addColorStop(0, 'rgba(2,2,2,1)');
  g.addColorStop(0.8, 'rgba(6,6,6,0.96)');
  g.addColorStop(1, 'rgba(10,10,10,0)');
  ctx.fillStyle = g;
  blobPath(ctx, rng, HALF, HALF, 20 + rng.next() * 4, 0.3, 14);
  ctx.fill();
  // cracks
  ctx.strokeStyle = 'rgba(28,27,26,0.72)';
  const n = 5 + rng.int(3);
  for (let i = 0; i < n; i++) crack(ctx, rng, HALF, HALF, (i / n) * Math.PI * 2 + rng.signed() * 0.4, 50 + rng.next() * 55, 1.2 + rng.next() * 1.6);
  speckle(ctx, rng, 40, 0.8, 2.2, 96, 'rgba(210,208,200,0.5)');
}

function drawMetalHole(ctx: Ctx, rng: Rng): void {
  const g = ctx.createRadialGradient(HALF, HALF, 8, HALF, HALF, 74);
  g.addColorStop(0, 'rgba(10,10,12,0.55)');
  g.addColorStop(1, 'rgba(10,10,12,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(HALF, HALF, 74, 0, Math.PI * 2);
  ctx.fill();
  // scratches / paint flaking
  for (let i = 0; i < 12; i++) {
    const a = rng.next() * Math.PI * 2;
    const r0 = 16 + rng.next() * 6;
    const r1 = r0 + 20 + rng.next() * 60;
    ctx.strokeStyle = `rgba(${215 + rng.int(35)},${218 + rng.int(30)},${225 + rng.int(28)},${0.28 + rng.next() * 0.35})`;
    ctx.lineWidth = 0.8 + rng.next() * 1.3;
    ctx.beginPath();
    ctx.moveTo(HALF + Math.cos(a) * r0, HALF + Math.sin(a) * r0);
    ctx.lineTo(HALF + Math.cos(a + rng.signed() * 0.08) * r1, HALF + Math.sin(a + rng.signed() * 0.08) * r1);
    ctx.stroke();
  }
  // bright dented rim, lit from the upper left
  const rim = ctx.createLinearGradient(HALF - 24, HALF - 24, HALF + 24, HALF + 24);
  rim.addColorStop(0, 'rgba(240,242,248,0.95)');
  rim.addColorStop(0.5, 'rgba(120,124,132,0.55)');
  rim.addColorStop(1, 'rgba(20,20,24,0.9)');
  ctx.strokeStyle = rim;
  ctx.lineWidth = 5;
  blobPath(ctx, rng, HALF, HALF, 20, 0.22, 16);
  ctx.stroke();
  ctx.fillStyle = 'rgba(2,2,3,1)';
  blobPath(ctx, rng, HALF, HALF, 13, 0.25, 12);
  ctx.fill();
}

function drawWoodHole(ctx: Ctx, rng: Rng): void {
  let g = ctx.createRadialGradient(HALF, HALF, 8, HALF, HALF, 58);
  g.addColorStop(0, 'rgba(28,18,8,0.7)');
  g.addColorStop(1, 'rgba(28,18,8,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(HALF, HALF, 58, 0, Math.PI * 2);
  ctx.fill();
  // splintered fibres, biased along the grain (horizontal)
  for (let i = 0; i < 30; i++) {
    const a = (rng.next() < 0.6 ? (rng.next() < 0.5 ? 0 : Math.PI) : rng.next() * Math.PI * 2) + rng.signed() * 0.35;
    const r0 = 10 + rng.next() * 8;
    const len = 16 + rng.next() * 58;
    ctx.strokeStyle = `rgba(${196 + rng.int(40)},${150 + rng.int(36)},${96 + rng.int(30)},${0.55 + rng.next() * 0.4})`;
    ctx.lineWidth = 1 + rng.next() * 2.2;
    ctx.beginPath();
    ctx.moveTo(HALF + Math.cos(a) * r0, HALF + Math.sin(a) * r0);
    ctx.lineTo(HALF + Math.cos(a) * (r0 + len), HALF + Math.sin(a) * (r0 + len) + rng.signed() * 5);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(4,3,2,1)';
  blobPath(ctx, rng, HALF, HALF, 14 + rng.next() * 3, 0.5, 12);
  ctx.fill();
  g = ctx.createRadialGradient(HALF, HALF, 10, HALF, HALF, 28);
  g.addColorStop(0, 'rgba(60,38,18,0.7)');
  g.addColorStop(1, 'rgba(60,38,18,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(HALF, HALF, 28, 0, Math.PI * 2);
  ctx.fill();
}

function drawGlassHole(ctx: Ctx, rng: Rng): void {
  ctx.strokeStyle = 'rgba(232,242,250,0.62)';
  const n = 11 + rng.int(4);
  for (let i = 0; i < n; i++) crack(ctx, rng, HALF, HALF, (i / n) * Math.PI * 2 + rng.signed() * 0.15, 55 + rng.next() * 60, 0.9 + rng.next() * 0.9, 0.5);
  // concentric arcs between the spokes
  ctx.strokeStyle = 'rgba(220,235,248,0.34)';
  ctx.lineWidth = 0.9;
  for (const r of [26, 44, 66]) {
    let a = rng.next() * 6;
    for (let s = 0; s < 6; s++) {
      const span = 0.3 + rng.next() * 0.6;
      ctx.beginPath();
      ctx.arc(HALF, HALF, r + rng.signed() * 2, a, a + span);
      ctx.stroke();
      a += span + 0.2 + rng.next() * 0.6;
    }
  }
  const g = ctx.createRadialGradient(HALF, HALF, 1, HALF, HALF, 20);
  g.addColorStop(0, 'rgba(0,0,0,0.75)');
  g.addColorStop(0.5, 'rgba(230,240,250,0.5)');
  g.addColorStop(1, 'rgba(230,240,250,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(HALF, HALF, 20, 0, Math.PI * 2);
  ctx.fill();
}

function drawDirtHole(ctx: Ctx, rng: Rng): void {
  const g = ctx.createRadialGradient(HALF, HALF, 4, HALF, HALF, 64);
  g.addColorStop(0, 'rgba(14,9,5,0.85)');
  g.addColorStop(0.45, 'rgba(38,28,18,0.5)');
  g.addColorStop(1, 'rgba(56,44,30,0)');
  ctx.fillStyle = g;
  blobPath(ctx, rng, HALF, HALF, 64, 0.4, 20);
  ctx.fill();
  speckle(ctx, rng, 26, 1, 3.5, 80, 'rgba(70,54,38,0.75)');
  ctx.fillStyle = 'rgba(4,3,2,0.95)';
  blobPath(ctx, rng, HALF, HALF, 11 + rng.next() * 3, 0.45, 12);
  ctx.fill();
}

function drawFabricHole(ctx: Ctx, rng: Rng): void {
  const g = ctx.createRadialGradient(HALF, HALF, 4, HALF, HALF, 46);
  g.addColorStop(0, 'rgba(10,12,8,0.6)');
  g.addColorStop(1, 'rgba(10,12,8,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(HALF, HALF, 46, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 0; i < 14; i++) {
    const a = rng.next() * Math.PI * 2;
    ctx.strokeStyle = `rgba(${60 + rng.int(40)},${64 + rng.int(40)},${44 + rng.int(30)},${0.5 + rng.next() * 0.4})`;
    ctx.lineWidth = 0.8 + rng.next();
    ctx.beginPath();
    ctx.moveTo(HALF + Math.cos(a) * 8, HALF + Math.sin(a) * 8);
    ctx.lineTo(HALF + Math.cos(a) * (14 + rng.next() * 22), HALF + Math.sin(a) * (14 + rng.next() * 22));
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(3,3,2,0.96)';
  blobPath(ctx, rng, HALF, HALF, 8 + rng.next() * 2, 0.5, 10);
  ctx.fill();
}

const HOLE_DRAWERS: Record<HoleSurface, (ctx: Ctx, rng: Rng) => void> = {
  concrete: drawConcreteHole,
  metal: drawMetalHole,
  wood: drawWoodHole,
  glass: drawGlassHole,
  dirt: drawDirtHole,
  fabric: drawFabricHole,
};

function buildAtlas(cols: number, rows: number, draw: (col: number, row: number, ctx: Ctx, rng: Rng) => void, seed: number, mask = 0.62): THREE.CanvasTexture {
  const atlas = makeCanvas(cols * TILE, rows * TILE);
  const tile = makeCanvas(TILE, TILE);
  const rng = new Rng(seed);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      tile.ctx.clearRect(0, 0, TILE, TILE);
      draw(c, r, tile.ctx, rng);
      radialMask(tile.ctx, mask);
      // canvas Y is top-down; texture V is bottom-up, so flip the row when placing
      atlas.ctx.drawImage(tile.canvas, c * TILE, (rows - 1 - r) * TILE);
    }
  }
  const tex = new THREE.CanvasTexture(atlas.canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

export function makeBulletHoleAtlas(): THREE.CanvasTexture {
  const order: HoleSurface[] = ['concrete', 'metal', 'wood', 'glass', 'dirt', 'fabric'];
  return buildAtlas(HOLE_VARIANTS, order.length, (_c, r, ctx, rng) => HOLE_DRAWERS[order[r]!](ctx, rng), 0x51a7);
}

// ---------------------------------------------------------------------------------------------
// blood & scorch
// ---------------------------------------------------------------------------------------------

export const BLOOD_VARIANTS = 4;

function drawBloodSplat(ctx: Ctx, rng: Rng): void {
  const base = () => `rgba(${96 + rng.int(26)},${9 + rng.int(7)},${8 + rng.int(6)},${0.88 + rng.next() * 0.1})`;
  // main pool
  ctx.fillStyle = base();
  blobPath(ctx, rng, HALF, HALF, 26 + rng.next() * 14, 0.55, 20);
  ctx.fill();
  // arms
  const arms = 10 + rng.int(8);
  for (let i = 0; i < arms; i++) {
    const a = rng.next() * Math.PI * 2;
    const len = 30 + rng.next() * 76;
    const w0 = 3 + rng.next() * 8;
    const sx = HALF + Math.cos(a) * 14;
    const sy = HALF + Math.sin(a) * 14;
    const ex = HALF + Math.cos(a) * len;
    const ey = HALF + Math.sin(a) * len;
    const nx = -Math.sin(a);
    const ny = Math.cos(a);
    ctx.fillStyle = base();
    ctx.beginPath();
    ctx.moveTo(sx + nx * w0, sy + ny * w0);
    ctx.lineTo(ex + nx * 0.8, ey + ny * 0.8);
    ctx.lineTo(ex - nx * 0.8, ey - ny * 0.8);
    ctx.lineTo(sx - nx * w0, sy - ny * w0);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.arc(ex, ey, 1.5 + rng.next() * 4, 0, Math.PI * 2);
    ctx.fill();
  }
  // satellite droplets
  for (let i = 0; i < 22; i++) {
    const a = rng.next() * Math.PI * 2;
    const d = 60 + rng.next() * 56;
    ctx.fillStyle = base();
    ctx.beginPath();
    ctx.arc(HALF + Math.cos(a) * d, HALF + Math.sin(a) * d, 1 + rng.next() * 4.2, 0, Math.PI * 2);
    ctx.fill();
  }
  // wet sheen towards the middle
  const g = ctx.createRadialGradient(HALF - 6, HALF - 8, 2, HALF, HALF, 40);
  g.addColorStop(0, 'rgba(140,20,16,0.5)');
  g.addColorStop(1, 'rgba(140,20,16,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(HALF, HALF, 40, 0, Math.PI * 2);
  ctx.fill();
}

export function makeBloodAtlas(): THREE.CanvasTexture {
  return buildAtlas(BLOOD_VARIANTS, 1, (_c, _r, ctx, rng) => drawBloodSplat(ctx, rng), 0xb10d, 0.7);
}

export const SCORCH_VARIANTS = 4;

function drawScorch(ctx: Ctx, rng: Rng): void {
  // accumulated soot blobs
  for (let i = 0; i < 46; i++) {
    const a = rng.next() * Math.PI * 2;
    const d = Math.sqrt(rng.next()) * 64;
    const r = 28 + rng.next() * 42;
    const g = ctx.createRadialGradient(HALF + Math.cos(a) * d, HALF + Math.sin(a) * d, 2, HALF + Math.cos(a) * d, HALF + Math.sin(a) * d, r);
    g.addColorStop(0, 'rgba(4,4,4,0.42)');
    g.addColorStop(1, 'rgba(5,5,5,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(HALF + Math.cos(a) * d, HALF + Math.sin(a) * d, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // blast rays
  for (let i = 0; i < 22; i++) {
    const a = rng.next() * Math.PI * 2;
    const len = 60 + rng.next() * 62;
    const w = 2 + rng.next() * 7;
    const nx = -Math.sin(a);
    const ny = Math.cos(a);
    ctx.fillStyle = `rgba(4,4,4,${0.4 + rng.next() * 0.3})`;
    ctx.beginPath();
    ctx.moveTo(HALF + nx * w, HALF + ny * w);
    ctx.lineTo(HALF + Math.cos(a) * len, HALF + Math.sin(a) * len);
    ctx.lineTo(HALF - nx * w, HALF - ny * w);
    ctx.closePath();
    ctx.fill();
  }
  // pitted centre
  const g = ctx.createRadialGradient(HALF, HALF, 4, HALF, HALF, 48);
  g.addColorStop(0, 'rgba(2,2,2,0.8)');
  g.addColorStop(1, 'rgba(2,2,2,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(HALF, HALF, 48, 0, Math.PI * 2);
  ctx.fill();
  speckle(ctx, rng, 60, 0.8, 2.6, 110, 'rgba(8,8,8,0.5)');
}

export function makeScorchAtlas(): THREE.CanvasTexture {
  return buildAtlas(SCORCH_VARIANTS, 1, (_c, _r, ctx, rng) => drawScorch(ctx, rng), 0x5c07c, 0.55);
}

// ---------------------------------------------------------------------------------------------
// tileable noise (sampled by the particle shader instead of evaluating hash noise per pixel)
// ---------------------------------------------------------------------------------------------

/** 256x256 RGBA8 tileable value noise; each channel uses a different lattice frequency (16, 32, 64, 24). */
export function makeNoiseTexture(): THREE.DataTexture {
  const N = 256;
  const data = new Uint8Array(N * N * 4);
  const rng = new Rng(0x6a09e667);
  const lattices = [16, 32, 64, 24];
  for (let ch = 0; ch < 4; ch++) {
    const L = lattices[ch]!;
    const grid = new Float32Array(L * L);
    for (let i = 0; i < grid.length; i++) grid[i] = rng.next();
    for (let y = 0; y < N; y++) {
      const fy = (y / N) * L;
      const y0 = Math.floor(fy);
      const ty = fy - y0;
      const sy = ty * ty * (3 - 2 * ty);
      const r0 = (y0 % L) * L;
      const r1 = ((y0 + 1) % L) * L;
      for (let x = 0; x < N; x++) {
        const fx = (x / N) * L;
        const x0 = Math.floor(fx);
        const tx = fx - x0;
        const sx = tx * tx * (3 - 2 * tx);
        const a = grid[r0 + (x0 % L)]!;
        const b = grid[r0 + ((x0 + 1) % L)]!;
        const c = grid[r1 + (x0 % L)]!;
        const d = grid[r1 + ((x0 + 1) % L)]!;
        const v = a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
        data[(y * N + x) * 4 + ch] = Math.round(v * 255);
      }
    }
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}
