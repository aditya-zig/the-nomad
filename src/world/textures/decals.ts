/**
 * Decal painters: road markings, grime, blood, scorch, rust / mould stains and spray-paint stencils.
 * Every decal maps its whole texture to the quad (UV 0..1); `DECAL_INFO` lists the natural world size
 * (metres, [along U, along V]) each decal was drawn for so quads can be created without stretching.
 *
 * Orientation conventions:
 *  - Linear road markings (laneDash, laneSolid, laneYellow, stopLine) and `arrow`, `chevrons` run along U (local +X);
 *    `arrow` / `chevrons` point toward +U. `crosswalk` bars run along U and are stacked along V.
 *  - `grime` is darkest at the BOTTOM (v = 0) of the quad, `rustStain` streaks run downward from the TOP (v = 1).
 *  - When a decal quad lies on the ground (PlaneGeometry rotated -PI/2 about X) U is world +X and V is world -Z.
 */
import * as THREE from 'three';
import type { DecalName, StencilOptions } from '../materials';
import { type PaintCtx, SM, SS, clamp, mulberry32, sstep } from './core';
import { canvasTexture, drawFittedText, finishPaint, makeCanvas } from './stencil';

export interface DecalInfo {
  /** Natural size in metres: [along U, along V]. */
  size: [number, number];
  note: string;
}

export const DECAL_INFO: Record<DecalName, DecalInfo> = {
  laneDash: { size: [3, 0.15], note: 'one white dash' },
  laneSolid: { size: [6, 0.15], note: 'solid white edge line segment' },
  laneYellow: { size: [6, 0.4], note: 'double yellow centre line' },
  crosswalk: { size: [3, 9.6], note: 'zebra bars along U, 8 bars stacked along V (0.6 m each)' },
  stopLine: { size: [5, 0.4], note: 'wide white stop line' },
  arrow: { size: [3.5, 1.3], note: 'white straight arrow pointing +U' },
  oilStain: { size: [2, 2], note: 'glossy dark oil blotch' },
  dirtPatch: { size: [4, 4], note: 'soft brown grime patch' },
  crackLarge: { size: [5, 1.25], note: 'branching pavement crack across U' },
  puddle: { size: [3, 2.4], note: 'dark reflective puddle (low roughness)' },
  skid: { size: [6, 1.2], note: 'two curved tyre skid marks' },
  bloodOld0: { size: [1.6, 1.6], note: 'dried blood splatter burst' },
  bloodOld1: { size: [1.6, 1.6], note: 'dried blood pool with drips' },
  bloodOld2: { size: [1.6, 1.6], note: 'dried blood spray arcs' },
  bloodDrag: { size: [3.2, 0.8], note: 'dried blood drag trail along U' },
  scorchOld: { size: [2.6, 2.6], note: 'old blast scorch with soot rays' },
  rustStain: { size: [0.8, 3], note: 'rust streaks running down a wall (top = v 1)' },
  grime: { size: [4, 2], note: 'wall-base dirt gradient (dark at bottom, v 0)' },
  mold: { size: [2, 2], note: 'green-black mould patches' },
  stencilH: { size: [3, 4], note: 'helipad H letter' },
  stencilRing: { size: [12, 12], note: 'helipad ring with inner ring' },
  biohazard: { size: [2, 2], note: 'biohazard symbol' },
  stencilQuarantine: { size: [6, 1.15], note: 'QUARANTINE spray stencil' },
  stencilDanger: { size: [2, 0.75], note: 'DANGER sign panel' },
  stencilRestricted: { size: [3, 1], note: 'RESTRICTED AREA' },
  stencilKeepOut: { size: [3, 0.75], note: 'KEEP OUT' },
  stencilDepot: { size: [4, 1], note: 'DEPOT 4' },
  stencilLZ: { size: [5, 3.1], note: 'LZ ECHO' },
  chevrons: { size: [2, 1], note: 'yellow hazard chevrons pointing +U' },
};

const WHITE: [number, number, number] = [234, 233, 224];
const YELLOW: [number, number, number] = [216, 176, 44];

