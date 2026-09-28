/**
 * Procedural canvas textures for the viewmodels: anodised metal, polymer, grip stipple, glove / sleeve fabric,
 * ceramic plate, plus flash and reticle sprites. Everything is seeded and generated in a few milliseconds.
 */
import * as THREE from 'three';
import { clamp, mulberry32 } from './util';

export interface PbrSet {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  /** Packed occlusion(R, unused) / roughness(G) / metalness(B). */
  orm?: THREE.CanvasTexture;
}

function makeCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (!g) throw new Error('2D canvas unavailable');
  return [c, g];
}

function toTexture(c: HTMLCanvasElement, srgb: boolean, repeat = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
  }
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

/** Periodic value noise (tiles seamlessly): lattice of `cells` x `cells` random values, smooth interpolation. */
function periodicNoise(size: number, cells: number, rand: () => number): Float32Array {
  const lat = new Float32Array(cells * cells);
  for (let i = 0; i < lat.length; i++) lat[i] = rand();
  const out = new Float32Array(size * size);
  const step = cells / size;
  for (let y = 0; y < size; y++) {
    const fy = y * step;
    const y0 = Math.floor(fy);
    const ty = fy - y0;
    const sy = ty * ty * (3 - 2 * ty);
    const y1 = (y0 + 1) % cells;
    for (let x = 0; x < size; x++) {
      const fx = x * step;
      const x0 = Math.floor(fx);
      const tx = fx - x0;
      const sx = tx * tx * (3 - 2 * tx);
      const x1 = (x0 + 1) % cells;
      const a = lat[y0 * cells + x0]!;
      const b = lat[y0 * cells + x1]!;
      const c = lat[y1 * cells + x0]!;
      const d = lat[y1 * cells + x1]!;
      out[y * size + x] = a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    }
  }
  return out;
}

function fbm(size: number, baseCells: number, octaves: number, rand: () => number, gain = 0.5): Float32Array {
  const out = new Float32Array(size * size);
  let amp = 1;
  let total = 0;
  let cells = baseCells;
  for (let o = 0; o < octaves; o++) {
    const n = periodicNoise(size, cells, rand);
    for (let i = 0; i < out.length; i++) out[i]! += n[i]! * amp;
    total += amp;
    amp *= gain;
    cells *= 2;
  }
  for (let i = 0; i < out.length; i++) out[i]! /= total;
  return out;
}

