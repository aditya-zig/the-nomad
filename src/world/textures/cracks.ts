/**
 * Natural-looking crack masks: meandering random-walk lines with kinks, tapering width and side branches, painted with
 * the 2D canvas and wrapped so they tile seamlessly. Voronoi edges look like cracked mud; these look like pavement.
 */
import { mulberry32 } from './core';
import { makeCanvas } from './stencil';

export interface CrackOpts {
  trunks: number;
  /** Length of each trunk in px. */
  length: number;
  /** Line width in px at the start of a trunk. */
  width: number;
  /** Branch probability per step. */
  branch: number;
  /** Direction wobble per step (radians). */
  jitter: number;
  seed: number;
}

interface Seg {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  w: number;
}

/** Returns a 0..1 coverage mask (N x N, row-major). */
export function crackMask(N: number, o: CrackOpts): Float32Array {
  const rng = mulberry32(o.seed);
  const segs: Seg[] = [];
  const walk = (x: number, y: number, ang: number, len: number, w: number, depth: number): void => {
    const step = 4 + rng() * 5;
    const n = Math.max(2, Math.floor(len / step));
    for (let i = 0; i < n; i++) {
      ang += (rng() - 0.5) * o.jitter;
      if (rng() < 0.05) ang += (rng() - 0.5) * 1.3; // occasional sharp kink
      const nx = x + Math.cos(ang) * step;
      const ny = y + Math.sin(ang) * step;
      const t = i / n;
      segs.push({ x0: x, y0: y, x1: nx, y1: ny, w: Math.max(0.7, w * (1 - 0.65 * t) * (0.75 + rng() * 0.5)) });
      x = nx;
      y = ny;
      if (depth < 3 && rng() < o.branch * (1 - t * 0.5)) {
        walk(x, y, ang + (rng() < 0.5 ? -1 : 1) * (0.35 + rng() * 0.9), len * (0.2 + rng() * 0.35), w * 0.62, depth + 1);
      }
    }
  };
  for (let k = 0; k < o.trunks; k++) walk(rng() * N, rng() * N, rng() * Math.PI * 2, o.length * (0.6 + rng() * 0.8), o.width, 0);

  const { canvas, g } = makeCanvas(N, N);
  g.fillStyle = '#000';
  g.fillRect(0, 0, N, N);
  g.strokeStyle = '#fff';
  g.lineCap = 'round';
  // draw every segment at the wrapped offsets it needs
  for (const s of segs) {
    const m = s.w + 2;
    const minX = Math.min(s.x0, s.x1);
    const minY = Math.min(s.y0, s.y1);
    // wrap the segment into the tile first so long walks that left the tile still show up
    const wrapX = Math.floor(minX / N) * N;
    const wrapY = Math.floor(minY / N) * N;
    const ax0 = s.x0 - wrapX;
    const ax1 = s.x1 - wrapX;
    const ay0 = s.y0 - wrapY;
    const ay1 = s.y1 - wrapY;
    const xs = [0];
    const ys = [0];
    if (Math.min(ax0, ax1) < m) xs.push(N);
    if (Math.max(ax0, ax1) > N - m) xs.push(-N);
    if (Math.min(ay0, ay1) < m) ys.push(N);
    if (Math.max(ay0, ay1) > N - m) ys.push(-N);
    g.lineWidth = s.w;
    for (const dy of ys) {
      for (const dx of xs) {
        g.beginPath();
        g.moveTo(ax0 + dx, ay0 + dy);
        g.lineTo(ax1 + dx, ay1 + dy);
        g.stroke();
      }
    }
  }
  const d = g.getImageData(0, 0, N, N).data;
  const out = new Float32Array(N * N);
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4]! / 255;
  canvas.width = 0;
  return out;
}

export interface Cracks512 {
  /** A few long hairline cracks (pavement, slabs). */
  sparse: Float32Array;
  /** Many short fine cracks (plaster, floors). */
  dense: Float32Array;
}
let c512: Cracks512 | null = null;
export function getCracks512(): Cracks512 {
  if (!c512) {
    c512 = {
      sparse: crackMask(512, { trunks: 5, length: 330, width: 1.5, branch: 0.06, jitter: 0.55, seed: 4001 }),
      dense: crackMask(512, { trunks: 10, length: 190, width: 1.2, branch: 0.09, jitter: 0.85, seed: 4013 }),
    };
  }
  return c512;
}

export interface Cracks1k {
  /** Hairline cracks in the asphalt. */
  fine: Float32Array;
  /** Wider, glossy black tar-sealed cracks. */
  tar: Float32Array;
}
let c1k: Cracks1k | null = null;
export function getCracks1k(): Cracks1k {
  if (!c1k) {
    c1k = {
      fine: crackMask(1024, { trunks: 9, length: 700, width: 1.9, branch: 0.05, jitter: 0.5, seed: 5003 }),
      tar: crackMask(1024, { trunks: 3, length: 800, width: 4.2, branch: 0.012, jitter: 0.28, seed: 5011 }),
    };
  }
  return c1k;
}

export function releaseCracks(): void {
  c512 = null;
  c1k = null;
}