function roundRectPath(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  if (typeof g.roundRect === 'function') g.roundRect(x, y, w, h, r);
  else g.rect(x, y, w, h);
}

function decalMaterial(tex: THREE.Texture, rough: number, envK = 1): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    roughness: rough,
    metalness: 0,
    envMapIntensity: envK,
  });
}

/** Common tail: erode, colour-bleed, upload. */
function finish(ctx: PaintCtx, canvas: HTMLCanvasElement, g: CanvasRenderingContext2D, o: { color: [number, number, number]; wear?: number; seed?: number; alpha?: number }): THREE.CanvasTexture {
  const img = g.getImageData(0, 0, canvas.width, canvas.height);
  finishPaint(img, ctx.bank, o);
  g.putImageData(img, 0, 0);
  return ctx.track(canvasTexture(canvas));
}

/** Organic soft blob decal computed per pixel from the noise bank. */
function blobDecal(
  ctx: PaintCtx,
  size: number,
  o: { color: [number, number, number]; seed: number; alpha: number; radius: number; ragged: number; edge?: number; speckle?: number; rim?: number; rays?: number },
): THREE.CanvasTexture {
  const { canvas, g } = makeCanvas(size, size);
  const img = g.createImageData(size, size);
  const d = img.data;
  const { bank } = ctx;
  const off = Math.floor(o.seed * 104729) % (512 * 512);
  const sc = 512 / size;
  const edge = o.edge ?? 0.3;
  for (let y = 0; y < size; y++) {
    const v = (y / size) * 2 - 1;
    const rowB = ((Math.floor(y * sc)) & SM) << SS;
    for (let x = 0; x < size; x++) {
      const u = (x / size) * 2 - 1;
      const bi = ((rowB | (Math.floor(x * sc) & SM)) + off) & 262143;
      const n = bank.macro[bi]!;
      const m = bank.mid[(bi + 9000) & 262143]!;
      const f = bank.fine[bi]!;
      const w = bank.white[bi]! / 255;
      const dist = Math.sqrt(u * u + v * v);
      let rag = (n - 0.5) * o.ragged + (m - 0.5) * o.ragged * 0.6 + (f - 0.5) * 0.12;
      if (o.rays) {
        const ang = Math.atan2(v, u);
        rag += Math.sin(ang * o.rays + m * 6) * 0.09 * o.ragged + (n - 0.5) * 0.15;
      }
      let a = 1 - sstep(o.radius * (1 - edge), o.radius, dist + rag);
      a *= 0.72 + 0.28 * (1 - sstep(0.5, 0.9, m)) + (f - 0.5) * 0.2;
      if (o.speckle) a += (w > 1 - o.speckle ? 0.5 : 0) * (1 - sstep(o.radius * 0.9, o.radius * 1.5, dist));
      const rim = o.rim ? o.rim * (sstep(o.radius * 0.5, o.radius * 0.85, dist + rag) * (1 - sstep(o.radius * 0.85, o.radius, dist + rag))) : 0;
      const i = (y * size + x) * 4;
      d[i] = o.color[0] + rim * 40;
      d[i + 1] = o.color[1] + rim * 40;
      d[i + 2] = o.color[2] + rim * 46;
      d[i + 3] = clamp(a, 0, 1) * o.alpha * 255;
    }
  }
  g.putImageData(img, 0, 0);
  return ctx.track(canvasTexture(canvas));
}

// ---------------------------------------------------------------------------------------------
// blood
// ---------------------------------------------------------------------------------------------

function drawBlob(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, rng: () => number, fillStyle: string): void {
  const pts = 18;
  const radii: number[] = [];
  for (let i = 0; i < pts; i++) radii.push(r * (0.62 + rng() * 0.5));
  g.beginPath();
  for (let i = 0; i <= pts; i++) {
    const a = (i % pts) / pts * Math.PI * 2;
    const rr = radii[i % pts]!;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    if (i === 0) g.moveTo(x, y);
    else {
      const a0 = ((i - 1) / pts) * Math.PI * 2 + Math.PI / pts;
      const rm = (radii[(i - 1) % pts]! + rr) * 0.5 * 1.05;
      g.quadraticCurveTo(cx + Math.cos(a0) * rm, cy + Math.sin(a0) * rm, x, y);
    }
  }
  g.closePath();
  g.fillStyle = fillStyle;
  g.fill();
}

