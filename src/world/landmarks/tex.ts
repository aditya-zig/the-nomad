/**
 * Small procedural canvas textures owned by the landmarks module: pad markings, floor rings, liquid ripples, facades,
 * console screens and sign boards. All lazily created and cached; canvases are small (<= 1024).
 */
import * as THREE from 'three';
import { Rng, cached, memo } from './util';

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return [c, ctx];
}

function toTexture(c: HTMLCanvasElement, srgb = true, repeat = false): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
  }
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

/** Scuffs paint: erases (or dirties) random speckles / scratches so markings look worn. */
function wear(ctx: CanvasRenderingContext2D, w: number, h: number, rng: Rng, amount: number, mode: 'erase' | 'dirt' = 'erase'): void {
  ctx.save();
  if (mode === 'erase') ctx.globalCompositeOperation = 'destination-out';
  const n = Math.floor(amount * w * h * 0.0009);
  for (let i = 0; i < n; i++) {
    const x = rng.f() * w;
    const y = rng.f() * h;
    const s = rng.range(1, 9);
    ctx.fillStyle = mode === 'erase' ? `rgba(0,0,0,${rng.range(0.25, 0.9)})` : `rgba(30,24,18,${rng.range(0.1, 0.4)})`;
    ctx.fillRect(x, y, s * rng.range(0.5, 3), s * rng.range(0.3, 1.2));
  }
  // scratches
  for (let i = 0; i < n * 0.06; i++) {
    ctx.strokeStyle = mode === 'erase' ? 'rgba(0,0,0,0.6)' : 'rgba(30,24,18,0.3)';
    ctx.lineWidth = rng.range(0.6, 2);
    ctx.beginPath();
    const x = rng.f() * w;
    const y = rng.f() * h;
    ctx.moveTo(x, y);
    ctx.lineTo(x + rng.range(-40, 40), y + rng.range(-40, 40));
    ctx.stroke();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------
// Helipad markings (transparent, 1024)
// ---------------------------------------------------------------------------------------------

export function helipadTexture(): THREE.CanvasTexture {
  return memo('tex:helipad', () => {
    const S = 1024;
    const [c, ctx] = makeCanvas(S, S);
    const rng = new Rng(4411);
    const cx = S / 2;
    ctx.clearRect(0, 0, S, S);
    // rubber landing smears (dark, translucent) drawn first
    ctx.fillStyle = 'rgba(8,8,10,0.28)';
    for (let i = 0; i < 26; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(60, 380);
      ctx.beginPath();
      ctx.ellipse(cx + Math.cos(a) * r, cx + Math.sin(a) * r, rng.range(20, 70), rng.range(6, 18), a, 0, Math.PI * 2);
      ctx.fill();
    }
    // outer safety ring (white) and inner dashed ring (yellow)
    ctx.strokeStyle = '#e8e6de';
    ctx.lineWidth = 26;
    ctx.beginPath();
    ctx.arc(cx, cx, 478, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = '#e0b520';
    ctx.lineWidth = 16;
    const dashes = 56;
    for (let i = 0; i < dashes; i++) {
      const a0 = (i / dashes) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx, cx, 436, a0, a0 + (Math.PI * 2) / dashes * 0.55);
      ctx.stroke();
    }
    // H
    ctx.fillStyle = '#ecebe4';
    const hw = 52;
    const hh = 330;
    const gap = 210;
    ctx.fillRect(cx - gap / 2 - hw, cx - hh / 2, hw, hh);
    ctx.fillRect(cx + gap / 2, cx - hh / 2, hw, hh);
    ctx.fillRect(cx - gap / 2 - 2, cx - hw / 2, gap + 4, hw);
    // hazard chevrons at the four compass points (pointing inward)
    ctx.fillStyle = '#d8ae1c';
    for (let k = 0; k < 4; k++) {
      ctx.save();
      ctx.translate(cx, cx);
      ctx.rotate((k * Math.PI) / 2);
      for (let j = 0; j < 2; j++) {
        ctx.beginPath();
        ctx.moveTo(-46, -300 - j * 44);
        ctx.lineTo(0, -262 - j * 44);
        ctx.lineTo(46, -300 - j * 44);
        ctx.lineTo(46, -318 - j * 44);
        ctx.lineTo(0, -280 - j * 44);
        ctx.lineTo(-46, -318 - j * 44);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
    // load / diameter marking
    ctx.fillStyle = '#ecebe4';
    ctx.font = 'bold 54px "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.save();
    ctx.translate(cx, cx - 385);
    ctx.fillText('22 t', 0, 0);
    ctx.restore();
    wear(ctx, S, S, rng, 1.6, 'erase');
    return toTexture(c);
  });
}

// ---------------------------------------------------------------------------------------------
// Defense-circle floor markings for the transmitter site (transparent, 1024)
// ---------------------------------------------------------------------------------------------

export function defenseRingTexture(): THREE.CanvasTexture {
  return memo('tex:defense', () => {
    const S = 1024;
    const [c, ctx] = makeCanvas(S, S);
    const rng = new Rng(9021);
    const cx = S / 2;
    ctx.clearRect(0, 0, S, S);
    // dashed hazard ring (yellow/black)
    const seg = 96;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2;
      const a1 = ((i + 1) / seg) * Math.PI * 2;
      ctx.strokeStyle = i % 2 === 0 ? '#d9b21e' : '#15171a';
      ctx.lineWidth = 20;
      ctx.beginPath();
      ctx.arc(cx, cx, 496, a0, a1 + 0.004);
      ctx.stroke();
    }
    // inner thin ring
    ctx.strokeStyle = 'rgba(217,178,30,0.85)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(cx, cx, 470, 0, Math.PI * 2);
    ctx.stroke();
    // tick marks (like a range dial) every 15 degrees, longer at cardinals
    ctx.strokeStyle = 'rgba(230,226,210,0.9)';
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const long = i % 6 === 0;
      ctx.lineWidth = long ? 10 : 5;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (long ? 430 : 448), cx + Math.sin(a) * (long ? 430 : 448));
      ctx.lineTo(cx + Math.cos(a) * 468, cx + Math.sin(a) * 468);
      ctx.stroke();
    }
    // inward chevrons at N/E/S/W
    ctx.fillStyle = '#d9b21e';
    for (let k = 0; k < 4; k++) {
      ctx.save();
      ctx.translate(cx, cx);
      ctx.rotate((k * Math.PI) / 2);
      for (let j = 0; j < 3; j++) {
        const y = -380 + j * 34;
        ctx.beginPath();
        ctx.moveTo(-42, y);
        ctx.lineTo(0, y + 30);
        ctx.lineTo(42, y);
        ctx.lineTo(42, y - 14);
        ctx.lineTo(0, y + 16);
        ctx.lineTo(-42, y - 14);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
    // label
    ctx.fillStyle = 'rgba(230,226,210,0.85)';
    ctx.font = 'bold 44px "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('RELAY PERIMETER', cx, cx + 402);
    wear(ctx, S, S, rng, 1.3, 'erase');
    return toTexture(c);
  });
}

// ---------------------------------------------------------------------------------------------
// Toxic liquid ripples (tileable)
// ---------------------------------------------------------------------------------------------

interface Wave {
  kx: number;
  ky: number;
  ph: number;
  a: number;
}

function makeWaves(rng: Rng, n: number, kmin: number, kmax: number): Wave[] {
  const out: Wave[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ kx: rng.int(kmin, kmax) * rng.sign(), ky: rng.int(kmin, kmax) * rng.sign(), ph: rng.range(0, 6.28), a: rng.range(0.5, 1) });
  }
  return out;
}

function fieldAt(u: number, v: number, waves: Wave[]): number {
  let s = 0;
  let norm = 0;
  for (const w of waves) {
    s += Math.sin(Math.PI * 2 * (w.kx * u + w.ky * v) + w.ph) * w.a;
    norm += w.a;
  }
  return s / norm;
}

export function liquidTextures(): { base: THREE.CanvasTexture; glow: THREE.CanvasTexture } {
  return memo('tex:liquid', () => {
    const S = 256;
    const rng = new Rng(777);
    const wa = makeWaves(rng, 6, 2, 7);
    const wb = makeWaves(rng, 5, 5, 12);
    const [c1, x1] = makeCanvas(S, S);
    const [c2, x2] = makeCanvas(S, S);
    const i1 = x1.createImageData(S, S);
    const i2 = x2.createImageData(S, S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = x / S;
        const v = y / S;
        const f = fieldAt(u, v, wa) * 0.65 + fieldAt(u, v, wb) * 0.35;
        const ridge = 1 - Math.abs(f) * 1.7; // bright veins where f ~ 0
        const veins = Math.pow(Math.max(0, ridge), 3.2);
        const blob = Math.max(0, f) * 0.6 + 0.25;
        const o = (y * S + x) * 4;
        // base: dark murky green
        i1.data[o] = 6 + blob * 10;
        i1.data[o + 1] = 26 + blob * 40;
        i1.data[o + 2] = 14 + blob * 16;
        i1.data[o + 3] = 255;
        // glow: veins bright green, bodies mid green
        const g = Math.min(1, 0.18 + veins * 0.95 + blob * 0.25);
        i2.data[o] = 30 * g;
        i2.data[o + 1] = 255 * g;
        i2.data[o + 2] = 110 * g;
        i2.data[o + 3] = 255;
      }
    }
    x1.putImageData(i1, 0, 0);
    x2.putImageData(i2, 0, 0);
    return { base: toTexture(c1, true, true), glow: toTexture(c2, true, true) };
  });
}

