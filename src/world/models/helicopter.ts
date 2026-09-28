/**
 * Transport helicopter (~15 m fuselage, 14 m main rotor). Nose toward local -Z, right side (+X) has the sliding cargo door.
 *
 * Draw calls (10): painted body (shader-driven panel seams, rivets, grime, glossy windows, decals, cut-out door aperture),
 * dark hardware, lit cabin interior, sliding door (+ its window), main rotor blades, tail rotor blades, blur discs,
 * light lenses (vertex colours animated per frame) and halo points.
 */
import * as THREE from 'three';
import { LoftGeometry } from 'three/addons/geometries/LoftGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { HelicopterRig, HelicopterState } from '../models';
import type { MaterialLib } from '../materials';
import {
  GeoBatch,
  HaloPoints,
  UI_FONT,
  canvasTexture,
  createDetailMaterial,
  makeCanvas,
  makeDetailUniforms,
  mulberry32,
  smoothstep,
  writeRange,
  type ColorFn,
  type VRange,
} from './util';

// ---------------------------------------------------------------------------------------------
// layout constants
// ---------------------------------------------------------------------------------------------

const HUB_Y = 4.3;
const HUB_Z = -0.15;
const MAIN_R = 7.0;
const TAIL_HUB = new THREE.Vector3(-0.33, 3.32, 9.06);
const TAIL_R = 1.3;
const DOOR_Z = -1.05;
const DOOR_Y = 1.7;
const DOOR_W = 1.74;
const DOOR_H = 1.3;
const DOOR_X = 1.3;
const DOOR_SLIDE = 1.78;

// fuselage stations: z, half width, belly y, roof y, superellipse exponent
const STATIONS: [number, number, number, number, number][] = [
  [-5.45, 0.06, 1.15, 1.4, 2.0],
  [-5.35, 0.3, 1.02, 1.62, 2.0],
  [-5.1, 0.58, 0.92, 1.98, 2.1],
  [-4.7, 0.88, 0.82, 2.28, 2.3],
  [-4.2, 1.1, 0.75, 2.52, 2.5],
  [-3.6, 1.23, 0.7, 2.66, 2.8],
  [-2.6, 1.27, 0.68, 2.7, 3.0],
  [-1.2, 1.28, 0.68, 2.72, 3.0],
  [0.2, 1.28, 0.68, 2.72, 3.0],
  [1.4, 1.25, 0.7, 2.68, 3.0],
  [2.4, 1.1, 0.8, 2.6, 2.8],
  [3.1, 0.88, 1.1, 2.5, 2.5],
  [3.9, 0.66, 1.55, 2.46, 2.2],
  [4.9, 0.5, 1.75, 2.42, 2.1],
  [6.2, 0.38, 1.95, 2.44, 2.0],
  [7.6, 0.28, 2.12, 2.52, 2.0],
  [8.7, 0.2, 2.25, 2.62, 2.0],
  [9.45, 0.12, 2.34, 2.72, 2.0],
];

const P = {
  hull: 0x647055,
  hullDark: 0x4f5942,
  belly: 0x7d8572,
  nose: 0x24272a,
  dark: 0x2a2e32,
  darker: 0x1b1d20,
  metal: 0x6d747a,
  yellow: 0xc9a227,
  rubber: 0x141516,
  seat: 0x323a2b,
  lining: 0x59605a,
  floor: 0x2d3033,
};

// ---------------------------------------------------------------------------------------------
// fuselage loft
// ---------------------------------------------------------------------------------------------

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

function fuselageGeometry(): THREE.BufferGeometry {
  const sections: THREE.Vector3[][] = [];
  const N = 20;
  const n = STATIONS.length;
  for (let i = 0; i < n - 1; i++) {
    const sub = i < 11 ? 2 : 1;
    for (let k = 0; k < sub; k++) {
      const t = k / sub;
      const s0 = STATIONS[Math.max(0, i - 1)]!;
      const s1 = STATIONS[i]!;
      const s2 = STATIONS[i + 1]!;
      const s3 = STATIONS[Math.min(n - 1, i + 2)]!;
      const v = [0, 1, 2, 3, 4].map((c) => catmull(s0[c]!, s1[c]!, s2[c]!, s3[c]!, t));
      sections.push(ring(v[0]!, v[1]!, v[2]!, v[3]!, Math.max(1.6, v[4]!), N));
    }
  }
  const last = STATIONS[n - 1]!;
  sections.push(ring(last[0], last[1], last[2], last[3], last[4], N));
  return new LoftGeometry(sections, { closed: true, capStart: true, capEnd: true });
}

function ring(z: number, hw: number, yb: number, yt: number, ex: number, N: number): THREE.Vector3[] {
  const yc = (yb + yt) / 2;
  const hh = (yt - yb) / 2;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const x = hw * Math.sign(c) * Math.pow(Math.abs(c), 2 / ex);
    const y = yc + hh * Math.sign(s) * Math.pow(Math.abs(s), 2 / ex);
    pts.push(new THREE.Vector3(x, y, z));
  }
  return pts;
}

const hullColor = (() => {
  const upper = new THREE.Color(P.hull);
  const lower = new THREE.Color(P.belly);
  const nose = new THREE.Color(P.nose);
  const dark = new THREE.Color(P.hullDark);
  const tmp = new THREE.Color();
  const fn: ColorFn = (out, _x, y, z) => {
    const t = smoothstep(1.05, 1.75, y);
    out.copy(lower).lerp(upper, t);
    // slightly darker camouflage band along the upper spine
    out.lerp(dark, smoothstep(2.35, 2.72, y) * 0.55);
    // matte black radome
    const n = smoothstep(-4.85, -5.15, z);
    tmp.copy(nose);
    out.lerp(tmp, n);
  };
  return fn;
})();