/** Convert a tileable height field into a tangent-space normal map. */
function heightToNormal(h: Float32Array, size: number, strength: number): HTMLCanvasElement {
  const [c, g] = makeCanvas(size);
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    const ym = ((y - 1 + size) % size) * size;
    const yp = ((y + 1) % size) * size;
    const yc = y * size;
    for (let x = 0; x < size; x++) {
      const xm = (x - 1 + size) % size;
      const xp = (x + 1) % size;
      const dx = (h[yc + xp]! - h[yc + xm]!) * strength;
      const dy = (h[yp + x]! - h[ym + x]!) * strength;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const i = (yc + x) * 4;
      img.data[i] = (-dx * inv * 0.5 + 0.5) * 255;
      img.data[i + 1] = (dy * inv * 0.5 + 0.5) * 255;
      img.data[i + 2] = (inv * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** Read a canvas's luminance into a float height field. */
function canvasToHeight(c: HTMLCanvasElement): Float32Array {
  const size = c.width;
  const g = c.getContext('2d')!;
  const d = g.getImageData(0, 0, size, size).data;
  const out = new Float32Array(size * size);
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4]! / 255;
  return out;
}

// ---------------------------------------------------------------------------------------------
// Metal (anodised dark aluminium / steel with wear)
// ---------------------------------------------------------------------------------------------

export function makeMetalSet(seed = 11): PbrSet {
  const size = 256;
  const rand = mulberry32(seed);
  const n1 = fbm(size, 4, 4, rand);
  const n2 = fbm(size, 96, 2, rand);

  // scratches + machining marks drawn as a height mask
  const [sc, sg] = makeCanvas(size);
  sg.fillStyle = '#000';
  sg.fillRect(0, 0, size, size);
  sg.lineCap = 'round';
  for (let i = 0; i < 90; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const len = 6 + rand() * 40;
    const a = (rand() < 0.6 ? 0 : Math.PI / 2) + (rand() - 0.5) * 0.5;
    sg.strokeStyle = `rgba(255,255,255,${0.12 + rand() * 0.4})`;
    sg.lineWidth = 0.5 + rand() * 0.8;
    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        sg.beginPath();
        sg.moveTo(x + ox, y + oy);
        sg.lineTo(x + ox + Math.cos(a) * len, y + oy + Math.sin(a) * len);
        sg.stroke();
      }
    }
  }
  const scratch = canvasToHeight(sc);

  const [mc, mg] = makeCanvas(size);
  const [oc, og] = makeCanvas(size);
  const albedo = mg.createImageData(size, size);
  const orm = og.createImageData(size, size);
  const height = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) {
    const wear = clamp((n1[i]! - 0.66) * 7 + scratch[i]! * 0.9, 0, 1); // bare metal showing through
    const grain = n2[i]!;
    const base = 0.8 + (n1[i]! - 0.5) * 0.1 + (grain - 0.5) * 0.1;
    const v = clamp(base + wear * 0.22, 0, 1);
    const o = i * 4;
    albedo.data[o] = v * 255;
    albedo.data[o + 1] = v * 255;
    albedo.data[o + 2] = v * 255 * 1.02;
    albedo.data[o + 3] = 255;
    orm.data[o] = 255;
    orm.data[o + 1] = clamp(0.42 + (grain - 0.5) * 0.2 - wear * 0.14, 0.15, 1) * 255; // roughness
    orm.data[o + 2] = clamp(0.88 + wear * 0.12 - (n1[i]! - 0.5) * 0.1, 0, 1) * 255; // metalness
    orm.data[o + 3] = 255;
    height[i] = grain * 0.3 + n1[i]! * 0.04 - scratch[i]! * 0.5;
  }
  mg.putImageData(albedo, 0, 0);
  og.putImageData(orm, 0, 0);
  return {
    map: toTexture(mc, true),
    orm: toTexture(oc, false),
    normalMap: toTexture(heightToNormal(height, size, 1.4), false),
  };
}

// ---------------------------------------------------------------------------------------------
// Polymer with fine pebble grain, and stippled grip
// ---------------------------------------------------------------------------------------------

export function makePolymerSet(seed = 21): PbrSet {
  const size = 256;
  const rand = mulberry32(seed);
  const coarse = fbm(size, 3, 3, rand);
  const fine = fbm(size, 64, 2, rand);
  const [mc, mg] = makeCanvas(size);
  const img = mg.createImageData(size, size);
  const height = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) {
    const v = clamp(0.8 + (coarse[i]! - 0.5) * 0.28 + (fine[i]! - 0.5) * 0.1, 0, 1);
    img.data[i * 4] = v * 255;
    img.data[i * 4 + 1] = v * 255;
    img.data[i * 4 + 2] = v * 255;
    img.data[i * 4 + 3] = 255;
    height[i] = fine[i]! * 0.6 + coarse[i]! * 0.15;
  }
  mg.putImageData(img, 0, 0);
  return { map: toTexture(mc, true), normalMap: toTexture(heightToNormal(height, size, 3.2), false) };
}

