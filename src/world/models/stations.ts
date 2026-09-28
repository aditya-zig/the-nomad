/**
 * Buy station (green supply cage with awning) and upgrade station (amber/cyan armory workbench with gantry).
 * Body geometry is one merged mesh per kind (shared, reference counted); screens / holo / sign / glow are small extra
 * meshes with per-instance materials so state feedback can be driven without allocation.
 */
import * as THREE from 'three';
import type { StationKind, StationModel } from '../models';
import {
  GeoBatch,
  MONO_FONT,
  UI_FONT,
  acquire,
  canvasTexture,
  createDetailMaterial,
  hdr,
  makeCanvas,
  makeDetailUniforms,
  makeRadialTexture,
  mulberry32,
  release,
  type ColorFn,
  type DetailUniforms,
} from './util';

// ---------------------------------------------------------------------------------------------
// shared textures
// ---------------------------------------------------------------------------------------------

function makeWireTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(128, 128);
  ctx.clearRect(0, 0, 128, 128);
  ctx.strokeStyle = '#aab2b8';
  ctx.lineWidth = 3.2;
  ctx.lineCap = 'round';
  for (let i = -128; i <= 256; i += 32) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + 128, 128);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(i + 128, 0);
    ctx.lineTo(i, 128);
    ctx.stroke();
  }
  const t = canvasTexture(canvas, { repeat: true, aniso: 8 });
  t.generateMipmaps = true;
  return t;
}

function makeSignTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(768, 160);
  ctx.fillStyle = '#04120a';
  ctx.fillRect(0, 0, 768, 160);
  ctx.strokeStyle = '#3fe07a';
  ctx.lineWidth = 6;
  ctx.strokeRect(8, 8, 752, 144);
  ctx.lineWidth = 2;
  ctx.strokeRect(20, 20, 728, 120);
  ctx.fillStyle = '#62ff9a';
  ctx.shadowColor = '#3cff88';
  ctx.shadowBlur = 16;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  (ctx as unknown as { letterSpacing: string }).letterSpacing = '10px';
  ctx.font = `800 74px ${UI_FONT}`;
  ctx.fillText('SUPPLY CACHE', 384, 66);
  ctx.shadowBlur = 6;
  (ctx as unknown as { letterSpacing: string }).letterSpacing = '6px';
  ctx.font = `600 24px ${UI_FONT}`;
  ctx.fillText('AMMO  //  ARMOR  //  ARMS  //  ORDNANCE', 384, 124);
  // scanlines
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  for (let y = 0; y < 160; y += 4) ctx.fillRect(0, y, 768, 1.5);
  return canvasTexture(canvas, { aniso: 8 });
}

function makeBuyScreenTexture(): THREE.CanvasTexture {
  const W = 256;
  const H = 320;
  const { canvas, ctx } = makeCanvas(W, H);
  ctx.fillStyle = '#04140a';
  ctx.fillRect(0, 0, W, H);
  const rows: [string, string][] = [
    ['AMMO REFILL', '$250'],
    ['ARMOR PLATE', '$350'],
    ['FRAG GRENADE x2', '$200'],
    ['PS-12 SHOTGUN', '$1200'],
    ['KR-16 RIFLE', '$700'],
    ['VX-9 PISTOL', '$200'],
    ['NOTE: CASH ONLY', ''],
    ['SUPPLY CHAIN 7-B', 'OK'],
  ];
  ctx.textBaseline = 'middle';
  const half = H / 2;
  for (let copy = 0; copy < 2; copy++) {
    const y0 = copy * half;
    ctx.fillStyle = '#3fe07a';
    ctx.fillRect(0, y0, W, 20);
    ctx.fillStyle = '#04140a';
    ctx.font = `800 15px ${UI_FONT}`;
    ctx.textAlign = 'left';
    ctx.fillText('QUARTERMASTER  //  STOCK', 8, y0 + 11);
    ctx.font = `600 13px ${MONO_FONT}`;
    rows.forEach(([a, p], i) => {
      const y = y0 + 34 + i * 15.5;
      ctx.fillStyle = i % 2 ? '#3fbf6a' : '#62ff9a';
      ctx.textAlign = 'left';
      ctx.fillText(a, 8, y);
      ctx.textAlign = 'right';
      ctx.fillText(p, W - 8, y);
    });
  }
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
  const t = canvasTexture(canvas, { repeat: true, aniso: 8 });
  t.repeat.set(1, 0.5);
  return t;
}