// ---------------------------------------------------------------------------------------------
// decal atlas
// ---------------------------------------------------------------------------------------------

function makeDecalAtlas(): THREE.CanvasTexture {
  const W = 1024;
  const H = 512;
  const { canvas, ctx } = makeCanvas(W, H);
  ctx.clearRect(0, 0, W, H);
  const rand = mulberry32(2024);
  // tail code (top band)
  ctx.fillStyle = '#d9dccf';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  (ctx as unknown as { letterSpacing: string }).letterSpacing = '14px';
  ctx.font = `900 190px ${UI_FONT}`;
  ctx.fillText('SR-0731', W / 2, 105);
  (ctx as unknown as { letterSpacing: string }).letterSpacing = '8px';
  ctx.font = `800 52px ${UI_FONT}`;
  ctx.fillText('SIGNAL RECOVERY', W / 2, 232);
  ctx.fillRect(40, 268, W - 80, 6);
  // emblem (bottom-left square 224x224): ring with signal arcs and a slash
  const cx = 112;
  const cy = 400;
  ctx.strokeStyle = '#d9dccf';
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.arc(cx, cy, 92, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 8;
  for (const r of [22, 46, 70]) {
    ctx.beginPath();
    ctx.arc(cx - 26, cy + 26, r, -Math.PI * 0.5, 0);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(cx - 26, cy + 26, 8, 0, Math.PI * 2);
  ctx.fillStyle = '#d9dccf';
  ctx.fill();
  ctx.fillStyle = '#c9a227';
  ctx.fillRect(cx + 20, cy - 96, 10, 40);
  // hazard "NO STEP" strip on the right of the atlas
  ctx.fillStyle = '#c9a227';
  ctx.fillRect(560, 300, 420, 110);
  ctx.fillStyle = '#16181a';
  for (let x = 560; x < 980; x += 44) {
    ctx.beginPath();
    ctx.moveTo(x, 410);
    ctx.lineTo(x + 22, 410);
    ctx.lineTo(x + 42, 300);
    ctx.lineTo(x + 20, 300);
    ctx.fill();
  }
  // wear: knock out flecks so the paint looks chipped
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 700; i++) {
    ctx.fillStyle = `rgba(0,0,0,${0.35 + rand() * 0.6})`;
    ctx.fillRect(rand() * W, rand() * H, 1 + rand() * 6, 1 + rand() * 3);
  }
  for (let i = 0; i < 30; i++) {
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.lineWidth = 1 + rand() * 2;
    ctx.beginPath();
    const x = rand() * W;
    const y = rand() * H;
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rand() - 0.5) * 120, y + (rand() - 0.5) * 30);
    ctx.stroke();
  }
  const t = canvasTexture(canvas, { aniso: 8 });
  t.generateMipmaps = true;
  return t;
}