export function makeGripSet(seed = 31): PbrSet {
  const size = 256;
  const rand = mulberry32(seed);
  const [mc, mg] = makeCanvas(size);
  const [hc, hg] = makeCanvas(size);
  mg.fillStyle = '#c8c8c8';
  mg.fillRect(0, 0, size, size);
  hg.fillStyle = '#404040';
  hg.fillRect(0, 0, size, size);
  const pitch = 8;
  for (let gy = 0; gy < size / pitch; gy++) {
    for (let gx = 0; gx < size / pitch; gx++) {
      const cx = (gx + 0.5 + (gy % 2) * 0.5) * pitch + (rand() - 0.5) * 1.2;
      const cy = (gy + 0.5) * pitch + (rand() - 0.5) * 1.2;
      const r = 2.2 + rand() * 0.8;
      for (const ox of [-size, 0, size]) {
        const grad = hg.createRadialGradient(cx + ox, cy, 0, cx + ox, cy, r * 1.4);
        grad.addColorStop(0, '#fff');
        grad.addColorStop(0.7, '#a0a0a0');
        grad.addColorStop(1, '#404040');
        hg.fillStyle = grad;
        hg.beginPath();
        hg.arc(cx + ox, cy, r * 1.4, 0, Math.PI * 2);
        hg.fill();
        mg.fillStyle = 'rgba(0,0,0,0.25)';
        mg.beginPath();
        mg.arc(cx + ox, cy, r * 0.5, 0, Math.PI * 2);
        mg.fill();
      }
    }
  }
  const h = canvasToHeight(hc);
  return { map: toTexture(mc, true), normalMap: toTexture(heightToNormal(h, size, 4.5), false) };
}

// ---------------------------------------------------------------------------------------------
// Fabric (glove ripstop weave, sleeve twill)
// ---------------------------------------------------------------------------------------------

export function makeFabricSet(seed = 41, weavePitch = 4, blotch = 0.08): PbrSet {
  const size = 256;
  const rand = mulberry32(seed);
  const low = fbm(size, 6, 3, rand);
  const [mc, mg] = makeCanvas(size);
  const img = mg.createImageData(size, size);
  const height = new Float32Array(size * size);
  const p = weavePitch;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const wx = Math.sin((x / p) * Math.PI * 2);
      const wy = Math.sin((y / p) * Math.PI * 2);
      // over/under checker weave
      const over = ((Math.floor(x / p) + Math.floor(y / p)) & 1) === 0;
      const w = over ? wx * 0.5 + 0.5 : wy * 0.5 + 0.5;
      const wSoft = 0.5 + (w - 0.5) * 0.6;
      // ripstop reinforcement grid every 8 threads
      const rip = x % (p * 8) < 1.5 || y % (p * 8) < 1.5 ? 0.35 : 0;
      height[i] = w * 0.55 + rip;
      const v = clamp(0.88 + (low[i]! - 0.5) * blotch * 2 - (1 - wSoft) * 0.08 + rip * 0.05, 0, 1);
      img.data[i * 4] = v * 255;
      img.data[i * 4 + 1] = v * 255;
      img.data[i * 4 + 2] = v * 255;
      img.data[i * 4 + 3] = 255;
    }
  }
  mg.putImageData(img, 0, 0);
  return { map: toTexture(mc, true), normalMap: toTexture(heightToNormal(height, size, 1.5), false) };
}

// ---------------------------------------------------------------------------------------------
// Ceramic armour plate (speckled grey with tape edge)
// ---------------------------------------------------------------------------------------------

export function makeCeramicSet(seed = 51): PbrSet {
  const size = 256;
  const rand = mulberry32(seed);
  const low = fbm(size, 4, 3, rand);
  const speck = fbm(size, 64, 1, rand);
  const [mc, mg] = makeCanvas(size);
  const img = mg.createImageData(size, size);
  const height = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) {
    const s = speck[i]! > 0.7 ? 0.05 : speck[i]! < 0.28 ? -0.035 : 0;
    const v = clamp(0.72 + (low[i]! - 0.5) * 0.14 + s, 0, 1);
    img.data[i * 4] = v * 250;
    img.data[i * 4 + 1] = v * 252;
    img.data[i * 4 + 2] = v * 255;
    img.data[i * 4 + 3] = 255;
    height[i] = speck[i]! * 0.25 + low[i]! * 0.1;
  }
  mg.putImageData(img, 0, 0);
  return { map: toTexture(mc, true), normalMap: toTexture(heightToNormal(height, size, 1.0), false) };
}