function paintBlood(ctx: PaintCtx, variant: number): THREE.MeshStandardMaterial {
  const size = 512;
  const { canvas, g } = makeCanvas(size, size);
  const rng = mulberry32(9100 + variant * 37);
  const c = size / 2;
  if (variant === 0) {
    // directional splatter burst
    drawBlob(g, c, c, 58, rng, 'rgba(70,12,10,0.95)');
    drawBlob(g, c + 6, c - 4, 30, rng, 'rgba(46,8,8,0.95)');
    const dir = rng() * Math.PI * 2;
    for (let i = 0; i < 120; i++) {
      const spread = (rng() - 0.5) * 2.2;
      const a = dir + spread;
      const dist = 60 + Math.pow(rng(), 1.6) * 190;
      const x = c + Math.cos(a) * dist;
      const y = c + Math.sin(a) * dist;
      const r = 1.5 + rng() * (dist < 120 ? 7 : 4);
      g.beginPath();
      g.ellipse(x, y, r * (1 + rng() * 1.6), r, a, 0, Math.PI * 2);
      g.fillStyle = `rgba(${60 + rng() * 22},${10 + rng() * 6},${8 + rng() * 5},${0.75 + rng() * 0.2})`;
      g.fill();
    }
  } else if (variant === 1) {
    // pooled blood with drips running out
    drawBlob(g, c, c, 92, rng, 'rgba(62,10,9,0.94)');
    drawBlob(g, c - 14, c + 8, 55, rng, 'rgba(44,7,7,0.96)');
    for (let i = 0; i < 7; i++) {
      const a = rng() * Math.PI * 2;
      const len = 90 + rng() * 120;
      g.strokeStyle = 'rgba(66,11,9,0.9)';
      g.lineCap = 'round';
      g.lineWidth = 3 + rng() * 6;
      g.beginPath();
      g.moveTo(c + Math.cos(a) * 60, c + Math.sin(a) * 60);
      g.lineTo(c + Math.cos(a) * len, c + Math.sin(a) * len);
      g.stroke();
      g.beginPath();
      g.arc(c + Math.cos(a) * len, c + Math.sin(a) * len, 4 + rng() * 5, 0, Math.PI * 2);
      g.fill();
    }
    for (let i = 0; i < 30; i++) {
      const a = rng() * Math.PI * 2;
      const dist = 100 + rng() * 120;
      g.beginPath();
      g.arc(c + Math.cos(a) * dist, c + Math.sin(a) * dist, 1.5 + rng() * 4, 0, Math.PI * 2);
      g.fillStyle = 'rgba(64,11,9,0.85)';
      g.fill();
    }
  } else {
    // arterial spray arcs
    g.lineCap = 'round';
    for (let arc = 0; arc < 3; arc++) {
      const a0 = rng() * Math.PI * 2;
      const rad = 70 + arc * 55 + rng() * 25;
      const span = 0.8 + rng() * 0.9;
      for (let i = 0; i < 46; i++) {
        const a = a0 + (i / 46) * span + (rng() - 0.5) * 0.05;
        const rr = rad + (rng() - 0.5) * 16;
        const x = c + Math.cos(a) * rr;
        const y = c + Math.sin(a) * rr;
        const r = 2 + rng() * 6;
        g.beginPath();
        g.ellipse(x, y, r * 1.6, r, a + Math.PI / 2, 0, Math.PI * 2);
        g.fillStyle = `rgba(${58 + rng() * 22},${9 + rng() * 6},${8 + rng() * 5},${0.7 + rng() * 0.25})`;
        g.fill();
      }
    }
    drawBlob(g, c, c, 40, rng, 'rgba(60,10,9,0.94)');
  }
  const tex = finish(ctx, canvas, g, { color: [48, 9, 8], wear: 0.32, seed: 0.13 + variant * 0.31, alpha: 0.92 });
  return decalMaterial(tex, 0.7);
}