/** Radial streak texture for the blur discs (u = angle, v = radius fraction). */
function makeBlurTexture(): THREE.CanvasTexture {
  const W = 512;
  const H = 128;
  const { canvas, ctx } = makeCanvas(W, H);
  const rand = mulberry32(555);
  const img = ctx.createImageData(W, H);
  for (let i = 0; i < W * H; i++) {
    img.data[i * 4] = 210;
    img.data[i * 4 + 1] = 218;
    img.data[i * 4 + 2] = 224;
    img.data[i * 4 + 3] = 0;
  }
  // per-column streak strength
  const cols = new Float32Array(W);
  for (let x = 0; x < W; x++) cols[x] = 0.55 + rand() * 0.45;
  for (let x = 1; x < W - 1; x++) cols[x] = (cols[x - 1]! + cols[x]! * 2 + cols[x + 1]!) / 4;
  for (let y = 0; y < H; y++) {
    const v = y / (H - 1);
    const base = 0.06 + 0.5 * Math.pow(v, 1.3);
    const tip = Math.exp(-Math.pow((v - 0.985) / 0.02, 2)) * 0.8;
    const hubFade = Math.min(1, v / 0.12);
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const a = (base * cols[x]! + tip) * hubFade;
      img.data[i + 3] = Math.max(0, Math.min(255, Math.round(a * 255)));
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = canvasTexture(canvas, { repeat: true });
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

function polarDisc(r0: number, r1: number, seg: number, rings: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= seg; j++) {
    const a = (j / seg) * Math.PI * 2;
    for (let i = 0; i <= rings; i++) {
      const v = i / rings;
      const r = r0 + (r1 - r0) * v;
      pos.push(Math.cos(a) * r, 0, Math.sin(a) * r);
      uv.push(j / seg, v);
    }
  }
  for (let j = 0; j < seg; j++) {
    for (let i = 0; i < rings; i++) {
      const a = j * (rings + 1) + i;
      const b = (j + 1) * (rings + 1) + i;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------------------------
// shader snippets for the painted body
// ---------------------------------------------------------------------------------------------

const BODY_DECLARE = /* glsl */ `
  uniform sampler2D uDecal;
  float boxMask(vec2 p, vec2 c, vec2 hs, float soft){
    vec2 d = abs(p - c) - hs;
    return 1.0 - smoothstep(-soft, soft, max(d.x, d.y));
  }
`;

const BODY_DISCARD = /* glsl */ `
  if (vObjPos.x > 0.85 && abs(vObjNrm.x) > 0.3) {
    float sdDoor = sdRoundRect(vec2(vObjPos.z, vObjPos.y) - vec2(${DOOR_Z.toFixed(3)}, ${DOOR_Y.toFixed(3)}), vec2(${(DOOR_W / 2 - 0.02).toFixed(3)}, ${(DOOR_H / 2 - 0.02).toFixed(3)}), 0.1);
    if (sdDoor < 0.0) discard;
  }
`;

const BODY_COLOR = /* glsl */ `
  {
    vec3 an2 = abs(normalize(vObjNrm));
    vec2 zy = vec2(vObjPos.z, vObjPos.y);
    float sideFace = smoothstep(0.35, 0.7, an2.x);
    // cockpit side windows (both sides)
    float sdW1 = sdRoundRect(zy - vec2(-3.7, 1.99), vec2(0.5, 0.36), 0.14);
    float w1 = (1.0 - smoothstep(-0.012, 0.012, sdW1)) * sideFace;
    // cabin windows aft of the door (both sides) and left cabin window
    float sdW2 = sdRoundRect(zy - vec2(1.2, 2.0), vec2(0.5, 0.3), 0.1);
    float w2 = (1.0 - smoothstep(-0.012, 0.012, sdW2)) * sideFace;
    float sdW3 = sdRoundRect(zy - vec2(-0.6, 1.95), vec2(0.62, 0.3), 0.1);
    float w3 = (1.0 - smoothstep(-0.012, 0.012, sdW3)) * sideFace * step(vObjPos.x, 0.0);
    // windshield: upper-front surfaces of the nose, split by a centre post
    float wsHalf = 0.18 + (vObjPos.z + 5.05) * 0.62;
    float ws = smoothstep(-0.02, 0.02, wsHalf - abs(vObjPos.x))
             * smoothstep(-5.08, -5.0, vObjPos.z) * (1.0 - smoothstep(-3.62, -3.54, vObjPos.z))
             * smoothstep(1.55, 1.7, vObjPos.y) * (1.0 - sideFace * 0.4);
    ws *= smoothstep(0.02, 0.045, abs(vObjPos.x));
    gWin = clamp(max(max(w1, max(w2, w3)), ws), 0.0, 1.0);
    float frame = clamp(max(1.0 - smoothstep(0.0, 0.05, abs(sdW1 - 0.035)), 1.0 - smoothstep(0.0, 0.05, abs(sdW2 - 0.035))), 0.0, 1.0) * sideFace;
    diffuseColor.rgb *= 1.0 - 0.55 * frame * (1.0 - gWin);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.006, 0.009, 0.013), gWin);

    // decals: tail code on both sides of the boom, emblem beside the cockpit
    float sgn = sign(vObjNrm.x);
    vec2 tUv = vec2((vObjPos.z - 4.5) / 1.9, (vObjPos.y - 1.96) / 0.5);
    tUv.x = sgn > 0.0 ? 1.0 - tUv.x : tUv.x;
    vec4 dT = texture2D(uDecal, vec2(tUv.x, 0.4375 + clamp(tUv.y, 0.0, 1.0) * 0.5625));
    float mT = boxMask(vec2(vObjPos.z, vObjPos.y), vec2(5.45, 2.21), vec2(0.95, 0.25), 0.01) * sideFace;
    vec2 eUv = vec2((vObjPos.z + 3.0) / 0.8, (vObjPos.y - 1.7) / 0.8);
    eUv.x = sgn > 0.0 ? 1.0 - eUv.x : eUv.x;
    vec4 dE = texture2D(uDecal, vec2(clamp(eUv.x, 0.0, 1.0) * 0.4375, clamp(eUv.y, 0.0, 1.0) * 0.4375));
    float mE = boxMask(vec2(vObjPos.z, vObjPos.y), vec2(-2.6, 2.1), vec2(0.4, 0.4), 0.01) * sideFace;
    // caution stripe near the fin root
    diffuseColor.rgb = mix(diffuseColor.rgb, dT.rgb, dT.a * mT * 0.92);
    diffuseColor.rgb = mix(diffuseColor.rgb, dE.rgb, dE.a * mE * 0.9);
  }
`;

const BODY_MATERIAL = /* glsl */ `
  roughnessFactor = mix(roughnessFactor, 0.07, gWin);
  metalnessFactor = mix(metalnessFactor, 0.75, gWin);
`;

// ---------------------------------------------------------------------------------------------
// builders
// ---------------------------------------------------------------------------------------------

interface LightRanges {
  navL: VRange;
  navR: VRange;
  strobe: VRange;
  beacon: VRange;
  landL: VRange;
  landR: VRange;
  cab1: VRange;
  cab2: VRange;
  exhL: VRange;
  exhR: VRange;
}

export function createHelicopterImpl(mats: MaterialLib): HelicopterRig {
  const disposables: { dispose(): void }[] = [];

  // ---- painted body ----
  const body = new GeoBatch();
  body.add(fuselageGeometry(), hullColor);
  // engine nacelles + intakes
  for (const sx of [-1, 1]) {
    body.cyl(0.36, 0.36, 2.5, 12, P.hull, { pos: [sx * 0.6, 2.95, 0.5], rot: [Math.PI / 2, 0, 0] });
    body.sphere(0.36, 10, 6, P.hull, { pos: [sx * 0.6, 2.95, -0.75], scale: [1, 1, 0.75] });
    body.sphere(0.34, 10, 6, P.hull, { pos: [sx * 0.6, 2.95, 1.75], scale: [1, 1, 0.9] });
  }
  body.box(1.1, 0.34, 2.2, P.hullDark, { pos: [0, 2.8, 0.4] });
  // gearbox fairing around the mast
  body.cyl(0.42, 0.78, 0.62, 12, P.hullDark, { pos: [0, 3.05, HUB_Z] });
  body.cyl(0.36, 0.42, 0.22, 12, P.hullDark, { pos: [0, 3.45, HUB_Z] });
  // lower sponsons (gear housings + fuel cells)
  for (const sx of [-1, 1]) body.rbox(0.42, 0.62, 1.7, 0.14, P.belly, { pos: [sx * 1.15, 0.98, 0.72] });
  // vertical fin (swept), stabilator
  const finShape = new THREE.Shape();
  finShape.moveTo(7.6, 2.55);
  finShape.lineTo(8.85, 4.2);
  finShape.lineTo(9.6, 4.25);
  finShape.lineTo(9.78, 3.9);
  finShape.lineTo(9.62, 2.6);
  finShape.closePath();
  const fin = new THREE.ExtrudeGeometry(finShape, { depth: 0.16, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 1 });
  fin.rotateY(-Math.PI / 2);
  fin.translate(0.08, 0, 0);
  body.add(fin, P.hull);
  body.rbox(3.3, 0.07, 0.72, 0.03, P.hull, { pos: [0, 2.6, 8.55] });
  body.rbox(0.28, 0.5, 0.8, 0.05, P.hullDark, { pos: [0, 2.9, 8.35] });
  // tail rotor drive shaft cover + tail rotor gearbox housing
  body.rbox(0.13, 0.12, 4.6, 0.04, P.hullDark, { pos: [0, 2.64, 6.5] });
  body.rbox(0.36, 0.34, 0.5, 0.08, P.hullDark, { pos: [-0.14, 3.34, 9.0] });
  // hazard chevrons on fin tip
  for (let i = 0; i < 4; i++) body.box(0.2, 0.08, 0.14, i % 2 ? P.darker : P.yellow, { pos: [0.02, 3.95 + i * 0.09, 9.52] });
  // door frame trim is dark hardware (see below); step under the sill
  // ---- dark hardware ----
  const dark = new GeoBatch();
  // door aperture frame
  const fz = DOOR_Z;
  const fy = DOOR_Y;
  dark.box(0.1, 0.09, DOOR_W + 0.14, P.dark, { pos: [1.3, fy + DOOR_H / 2 + 0.02, fz] });
  dark.box(0.16, 0.08, DOOR_W + 0.14, P.dark, { pos: [1.31, fy - DOOR_H / 2 - 0.02, fz] });
  dark.box(0.1, DOOR_H + 0.1, 0.08, P.dark, { pos: [1.3, fy, fz - DOOR_W / 2 - 0.02] });
  dark.box(0.1, DOOR_H + 0.1, 0.08, P.dark, { pos: [1.3, fy, fz + DOOR_W / 2 + 0.02] });
  // rails for the sliding door
  dark.box(0.06, 0.05, 3.8, P.dark, { pos: [1.33, fy + DOOR_H / 2 + 0.06, fz + 1.05] });
  dark.box(0.06, 0.05, 3.8, P.dark, { pos: [1.33, fy - DOOR_H / 2 - 0.06, fz + 1.05] });
  // boarding step + grab handles
  dark.box(0.42, 0.05, 0.55, P.metal, { pos: [1.47, 0.86, fz - 0.05] });
  dark.strut([1.31, 2.42, fz - 0.6], [1.31, 2.42, fz + 0.6], 0.018, 6, P.metal);
  // mast, hub, swashplate, control rods
  dark.cyl(0.13, 0.15, 1.05, 9, P.dark, { pos: [0, 3.9, HUB_Z] });
  dark.cyl(0.22, 0.22, 0.12, 10, P.metal, { pos: [0, 3.68, HUB_Z] });
  dark.cyl(0.26, 0.26, 0.09, 10, P.dark, { pos: [0, 3.82, HUB_Z] });
  dark.cyl(0.3, 0.3, 0.3, 12, P.dark, { pos: [0, 4.28, HUB_Z] });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    dark.strut([Math.cos(a) * 0.22, 3.72, HUB_Z + Math.sin(a) * 0.22], [Math.cos(a) * 0.27, 4.2, HUB_Z + Math.sin(a) * 0.27], 0.012, 5, P.metal);
  }
  // engine intakes + exhausts
  for (const sx of [-1, 1]) {
    dark.cyl(0.25, 0.25, 0.14, 10, P.darker, { pos: [sx * 0.6, 2.95, -0.95], rot: [Math.PI / 2, 0, 0] });
    dark.torus(0.3, 0.03, 6, 16, Math.PI * 2, P.metal, { pos: [sx * 0.6, 2.95, -0.86] });
    dark.cyl(0.17, 0.2, 0.4, 9, P.darker, { pos: [sx * 0.6, 2.95, 2.05], rot: [Math.PI / 2, 0, 0], scale: [1, 1, 1] });
    dark.cyl(0.14, 0.14, 0.05, 9, 0x0a0a0a, { pos: [sx * 0.6, 2.95, 2.27], rot: [Math.PI / 2, 0, 0] });
  }
  // landing gear: main struts + wheels, tail strut + wheel
  for (const sx of [-1, 1]) {
    dark.strut([sx * 1.08, 1.05, 0.7], [sx * 1.36, 0.46, 0.75], 0.06, 8, P.dark);
    dark.strut([sx * 1.36, 0.6, 0.75], [sx * 1.36, 0.42, 0.75], 0.038, 8, P.metal);
    dark.strut([sx * 0.85, 0.85, -0.3], [sx * 1.32, 0.5, 0.72], 0.028, 6, P.dark);
    dark.cyl(0.4, 0.4, 0.27, 14, P.rubber, { pos: [sx * 1.45, 0.4, 0.75], rot: [0, 0, Math.PI / 2] });
    dark.cyl(0.22, 0.22, 0.29, 10, P.metal, { pos: [sx * 1.45, 0.4, 0.75], rot: [0, 0, Math.PI / 2] });
    dark.cyl(0.08, 0.08, 0.31, 8, P.dark, { pos: [sx * 1.45, 0.4, 0.75], rot: [0, 0, Math.PI / 2] });
  }
  dark.strut([0, 2.22, 7.25], [0, 0.32, 7.55], 0.05, 8, P.dark);
  dark.strut([0, 1.0, 7.5], [0, 0.34, 7.55], 0.03, 6, P.metal);
  dark.cyl(0.26, 0.26, 0.14, 10, P.rubber, { pos: [0, 0.26, 7.6], rot: [0, 0, Math.PI / 2] });
  dark.box(0.3, 0.05, 0.12, P.dark, { pos: [0, 0.5, 7.55] });
  // sensor turret + landing light housings + pitot tubes + antennas
  dark.sphere(0.22, 12, 8, P.dark, { pos: [0, 0.88, -4.55] });
  dark.cyl(0.1, 0.1, 0.06, 9, 0x0b1218, { pos: [0, 0.83, -4.72], rot: [Math.PI / 2 + 0.3, 0, 0] });
  for (const sx of [-1, 1]) {
    dark.cyl(0.08, 0.08, 0.12, 8, P.dark, { pos: [sx * 0.5, 0.98, -4.8], rot: [Math.PI / 2 + 0.25, 0, 0] });
    dark.strut([sx * 0.42, 1.65, -5.02], [sx * 0.42, 1.62, -5.6], 0.012, 5, P.metal);
    dark.strut([sx * 0.6, 2.7, -3.55], [sx * 0.6, 2.95, -3.45], 0.02, 5, P.dark);
  }
  dark.strut([0.05, 2.7, -3.6], [0.05, 3.05, -3.35], 0.014, 5, P.metal); // wire cutter
  dark.strut([0.25, 2.78, 1.9], [0.32, 3.75, 2.1], 0.008, 4, P.metal); // whip antenna
  dark.strut([-0.3, 0.66, 0.4], [-0.3, 0.42, 0.45], 0.012, 4, P.metal);
  dark.box(0.04, 0.25, 0.32, P.dark, { pos: [0.3, 0.55, 1.6] });
  // tail rotor hub + pitch links
  dark.cyl(0.09, 0.09, 0.34, 8, P.dark, { pos: [TAIL_HUB.x - 0.08, TAIL_HUB.y, TAIL_HUB.z], rot: [0, 0, Math.PI / 2] });
  // skin screws: rotor mast top bolt
  dark.cyl(0.06, 0.06, 0.1, 8, P.metal, { pos: [0, 4.5, HUB_Z] });

  // ---- interior ----
  const inter = new GeoBatch();
  const fz0 = -3.0;
  const fz1 = 2.45;
  inter.box(2.3, 0.05, fz1 - fz0, P.floor, { pos: [0, 1.03, (fz0 + fz1) / 2] });
  inter.box(2.3, 0.04, fz1 - fz0, 0x8d938b, { pos: [0, 2.47, (fz0 + fz1) / 2] });
  inter.box(0.05, 1.45, fz1 - fz0, P.lining, { pos: [-1.17, 1.75, (fz0 + fz1) / 2] });
  // right wall lining split around the door aperture
  const dzA = DOOR_Z - DOOR_W / 2;
  const dzB = DOOR_Z + DOOR_W / 2;
  inter.box(0.05, 1.45, dzA - fz0, P.lining, { pos: [1.17, 1.75, (fz0 + dzA) / 2] });
  inter.box(0.05, 1.45, fz1 - dzB, P.lining, { pos: [1.17, 1.75, (dzB + fz1) / 2] });
  inter.box(0.05, 0.1, dzB - dzA, P.lining, { pos: [1.17, 1.02 + 0.05, DOOR_Z] });
  inter.box(2.3, 1.45, 0.06, 0x4a514a, { pos: [0, 1.75, fz0] });
  inter.box(2.3, 1.45, 0.06, 0x4a514a, { pos: [0, 1.75, fz1] });
  inter.box(0.9, 1.05, 0.05, P.darker, { pos: [0, 1.6, fz0 + 0.04] }); // cockpit doorway
  // rear bench seat (3 cushions) facing forward
  for (let i = -1; i <= 1; i++) {
    inter.box(0.66, 0.13, 0.52, P.seat, { pos: [i * 0.72, 1.47, 2.13] });
    inter.box(0.66, 0.56, 0.1, P.seat, { pos: [i * 0.72, 1.82, 2.36] });
  }
  inter.box(2.2, 0.05, 0.05, P.dark, { pos: [0, 1.35, 2.13] });
  // side jump seats on the left wall (facing right)
  for (const z of [-0.2, 0.75]) {
    inter.box(0.5, 0.12, 0.56, P.seat, { pos: [-0.88, 1.44, z] });
    inter.box(0.1, 0.5, 0.56, P.seat, { pos: [-1.1, 1.75, z] });
    inter.strut([-0.7, 1.4, z - 0.24], [-0.7, 1.06, z - 0.24], 0.018, 5, P.metal);
    inter.strut([-0.7, 1.4, z + 0.24], [-0.7, 1.06, z + 0.24], 0.018, 5, P.metal);
  }
  // cargo: duffel, strapped crate, extinguisher, hoist boom
  inter.box(0.62, 0.3, 0.32, 0x4b5238, { pos: [0.45, 1.23, 1.65], rot: [0, 0.4, 0] });
  inter.box(0.5, 0.4, 0.42, 0x596244, { pos: [-0.35, 1.28, 1.95], rot: [0, -0.2, 0] });
  inter.box(0.06, 0.42, 0.44, 0x2c2c2a, { pos: [-0.35, 1.28, 1.95], rot: [0, -0.2, 0] });
  inter.cyl(0.07, 0.07, 0.34, 8, 0x9a2e22, { pos: [0.9, 1.3, fz0 + 0.14] });
  inter.strut([1.0, 2.35, 0.6], [0.4, 2.42, 0.6], 0.03, 6, P.metal);
  // ---- door (separate mesh; origin at its centre) ----
  const doorB = new GeoBatch();
  doorB.rbox(0.055, DOOR_H, DOOR_W, 0.03, P.hull, { pos: [0, 0, 0] });
  doorB.box(0.07, 0.05, DOOR_W - 0.1, P.hullDark, { pos: [0.005, DOOR_H / 2 - 0.14, 0] });
  doorB.box(0.07, 0.1, 0.22, P.dark, { pos: [0.035, -0.05, 0.62] });
  doorB.box(0.035, 0.16, 0.05, P.metal, { pos: [0.06, -0.05, 0.62] });
  doorB.strut([0.05, 0.4, -0.5], [0.05, 0.4, 0.5], 0.014, 5, P.metal);
  // ---- rotor blades ----
  const blades = new GeoBatch();
  const bladeColor: ColorFn = (out, x, y, z) => {
    const r = Math.hypot(x, z);
    void y;
    if (r > MAIN_R - 0.95) out.set(Math.floor(r * 3.2) % 2 ? 0xc9a227 : 0x18191b);
    else out.set(0x2a2d30);
  };
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2;
    const inner = new THREE.BoxGeometry(3.2, 0.045, 0.56);
    inner.translate(0.4 + 1.6, 0, 0);
    inner.rotateZ(0.02);
    const outer = new THREE.BoxGeometry(3.45, 0.04, 0.54);
    outer.translate(0, 0, 0);
    outer.rotateZ(-0.075);
    outer.translate(3.6 + 1.7, 0.09, 0);
    const merged = mergeGeometries(
      [inner, outer].map((g) => {
        // ensure both have identical attributes for merging
        g.deleteAttribute('uv');
        return g;
      }),
    );
    if (merged) {
      merged.rotateY(a);
      merged.translate(0, HUB_Y + 0.1, 0);
      // pitch: leading edge slightly up
      blades.add(merged, bladeColor);
    }
    // blade grip sleeve
    const sx = Math.cos(a);
    const sz = Math.sin(a);
    blades.cyl(0.09, 0.11, 0.62, 8, P.dark, { pos: [sx * 0.62, HUB_Y + 0.1, -sz * 0.62], rot: [0, a, Math.PI / 2] });
  }
  blades.cyl(0.32, 0.32, 0.1, 12, P.dark, { pos: [0, HUB_Y + 0.28, 0] });
  // ---- tail rotor blades (local space around the tail hub) ----
  const tailB = new GeoBatch();
  const tailColor: ColorFn = (out, _x, y, z) => {
    const r = Math.hypot(y, z);
    out.set(r > TAIL_R - 0.28 ? (Math.floor(r * 9) % 2 ? 0xc9a227 : 0x18191b) : 0x2a2d30);
  };
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + 0.3;
    const g = new THREE.BoxGeometry(0.03, 1.2, 0.17);
    g.translate(0, 0.6 + 0.12, 0);
    g.rotateX(a);
    tailB.add(g, tailColor);
  }
  tailB.cyl(0.11, 0.11, 0.08, 8, P.dark, { rot: [0, 0, Math.PI / 2] });

  // ---- lights ----
  const lightsB = new GeoBatch();
  const L: Partial<LightRanges> = {};
  L.navL = lightsB.sphere(0.055, 6, 4, 0xffffff, { pos: [-1.31, 1.6, -3.25] });
  L.navR = lightsB.sphere(0.055, 6, 4, 0xffffff, { pos: [1.31, 1.6, -3.25] });
  L.strobe = lightsB.sphere(0.07, 6, 4, 0xffffff, { pos: [0, 4.3, 9.52] });
  L.beacon = lightsB.sphere(0.09, 6, 4, 0xffffff, { pos: [0, 2.92, 2.0], scale: [1, 0.7, 1] });
  L.landL = lightsB.cyl(0.075, 0.075, 0.03, 9, 0xffffff, { pos: [-0.5, 0.96, -4.87], rot: [Math.PI / 2 + 0.25, 0, 0] });
  L.landR = lightsB.cyl(0.075, 0.075, 0.03, 9, 0xffffff, { pos: [0.5, 0.96, -4.87], rot: [Math.PI / 2 + 0.25, 0, 0] });
  L.cab1 = lightsB.box(0.55, 0.015, 0.16, 0xffffff, { pos: [0, 2.445, 0.55] });
  L.cab2 = lightsB.box(0.55, 0.015, 0.16, 0xffffff, { pos: [0, 2.445, -1.4] });
  L.exhL = lightsB.cyl(0.13, 0.13, 0.01, 8, 0xffffff, { pos: [-0.6, 2.95, 2.29], rot: [Math.PI / 2, 0, 0] });
  L.exhR = lightsB.cyl(0.13, 0.13, 0.01, 8, 0xffffff, { pos: [0.6, 2.95, 2.29], rot: [Math.PI / 2, 0, 0] });
  const lr = L as LightRanges;

  // ---- materials ----
  const decal = makeDecalAtlas();
  disposables.push(decal);
  const bodyU = makeDetailUniforms();
  const bodyMat = createDetailMaterial(
    {
      tag: 'heli-body',
      roughness: 0.5,
      metalness: 0.35,
      panels: { x: 0.95, y: 0.7, z: 1.15, grime: 0.6, wear: 0.4, rivets: true, tint: 0.1 },
      declare: BODY_DECLARE,
      discardCode: BODY_DISCARD,
      colorCode: BODY_COLOR,
      materialCode: BODY_MATERIAL,
      uniforms: { uDecal: { value: decal } },
    },
    bodyU,
  ).material;
  const darkMat = createDetailMaterial({ tag: 'heli-dark', roughness: 0.55, metalness: 0.7, panels: { x: 0.4, y: 0.4, z: 0.4, grime: 0.5, wear: 0.3, tint: 0.06 } }).material;
  const cabinU = { value: 0 };
  const cabinPos = { value: new THREE.Vector3(0, 2.4, 0.4) };
  const interMat = createDetailMaterial({
    tag: 'heli-inter',
    roughness: 0.85,
    metalness: 0.1,
    color: 0x9a9a9a,
    panels: { x: 0.6, y: 0.5, z: 0.6, grime: 0.7, wear: 0.2, tint: 0.08 },
    declare: 'uniform float uCabin; uniform vec3 uCabinPos;',
    emissiveCode: 'float dl = distance(vObjPos, uCabinPos); totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.82, 0.55) * uCabin * smoothstep(3.6, 0.2, dl) * 2.4;',
    uniforms: { uCabin: cabinU, uCabinPos: cabinPos },
  }).material;
  const doorU = makeDetailUniforms();
  const doorMat = createDetailMaterial(
    { tag: 'heli-door', roughness: 0.5, metalness: 0.35, panels: { x: 0.95, y: 0.7, z: 1.15, grime: 0.6, wear: 0.4, rivets: true, tint: 0.1 } },
    doorU,
  ).material;
  const bladeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.45, transparent: true });
  const lightMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  const blurTex = makeBlurTexture();
  disposables.push(blurTex);
  const discMat = new THREE.MeshBasicMaterial({ map: blurTex, color: 0xbfc8d0, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  disposables.push(bodyMat, darkMat, interMat, doorMat, bladeMat, lightMat, discMat);

  // ---- assemble ----
  const root = new THREE.Group();
  root.name = 'Helicopter';
  const pivot = new THREE.Group();
  pivot.position.set(0, 2.0, 0);
  const content = new THREE.Group();
  content.position.set(0, -2.0, 0);
  pivot.add(content);
  root.add(pivot);

  const addMesh = (geo: THREE.BufferGeometry, mat: THREE.Material, cast: boolean, parent: THREE.Object3D = content): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = cast;
    m.receiveShadow = true;
    parent.add(m);
    disposables.push(geo);
    return m;
  };
  addMesh(body.build(), bodyMat, true);
  addMesh(dark.build(), darkMat, true);
  addMesh(inter.build(), interMat, false);
  const doorGeo = doorB.build();
  const door = addMesh(doorGeo, doorMat, true);
  door.position.set(DOOR_X, DOOR_Y, DOOR_Z);
  // door window (shared glass material from the material library)
  const glassGeo = new THREE.BoxGeometry(0.03, 0.42, 0.9);
  const glass = new THREE.Mesh(glassGeo, mats.get('glass'));
  glass.position.set(0.03, 0.32, 0.0);
  door.add(glass);
  disposables.push(glassGeo);
  const bladesMesh = addMesh(blades.build(), bladeMat, true);
  bladesMesh.frustumCulled = false;
  bladesMesh.position.set(0, 0, HUB_Z);
  const tailMesh = addMesh(tailB.build(), bladeMat, true);
  tailMesh.position.copy(TAIL_HUB);

  // blur discs (merged into a single draw call)
  const mainDisc = polarDisc(0.5, MAIN_R, 44, 3);
  mainDisc.translate(0, HUB_Y + 0.12, HUB_Z);
  const tailDisc = polarDisc(0.1, TAIL_R, 24, 2);
  tailDisc.rotateZ(Math.PI / 2);
  tailDisc.translate(TAIL_HUB.x, TAIL_HUB.y, TAIL_HUB.z);
  const discGeo = mergeGeometries([mainDisc, tailDisc]);
  if (!discGeo) throw new Error('helicopter: disc merge failed');
  const disc = addMesh(discGeo, discMat, false);
  disc.frustumCulled = false;
  disc.renderOrder = 4;
  disc.receiveShadow = false;

  const lightGeo = lightsB.build();
  const colorAttr = lightGeo.attributes.color as THREE.BufferAttribute;
  colorAttr.setUsage(THREE.DynamicDrawUsage);
  addMesh(lightGeo, lightMat, false).receiveShadow = false;

  const haloItems = [
    { x: -1.34, y: 1.6, z: -3.25, size: 0.3 },
    { x: 1.34, y: 1.6, z: -3.25, size: 0.3 },
    { x: 0, y: 4.32, z: 9.52, size: 0.9 },
    { x: 0, y: 2.95, z: 2.0, size: 0.7 },
    { x: -0.5, y: 0.96, z: -4.95, size: 0.75 },
    { x: 0.5, y: 0.96, z: -4.95, size: 0.75 },
    { x: 0, y: 2.4, z: 0.55, size: 0.7 },
  ];
  const halos = new HaloPoints(haloItems);
  content.add(halos.points);
  disposables.push({ dispose: () => halos.dispose() });

  // ---- animation state ----
  let time = 0;
  let mainAngle = 0;
  let tailAngle = 0;
  let spin = 0;
  let doorK = 0;
  const tmp = new THREE.Color();
  const setL = (range: VRange, hex: number, k: number): void => {
    tmp.set(hex);
    writeRange(colorAttr, range, tmp.r * k, tmp.g * k, tmp.b * k);
  };

  const update = (dt: number, s: HelicopterState): void => {
    time += dt;
    spin += (s.rotor - spin) * Math.min(1, dt * 4);
    mainAngle = (mainAngle + dt * 27 * spin) % (Math.PI * 2);
    tailAngle = (tailAngle + dt * 120 * spin) % (Math.PI * 2);
    bladesMesh.rotation.y = mainAngle;
    tailMesh.rotation.x = tailAngle;
    const blur = smoothstep(0.32, 0.85, spin);
    bladeMat.opacity = 1 - 0.86 * blur;
    bladeMat.depthWrite = bladeMat.opacity > 0.9;
    discMat.opacity = 0.75 * smoothstep(0.18, 0.75, spin);
    blurTex.offset.x = (blurTex.offset.x - dt * 3.2 * spin) % 1;

    // door slide (eased)
    doorK += (s.doorOpen - doorK) * Math.min(1, dt * 6);
    const k = Math.max(0, Math.min(1, doorK));
    door.position.set(DOOR_X + 0.09 * smoothstep(0, 0.25, k), DOOR_Y, DOOR_Z + DOOR_SLIDE * k);
    doorU.objOffset.value.set(door.position.x, door.position.y, door.position.z);

    // tilt & subtle rotor vibration
    pivot.rotation.x = -(s.pitch ?? 0);
    pivot.rotation.z = -(s.roll ?? 0);
    content.position.y = -2.0 + Math.sin(time * 61) * 0.0035 * spin;

    // lights
    const on = s.lights ? 1 : 0;
    const beaconOn = (time % 1.1) < 0.14 ? 1 : 0.05;
    const strobePhase = time % 1.5;
    const strobeOn = strobePhase < 0.06 || (strobePhase > 0.2 && strobePhase < 0.26) ? 1 : 0.03;
    const heat = Math.min(1, spin * 1.2);
    setL(lr.navL, 0xff2a20, 2.2 * on);
    setL(lr.navR, 0x30ff70, 2.2 * on);
    setL(lr.strobe, 0xffffff, 5 * strobeOn * on);
    setL(lr.beacon, 0xff2418, 4.5 * beaconOn * on);
    setL(lr.landL, 0xfff1d0, 6 * on);
    setL(lr.landR, 0xfff1d0, 6 * on);
    setL(lr.cab1, 0xffe0b0, 2.6 * on);
    setL(lr.cab2, 0xffe0b0, 2.6 * on);
    setL(lr.exhL, 0xff6a20, 1.6 * heat);
    setL(lr.exhR, 0xff6a20, 1.6 * heat);
    colorAttr.needsUpdate = true;
    cabinU.value = on * 0.9;
    halos.set(0, 0.9 * on, 0.06 * on, 0.04 * on);
    halos.set(1, 0.06 * on, 0.9 * on, 0.2 * on);
    halos.set(2, 2.2 * strobeOn * on, 2.2 * strobeOn * on, 2.4 * strobeOn * on);
    halos.set(3, 2.4 * beaconOn * on, 0.18 * beaconOn * on, 0.1 * beaconOn * on);
    halos.set(4, 0.7 * on, 0.66 * on, 0.58 * on);
    halos.set(5, 0.7 * on, 0.66 * on, 0.58 * on);
    halos.set(6, 0.3 * on, 0.22 * on, 0.12 * on);
    halos.commit();
  };
  update(0, { rotor: 0, lights: true, doorOpen: 0 });

  return {
    root,
    doorLocal: new THREE.Vector3(2.05, 0, DOOR_Z),
    spotLocal: new THREE.Vector3(0, 0.95, -5.0),
    update,
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