// ---------------------------------------------------------------------------------------------
// City facades (albedo + emissive windows), 3 variants
// ---------------------------------------------------------------------------------------------

export interface FacadeSet {
  albedo: THREE.CanvasTexture;
  emissive: THREE.CanvasTexture;
}

export function facadeTextures(variant: number): FacadeSet {
  return memo(`tex:facade${variant}`, () => {
    const S = 512;
    const rng = new Rng(3100 + variant * 37);
    const [ca, xa] = makeCanvas(S, S);
    const [ce, xe] = makeCanvas(S, S);
    const palette = [
      { wall: '#252c34', frame: '#171c22', glass: '#0b1219' },
      { wall: '#30282a', frame: '#1c1719', glass: '#0d1015' },
      { wall: '#1b242d', frame: '#10161c', glass: '#0a1721' },
    ][variant % 3]!;
    xa.fillStyle = palette.wall;
    xa.fillRect(0, 0, S, S);
    // mottled wall
    for (let i = 0; i < 1400; i++) {
      const v = rng.range(-12, 12);
      xa.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${Math.abs(v) / 90})`;
      xa.fillRect(rng.f() * S, rng.f() * S, rng.range(4, 26), rng.range(4, 26));
    }
    xe.fillStyle = '#000';
    xe.fillRect(0, 0, S, S);
    const cols = 4;
    const rows = 4;
    const cw = S / cols;
    const rh = S / rows;
    const litColors = ['#ffcf8a', '#ffe1b0', '#cfe6ff', '#ffb870'];
    for (let r = 0; r < rows; r++) {
      for (let cIdx = 0; cIdx < cols; cIdx++) {
        const x = cIdx * cw + cw * 0.16;
        const y = r * rh + rh * 0.2;
        const w = cw * 0.68;
        const h = rh * 0.6;
        xa.fillStyle = palette.frame;
        xa.fillRect(x - 5, y - 5, w + 10, h + 10);
        const g = xa.createLinearGradient(x, y, x, y + h);
        g.addColorStop(0, '#16222e');
        g.addColorStop(1, palette.glass);
        xa.fillStyle = g;
        xa.fillRect(x, y, w, h);
        // mullion
        xa.fillStyle = palette.frame;
        xa.fillRect(x + w / 2 - 2, y, 4, h);
        const roll = rng.f();
        if (roll < 0.09) {
          xe.fillStyle = rng.pick(litColors);
          xe.globalAlpha = rng.range(0.35, 0.9);
          xe.fillRect(x + 2, y + 2, w - 4, h - 4);
          xe.globalAlpha = 1;
        } else if (roll < 0.14) {
          // broken window (dark diagonal crack highlight)
          xa.strokeStyle = 'rgba(160,190,210,0.25)';
          xa.lineWidth = 2;
          xa.beginPath();
          xa.moveTo(x, y);
          xa.lineTo(x + w * rng.range(0.4, 1), y + h * rng.range(0.4, 1));
          xa.stroke();
        }
      }
      // floor slab line
      xa.fillStyle = 'rgba(0,0,0,0.28)';
      xa.fillRect(0, r * rh, S, 4);
    }
    // streaks of grime
    for (let i = 0; i < 40; i++) {
      xa.fillStyle = `rgba(0,0,0,${rng.range(0.05, 0.16)})`;
      xa.fillRect(rng.f() * S, rng.f() * S * 0.5, rng.range(3, 10), rng.range(60, 260));
    }
    return { albedo: toTexture(ca, true, true), emissive: toTexture(ce, true, true) };
  });
}

// ---------------------------------------------------------------------------------------------
// Sign boards
// ---------------------------------------------------------------------------------------------

export interface SignOpts {
  bg?: string;
  fg?: string;
  border?: string;
  /** width / height */
  aspect?: number;
  emissive?: boolean;
  worn?: boolean;
  fontScale?: number;
}

/** Cached sign material: board with border and centred text lines. Emissive signs glow (backlit). */
export function signMaterial(lines: string[], o: SignOpts = {}): THREE.MeshStandardMaterial {
  const key = `sign:${lines.join('|')}:${o.bg}:${o.fg}:${o.border}:${o.aspect}:${o.emissive ? 1 : 0}`;
  return cached(key, () => {
    const aspect = o.aspect ?? 2;
    const H = 256;
    const W = Math.round(H * aspect);
    const [c, ctx] = makeCanvas(W, H);
    const bg = o.bg ?? '#c9a51c';
    const fg = o.fg ?? '#121212';
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = o.border ?? fg;
    ctx.lineWidth = 8;
    ctx.strokeRect(10, 10, W - 20, H - 20);
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const n = lines.length;
    const lineH = (H - 40) / n;
    const size = Math.min(lineH * 0.82 * (o.fontScale ?? 1), (W - 50) / Math.max(4, Math.max(...lines.map((l) => l.length)) * 0.62));
    ctx.font = `bold ${size}px "Arial Narrow", "Helvetica Neue", Arial, sans-serif`;
    lines.forEach((ln, i) => ctx.fillText(ln, W / 2, 20 + lineH * (i + 0.5)));
    if (o.worn !== false) wear(ctx, W, H, new Rng(lines.join('').length * 31 + 7), 0.7, 'dirt');
    const tex = toTexture(c);
    const m = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.55,
      metalness: 0.25,
      emissive: o.emissive ? new THREE.Color(0xffffff) : new THREE.Color(0x000000),
      emissiveMap: o.emissive ? tex : null,
      emissiveIntensity: o.emissive ? 0.9 : 0,
    });
    return m;
  });
}

// ---------------------------------------------------------------------------------------------
// Console screen (drawn dynamically by the transmitter)
// ---------------------------------------------------------------------------------------------

export type ConsoleState = 'off' | 'ready' | 'active' | 'done';

export function drawConsoleScreen(ctx: CanvasRenderingContext2D, w: number, h: number, state: ConsoleState, progress: number, t: number): void {
  ctx.fillStyle = '#04080a';
  ctx.fillRect(0, 0, w, h);
  if (state === 'off') {
    // dead screen: faint scanline noise
    ctx.fillStyle = 'rgba(40,70,80,0.08)';
    for (let y = 0; y < h; y += 6) ctx.fillRect(0, y, w, 2);
    return;
  }
  const col = state === 'ready' ? '#ffb030' : state === 'active' ? '#4fe0ff' : '#5dff9a';
  ctx.strokeStyle = col;
  ctx.lineWidth = 3;
  ctx.strokeRect(6, 6, w - 12, h - 12);
  ctx.fillStyle = col;
  ctx.font = `bold ${Math.round(h * 0.13)}px ui-monospace, "SF Mono", Menlo, monospace`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const head = state === 'ready' ? 'RELAY OFFLINE' : state === 'active' ? 'UPLINK ACTIVE' : 'UPLINK COMPLETE';
  ctx.fillText(head, 16, 14);
  ctx.font = `${Math.round(h * 0.085)}px ui-monospace, "SF Mono", Menlo, monospace`;
  const sub = state === 'ready' ? 'AWAITING OPERATOR' : state === 'active' ? `HOLD PERIMETER  ${Math.round(progress * 100)}%` : 'STATION SECURED';
  ctx.fillText(sub, 16, 14 + h * 0.17);
  // progress bar
  const bx = 16;
  const by = h * 0.58;
  const bw = w - 32;
  const bh = h * 0.16;
  ctx.strokeStyle = col;
  ctx.lineWidth = 2;
  ctx.strokeRect(bx, by, bw, bh);
  ctx.fillRect(bx + 3, by + 3, Math.max(0, (bw - 6) * (state === 'done' ? 1 : progress)), bh - 6);
  // fake data ticker
  ctx.globalAlpha = 0.75;
  ctx.font = `${Math.round(h * 0.07)}px ui-monospace, "SF Mono", Menlo, monospace`;
  const off = Math.floor(t * 8) % 16;
  const row = state === 'active' ? `${(0x3a90 + off * 77).toString(16).toUpperCase()} ${(0xb2c1 - off * 31).toString(16).toUpperCase()} ${(0x77d0 + off * 13).toString(16).toUpperCase()}` : 'NO CARRIER';
  ctx.fillText(row, 16, h * 0.8);
  ctx.globalAlpha = 1;
}

/** Text label for lit signs, e.g. a checkout "OPEN" sign. */
export function neonLabelMaterial(text: string, hex: string): THREE.MeshStandardMaterial {
  return signMaterial([text], { bg: '#0a0d10', fg: hex, border: hex, aspect: 2.6, emissive: true, worn: false });
}

// ---------------------------------------------------------------------------------------------
// Server rack fronts and lab monitor screens
// ---------------------------------------------------------------------------------------------

/** Perforated server door front: dark plate with drive bays and vent slits (LEDs are added as glow points). */
export function serverFrontTexture(): THREE.CanvasTexture {
  return memo('tex:serverFront', () => {
    const W = 256;
    const H = 512;
    const [c, ctx] = makeCanvas(W, H);
    const rng = new Rng(555);
    ctx.fillStyle = '#2b3138';
    ctx.fillRect(0, 0, W, H);
    // units
    let y = 14;
    while (y < H - 30) {
      const h = rng.pick([28, 28, 44, 60]);
      ctx.fillStyle = '#3a434b';
      ctx.fillRect(10, y, W - 20, h - 4);
      ctx.strokeStyle = '#0a0c0e';
      ctx.lineWidth = 2;
      ctx.strokeRect(10, y, W - 20, h - 4);
      // vent slits
      ctx.fillStyle = '#0d1013';
      for (let x = 22; x < W - 70; x += 7) ctx.fillRect(x, y + 6, 3, h - 16);
      // handle / label
      ctx.fillStyle = '#3a4148';
      ctx.fillRect(W - 60, y + 6, 40, 7);
      y += h;
    }
    // panel edges
    ctx.strokeStyle = '#2a3036';
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, W - 6, H - 6);
    // dirt
    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = `rgba(0,0,0,${rng.range(0.05, 0.25)})`;
      ctx.fillRect(rng.f() * W, rng.f() * H, rng.range(2, 14), rng.range(2, 10));
    }
    return toTexture(c);
  });
}

/** Lab monitor screen contents (emissive), 3 variants: vitals trace, text log, radial scan. */
export function monitorTexture(variant: number): THREE.CanvasTexture {
  return memo(`tex:monitor${variant % 3}`, () => {
    const W = 256;
    const H = 160;
    const [c, ctx] = makeCanvas(W, H);
    const rng = new Rng(880 + variant * 13);
    ctx.fillStyle = '#031008';
    ctx.fillRect(0, 0, W, H);
    const v = variant % 3;
    const col = v === 1 ? '#5ad0ff' : v === 2 ? '#ffb040' : '#4dff8a';
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    ctx.lineWidth = 2;
    ctx.font = 'bold 11px ui-monospace, "SF Mono", Menlo, monospace';
    if (v === 0) {
      ctx.fillText('SUBJECT 04  VITALS', 8, 16);
      for (let row = 0; row < 3; row++) {
        ctx.beginPath();
        const y0 = 50 + row * 40;
        ctx.moveTo(6, y0);
        for (let x = 6; x < W - 6; x += 2) {
          const spike = x % 46 < 4 ? -rng.range(14, 26) : rng.range(-2, 2);
          ctx.lineTo(x, y0 + spike);
        }
        ctx.stroke();
      }
    } else if (v === 1) {
      for (let i = 0; i < 11; i++) {
        ctx.globalAlpha = rng.range(0.5, 1);
        const len = rng.int(10, 30);
        ctx.fillText('> ' + Array.from({ length: len }, () => rng.pick(['0', '1', 'A', 'F', '#', '.'])).join(''), 8, 16 + i * 13);
      }
      ctx.globalAlpha = 1;
    } else {
      ctx.beginPath();
      ctx.arc(80, 84, 58, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(80, 84, 30, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(80, 84);
      ctx.lineTo(126, 60);
      ctx.stroke();
      for (let i = 0; i < 7; i++) {
        ctx.beginPath();
        ctx.arc(80 + rng.range(-40, 40), 84 + rng.range(-40, 40), rng.range(2, 5), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillText('BIO-SCAN', 158, 24);
      ctx.fillText('SIG 0.87', 158, 44);
      ctx.fillText('CONTAM HIGH', 158, 64);
    }
    // scanlines
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = '#000';
    for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
    ctx.globalAlpha = 1;
    return toTexture(c);
  });
}