function paintBloodDrag(ctx: PaintCtx): THREE.MeshStandardMaterial {
  const w = 1024;
  const h = 256;
  const { canvas, g } = makeCanvas(w, h);
  const rng = mulberry32(9177);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  // wavy smear that thins out toward the far end
  const grad = g.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, 'rgba(60,10,9,0.95)');
  grad.addColorStop(0.7, 'rgba(60,10,9,0.8)');
  grad.addColorStop(1, 'rgba(60,10,9,0.0)');
  for (let k = 0; k < 3; k++) {
    g.strokeStyle = grad;
    g.lineWidth = 46 - k * 12;
    g.beginPath();
    for (let x = 30; x <= w - 20; x += 24) {
      const y = h / 2 + Math.sin(x * 0.012 + k) * 22 + (rng() - 0.5) * 5 + (k - 1) * 12;
      if (x === 30) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
  drawBlob(g, 90, h / 2, 60, rng, 'rgba(58,9,8,0.95)');
  for (let i = 0; i < 46; i++) {
    const x = 60 + rng() * 700;
    const y = h / 2 + (rng() - 0.5) * 150;
    g.beginPath();
    g.arc(x, y, 1.5 + rng() * 4, 0, Math.PI * 2);
    g.fillStyle = 'rgba(64,10,9,0.8)';
    g.fill();
  }
  const tex = finish(ctx, canvas, g, { color: [46, 9, 8], wear: 0.35, seed: 0.77, alpha: 0.9 });
  return decalMaterial(tex, 0.7);
}

// ---------------------------------------------------------------------------------------------
// ground grime
// ---------------------------------------------------------------------------------------------

function paintCrack(ctx: PaintCtx): THREE.MeshStandardMaterial {
  const w = 1024;
  const h = 256;
  const { canvas, g } = makeCanvas(w, h);
  const rng = mulberry32(4242);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const walk = (x: number, y: number, ang: number, len: number, width: number, depth: number): void => {
    const steps = Math.floor(len / 9);
    let px = x;
    let py = y;
    for (let i = 0; i < steps; i++) {
      ang += (rng() - 0.5) * 0.7;
      const nx = px + Math.cos(ang) * 9;
      const ny = py + Math.sin(ang) * 9;
      const t = i / steps;
      g.lineWidth = Math.max(0.8, width * (1 - t * 0.75));
      g.strokeStyle = `rgba(10,10,13,${0.95 - t * 0.35})`;
      g.beginPath();
      g.moveTo(px, py);
      g.lineTo(nx, ny);
      g.stroke();
      px = nx;
      py = ny;
      if (depth < 3 && rng() < 0.075) walk(px, py, ang + (rng() < 0.5 ? -1 : 1) * (0.5 + rng() * 0.7), len * (0.35 + rng() * 0.3), width * 0.7, depth + 1);
      if (px < 0 || px > w || py < 0 || py > h) break;
    }
  };
  walk(10, h * 0.45, 0.05, w * 0.98, 5, 0);
  walk(w * 0.3, h * 0.5, 1.2, 130, 3, 1);
  const tex = finish(ctx, canvas, g, { color: [12, 12, 15], wear: 0.18, seed: 0.5 });
  return decalMaterial(tex, 0.95);
}

function paintSkid(ctx: PaintCtx): THREE.MeshStandardMaterial {
  const w = 1024;
  const h = 256;
  const { canvas, g } = makeCanvas(w, h);
  const grad = g.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, 'rgba(12,12,14,0)');
  grad.addColorStop(0.12, 'rgba(12,12,14,0.62)');
  grad.addColorStop(0.7, 'rgba(12,12,14,0.55)');
  grad.addColorStop(1, 'rgba(12,12,14,0)');
  g.strokeStyle = grad;
  g.lineCap = 'butt';
  for (let k = 0; k < 2; k++) {
    g.lineWidth = 34;
    g.beginPath();
    g.moveTo(0, 70 + k * 100);
    g.bezierCurveTo(w * 0.35, 70 + k * 100, w * 0.62, 90 + k * 100, w, 150 + k * 60);
    g.stroke();
  }
  // tread nicks
  g.globalCompositeOperation = 'destination-out';
  for (let x = 0; x < w; x += 9) {
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fillRect(x, 0, 2.2, h);
  }
  g.globalCompositeOperation = 'source-over';
  const tex = finish(ctx, canvas, g, { color: [12, 12, 14], wear: 0.45, seed: 0.31 });
  return decalMaterial(tex, 0.8);
}