// ---------------------------------------------------------------------------------------------
// Sprites: muzzle flash star / glow / streak, optic reticles
// ---------------------------------------------------------------------------------------------

export function makeGlowSprite(size = 128): THREE.CanvasTexture {
  const [c, g] = makeCanvas(size);
  const r = size / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.15, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.22)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return toTexture(c, true, false);
}

export function makeStarSprite(seed = 3, size = 256, spikes = 7): THREE.CanvasTexture {
  const rand = mulberry32(seed);
  const [c, g] = makeCanvas(size);
  const r = size / 2;
  g.fillStyle = '#000';
  g.fillRect(0, 0, size, size);
  g.globalCompositeOperation = 'lighter';
  g.translate(r, r);
  for (let i = 0; i < spikes; i++) {
    const a = (i / spikes) * Math.PI * 2 + (rand() - 0.5) * 0.4;
    const len = r * (0.55 + rand() * 0.45);
    const wid = r * (0.05 + rand() * 0.06);
    g.save();
    g.rotate(a);
    const grad = g.createLinearGradient(0, 0, len, 0);
    grad.addColorStop(0, 'rgba(255,255,255,0.95)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(0, -wid);
    g.quadraticCurveTo(len * 0.5, -wid * 0.5, len, 0);
    g.quadraticCurveTo(len * 0.5, wid * 0.5, 0, wid);
    g.closePath();
    g.fill();
    g.restore();
  }
  const core = g.createRadialGradient(0, 0, 0, 0, 0, r * 0.5);
  core.addColorStop(0, 'rgba(255,255,255,1)');
  core.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  core.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = core;
  g.fillRect(-r, -r, size, size);
  return toTexture(c, true, false);
}

/** Flame streak: bright at the left (muzzle) fading to the right; used on planes along the barrel axis. */
export function makeStreakSprite(size = 128): THREE.CanvasTexture {
  const w = size * 2;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, size);
  const grad = g.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.7)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(0, size * 0.32);
  g.quadraticCurveTo(w * 0.3, size * 0.05, w, size * 0.5);
  g.quadraticCurveTo(w * 0.3, size * 0.95, 0, size * 0.68);
  g.closePath();
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makeReticleSprite(kind: 'dot' | 'ring' = 'ring', size = 128): THREE.CanvasTexture {
  const [c, g] = makeCanvas(size);
  g.clearRect(0, 0, size, size);
  const r = size / 2;
  g.strokeStyle = 'rgba(255,255,255,1)';
  g.fillStyle = 'rgba(255,255,255,1)';
  if (kind === 'ring') {
    g.lineWidth = size * 0.028;
    g.beginPath();
    g.arc(r, r, r * 0.6, 0, Math.PI * 2);
    g.stroke();
    // four short ticks
    g.lineWidth = size * 0.03;
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      g.beginPath();
      g.moveTo(r + Math.cos(a) * r * 0.6, r + Math.sin(a) * r * 0.6);
      g.lineTo(r + Math.cos(a) * r * 0.86, r + Math.sin(a) * r * 0.86);
      g.stroke();
    }
  }
  const dot = g.createRadialGradient(r, r, 0, r, r, size * 0.06);
  dot.addColorStop(0, 'rgba(255,255,255,1)');
  dot.addColorStop(0.7, 'rgba(255,255,255,0.9)');
  dot.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = dot;
  g.fillRect(0, 0, size, size);
  return toTexture(c, true, false);
}

/** Small emissive label / text plate (watch face, stencil marks). */
export function makeLabelTexture(lines: string[], w = 128, h = 64, fg = '#9fe8ff', bg = 'rgba(0,0,0,0)'): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.fillStyle = fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const fs = Math.floor(h / (lines.length + 0.6));
  g.font = `bold ${fs}px ui-monospace, Menlo, monospace`;
  lines.forEach((l, i) => g.fillText(l, w / 2, (h / (lines.length + 1)) * (i + 1)));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
