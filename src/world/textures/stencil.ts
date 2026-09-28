/**
 * Canvas helpers: font stacks, fitted multi-line text with stencil bridges, paint erosion, transparent-colour bleed,
 * and compositing a canvas drawing onto a TexBuilder (used for stencilled markings on crates, barrels, boxes).
 */
import * as THREE from 'three';
import { type NoiseBank, S, SM, SS, type TexBuilder, mulberry32, sstep } from './core';

export type FontKind = 'stencil' | 'sans' | 'mono';

export const FONT_STACKS: Record<FontKind, string> = {
  stencil: '"Stencil Std", "Stencil", "Impact", "Haettenschweiler", "Arial Narrow Bold", "Arial Black", sans-serif',
  sans: '"Helvetica Neue", "Arial", "Liberation Sans", sans-serif',
  mono: '"SF Mono", "Menlo", "Consolas", "Courier New", monospace',
};

export function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  if (!g) throw new Error('2D canvas unavailable');
  return { canvas, g };
}

export interface TextOpts {
  color: string;
  font?: FontKind;
  weight?: string;
  /** Cut stencil bridges into glyphs. */
  bridges?: boolean;
  /** Fraction of the box the text may fill horizontally / vertically. */
  fill?: number;
  letterSpacing?: number;
  align?: 'center' | 'left';
}

/** Draw `text` (\n separated lines) fitted inside the box. */
export function drawFittedText(g: CanvasRenderingContext2D, text: string, x: number, y: number, w: number, h: number, o: TextOpts): void {
  const lines = text.split('\n');
  const lineH = h / lines.length;
  const family = FONT_STACKS[o.font ?? 'stencil'];
  const weight = o.weight ?? (o.font === 'mono' ? 'bold' : 'bold');
  g.save();
  g.fillStyle = o.color;
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  const spacing = o.letterSpacing ?? 0;
  const ctxAny = g as CanvasRenderingContext2D & { letterSpacing?: string };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    let size = lineH * (o.fill ?? 0.86);
    g.font = `${weight} ${size}px ${family}`;
    if ('letterSpacing' in ctxAny) ctxAny.letterSpacing = `${spacing * size}px`;
    let width = g.measureText(line).width;
    const maxW = w * (o.fill ?? 0.94);
    if (width > maxW) {
      size *= maxW / width;
      g.font = `${weight} ${size}px ${family}`;
      if ('letterSpacing' in ctxAny) ctxAny.letterSpacing = `${spacing * size}px`;
      width = g.measureText(line).width;
    }
    const startX = o.align === 'left' ? x : x + (w - width) / 2;
    const cy = y + lineH * (i + 0.5);
    g.fillText(line, startX, cy);
    if (o.bridges) {
      // stencil bridges: punch thin slits through glyphs that have counters
      const slit = Math.max(1.5, size * 0.055);
      g.globalCompositeOperation = 'destination-out';
      for (let c = 0; c < line.length; c++) {
        const ch = line[c]!;
        if (!'OADPRBQ0469@8&'.includes(ch.toUpperCase())) continue;
        const before = g.measureText(line.slice(0, c)).width;
        const cw = g.measureText(ch).width;
        const cx = startX + before + cw / 2;
        g.fillRect(cx - slit / 2, cy - size * 0.5, slit, size * 0.24);
        g.fillRect(cx - slit / 2, cy + size * 0.26, slit, size * 0.24);
      }
      g.globalCompositeOperation = 'source-over';
    }
  }
  if ('letterSpacing' in ctxAny) ctxAny.letterSpacing = '0px';
  g.restore();
}

/**
 * Erode painted pixels using the noise bank (worn paint), replace the RGB of all pixels by `color`
 * (avoids dark halos when filtering) and return the ImageData ready for putImageData.
 */
export function finishPaint(
  img: ImageData,
  bank: NoiseBank,
  o: { color?: [number, number, number]; wear?: number; seed?: number; alpha?: number; jitter?: number },
): ImageData {
  const d = img.data;
  const w = img.width;
  const h = img.height;
  const wear = o.wear ?? 0;
  const off = Math.floor((o.seed ?? 1) * 7919) % (S * S);
  const alphaK = o.alpha ?? 1;
  for (let y = 0; y < h; y++) {
    const rowB = (y & SM) << SS;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      let a = d[i + 3]! / 255;
      if (a > 0.002 && wear > 0) {
        const bi = (rowB | (x & SM)) + off;
        const n = bank.fine[bi & (S * S - 1)]! * 0.55 + (bank.white[(bi * 3) & (S * S - 1)]! / 255) * 0.25 + bank.mid[(bi + 5000) & (S * S - 1)]! * 0.4;
        a *= 1 - wear * sstep(0.72, 0.98, n) - wear * 0.25 * sstep(0.5, 0.8, bank.mid[(bi + 999) & (S * S - 1)]!);
        if (a < 0) a = 0;
      }
      d[i + 3] = a * alphaK * 255;
      if (o.color) {
        d[i] = o.color[0];
        d[i + 1] = o.color[1];
        d[i + 2] = o.color[2];
      }
    }
  }
  return img;
}

/**
 * Draw vector art on a transparent N x N canvas and composite it onto `tb.albedo` (bottom-up, matching texture rows).
 * Returns the coverage mask (0..255) in texture row order.
 */
export function overlayCanvas(tb: TexBuilder, bank: NoiseBank, draw: (g: CanvasRenderingContext2D, n: number) => void, wear = 0.25, seed = 3): Uint8Array {
  const n = tb.N;
  const { canvas, g } = makeCanvas(n, n);
  draw(g, n);
  const img = g.getImageData(0, 0, n, n);
  // apply wear to coverage
  const d = img.data;
  const mask = new Uint8Array(n * n);
  const rng = mulberry32(seed);
  const off = Math.floor(rng() * S * S);
  for (let y = 0; y < n; y++) {
    const ty = n - 1 - y; // canvas row -> texture row
    for (let x = 0; x < n; x++) {
      const i = (y * n + x) * 4;
      let a = d[i + 3]! / 255;
      if (a <= 0) continue;
      const bi = (((y & SM) << SS) | (x & SM)) + off;
      const nn = bank.fine[bi & (S * S - 1)]! * 0.5 + (bank.white[(bi * 5) & (S * S - 1)]! / 255) * 0.35 + bank.mid[(bi + 700) & (S * S - 1)]! * 0.3;
      a *= 1 - wear * sstep(0.7, 0.95, nn);
      const o = (ty * n + x) * 4;
      const k = a;
      tb.albedo[o] = tb.albedo[o]! * (1 - k) + d[i]! * k;
      tb.albedo[o + 1] = tb.albedo[o + 1]! * (1 - k) + d[i + 1]! * k;
      tb.albedo[o + 2] = tb.albedo[o + 2]! * (1 - k) + d[i + 2]! * k;
      mask[ty * n + x] = a * 255;
    }
  }
  canvas.width = 0; // release
  return mask;
}

/** Create the CanvasTexture used by decals / stencils. */
export function canvasTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  return t;
}