function paintRustStain(ctx: PaintCtx): THREE.MeshStandardMaterial {
  const w = 128;
  const h = 512;
  const { canvas, g } = makeCanvas(w, h);
  const rng = mulberry32(6161);
  for (let i = 0; i < 9; i++) {
    const x = 8 + rng() * (w - 16);
    const len = 160 + rng() * 340;
    const wd = 3 + rng() * 9;
    const grad = g.createLinearGradient(0, 0, 0, len);
    const c = rng() < 0.5 ? '128,70,32' : '98,52,26';
    grad.addColorStop(0, `rgba(${c},0.0)`);
    grad.addColorStop(0.06, `rgba(${c},0.6)`);
    grad.addColorStop(0.7, `rgba(${c},0.35)`);
    grad.addColorStop(1, `rgba(${c},0)`);
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(x - wd / 2, 0);
    g.lineTo(x + wd / 2, 0);
    g.lineTo(x + wd * 0.2, len);
    g.lineTo(x - wd * 0.2, len);
    g.closePath();
    g.fill();
  }
  const tex = finish(ctx, canvas, g, { color: [114, 62, 30], wear: 0.3, seed: 0.9 });
  return decalMaterial(tex, 0.9);
}

function paintGrime(ctx: PaintCtx): THREE.MeshStandardMaterial {
  const w = 512;
  const h = 256;
  const { canvas, g } = makeCanvas(w, h);
  const img = g.createImageData(w, h);
  const d = img.data;
  const { bank } = ctx;
  for (let y = 0; y < h; y++) {
    const v = y / h; // 0 top .. 1 bottom
    for (let x = 0; x < w; x++) {
      const bi = (((y * 2) & SM) << SS) | ((x) & SM);
      const sv = bank.streakV[bi]!;
      const m = bank.mid[bi]!;
      const base = Math.pow(v, 1.8);
      const a = clamp(base * (0.55 + sv * 0.9) + (m - 0.5) * 0.12 - (1 - v) * 0.02, 0, 1);
      const i = (y * w + x) * 4;
      d[i] = 24;
      d[i + 1] = 22;
      d[i + 2] = 20;
      d[i + 3] = a * 0.8 * 255;
    }
  }
  g.putImageData(img, 0, 0);
  return decalMaterial(ctx.track(canvasTexture(canvas)), 0.95);
}

// ---------------------------------------------------------------------------------------------
// road markings
// ---------------------------------------------------------------------------------------------

function marking(
  ctx: PaintCtx,
  w: number,
  h: number,
  color: [number, number, number],
  draw: (g: CanvasRenderingContext2D) => void,
  wear: number,
  seed: number,
): THREE.MeshStandardMaterial {
  const { canvas, g } = makeCanvas(w, h);
  g.fillStyle = '#fff';
  draw(g);
  const tex = finish(ctx, canvas, g, { color, wear, seed, alpha: 0.94 });
  return decalMaterial(tex, 0.7);
}

// ---------------------------------------------------------------------------------------------
// symbols
// ---------------------------------------------------------------------------------------------

