/** Military and perimeter props: sandbags, jersey barriers, HESCO, fences, tents, checkpoint kit, watchtower. */
import * as THREE from 'three';
import type { LevelBuilder } from '../builder';
import type { Place } from './types';
import { Parts, angleOf, collideLocal, extrudeProfile, plainMat, rngFor, scaleUV, TAU, stencil } from './util';

// ---------------------------------------------------------------------------------------------
// sandbags
// ---------------------------------------------------------------------------------------------

let bagGeoCache: THREE.BufferGeometry | null = null;
function bagGeo(): THREE.BufferGeometry {
  if (bagGeoCache) return bagGeoCache;
  const g = new THREE.SphereGeometry(1, 7, 4);
  const pos = g.attributes.position!;
  const sh = (v: number, half: number): number => Math.sign(v) * Math.pow(Math.abs(v), 0.62) * half;
  for (let i = 0; i < pos.count; i++) pos.setXYZ(i, sh(pos.getX(i), 0.25), sh(pos.getY(i), 0.085), sh(pos.getZ(i), 0.15));
  g.computeVertexNormals();
  bagGeoCache = g;
  return g;
}

/** Line of stacked sandbags from (x0,z0) to (x1,z1), default 1.1 m high, thickness ~0.6 (brick-bonded, hand-stacked). Instanced bags + collider. */
export function sandbagWall(b: LevelBuilder, o: { x0: number; z0: number; x1: number; z1: number; height?: number; thickness?: number }): void {
  const dx = o.x1 - o.x0;
  const dz = o.z1 - o.z0;
  const len = Math.hypot(dx, dz);
  if (len < 0.3) return;
  const rot = angleOf(dx, dz);
  const h = o.height ?? 1.1;
  const t = o.thickness ?? 0.6;
  const rng = rngFor({ x: o.x0, z: o.z0 }, 81);
  const layers = Math.max(1, Math.round(h / 0.16));
  const pitch = h / layers;
  const rows = Math.max(1, Math.round(t / 0.3));
  const rowW = t / rows;
  const n = Math.max(1, Math.round(len / 0.46));
  const step = len / n;
  const set = b.instanced('sandbag', bagGeo(), b.mats.get('sandbag'));
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  for (let l = 0; l < layers; l++) {
    for (let r = 0; r < rows; r++) {
      const odd = (l + r) % 2 === 1;
      const count = odd ? n - 1 : n;
      for (let i = 0; i < count; i++) {
        const sx = (i + 0.5 + (odd ? 0.5 : 0)) * step + rng.range(-0.015, 0.015);
        const zr = (r - (rows - 1) / 2) * rowW + rng.range(-0.02, 0.02);
        const y = 0.08 + l * pitch + rng.range(-0.01, 0.01);
        set.add(o.x0 + c * sx + s * zr, y, o.z0 - s * sx + c * zr, rot + rng.range(-0.09, 0.09), 1 + rng.range(-0.05, 0.06), 1 + rng.range(-0.06, 0.04), 1 + rng.range(-0.05, 0.05));
      }
    }
  }
  b.collide({
    x: (o.x0 + o.x1) / 2,
    z: (o.z0 + o.z1) / 2,
    hx: len / 2 + 0.05,
    hz: t / 2 + 0.03,
    rot,
    y1: h,
    surface: 'dirt',
    mapKind: 'prop',
    tag: 'sandbags',
  });
}

// ---------------------------------------------------------------------------------------------
// jersey barriers
// ---------------------------------------------------------------------------------------------

const jerseyGeoCache = new Map<number, THREE.BufferGeometry>();
function jerseyGeo(tile: number): THREE.BufferGeometry {
  const hit = jerseyGeoCache.get(tile);
  if (hit) return hit;
  const prof: [number, number][] = [
    [-0.3, 0],
    [0.3, 0],
    [0.3, 0.075],
    [0.27, 0.2],
    [0.15, 0.55],
    [0.115, 0.8],
    [-0.115, 0.8],
    [-0.15, 0.55],
    [-0.27, 0.2],
    [-0.3, 0.075],
  ];
  const g = extrudeProfile(prof, 3.0, 0);
  g.rotateY(Math.PI / 2);
  scaleUV(g, 1 / tile);
  jerseyGeoCache.set(tile, g);
  return g;
}