function makeToolWallTexture(): THREE.CanvasTexture {
  const W = 1024;
  const H = 512;
  const { canvas, ctx } = makeCanvas(W, H);
  const rand = mulberry32(777);
  ctx.fillStyle = '#23292e';
  ctx.fillRect(0, 0, W, H);
  // pegboard holes
  for (let y = 12; y < H; y += 24) {
    for (let x = 12; x < W; x += 24) {
      ctx.fillStyle = '#0d1012';
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(160,170,180,0.10)';
      ctx.beginPath();
      ctx.arc(x - 1, y - 1, 4, Math.PI, Math.PI * 1.6);
      ctx.stroke();
    }
  }
  // grime
  for (let i = 0; i < 90; i++) {
    const x = rand() * W;
    const y = rand() * H;
    const r = 20 + rand() * 90;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(10,10,8,0.20)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // tool outlines painted on the board with soft shadows and metal highlights
  const drawTool = (fn: () => void) => {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetX = 5;
    ctx.shadowOffsetY = 6;
    fn();
    ctx.restore();
  };
  const metal = '#8b949b';
  const dark = '#4b5359';
  const wood = '#8a6a44';
  // wrenches
  for (let i = 0; i < 6; i++) {
    const x = 60 + i * 44;
    drawTool(() => {
      ctx.fillStyle = metal;
      ctx.fillRect(x - 5, 100, 10, 170 - i * 8);
      ctx.beginPath();
      ctx.arc(x, 96, 17, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#23292e';
      ctx.fillRect(x - 5, 76, 10, 20);
      ctx.fillStyle = metal;
      ctx.beginPath();
      ctx.arc(x, 280 - i * 8, 14, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  // hammers
  for (let i = 0; i < 2; i++) {
    const x = 380 + i * 78;
    drawTool(() => {
      ctx.fillStyle = wood;
      ctx.fillRect(x - 6, 120, 12, 190);
      ctx.fillStyle = dark;
      ctx.fillRect(x - 32, 92, 64, 30);
      ctx.fillStyle = metal;
      ctx.fillRect(x - 32, 92, 64, 8);
    });
  }
  // screwdrivers
  for (let i = 0; i < 5; i++) {
    const x = 560 + i * 28;
    drawTool(() => {
      ctx.fillStyle = '#c9a227';
      ctx.fillRect(x - 7, 84, 14, 56);
      ctx.fillStyle = metal;
      ctx.fillRect(x - 2.5, 140, 5, 110 - i * 10);
    });
  }
  // pliers / cutters
  for (let i = 0; i < 3; i++) {
    const x = 740 + i * 72;
    drawTool(() => {
      ctx.strokeStyle = '#b03a2a';
      ctx.lineWidth = 11;
      ctx.beginPath();
      ctx.moveTo(x - 12, 98);
      ctx.lineTo(x - 4, 220);
      ctx.moveTo(x + 12, 98);
      ctx.lineTo(x + 4, 220);
      ctx.stroke();
      ctx.fillStyle = metal;
      ctx.beginPath();
      ctx.moveTo(x - 14, 220);
      ctx.lineTo(x + 14, 220);
      ctx.lineTo(x + 5, 290);
      ctx.lineTo(x - 5, 290);
      ctx.fill();
    });
  }
  // clamp + saw + tape + coiled cable on the lower row
  drawTool(() => {
    ctx.strokeStyle = metal;
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.moveTo(70, 380);
    ctx.lineTo(70, 460);
    ctx.lineTo(190, 460);
    ctx.stroke();
    ctx.fillStyle = dark;
    ctx.fillRect(150, 380, 80, 14);
    ctx.fillStyle = '#c9a227';
    ctx.fillRect(280, 380, 300, 22);
    ctx.fillStyle = metal;
    for (let i = 0; i < 30; i++) ctx.fillRect(280 + i * 10, 402, 5, 9);
    ctx.fillStyle = '#c9a227';
    ctx.beginPath();
    ctx.arc(680, 420, 40, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#23292e';
    ctx.beginPath();
    ctx.arc(680, 420, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#2a2d30';
    ctx.lineWidth = 9;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.arc(860, 420, 20 + i * 8, 0, Math.PI * 2);
      ctx.stroke();
    }
  });
  // stencilled label strip
  ctx.fillStyle = 'rgba(255,190,60,0.85)';
  ctx.font = `800 26px ${UI_FONT}`;
  ctx.textAlign = 'left';
  (ctx as unknown as { letterSpacing: string }).letterSpacing = '6px';
  ctx.fillText('ARMORY  BENCH  //  AUTHORISED  PERSONNEL', 40, 40);
  // border
  ctx.strokeStyle = '#c9a227';
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, W - 8, H - 8);
  const t = canvasTexture(canvas, { aniso: 8 });
  return t;
}

// ---------------------------------------------------------------------------------------------
// prop helpers
// ---------------------------------------------------------------------------------------------

const OLIVE = 0x7d8a58;
const OLIVE_L = 0x929f69;
const STEEL = 0x4b5258;
const STEEL_L = 0x8a9096;
const DARK = 0x272b2f;
const YEL = 0xc9a227;

function ammoCan(b: GeoBatch, x: number, y: number, z: number, ry: number): void {
  const r = [0, ry, 0] as [number, number, number];
  const at = (dx: number, dy: number, dz: number): [number, number, number] => {
    const c = Math.cos(ry);
    const s = Math.sin(ry);
    return [x + dx * c + dz * s, y + dy, z - dx * s + dz * c];
  };
  b.box(0.3, 0.16, 0.14, OLIVE, { pos: at(0, 0.08, 0), rot: r });
  b.box(0.31, 0.03, 0.15, OLIVE_L, { pos: at(0, 0.175, 0), rot: r });
  b.box(0.15, 0.06, 0.004, 0xd7c25a, { pos: at(-0.03, 0.09, -0.072), rot: r });
  b.torus(0.05, 0.007, 3, 6, Math.PI, STEEL_L, { pos: at(0, 0.19, 0), rot: [0, ry, 0] });
}

function smallBox(b: GeoBatch, x: number, y: number, z: number, w: number, h: number, d: number, color: number, ry = 0): void {
  b.box(w, h, d, color, { pos: [x, y + h / 2, z], rot: [0, ry, 0] });
}

function shotgun(b: GeoBatch, x: number, y: number, z: number, scale = 1): void {
  const p = (dx: number, dy: number, dz = 0): [number, number, number] => [x + dx * scale, y + dy * scale, z + dz * scale];
  const GUN = 0x24272a;
  const rot = [0, 0, Math.PI / 2] as [number, number, number];
  b.cyl(0.0135 * scale, 0.0135 * scale, 0.62 * scale, 8, GUN, { pos: p(0.31, 0.01), rot });
  b.cyl(0.011 * scale, 0.011 * scale, 0.5 * scale, 8, GUN, { pos: p(0.25, -0.022), rot });
  b.cyl(0.016 * scale, 0.016 * scale, 0.02 * scale, 8, 0x14161a, { pos: p(0.63, 0.01), rot });
  b.box(0.22 * scale, 0.062 * scale, 0.046 * scale, 0x1c1e21, { pos: p(-0.04, 0.0) });
  b.box(0.19 * scale, 0.05 * scale, 0.058 * scale, 0x14161a, { pos: p(0.2, -0.032) });
  b.box(0.3 * scale, 0.06 * scale, 0.04 * scale, 0x5c4530, { pos: p(-0.27, -0.02), rot: [0, 0, 0.09] });
  b.box(0.045 * scale, 0.11 * scale, 0.034 * scale, 0x5c4530, { pos: p(-0.12, -0.075), rot: [0, 0, -0.35] });
  b.box(0.012 * scale, 0.02 * scale, 0.012 * scale, 0xd0c090, { pos: p(0.61, 0.033) });
  b.box(0.03 * scale, 0.05 * scale, 0.03 * scale, 0x14161a, { pos: p(-0.06, 0.047) });
}

function rifleShape(b: GeoBatch, x: number, y: number, z: number, glow: THREE.Color, metal = 0x25282b): void {
  const p = (dx: number, dy: number, dz = 0): [number, number, number] => [x + dx, y + dy, z + dz];
  const c = (k: number): THREE.Color => new THREE.Color(metal).multiplyScalar(k);
  const rot = [0, 0, Math.PI / 2] as [number, number, number];
  b.box(0.26, 0.06, 0.038, c(1), { pos: p(0, 0) });
  b.box(0.3, 0.048, 0.05, c(0.75), { pos: p(0.26, -0.004) });
  b.cyl(0.011, 0.011, 0.3, 8, c(0.6), { pos: p(0.55, 0.004), rot });
  b.cyl(0.017, 0.017, 0.07, 8, c(0.45), { pos: p(0.72, 0.004), rot });
  b.box(0.26, 0.058, 0.04, c(0.85), { pos: p(-0.27, -0.01), rot: [0, 0, 0.06] });
  b.box(0.04, 0.11, 0.032, c(0.6), { pos: p(-0.08, -0.08), rot: [0, 0, -0.3] });
  b.box(0.05, 0.14, 0.03, c(0.7), { pos: p(0.06, -0.09), rot: [0, 0, 0.18] });
  b.box(0.3, 0.014, 0.024, c(0.5), { pos: p(0.05, 0.036) });
  b.box(0.11, 0.04, 0.035, c(0.55), { pos: p(0.08, 0.06) });
  b.box(0.012, 0.03, 0.03, glow, { pos: p(0.135, 0.06) }, glow);
  b.box(0.3, 0.006, 0.006, glow, { pos: p(0.28, 0.026, 0.0265) }, glow);
  b.box(0.3, 0.006, 0.006, glow, { pos: p(0.28, 0.026, -0.0265) }, glow);
}

function quad(b: GeoBatch, pts: [number, number][], z: number, color: number): void {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(pts.length * 3);
  pts.forEach((p, i) => pos.set([p[0], p[1], z], i * 3));
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.computeVertexNormals();
  b.add(g, color);
}

// ---------------------------------------------------------------------------------------------
// buy station
// ---------------------------------------------------------------------------------------------

interface StationBuild {
  geo: THREE.BufferGeometry;
}

function buildBuy(): StationBuild {
  const b = new GeoBatch();
  const green = hdr(0x58ff8a, 2.4);
  const warm = hdr(0xd8ffe0, 1.5);
  // deck, back wall, counter
  b.box(3.0, 0.1, 1.6, 0x2c3034, { pos: [0, 0.05, 0] });
  b.box(3.0, 2.3, 0.07, 0x6b747c, { pos: [0, 1.25, 0.765] });
  for (const sx of [-1.2, -0.6, 0, 0.6, 1.2]) b.box(0.08, 2.3, 0.06, 0x525a61, { pos: [sx, 1.25, 0.71] });
  b.box(3.0, 0.9, 0.5, STEEL, { pos: [0, 0.55, -0.55] });
  b.box(3.1, 0.05, 0.62, STEEL_L, { pos: [0, 1.025, -0.56] });
  b.box(3.1, 0.02, 0.03, 0x2b2f33, { pos: [0, 1.055, -0.865] });
  // hazard-striped front band
  const n = 30;
  const sw = 3.0 / n;
  for (let i = 0; i < n; i++) {
    const x0 = -1.5 + i * sw;
    quad(b, [[x0, 0.34], [x0 + sw * 0.5, 0.34], [x0 + sw * 0.5 + 0.11, 0.66], [x0 + 0.11, 0.66]], -0.802, YEL);
  }
  b.box(3.0, 0.04, 0.03, 0x16181a, { pos: [0, 0.32, -0.815] });
  b.box(3.0, 0.04, 0.03, 0x16181a, { pos: [0, 0.68, -0.815] });
  // posts, rails
  for (const sx of [-1.5, 1.5]) {
    b.box(0.1, 2.5, 0.1, STEEL, { pos: [sx, 1.35, -0.75] });
    b.box(0.1, 2.5, 0.1, STEEL, { pos: [sx, 1.35, 0.76] });
    b.box(0.22, 0.03, 0.22, DARK, { pos: [sx, 0.115, -0.75] });
    b.box(0.22, 0.03, 0.22, DARK, { pos: [sx, 0.115, 0.76] });
    for (const y of [0.6, 1.4, 2.4]) b.box(0.05, 0.05, 1.55, STEEL, { pos: [sx, y, 0] });
    b.box(0.12, 0.05, 0.12, DARK, { pos: [sx, 2.62, -0.75] });
  }
  b.box(3.0, 0.1, 0.1, STEEL, { pos: [0, 2.45, -0.78] });
  b.box(3.0, 0.1, 0.1, STEEL, { pos: [0, 2.45, 0.76] });
  // service-window bars
  const barCount = 25;
  for (let i = 0; i < barCount; i++) {
    const x = -1.4 + (i / (barCount - 1)) * 2.8;
    b.cyl(0.009, 0.009, 1.08, 4, 0x9aa1a7, { pos: [x, 1.6, -0.84] }, undefined, true);
  }
  b.box(2.95, 0.045, 0.045, STEEL, { pos: [0, 2.14, -0.84] });
  b.box(2.95, 0.03, 0.03, STEEL, { pos: [0, 1.6, -0.84] });
  b.box(2.95, 0.035, 0.035, STEEL, { pos: [0, 1.08, -0.84] });
  // shelves and goods (left zone x in [-1.4, 0.1])
  for (const [y, w] of [[1.25, 1.55], [1.7, 1.55], [2.15, 1.55]] as const) {
    b.box(w, 0.035, 0.44, 0x5a636b, { pos: [-0.62, y, 0.5] });
    b.box(0.04, 0.05, 0.44, 0x30353a, { pos: [-1.4, y - 0.04, 0.5] });
  }
  for (let i = 0; i < 5; i++) ammoCan(b, -1.2 + i * 0.32, 1.27, 0.5, (i % 2) * 0.06);
  // ammo boxes + plate rack on shelf 2
  for (let i = 0; i < 4; i++) smallBox(b, -1.28 + i * 0.13, 1.72, 0.48, 0.11, 0.09, 0.16, i % 2 ? 0x8a9a62 : 0x6f7d4d);
  for (let i = 0; i < 4; i++) smallBox(b, -1.28 + i * 0.13, 1.81, 0.48, 0.11, 0.09, 0.16, i % 2 ? 0x6f7d4d : 0x8a9a62);
  b.box(0.36, 0.02, 0.1, DARK, { pos: [-0.5, 1.72, 0.5] });
  for (let i = 0; i < 4; i++) {
    b.box(0.26, 0.32, 0.03, i === 3 ? 0xb4bac0 : 0x9aa1a7, { pos: [-0.5 + (i - 1.5) * 0.06, 1.9, 0.5 + (i - 1.5) * 0.045], rot: [-0.15, 0, 0] }, i === 3 ? hdr(0xffb030, 0.5) : undefined);
  }
  smallBox(b, -0.05, 1.72, 0.5, 0.32, 0.2, 0.22, OLIVE);
  b.box(0.33, 0.045, 0.23, 0xb03a2a, { pos: [-0.05, 1.84, 0.5] });
  // first-aid + magazines on shelf 3
  for (let i = 0; i < 3; i++) {
    smallBox(b, -1.2 + i * 0.26, 2.17, 0.5, 0.22, 0.14, 0.09, 0xd4d2c4);
    b.box(0.06, 0.02, 0.012, 0x2f8a4a, { pos: [-1.2 + i * 0.26, 2.24, 0.453] });
    b.box(0.02, 0.06, 0.012, 0x2f8a4a, { pos: [-1.2 + i * 0.26, 2.24, 0.453] });
  }
  for (let i = 0; i < 6; i++) smallBox(b, -0.42 + i * 0.09, 2.17, 0.5, 0.07, 0.16, 0.05, 0x1b1d20);
  b.box(1.45, 0.018, 0.018, warm, { pos: [-0.62, 1.68, 0.3] }, warm);
  b.box(1.45, 0.018, 0.018, warm, { pos: [-0.62, 1.23, 0.3] }, warm);
  // weapons rack (right zone)
  b.box(1.3, 0.34, 0.05, 0x5b4630, { pos: [0.78, 1.52, 0.715] });
  b.box(1.32, 0.02, 0.02, green, { pos: [0.78, 1.69, 0.685] }, green);
  shotgun(b, 0.42, 1.6, 0.67);
  rifleShape(b, 0.36, 1.43, 0.67, hdr(0x58ff8a, 1.6));
  for (const rx of [0.55, 1.05]) {
    b.box(0.04, 0.06, 0.03, DARK, { pos: [rx, 1.68, 0.685] });
    b.box(0.04, 0.06, 0.03, DARK, { pos: [rx, 1.4, 0.685] });
  }
  b.box(1.3, 0.035, 0.44, 0x5a636b, { pos: [0.78, 1.25, 0.5] });
  for (let i = 0; i < 3; i++) ammoCan(b, 0.35 + i * 0.4, 1.27, 0.5, 0.05);
  b.box(1.3, 0.035, 0.44, 0x5a636b, { pos: [0.78, 2.0, 0.5] });
  for (let i = 0; i < 4; i++) smallBox(b, 0.3 + i * 0.28, 2.02, 0.5, 0.24, 0.18, 0.2, i % 2 ? OLIVE : 0x6f7d4d);
  // terminal on the counter
  b.box(0.62, 0.06, 0.36, DARK, { pos: [-0.9, 1.1, -0.55] });
  b.box(0.6, 0.42, 0.06, 0x1b1e21, { pos: [-0.9, 1.34, -0.4], rot: [-0.28, 0, 0] });
  for (let r = 0; r < 2; r++) for (let c = 0; c < 6; c++) b.box(0.05, 0.016, 0.04, 0x9aa0a4, { pos: [-1.1 + c * 0.075, 1.14, -0.62 + r * 0.06] });
  b.box(0.5, 0.012, 0.012, green, { pos: [-0.9, 1.12, -0.735] }, green);
  // ammo box display on counter
  smallBox(b, 0.75, 1.05, -0.55, 0.28, 0.13, 0.2, OLIVE);
  b.box(0.26, 0.05, 0.004, 0xd7c25a, { pos: [0.75, 1.12, -0.652] });
  smallBox(b, 1.1, 1.05, -0.5, 0.26, 0.32, 0.03, 0x70767b);
  // awning (double sided) with sag and valance
  const cols = 12;
  const rowsN = 5;
  const awning = new THREE.PlaneGeometry(3.3, 2.1, cols, rowsN);
  awning.rotateX(-Math.PI / 2);
  awning.translate(0, 0, -0.2);
  const ap = awning.attributes.position!;
  for (let i = 0; i < ap.count; i++) {
    const zz = ap.getZ(i);
    const xx = ap.getX(i);
    const t = (0.85 - zz) / 2.1; // 0 at back, 1 at front
    let yy = 2.55 - t * 0.34;
    yy -= 0.05 * Math.sin(((xx + 1.65) / 3.3) * Math.PI * 4) * Math.sin(t * Math.PI) * 0.7; // billowing between ribs
    yy -= 0.03 * Math.sin(t * Math.PI);
    ap.setY(i, yy);
  }
  awning.computeVertexNormals();
  const awningColor: ColorFn = (out, x, _y, z) => {
    const panel = Math.floor((x + 1.65) / 0.55);
    const k = 0.94 + 0.1 * ((panel * 7) % 3) * 0.5;
    out.set(0x707a55).multiplyScalar(k);
    const edge = z < -1.2 ? 0.55 : 1;
    out.multiplyScalar(edge);
  };
  b.add(awning, awningColor);
  // valance points along the front edge
  const vn = 13;
  for (let i = 0; i < vn; i++) {
    const w = 3.3 / vn;
    const x0 = -1.65 + i * w;
    const zf = -1.25;
    const yTop = 2.21;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([x0, yTop, zf, x0 + w, yTop, zf, x0 + w / 2, yTop - 0.2, zf - 0.02]), 3));
    g.setIndex([0, 1, 2]);
    g.computeVertexNormals();
    b.add(g, i % 2 ? 0x5b6446 : 0x778260);
  }
  b.box(3.3, 0.05, 0.05, 0x3f4632, { pos: [0, 2.235, -1.24], rot: [0.1, 0, 0] });
  b.box(3.3, 0.05, 0.05, 0x3f4632, { pos: [0, 2.53, 0.84] });
  // awning poles and braces
  for (const sx of [-1.55, 1.55]) {
    b.cyl(0.03, 0.03, 2.22, 8, STEEL, { pos: [sx, 1.11, -1.2] });
    b.cyl(0.05, 0.06, 0.04, 8, DARK, { pos: [sx, 0.02, -1.2] });
    b.strut([sx, 2.0, -1.2], [sx * 0.97, 2.4, -0.75], 0.018, 6, STEEL);
  }
  // emissive strips: front of awning + counter edge
  b.box(2.9, 0.028, 0.028, green, { pos: [0, 2.2, -1.235] }, green);
  b.box(3.0, 0.014, 0.014, green, { pos: [0, 1.055, -0.885] }, green);
  b.box(0.05, 0.4, 0.014, green, { pos: [-1.46, 0.5, -0.86] }, green);
  b.box(0.05, 0.4, 0.014, green, { pos: [1.46, 0.5, -0.86] }, green);
  // sign housing
  b.box(2.3, 0.55, 0.1, DARK, { pos: [0, 2.79, 0.55], rot: [-0.1, 0, 0] });
  for (const sx of [-1.05, 1.05]) b.box(0.08, 0.36, 0.08, STEEL, { pos: [sx, 2.6, 0.6] });
  return { geo: b.build() };
}

// ---------------------------------------------------------------------------------------------
// upgrade station
// ---------------------------------------------------------------------------------------------

function buildUpgrade(): StationBuild {
  const b = new GeoBatch();
  const amber = hdr(0xffb030, 2.4);
  const cyan = hdr(0x5ae6ff, 2.2);
  const warmLens = hdr(0xffe2b0, 3.0);
  // deck + floor mat with hazard rim
  b.box(3.0, 0.08, 1.6, 0x2a2d31, { pos: [0, 0.04, 0] });
  b.box(2.7, 0.02, 0.8, 0x141618, { pos: [0, 0.01, -1.25] });
  const rimN = 26;
  for (let i = 0; i < rimN; i++) {
    const x0 = -1.35 + (i / rimN) * 2.7;
    b.box(2.7 / rimN * 0.55, 0.024, 0.05, i % 2 ? YEL : 0x16181a, { pos: [x0 + 0.05, 0.012, -0.87] });
    b.box(2.7 / rimN * 0.55, 0.024, 0.05, i % 2 ? YEL : 0x16181a, { pos: [x0 + 0.05, 0.012, -1.63] });
  }
  // gantry frame
  for (const sx of [-1.42, 1.42]) {
    b.box(0.15, 2.4, 0.15, 0x555c62, { pos: [sx, 1.28, 0.6] });
    b.box(0.32, 0.03, 0.32, DARK, { pos: [sx, 0.095, 0.6] });
    b.box(0.05, 2.3, 0.05, 0x3f454a, { pos: [sx - Math.sign(sx) * 0.1, 1.25, 0.6] });
    b.strut([sx, 0.6, 0.6], [sx * 0.8, 2.3, 0.6], 0.02, 6, 0x3f454a);
  }
  b.box(3.1, 0.17, 0.2, 0x555c62, { pos: [0, 2.4, 0.6] });
  b.box(3.1, 0.03, 0.34, DARK, { pos: [0, 2.3, 0.6] });
  b.box(2.96, 0.014, 0.014, cyan, { pos: [0, 2.28, 0.44] }, cyan);
  // chain hoist
  b.box(0.3, 0.1, 0.22, 0x3a3f44, { pos: [0.95, 2.22, 0.6] });
  b.cyl(0.04, 0.04, 0.24, 8, YEL, { pos: [0.95, 2.1, 0.6] });
  b.cyl(0.006, 0.006, 0.6, 5, 0x22262a, { pos: [0.95, 1.8, 0.6] });
  for (let i = 0; i < 6; i++) b.torus(0.014, 0.004, 3, 6, Math.PI * 2, 0x565c62, { pos: [0.95, 2.0 - i * 0.09, 0.6], rot: [i % 2 ? Math.PI / 2 : 0, 0, 0] });
  b.box(0.07, 0.1, 0.05, YEL, { pos: [0.95, 1.5, 0.6] });
  b.torus(0.04, 0.008, 5, 12, Math.PI * 1.4, 0x22262a, { pos: [0.95, 1.4, 0.6], rot: [0, 0, 2.4] });
  // workbench
  b.rbox(2.2, 0.07, 0.86, 0.012, 0x7a6248, { pos: [0.05, 0.955, 0.05] });
  b.box(2.24, 0.03, 0.9, 0x3d4247, { pos: [0.05, 0.915, 0.05] });
  for (const sx of [-1.02, 1.12]) for (const sz of [-0.34, 0.44]) b.box(0.09, 0.88, 0.09, 0x4d545a, { pos: [sx, 0.48, sz] });
  b.box(2.1, 0.03, 0.7, 0x30353a, { pos: [0.05, 0.3, 0.05] });
  b.box(2.2, 0.06, 0.03, 0x4d545a, { pos: [0.05, 0.85, -0.37] });
  // drawer unit and lower shelf items
  b.box(0.62, 0.62, 0.72, 0x3a4046, { pos: [0.72, 0.6, 0.05] });
  for (let i = 0; i < 3; i++) {
    b.box(0.56, 0.17, 0.02, 0x555c62, { pos: [0.72, 0.84 - i * 0.2, -0.315] });
    b.box(0.2, 0.025, 0.03, STEEL_L, { pos: [0.72, 0.84 - i * 0.2, -0.335] });
  }
  b.box(0.5, 0.22, 0.3, 0xb03a2a, { pos: [-0.5, 0.42, 0.05] });
  b.box(0.52, 0.03, 0.32, 0x8a2a20, { pos: [-0.5, 0.545, 0.05] });
  b.box(0.3, 0.18, 0.24, OLIVE, { pos: [0.05, 0.4, 0.05] });
  // rifle cradle
  for (const dx of [-0.3, 0.32]) {
    b.box(0.1, 0.06, 0.13, 0x1d2023, { pos: [0.15 + dx, 1.02, 0.05] });
    b.box(0.11, 0.02, 0.15, 0x3a2a1a, { pos: [0.15 + dx, 1.05, 0.05] });
  }
  rifleShape(b, -0.04, 1.14, 0.05, cyan, 0x3f454c);
  // vise (right end)
  b.box(0.22, 0.05, 0.2, 0x555c62, { pos: [1.0, 1.015, -0.05] });
  b.box(0.16, 0.11, 0.06, 0x3b4147, { pos: [1.0, 1.1, 0.02] });
  b.box(0.16, 0.09, 0.05, 0x3b4147, { pos: [1.0, 1.09, -0.12] });
  b.cyl(0.011, 0.011, 0.24, 6, STEEL_L, { pos: [1.0, 1.09, -0.2], rot: [Math.PI / 2, 0, 0] });
  b.cyl(0.008, 0.008, 0.2, 6, STEEL_L, { pos: [1.0, 1.09, -0.31], rot: [0, 0, Math.PI / 2] });
  // press (left end)
  b.box(0.14, 0.72, 0.28, 0x555c62, { pos: [-1.2, 1.35, 0.3] });
  b.box(0.42, 0.1, 0.28, 0x555c62, { pos: [-1.06, 1.72, 0.3] });
  b.cyl(0.04, 0.04, 0.32, 10, 0x8a9096, { pos: [-0.94, 1.55, 0.3] });
  b.cyl(0.055, 0.055, 0.08, 10, 0x3b4147, { pos: [-0.94, 1.71, 0.3] });
  b.box(0.3, 0.09, 0.22, 0x2f3438, { pos: [-0.94, 1.035, 0.3] });
  b.cyl(0.055, 0.055, 0.03, 16, 0x15181a, { pos: [-1.2, 1.55, 0.135], rot: [Math.PI / 2, 0, 0] });
  b.cyl(0.046, 0.046, 0.012, 16, 0xffb030, { pos: [-1.2, 1.55, 0.118], rot: [Math.PI / 2, 0, 0] }, amber);
  // overhead work lamp on an articulated arm
  b.cyl(0.05, 0.05, 0.1, 8, DARK, { pos: [0.15, 2.28, 0.5] });
  b.strut([0.15, 2.28, 0.5], [0.15, 2.02, 0.18], 0.02, 6, 0x6a7178);
  b.strut([0.15, 2.02, 0.18], [0.15, 1.88, -0.12], 0.018, 6, 0x6a7178);
  b.torus(0.04, 0.012, 5, 10, Math.PI * 2, DARK, { pos: [0.15, 2.02, 0.18], rot: [0, Math.PI / 2, 0] });
  b.cyl(0.07, 0.22, 0.17, 16, 0x2c3035, { pos: [0.15, 1.8, -0.12], rot: [0.0, 0, 0] });
  b.cyl(0.2, 0.2, 0.012, 16, 0xfff0d0, { pos: [0.15, 1.715, -0.12] }, warmLens);
  // tool wall frame + shelf above
  b.box(2.8, 0.06, 0.08, 0xc9a227, { pos: [0, 0.75, 0.73] });
  b.box(2.8, 0.06, 0.08, 0xc9a227, { pos: [0, 2.3, 0.73] });
  b.box(0.06, 1.6, 0.08, 0xc9a227, { pos: [-1.4, 1.52, 0.73] });
  b.box(0.06, 1.6, 0.08, 0xc9a227, { pos: [1.4, 1.52, 0.73] });
  // hologram projector base and frame (panel spans x -0.75 .. 0.05)
  b.rbox(0.9, 0.06, 0.18, 0.01, 0x22262a, { pos: [-0.35, 1.015, 0.36] });
  b.cyl(0.05, 0.06, 0.05, 12, 0x15181a, { pos: [-0.35, 1.06, 0.36] });
  b.cyl(0.035, 0.035, 0.01, 12, 0x5ae6ff, { pos: [-0.35, 1.088, 0.36] }, cyan);
  b.box(0.04, 0.68, 0.03, 0x555c62, { pos: [-0.78, 1.36, 0.36] });
  b.box(0.04, 0.68, 0.03, 0x555c62, { pos: [0.08, 1.36, 0.36] });
  b.box(0.9, 0.03, 0.03, 0x555c62, { pos: [-0.35, 1.71, 0.36] });
  b.box(0.9, 0.014, 0.014, amber, { pos: [-0.35, 1.685, 0.34] }, amber);
  b.box(0.014, 0.6, 0.014, cyan, { pos: [-0.78, 1.36, 0.34] }, cyan);
  b.box(0.014, 0.6, 0.014, cyan, { pos: [0.08, 1.36, 0.34] }, cyan);
  // amber accent along the bench front edge
  b.box(2.2, 0.016, 0.016, amber, { pos: [0.05, 0.925, -0.385] }, amber);
  return { geo: b.build() };
}

// ---------------------------------------------------------------------------------------------
// holographic reticle shader (upgrade station)
// ---------------------------------------------------------------------------------------------

const HOLO_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const HOLO_FRAG = /* glsl */ `
  uniform float uTime; uniform float uK; uniform vec3 uFlashColor; uniform float uFlash;
  varying vec2 vUv;
  float ring(float r, float r0, float w){ return 1.0 - smoothstep(0.0, w, abs(r - r0)); }
  void main() {
    vec2 p = (vUv - 0.5) * vec2(1.24, 1.0) * 2.0;
    float r = length(p);
    float a = atan(p.y, p.x);
    const float TAU = 6.2831853;
    vec3 cy = vec3(0.35, 0.9, 1.0);
    vec3 am = vec3(1.0, 0.7, 0.2);
    float v = 0.0;
    vec3 col = vec3(0.0);
    // outer ring with rotating ticks
    float ticks = smoothstep(0.55, 0.62, abs(fract((a + uTime * 0.35) / (TAU / 48.0)) - 0.5) * 2.0);
    float outer = ring(r, 0.86, 0.012) + ring(r, 0.8, 0.008) * ticks * 1.4;
    col += cy * outer;
    // dashed mid ring rotating the other way
    float dash = step(0.35, fract((a - uTime * 0.6) / (TAU / 12.0)));
    col += cy * ring(r, 0.62, 0.018) * dash;
    // inner amber arcs
    float arcs = step(0.6, fract((a + uTime * 0.9) / (TAU / 3.0)));
    col += am * ring(r, 0.4, 0.028) * arcs;
    col += am * ring(r, 0.26, 0.01) * 0.8;
    // crosshair with centre gap
    float gap = smoothstep(0.1, 0.13, r);
    float hx = (1.0 - smoothstep(0.0, 0.012, abs(p.y))) * step(r, 0.72);
    float hy = (1.0 - smoothstep(0.0, 0.012, abs(p.x))) * step(r, 0.72);
    col += cy * (hx + hy) * gap * 0.9;
    // centre dot pulse
    col += am * (1.0 - smoothstep(0.0, 0.05, r)) * (0.7 + 0.3 * sin(uTime * 5.0));
    // scan sweep
    float sweep = 1.0 - smoothstep(0.0, 0.03, abs(fract(uTime * 0.28) * 2.0 - 1.0 - p.y));
    col += cy * sweep * 0.5 * step(r, 0.95);
    // corner brackets on the panel
    vec2 q = abs(vUv - 0.5) * 2.0;
    float br = step(0.9, q.x) * step(0.78, q.y) + step(0.78, q.x) * step(0.9, q.y);
    col += am * br * step(max(q.x, q.y), 0.985) * 0.9;
    // scan lines
    col *= 0.85 + 0.15 * sin(vUv.y * 380.0 + uTime * 6.0);
    col = mix(col, uFlashColor * (0.35 + 0.5 * length(col)), uFlash * 0.85);
    float alpha = clamp(max(col.r, max(col.g, col.b)), 0.0, 1.0);
    gl_FragColor = vec4(col * uK, alpha * 0.9 * min(uK, 1.0));
  }
`;

// ---------------------------------------------------------------------------------------------
// instance
// ---------------------------------------------------------------------------------------------

interface KindShared {
  geo: THREE.BufferGeometry;
  textures: Record<string, THREE.Texture>;
  planes: Record<string, THREE.PlaneGeometry>;
  glowTex: THREE.CanvasTexture;
}

function getShared(kind: StationKind): KindShared {
  return acquire(
    `station-${kind}`,
    (): KindShared => {
      const glowTex = makeRadialTexture(128);
      if (kind === 'buy') {
        return {
          geo: buildBuy().geo,
          textures: { wire: makeWireTexture(), sign: makeSignTexture(), screen: makeBuyScreenTexture() },
          planes: {
            sign: new THREE.PlaneGeometry(2.16, 0.45),
            back: new THREE.PlaneGeometry(2.9, 1.25),
            screen: new THREE.PlaneGeometry(0.5, 0.33),
            wire: new THREE.PlaneGeometry(1.42, 2.3, 1, 1),
            pool: (() => {
              const g = new THREE.PlaneGeometry(3.8, 2.6);
              g.rotateX(-Math.PI / 2);
              return g;
            })(),
          },
          glowTex,
        };
      }
      return {
        geo: buildUpgrade().geo,
        textures: { tools: makeToolWallTexture() },
        planes: {
          tools: new THREE.PlaneGeometry(2.7, 1.42),
          holo: new THREE.PlaneGeometry(0.8, 0.64),
          pool: (() => {
            const g = new THREE.PlaneGeometry(3.8, 2.6);
            g.rotateX(-Math.PI / 2);
            return g;
          })(),
          bench: (() => {
            const g = new THREE.PlaneGeometry(1.6, 0.9);
            g.rotateX(-Math.PI / 2);
            return g;
          })(),
        },
        glowTex,
      };
    },
    (s) => {
      s.geo.dispose();
      for (const t of Object.values(s.textures)) t.dispose();
      for (const p of Object.values(s.planes)) p.dispose();
      s.glowTex.dispose();
    },
  );
}

export function createStationModelImpl(kind: StationKind): StationModel {
  const shared = getShared(kind);
  const uniforms: DetailUniforms = makeDetailUniforms();
  uniforms.pulse.value = 0.0;
  const flashU = { value: 0 };
  const flashColorU = { value: new THREE.Color(1, 1, 1) };
  const bodyMat = createDetailMaterial(
    {
      tag: `station-${kind}`,
      roughness: 0.6,
      metalness: 0.45,
      side: THREE.DoubleSide,
      emis: true,
      panels: { x: 0.5, y: 0.45, z: 0.5, grime: 0.6, wear: 0.5, rivets: true, tint: 0.08 },
      declare: 'uniform vec3 uFlashColor; uniform float uFlash;',
      emissiveCode: 'float evm = max(vEmis.r, max(vEmis.g, vEmis.b)); float ev = step(0.01, evm); totalEmissiveRadiance = mix(totalEmissiveRadiance, uFlashColor * (0.4 + 0.24 * evm) * ev, uFlash * ev);',
      uniforms: { uFlashColor: flashColorU, uFlash: flashU },
    },
    uniforms,
  ).material;

  const root = new THREE.Group();
  root.name = `Station:${kind}`;
  const body = new THREE.Mesh(shared.geo, bodyMat);
  body.castShadow = true;
  body.receiveShadow = true;
  root.add(body);

  const disposables: { dispose(): void }[] = [bodyMat];
  const glowColor = kind === 'buy' ? new THREE.Color(0x4dff8a) : new THREE.Color(0xffb650);
  const poolMat = new THREE.MeshBasicMaterial({
    map: shared.glowTex,
    color: glowColor.clone(),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  });
  disposables.push(poolMat);
  const pool = new THREE.Mesh(shared.planes.pool!, poolMat);
  pool.position.set(0, 0.03, -1.5);
  pool.renderOrder = 3;
  root.add(pool);

  let screenMat: THREE.MeshBasicMaterial | null = null;
  let signMat: THREE.MeshBasicMaterial | null = null;
  let holoMat: THREE.ShaderMaterial | null = null;
  let benchGlowMat: THREE.MeshBasicMaterial | null = null;
  let screenTex: THREE.Texture | null = null;
  let backGlowMat: THREE.MeshBasicMaterial | null = null;

  if (kind === 'buy') {
    // wire mesh side panels
    const wire = shared.textures.wire!;
    for (const sx of [-1.505, 1.505]) {
      const g = shared.planes.wire!.clone();
      const uv = g.attributes.uv!;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (1.42 / 0.1), uv.getY(i) * (2.3 / 0.1));
      g.rotateY(Math.PI / 2);
      const m = new THREE.MeshStandardMaterial({ map: wire, alphaTest: 0.45, side: THREE.DoubleSide, metalness: 0.7, roughness: 0.5, color: 0xbfc6cc });
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(sx, 1.28, 0);
      root.add(mesh);
      disposables.push(m, g);
    }
    signMat = new THREE.MeshBasicMaterial({ map: shared.textures.sign!, color: new THREE.Color(1.3, 1.3, 1.3), toneMapped: true });
    disposables.push(signMat);
    const sign = new THREE.Mesh(shared.planes.sign!, signMat);
    sign.position.set(0, 2.795, 0.495);
    sign.rotation.set(0.1, Math.PI, 0);
    sign.rotation.order = 'YXZ';
    root.add(sign);
    // faint interior wash so the stocked shelves read behind the bars
    backGlowMat = new THREE.MeshBasicMaterial({ map: shared.glowTex, color: new THREE.Color(0.5, 1, 0.65), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    disposables.push(backGlowMat);
    const backGlow = new THREE.Mesh(shared.planes.back!, backGlowMat);
    backGlow.position.set(0, 1.7, 0.16);
    backGlow.renderOrder = 4;
    root.add(backGlow);
    // counter terminal screen (scrolling list)
    screenTex = shared.textures.screen!.clone();
    screenTex.needsUpdate = true;
    screenTex.wrapT = THREE.RepeatWrapping;
    screenTex.repeat.set(1, 0.5);
    screenMat = new THREE.MeshBasicMaterial({ map: screenTex, color: new THREE.Color(1.2, 1.2, 1.2) });
    disposables.push(screenMat, screenTex);
    const screen = new THREE.Mesh(shared.planes.screen!, screenMat);
    // sits on the terminal's tilted face, facing the customer (-z)
    screen.position.set(-0.9, 1.34, -0.4 - 0.036);
    screen.rotation.set(0.28, Math.PI, 0);
    screen.rotation.order = 'YXZ';
    root.add(screen);
  } else {
    // pegboard tool wall
    const toolsMat = new THREE.MeshStandardMaterial({ map: shared.textures.tools!, roughness: 0.8, metalness: 0.2 });
    disposables.push(toolsMat);
    const tools = new THREE.Mesh(shared.planes.tools!, toolsMat);
    tools.position.set(0, 1.52, 0.7);
    tools.rotation.y = Math.PI;
    tools.receiveShadow = true;
    root.add(tools);
    // hologram reticle
    holoMat = new THREE.ShaderMaterial({
      vertexShader: HOLO_VERT,
      fragmentShader: HOLO_FRAG,
      uniforms: { uTime: { value: 0 }, uK: { value: 1 }, uFlashColor: flashColorU, uFlash: flashU },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    disposables.push(holoMat);
    const holo = new THREE.Mesh(shared.planes.holo!, holoMat);
    holo.position.set(-0.35, 1.36, 0.335);
    holo.rotation.set(0.14, Math.PI, 0);
    holo.rotation.order = 'YXZ';
    holo.renderOrder = 5;
    root.add(holo);
    // warm pool of light on the bench under the work lamp
    benchGlowMat = new THREE.MeshBasicMaterial({
      map: shared.glowTex,
      color: new THREE.Color(1.0, 0.72, 0.4),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    disposables.push(benchGlowMat);
    const bench = new THREE.Mesh(shared.planes.bench!, benchGlowMat);
    bench.position.set(0.15, 0.995, 0.02);
    bench.renderOrder = 3;
    root.add(bench);
  }

  let baseNear = 0;
  let baseTarget = 0;
  let flash = 0;
  const flashRed = new THREE.Color(1, 0.18, 0.12);
  const flashGood = kind === 'buy' ? new THREE.Color(0.55, 1.0, 0.7) : new THREE.Color(1.0, 0.85, 0.5);

  const update = (dt: number, time: number): void => {
    baseNear += (baseTarget - baseNear) * Math.min(1, dt * 6);
    flash *= Math.exp(-dt * 4.2);
    uniforms.time.value = time;
    const flick = kind === 'buy' ? 1 + 0.04 * Math.sin(time * 37) * Math.sin(time * 5.3) : 1;
    uniforms.emisGain.value = (0.85 + 0.85 * baseNear + flash * 0.4) * flick;
    flashU.value = flash;
    const glow = 0.28 + 0.5 * baseNear + flash * 0.9;
    poolMat.color.copy(glowColor).lerp(flashColorU.value, Math.min(1, flash) * 0.8).multiplyScalar(glow);
    if (screenMat && screenTex) {
      screenMat.color.setScalar((1.05 + 0.5 * baseNear + flash * 0.9) * flick);
      screenTex.offset.y = (time * 0.05) % 1;
    }
    if (backGlowMat) backGlowMat.color.setRGB(0.5, 1, 0.65).multiplyScalar(0.16 + 0.16 * baseNear + flash * 0.3);
    if (signMat) signMat.color.setScalar((1.2 + 0.35 * baseNear + flash * 0.7) * (0.96 + 0.04 * Math.sin(time * 3.1)));
    if (holoMat) {
      holoMat.uniforms.uTime!.value = time;
      holoMat.uniforms.uK!.value = 0.75 + 0.8 * baseNear + flash * 0.6;
    }
    if (benchGlowMat) benchGlowMat.color.setRGB(1.0, 0.72, 0.4).multiplyScalar(0.42 + 0.5 * baseNear + flash * 0.8);
  };
  update(0, 0);

  return {
    root,
    setState(state) {
      if (state === 'idle') baseTarget = 0;
      else if (state === 'near') baseTarget = 1;
      else if (state === 'used') {
        flash = 1;
        flashColorU.value.copy(flashGood);
      } else {
        flash = 1;
        flashColorU.value.copy(flashRed);
      }
    },
    update,
    topLocal: new THREE.Vector3(0, kind === 'buy' ? 3.35 : 2.85, 0),
    dispose() {
      for (const d of disposables) d.dispose();
      release(`station-${kind}`);
    },
  };
}