function drawBiohazard(g: CanvasRenderingContext2D, cx: number, cy: number, s: number): void {
  g.save();
  g.translate(cx, cy);
  g.fillStyle = '#fff';
  g.strokeStyle = '#fff';
  for (let k = 0; k < 3; k++) {
    g.save();
    g.rotate((k * Math.PI * 2) / 3);
    // crescent lobe: big circle minus offset circle
    g.beginPath();
    g.arc(0, -0.23 * s, 0.27 * s, 0, Math.PI * 2);
    g.fill();
    g.globalCompositeOperation = 'destination-out';
    g.beginPath();
    g.arc(0, -0.3 * s, 0.21 * s, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.arc(0, -0.03 * s, 0.1 * s, 0, Math.PI * 2);
    g.fill();
    g.globalCompositeOperation = 'source-over';
    // inner small ring in each lobe
    g.beginPath();
    g.lineWidth = 0.028 * s;
    g.arc(0, -0.34 * s, 0.075 * s, 0, Math.PI * 2);
    g.stroke();
    g.restore();
  }
  // centre ring
  g.beginPath();
  g.lineWidth = 0.05 * s;
  g.arc(0, 0, 0.075 * s, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  g.fillStyle = '#fff';
  g.arc(0, 0, 0.03 * s, 0, Math.PI * 2);
  g.fill();
  // outer ring with three gaps
  g.lineWidth = 0.035 * s;
  for (let k = 0; k < 3; k++) {
    const a0 = (k * Math.PI * 2) / 3 + Math.PI / 6 + 0.16;
    g.beginPath();
    g.arc(0, 0, 0.5 * s, a0, a0 + (Math.PI * 2) / 3 - 0.32);
    g.stroke();
  }
  g.restore();
}

// ---------------------------------------------------------------------------------------------
// main entry
// ---------------------------------------------------------------------------------------------

export function paintDecal(ctx: PaintCtx, name: DecalName): THREE.MeshStandardMaterial {
  switch (name) {
    case 'laneDash':
      return marking(ctx, 1024, 32, WHITE, (g) => g.fillRect(14, 4, 996, 24), 0.42, 0.11);
    case 'laneSolid':
      return marking(ctx, 1024, 32, WHITE, (g) => g.fillRect(0, 4, 1024, 24), 0.5, 0.23);
    case 'laneYellow':
      return marking(
        ctx,
        1024,
        96,
        YELLOW,
        (g) => {
          g.fillRect(0, 8, 1024, 26);
          g.fillRect(0, 62, 1024, 26);
        },
        0.5,
        0.35,
      );
    case 'crosswalk':
      return marking(
        ctx,
        256,
        1024,
        WHITE,
        (g) => {
          for (let i = 0; i < 8; i++) g.fillRect(6, i * 128 + 8, 244, 112);
        },
        0.55,
        0.47,
      );
    case 'stopLine':
      return marking(ctx, 1024, 96, WHITE, (g) => g.fillRect(0, 6, 1024, 84), 0.5, 0.59);
    case 'arrow':
      return marking(
        ctx,
        1024,
        384,
        WHITE,
        (g) => {
          g.beginPath();
          g.moveTo(30, 140);
          g.lineTo(600, 140);
          g.lineTo(600, 40);
          g.lineTo(994, 192);
          g.lineTo(600, 344);
          g.lineTo(600, 244);
          g.lineTo(30, 244);
          g.closePath();
          g.fill();
        },
        0.5,
        0.61,
      );
    case 'oilStain':
      return decalMaterial(blobDecal(ctx, 256, { color: [14, 16, 22], seed: 0.21, alpha: 0.7, radius: 0.85, ragged: 0.8, edge: 0.45, rim: 0.7 }), 0.18, 1.3);
    case 'dirtPatch':
      return decalMaterial(blobDecal(ctx, 256, { color: [62, 55, 46], seed: 0.42, alpha: 0.55, radius: 0.95, ragged: 1.0, edge: 0.7, speckle: 0.03 }), 0.95);
    case 'crackLarge':
      return paintCrack(ctx);
    case 'puddle':
      return decalMaterial(blobDecal(ctx, 256, { color: [9, 13, 19], seed: 0.63, alpha: 0.66, radius: 0.72, ragged: 0.5, edge: 0.16, rim: 0.5 }), 0.02, 2.2);
    case 'skid':
      return paintSkid(ctx);
    case 'bloodOld0':
      return paintBlood(ctx, 0);
    case 'bloodOld1':
      return paintBlood(ctx, 1);
    case 'bloodOld2':
      return paintBlood(ctx, 2);
    case 'bloodDrag':
      return paintBloodDrag(ctx);
    case 'scorchOld':
      return decalMaterial(blobDecal(ctx, 256, { color: [11, 10, 9], seed: 0.83, alpha: 0.92, radius: 0.92, ragged: 0.6, edge: 0.75, rays: 11, speckle: 0.02 }), 0.97);
    case 'rustStain':
      return paintRustStain(ctx);
    case 'grime':
      return paintGrime(ctx);
    case 'mold':
      return decalMaterial(blobDecal(ctx, 256, { color: [30, 42, 28], seed: 0.55, alpha: 0.6, radius: 0.9, ragged: 1.1, edge: 0.6, speckle: 0.05 }), 0.95);
    case 'stencilH':
      return marking(
        ctx,
        384,
        512,
        WHITE,
        (g) => {
          g.fillRect(20, 20, 92, 472);
          g.fillRect(272, 20, 92, 472);
          g.fillRect(20, 206, 344, 100);
        },
        0.45,
        0.71,
      );
    case 'stencilRing':
      return marking(
        ctx,
        1024,
        1024,
        WHITE,
        (g) => {
          g.strokeStyle = '#fff';
          g.lineWidth = 34;
          g.beginPath();
          g.arc(512, 512, 488, 0, Math.PI * 2);
          g.stroke();
          g.lineWidth = 8;
          g.beginPath();
          g.arc(512, 512, 372, 0, Math.PI * 2);
          g.stroke();
          g.lineWidth = 16;
          for (let i = 0; i < 12; i++) {
            const a = (i / 12) * Math.PI * 2;
            g.beginPath();
            g.moveTo(512 + Math.cos(a) * 372, 512 + Math.sin(a) * 372);
            g.lineTo(512 + Math.cos(a) * 430, 512 + Math.sin(a) * 430);
            g.stroke();
          }
        },
        0.45,
        0.73,
      );
    case 'biohazard':
      return marking(ctx, 512, 512, YELLOW, (g) => drawBiohazard(g, 256, 262, 440), 0.42, 0.77);
    case 'stencilQuarantine':
      return marking(ctx, 1024, 196, [208, 64, 36], (g) => drawFittedText(g, 'QUARANTINE', 0, 4, 1024, 188, { color: '#fff', font: 'stencil', bridges: true, fill: 0.96, letterSpacing: 0.04 }), 0.5, 0.81);
    case 'stencilDanger': {
      const { canvas, g } = makeCanvas(512, 192);
      g.fillStyle = 'rgb(170,28,24)';
      roundRectPath(g, 4, 4, 504, 184, 14);
      g.fill();
      g.strokeStyle = 'rgb(236,232,222)';
      g.lineWidth = 6;
      roundRectPath(g, 16, 16, 480, 160, 8);
      g.stroke();
      drawFittedText(g, 'DANGER', 20, 24, 472, 144, { color: 'rgb(236,232,222)', font: 'sans', fill: 0.9, letterSpacing: 0.05 });
      return signDecal(ctx, canvas, g, 0.28);
    }
    case 'stencilRestricted':
      return marking(ctx, 768, 256, YELLOW, (g) => drawFittedText(g, 'RESTRICTED\nAREA', 0, 4, 768, 248, { color: '#fff', font: 'stencil', bridges: true, fill: 0.95, letterSpacing: 0.03 }), 0.5, 0.83);
    case 'stencilKeepOut':
      return marking(ctx, 768, 192, WHITE, (g) => drawFittedText(g, 'KEEP OUT', 0, 4, 768, 184, { color: '#fff', font: 'stencil', bridges: true, fill: 0.95, letterSpacing: 0.04 }), 0.5, 0.85);
    case 'stencilDepot':
      return marking(ctx, 1024, 256, WHITE, (g) => drawFittedText(g, 'DEPOT 4', 0, 4, 1024, 248, { color: '#fff', font: 'stencil', bridges: true, fill: 0.95, letterSpacing: 0.05 }), 0.5, 0.87);
    case 'stencilLZ':
      return marking(ctx, 1024, 640, WHITE, (g) => drawFittedText(g, 'LZ\nECHO', 0, 6, 1024, 628, { color: '#fff', font: 'stencil', bridges: true, fill: 0.9, letterSpacing: 0.06 }), 0.42, 0.89);
    case 'chevrons':
      return marking(
        ctx,
        512,
        256,
        YELLOW,
        (g) => {
          g.strokeStyle = '#fff';
          g.lineWidth = 46;
          g.lineJoin = 'miter';
          for (let i = 0; i < 3; i++) {
            const x = 30 + i * 150;
            g.beginPath();
            g.moveTo(x, 20);
            g.lineTo(x + 100, 128);
            g.lineTo(x, 236);
            g.stroke();
          }
        },
        0.45,
        0.93,
      );
    default:
      return decalMaterial(ctx.track(new THREE.Texture()), 1);
  }
}

/** Multi-colour decal (e.g. a danger panel): keeps the painted colours and only erodes the alpha. */
function signDecal(ctx: PaintCtx, canvas: HTMLCanvasElement, g: CanvasRenderingContext2D, wear: number): THREE.MeshStandardMaterial {
  const img = g.getImageData(0, 0, canvas.width, canvas.height);
  erodeAlpha(img, ctx, wear);
  g.putImageData(img, 0, 0);
  return decalMaterial(ctx.track(canvasTexture(canvas)), 0.7);
}

/** Noise-driven paint erosion on the alpha channel only. */
function erodeAlpha(img: ImageData, ctx: PaintCtx, wear: number): void {
  const d = img.data;
  const { bank } = ctx;
  const w = img.width;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const bi = (((y & SM) << SS) | (x & SM)) & 262143;
      const n = bank.fine[bi]! * 0.55 + (bank.white[(bi * 3) & 262143]! / 255) * 0.25 + bank.mid[(bi + 5000) & 262143]! * 0.4;
      d[i + 3] = d[i + 3]! * (1 - wear * sstep(0.72, 0.98, n));
    }
  }
}