function jerseyMat(b: LevelBuilder): THREE.Material {
  return b.mats.get('concreteWall');
}

/** One 3 m concrete jersey barrier (~0.8 m tall; hop-over). */
export function jerseyBarrier(b: LevelBuilder, o: Place & { length?: number }): void {
  const len = o.length ?? 3;
  const mat = jerseyMat(b);
  const tile = (mat.userData?.tile as number | undefined) ?? 4;
  b.instanced(`jersey:${tile}`, jerseyGeo(tile), mat).add(o.x, o.y ?? 0, o.z, o.rot ?? 0, len / 3, 1, 1);
  collideLocal(b, o, 0, 0, len, 0.6, 0.8, { surface: 'concrete', mapKind: 'prop', tag: 'barrier' });
}

/** A row of jersey barriers between two points, with optional gaps ({ at: distance from start, width }). */
export function barrierLine(
  b: LevelBuilder,
  o: { x0: number; z0: number; x1: number; z1: number; gaps?: { at: number; width: number }[]; stagger?: boolean },
): void {
  const dx = o.x1 - o.x0;
  const dz = o.z1 - o.z0;
  const len = Math.hypot(dx, dz);
  if (len < 0.5) return;
  const rot = angleOf(dx, dz);
  const ux = dx / len;
  const uz = dz / len;
  const rng = rngFor({ x: o.x0, z: o.z0 }, 91);
  // intervals of solid line between gaps
  const gaps = [...(o.gaps ?? [])].sort((a, c) => a.at - c.at);
  const intervals: [number, number][] = [];
  let cur = 0;
  for (const g of gaps) {
    if (g.at > cur) intervals.push([cur, Math.min(g.at, len)]);
    cur = Math.max(cur, g.at + g.width);
  }
  if (cur < len) intervals.push([cur, len]);
  const mat = jerseyMat(b);
  const tile = (mat.userData?.tile as number | undefined) ?? 4;
  const set = b.instanced(`jersey:${tile}`, jerseyGeo(tile), mat);
  for (const [a, e] of intervals) {
    const span = e - a;
    if (span < 0.6) continue;
    const count = Math.max(1, Math.round(span / 3));
    const seg = span / count;
    for (let i = 0; i < count; i++) {
      const s0 = a + i * seg + seg / 2;
      const off = o.stagger ? (i % 2 ? 0.28 : -0.28) + rng.range(-0.06, 0.06) : 0;
      const yaw = rot + (o.stagger ? rng.range(-0.09, 0.09) : 0);
      const px = o.x0 + ux * s0 - uz * off;
      const pz = o.z0 + uz * s0 + ux * off;
      set.add(px, 0, pz, yaw, seg / 3, 1, 1);
      if (o.stagger) b.collide({ x: px, z: pz, hx: seg / 2, hz: 0.3, rot: yaw, y1: 0.8, surface: 'concrete', mapKind: 'prop', tag: 'barrier' });
    }
    if (!o.stagger) {
      const mid = a + span / 2;
      b.collide({ x: o.x0 + ux * mid, z: o.z0 + uz * mid, hx: span / 2, hz: 0.3, rot, y1: 0.8, surface: 'concrete', mapKind: 'prop', tag: 'barrier' });
    }
  }
}

// ---------------------------------------------------------------------------------------------
// HESCO
// ---------------------------------------------------------------------------------------------

/** HESCO-style mesh-and-sand bastion wall, 1.4-2 m tall. */
export function hescoWall(b: LevelBuilder, o: { x0: number; z0: number; x1: number; z1: number; height?: number }): void {
  const dx = o.x1 - o.x0;
  const dz = o.z1 - o.z0;
  const len = Math.hypot(dx, dz);
  if (len < 0.5) return;
  const rot = angleOf(dx, dz);
  const h = o.height ?? 1.4;
  const rng = rngFor({ x: o.x0, z: o.z0 }, 101);
  const place: Place = { x: o.x0, z: o.z0, rot };
  const p = new Parts(place);
  const liner = b.mats.get('canvasTan');
  const sand = b.mats.get('sandbag');
  const wire = b.mats.get('steelDark');
  const n = Math.max(1, Math.round(len / 1.06));
  const w = len / n;
  const bands = h > 1.6 ? 4 : 3;
  for (let i = 0; i < n; i++) {
    const cx = (i + 0.5) * w;
    const jitter = rng.range(-0.012, 0.012);
    p.box(liner, w - 0.03, h, 0.98, cx, h / 2, 0, { ry: jitter });
    // sand mound and torn liner lip on top
    p.geo(sand, new THREE.SphereGeometry(1, 8, 4, 0, TAU, 0, Math.PI / 2), cx, h - 0.02, 0, { sx: (w - 0.1) / 2, sy: 0.09, sz: 0.46 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.box(wire, 0.03, h + 0.04, 0.03, cx + sx * (w / 2 - 0.02), h / 2, sz * 0.5);
    for (let k = 1; k <= bands; k++) {
      const y = (h * k) / (bands + 1);
      for (const sz of [-1, 1]) p.box(wire, w - 0.02, 0.02, 0.02, cx, y, sz * 0.505, { cast: false });
    }
    p.box(wire, w, 0.025, 0.025, cx, h, 0.5, { cast: false });
    p.box(wire, w, 0.025, 0.025, cx, h, -0.5, { cast: false });
  }
  p.flush(b);
  collideLocal(b, place, len / 2, 0, len, 1.0, h, { surface: 'dirt', mapKind: 'prop', tag: 'hesco' });
}

// ---------------------------------------------------------------------------------------------
// chain-link fence
// ---------------------------------------------------------------------------------------------

/**
 * Chain-link fence with posts, top rail and optional barbed wire (default 2.4 m). Movement collider ONLY
 * (`blocksShots: false`, mapKind 'fence'). `gaps` leave openings (gates); `damaged` cuts a real hole and sags a section.
 * Barbed-wire arms lean to the RIGHT of the direction of travel (x0,z0 -> x1,z1).
 */
export function chainlinkFence(
  b: LevelBuilder,
  o: { x0: number; z0: number; x1: number; z1: number; height?: number; barbed?: boolean; gaps?: { at: number; width: number }[]; damaged?: boolean },
): void {
  const dx = o.x1 - o.x0;
  const dz = o.z1 - o.z0;
  const len = Math.hypot(dx, dz);
  if (len < 0.5) return;
  const rot = angleOf(dx, dz);
  const h = o.height ?? 2.4;
  const rng = rngFor({ x: o.x0, z: o.z0 }, 111);
  const place: Place = { x: o.x0, z: o.z0, rot };
  const p = new Parts(place);
  const mesh = b.mats.get('chainlink');
  const steel = b.mats.get('steel');
  const dark = b.mats.get('steelDark');

  const gaps = (o.gaps ?? []).map((g) => ({ at: g.at, width: g.width }));
  let sagAt = -1;
  if (o.damaged && len > 6) {
    const holeAt = rng.range(len * 0.25, len * 0.75);
    gaps.push({ at: holeAt, width: 1.3 });
    sagAt = holeAt + 1.3 + 0.4;
  }
  gaps.sort((a, c) => a.at - c.at);
  const intervals: [number, number][] = [];
  let cur = 0;
  for (const g of gaps) {
    if (g.at > cur + 0.05) intervals.push([cur, Math.min(g.at, len)]);
    cur = Math.max(cur, g.at + g.width);
  }
  if (cur < len - 0.05) intervals.push([cur, len]);

  const post = (s: number, thick: boolean): void => {
    const r = thick ? 0.07 : 0.045;
    p.cyl(steel, r, r, h + 0.1, 6, s, (h + 0.1) / 2, 0, 'y');
    p.cyl(dark, r * 1.15, r * 1.15, 0.05, 6, s, h + 0.08, 0, 'y');
    if (o.barbed) {
      p.strut(dark, s, h, 0, s, h + 0.42, 0.42, 0.035);
      for (let k = 0; k < 3; k++) p.box(dark, 0.02, 0.02, 0.0001, s, h, 0, { cast: false });
    }
  };

  for (const [a, e] of intervals) {
    const span = e - a;
    const sag = sagAt >= 0 && a <= sagAt && e >= sagAt + 1;
    const hh = sag ? h * 0.62 : h;
    // mesh, both faces so it reads from either side even with single-sided materials
    p.plane(mesh, span, hh, (a + e) / 2, hh / 2 + (sag ? 0.05 : 0.02), 0.004, { rx: sag ? -0.32 : 0, cast: false });
    p.plane(mesh, span, hh, (a + e) / 2, hh / 2 + (sag ? 0.05 : 0.02), -0.004, { ry: Math.PI, rx: sag ? 0.32 : 0, cast: false });
    p.box(steel, span, 0.045, 0.045, (a + e) / 2, h, 0, { cast: false });
    p.box(dark, span, 0.02, 0.02, (a + e) / 2, 0.08, 0, { cast: false });
    const posts = Math.max(1, Math.ceil(span / 2.7));
    for (let i = 0; i <= posts; i++) post(a + (span * i) / posts, i === 0 || i === posts ? !!o.gaps?.length : false);
    if (o.barbed) {
      for (let k = 0; k < 3; k++) {
        p.box(dark, span, 0.012, 0.012, (a + e) / 2, h + 0.1 + k * 0.1, 0.13 + k * 0.13, { cast: false });
      }
    }
    b.collide({
      ...toColliderSpec(place, (a + e) / 2, span, h),
      blocksShots: false,
      surface: 'metal',
      mapKind: 'fence',
      tag: 'fence',
    });
  }
  p.flush(b);
}

function toColliderSpec(place: Place, lx: number, w: number, h: number): { x: number; z: number; hx: number; hz: number; rot: number; y1: number } {
  const r = place.rot ?? 0;
  return { x: place.x + Math.cos(r) * lx, z: place.z - Math.sin(r) * lx, hx: w / 2, hz: 0.05, rot: r, y1: (place.y ?? 0) + h };
}

// ---------------------------------------------------------------------------------------------
// tents
// ---------------------------------------------------------------------------------------------

const TENT_DEFAULTS = {
  command: { w: 9, d: 6, wh: 2.1, mat: 'canvasOlive', sign: 'COMMAND POST' },
  medical: { w: 8, d: 5, wh: 1.9, mat: 'canvasTan', sign: 'AID STATION' },
  mess: { w: 7, d: 5, wh: 1.9, mat: 'canvasOlive', sign: 'MESS' },
  small: { w: 4, d: 3, wh: 1.5, mat: 'canvasOlive', sign: '' },
} as const;

/** Military canvas tent (command ~9x6 m, medical ~8x5, mess ~7x5, small ~4x3; `w` along local X, `d` along Z). Door faces local +X. */
export function tent(b: LevelBuilder, o: Place & { kind: 'command' | 'medical' | 'small' | 'mess'; w?: number; d?: number }): void {
  const def = TENT_DEFAULTS[o.kind];
  const w = o.w ?? def.w;
  const d = o.d ?? def.d;
  const wh = def.wh;
  const ph = wh + d * 0.27;
  const rng = rngFor(o, 121);
  const p = new Parts(o);
  const canvas = b.mats.get(def.mat);
  const dark = b.mats.get('steelDark');
  const rope = plainMat(0x6b5f48, 1);
  const g = extrudeProfile(
    [
      [-d / 2, 0],
      [-d / 2, wh],
      [0, ph],
      [d / 2, wh],
      [d / 2, 0],
    ],
    w,
    0,
  );
  g.rotateY(Math.PI / 2);
  scaleUV(g, 0.5);
  p.geo(canvas, g, 0, 0, 0, { worldUV: false });
  // eave valance and ridge
  for (const sg of [-1, 1]) p.box(canvas, w + 0.1, 0.22, 0.03, 0, wh - 0.11, sg * (d / 2 + 0.015), { worldUV: false });
  p.box(dark, w + 0.3, 0.06, 0.08, 0, ph + 0.02, 0);
  // door on the +X end
  p.plane(dark, 1.3, 1.9, w / 2 + 0.01, 0.95, 0, { ry: Math.PI / 2, cast: false });
  for (const sg of [-1, 1]) {
    p.cyl(dark, 0.03, 0.03, 2.4, 6, w / 2 + 0.06, 1.2, sg * 0.78, 'y');
    p.strut(canvas, w / 2 + 0.02, 1.9, sg * 0.66, w / 2 + 0.02, 0.1, sg * 1.2, 0.04, { worldUV: false });
  }
  p.box(dark, 0.05, 0.05, 1.7, w / 2 + 0.06, 2.4, 0);
  // sign
  if (def.sign) {
    const sign = stencil(b.mats, def.sign, { color: o.kind === 'medical' ? '#b3141b' : '#e4e0d2', background: o.kind === 'medical' ? '#e6e2d6' : '#3c4630', aspect: 3.4, font: 'stencil' });
    p.plane(sign, 1.5, 0.45, w / 2 + 0.03, 2.75, 0, { ry: Math.PI / 2, cast: false });
  }
  // side windows
  const nWin = Math.max(1, Math.floor(w / 3.5));
  for (const sg of [-1, 1]) {
    for (let i = 0; i < nWin; i++) {
      const x = -w / 2 + (w * (i + 0.5)) / nWin;
      p.plane(dark, 0.6, 0.45, x, wh * 0.62, sg * (d / 2 + 0.012), { ry: sg > 0 ? 0 : Math.PI, cast: false });
    }
  }
  // guy ropes and stakes at both ends
  for (const ex of [-1, 1]) {
    for (const sg of [-1, 1]) {
      const px = ex * (w / 2 + 1.6 + rng.range(-0.15, 0.15));
      const pz = sg * (d / 2 + 1.1 + rng.range(-0.15, 0.15));
      p.strut(rope, ex * (w / 2), wh, sg * (d / 2), px, 0.12, pz, 0.018, { cast: false });
      p.cyl(dark, 0.02, 0.02, 0.32, 5, px, 0.12, pz, 'y', { rz: 0.3 * sg });
    }
    p.strut(rope, ex * (w / 2 + 0.02), ph, 0, ex * (w / 2 + 2.2), 0.1, 0, 0.018, { cast: false });
  }
  p.flush(b);
  collideLocal(b, o, 0, 0, w, d, wh, { surface: 'fabric', mapKind: 'building', tag: 'tent' });
  collideLocal(b, o, 0, 0, w, d * 0.42, ph, { surface: 'fabric', mapKind: 'building', tag: 'tent' });
}

// ---------------------------------------------------------------------------------------------
// checkpoint kit
// ---------------------------------------------------------------------------------------------

/** Guard booth (2.4 x 2.4 m, ~2.6 m tall) with windows on three sides; the door faces local -X (back). Registers a dim caged lamp. */
export function checkpointBooth(b: LevelBuilder, o: Place): void {
  const p = new Parts(o);
  const wall = b.mats.get('metalPanel');
  const trim = b.mats.get('oliveMetal');
  const dark = b.mats.get('steelDark');
  const glass = b.mats.get('glassDark');
  p.bevelBox(wall, 2.4, 0.15, 2.4, 0.03, 0, 0.075, 0);
  p.box(trim, 2.4, 2.45, 2.4, 0, 1.375, 0);
  // windows: front (+X) and both sides
  p.box(glass, 0.02, 1.0, 2.0, 1.21, 1.75, 0);
  p.box(dark, 0.06, 0.08, 2.1, 1.22, 1.22, 0);
  for (const sg of [-1, 1]) {
    p.box(glass, 1.6, 1.0, 0.02, 0.2, 1.75, sg * 1.21);
    p.box(dark, 1.7, 0.08, 0.06, 0.2, 1.22, sg * 1.22);
    p.box(dark, 0.05, 1.05, 0.05, -0.6, 1.75, sg * 1.215);
  }
  // door on the back
  p.box(dark, 0.03, 2.0, 0.9, -1.21, 1.1, 0.35);
  p.box(b.mats.get('steel'), 0.05, 0.05, 0.16, -1.235, 1.05, 0.05);
  // roof overhang, vent, conduit
  p.bevelBox(dark, 3.1, 0.14, 3.1, 0.04, 0, 2.63, 0);
  p.box(wall, 0.5, 0.2, 0.5, -0.4, 2.8, 0.3);
  p.cyl(dark, 0.03, 0.03, 1.4, 6, 1.1, 1.9, 1.25, 'y');
  // caged lamp above the front window
  p.box(dark, 0.3, 0.16, 0.2, 1.3, 2.4, 0);
  p.box(b.mats.get('lampWarm'), 0.22, 0.06, 0.14, 1.3, 2.31, 0, { cast: false });
  p.flush(b);
  collideLocal(b, o, 0, 0, 2.4, 2.4, 2.6, { surface: 'metal', mapKind: 'building', tag: 'booth' });
  const lp = new THREE.Vector3(1.3, 2.2, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), o.rot ?? 0);
  b.light({ x: o.x + lp.x, y: (o.y ?? 0) + lp.y, z: o.z + lp.z, color: 0xffe0b0, intensity: 45, distance: 12, mode: 'flicker', glow: 0.7, weight: 0.7 });
}

/** Striped boom barrier across `width` m (default 5). `open` = raised. The arm pivots at the cabinet (local origin) and reaches toward +X. */
export function boomBarrier(b: LevelBuilder, o: Place & { width?: number; open?: boolean }): void {
  const width = o.width ?? 5;
  const p = new Parts(o);
  const cab = b.mats.get('paintYellow');
  const red = b.mats.get('paintRed');
  const white = b.mats.get('paintWhite');
  const dark = b.mats.get('steelDark');
  p.bevelBox(cab, 0.45, 1.3, 0.4, 0.03, 0, 0.65, 0);
  p.box(dark, 0.3, 0.05, 0.25, 0, 1.32, 0);
  p.box(b.mats.get('lampRed'), 0.1, 0.1, 0.05, 0.0, 1.0, 0.21, { cast: false });
  // arm segments (alternate red / white)
  const n = Math.max(4, Math.round(width / 0.5));
  const seg = (width - 0.3) / n;
  const angle = o.open ? Math.PI / 2 - 0.12 : 0;
  for (let i = 0; i < n; i++) {
    const s = 0.25 + seg * (i + 0.5);
    const x = Math.cos(angle) * s;
    const y = 1.15 + Math.sin(angle) * s;
    p.box(i % 2 ? white : red, seg, 0.11, 0.07, x, y, 0, { rz: angle });
  }
  p.box(dark, 0.1, 0.14, 0.12, 0.05, 1.15, 0);
  if (!o.open) {
    // receiving post at the far end
    p.bevelBox(cab, 0.22, 1.3, 0.22, 0.02, width + 0.05, 0.65, 0);
    p.box(dark, 0.16, 0.05, 0.05, width - 0.05, 1.18, 0);
  }
  p.flush(b);
  collideLocal(b, o, 0, 0, 0.45, 0.4, 1.3, { surface: 'metal', mapKind: 'prop', tag: 'boom' });
  if (!o.open) {
    collideLocal(b, o, width / 2 + 0.1, 0, width - 0.2, 0.12, 1.25, { y0: 1.05, surface: 'metal', mapKind: 'prop', tag: 'boom' });
    collideLocal(b, o, width + 0.05, 0, 0.22, 0.22, 1.3, { surface: 'metal', mapKind: 'prop', tag: 'boom' });
  }
}

// ---------------------------------------------------------------------------------------------
// watchtower
// ---------------------------------------------------------------------------------------------

/** Guard watchtower on 4 legs with a cabin, walkway, roof searchlight and ladder (ladder on the local +X side). Legs and cabin block movement. */
export function watchtower(b: LevelBuilder, o: Place & { height?: number }): void {
  const H = o.height ?? 6;
  const p = new Parts(o);
  const steel = b.mats.get('steelDark');
  const wood = b.mats.get('wood');
  const cab = b.mats.get('oliveMetal');
  const glass = b.mats.get('glassDark');
  const L = 1.3;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      p.box(steel, 0.22, H, 0.22, sx * L, H / 2, sz * L);
      p.box(steel, 0.5, 0.15, 0.5, sx * L, 0.075, sz * L);
    }
  }
  // cross bracing on each face, 3 bays
  const bays = 3;
  for (let k = 0; k < bays; k++) {
    const y0 = (H * k) / bays;
    const y1 = (H * (k + 1)) / bays;
    for (const sg of [-1, 1]) {
      p.strut(steel, -L, y0, sg * L, L, y1, sg * L, 0.08);
      p.strut(steel, L, y0, sg * L, -L, y1, sg * L, 0.08);
      p.strut(steel, sg * L, y0, -L, sg * L, y1, L, 0.08);
      p.strut(steel, sg * L, y0, L, sg * L, y1, -L, 0.08);
      p.box(steel, 2 * L, 0.1, 0.1, 0, y1, sg * L);
      p.box(steel, 0.1, 0.1, 2 * L, sg * L, y1, 0);
    }
  }
  // platform, railings, cabin
  p.box(wood, 3.3, 0.14, 3.3, 0, H + 0.07, 0);
  for (const sg of [-1, 1]) {
    p.box(steel, 3.3, 0.05, 0.05, 0, H + 1.05, sg * 1.62);
    p.box(steel, 0.05, 0.05, 3.3, sg * 1.62, H + 1.05, 0);
  }
  p.bevelBox(cab, 2.4, 2.2, 2.4, 0.04, 0, H + 1.24, 0);
  for (const sg of [-1, 1]) {
    p.box(glass, 1.7, 0.85, 0.02, 0, H + 1.55, sg * 1.21);
    p.box(glass, 0.02, 0.85, 1.7, sg * 1.21, H + 1.55, 0);
  }
  p.bevelBox(steel, 3.0, 0.16, 3.0, 0.04, 0, H + 2.45, 0);
  p.box(steel, 0.3, 0.3, 0.3, -0.4, H + 2.7, 0.4);
  p.cyl(steel, 0.22, 0.22, 0.4, 10, 0.6, H + 2.75, -0.5, 'z');
  p.box(b.mats.get('lampCool'), 0.02, 0.36, 0.36, 0.6, H + 2.75, -0.71, { cast: false });
  // ladder on the +X side
  for (const dz of [-0.28, 0.28]) p.box(steel, 0.06, H + 0.4, 0.06, L + 0.15, (H + 0.4) / 2 - 0.2, dz);
  for (let y = 0.4; y < H; y += 0.32) p.box(steel, 0.05, 0.05, 0.56, L + 0.15, y, 0);
  p.flush(b);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) collideLocal(b, o, sx * L, sz * L, 0.35, 0.35, H, { surface: 'metal', mapKind: 'prop', tag: 'tower' });
  collideLocal(b, o, 0, 0, 3.3, 3.3, H + 2.6, { y0: H - 0.05, surface: 'metal', mapKind: 'prop', tag: 'tower' });
}