// ---------------------------------------------------------------------------------------------
// custom stencil()
// ---------------------------------------------------------------------------------------------

export function paintCustomStencil(ctx: PaintCtx, text: string, opts: StencilOptions = {}): THREE.MeshStandardMaterial {
  const aspect = opts.aspect ?? 3;
  const w = 768;
  const h = Math.max(64, Math.round(w / aspect));
  const { canvas, g } = makeCanvas(w, h);
  const bg = opts.background ?? 'transparent';
  if (bg !== 'transparent') {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.65)';
    g.lineWidth = Math.max(3, h * 0.04);
    g.strokeRect(h * 0.08, h * 0.08, w - h * 0.16, h * 0.84);
  }
  const lines = text.split('\n').length;
  const pad = bg !== 'transparent' ? h * 0.16 : h * 0.04;
  drawFittedText(g, text, pad, pad, w - pad * 2, h - pad * 2, {
    color: opts.color ?? '#e8e6da',
    font: opts.font ?? 'stencil',
    bridges: (opts.font ?? 'stencil') === 'stencil' && bg === 'transparent',
    fill: lines > 1 ? 0.9 : 0.92,
    letterSpacing: 0.03,
  });
  if (opts.worn) {
    const img = g.getImageData(0, 0, w, h);
    erodeAlpha(img, ctx, 0.45);
    g.putImageData(img, 0, 0);
  }
  const tex = ctx.track(canvasTexture(canvas));
  const m = decalMaterial(tex, 0.7);
  if (opts.emissive) {
    m.emissiveMap = tex;
    m.emissive.set(0xffffff);
    m.emissiveIntensity = 1.6;
  }
  if (bg !== 'transparent') {
    // boards are opaque signs; leave depthWrite off but keep alpha
    m.polygonOffsetFactor = -1;
  }
  return m;
}
