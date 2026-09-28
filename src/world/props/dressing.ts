/** Ground dressing: rubble and trash, dead trees, corpses. */
import * as THREE from 'three';
import type { LevelBuilder } from '../builder';
import type { Place } from './types';
import { Parts, Rng, plainMat, rngFor, TAU } from './util';

// ---------------------------------------------------------------------------------------------
// debris
// ---------------------------------------------------------------------------------------------

const chunkGeoCache: THREE.BufferGeometry[] = [];
function chunkGeo(i: number): THREE.BufferGeometry {
  const hit = chunkGeoCache[i];
  if (hit) return hit;
  const rng = new Rng(9000 + i * 77);
  const g = new THREE.IcosahedronGeometry(0.5, 0);
  const pos = g.attributes.position!;
  const seen = new Map<string, number>();
  for (let v = 0; v < pos.count; v++) {
    const key = `${pos.getX(v).toFixed(3)},${pos.getY(v).toFixed(3)},${pos.getZ(v).toFixed(3)}`;
    let k = seen.get(key);
    if (k === undefined) {
      k = rng.range(0.7, 1.15);
      seen.set(key, k);
    }
    pos.setXYZ(v, pos.getX(v) * k * (1 + i * 0.12), pos.getY(v) * k * 0.7, pos.getZ(v) * k * (1.1 - i * 0.1));
  }
  g.computeVertexNormals();
  chunkGeoCache[i] = g;
  return g;
}

let paperGeoCache: THREE.BufferGeometry | null = null;
function paperGeo(): THREE.BufferGeometry {
  if (!paperGeoCache) {
    paperGeoCache = new THREE.PlaneGeometry(0.28, 0.2);
    paperGeoCache.rotateX(-Math.PI / 2);
  }
  return paperGeoCache;
}

/** Rubble, trash and broken concrete scattered inside `radius`. Waist-high `big` piles get a collider; scattered chunks are decorative (<= 0.3 m). */
export function debris(b: LevelBuilder, o: { x: number; z: number; radius: number; density?: number; seed?: number; big?: boolean }): void {
  const rng = rngFor(o, 201);
  const density = o.density ?? 1;
  const rubble = b.mats.get('rubble');
  const chunks = [0, 1, 2].map((i) => b.instanced(`debris:${i}`, chunkGeo(i), rubble));
  const n = Math.max(3, Math.round(o.radius * o.radius * 1.6 * density));
  for (let i = 0; i < n; i++) {
    const a = rng.range(0, TAU);
    const d = Math.pow(rng.f(), 0.7) * o.radius;
    const x = o.x + Math.cos(a) * d;
    const z = o.z + Math.sin(a) * d;
    const s = rng.range(0.16, 0.5) * (rng.chance(0.15) ? 1.5 : 1);
    chunks[rng.int(0, 2)]!.add(x, s * 0.28, z, rng.range(0, TAU), s, s * rng.range(0.6, 1.1), s * rng.range(0.7, 1.2));
  }
  // papers and small trash
  const paperMat = plainMat(0x8f8c80, 0.98);
  const paper = b.instanced('paper', paperGeo(), paperMat, { cast: false });
  const m = new THREE.Matrix4();
  for (let i = 0; i < Math.round(n * 0.7); i++) {
    const a = rng.range(0, TAU);
    const d = Math.sqrt(rng.f()) * o.radius * 1.15;
    m.makeRotationY(rng.range(0, TAU));
    m.setPosition(o.x + Math.cos(a) * d, 0.012 + rng.range(0, 0.008), o.z + Math.sin(a) * d);
    paper.addMatrix(m);
  }
  const p = new Parts({ x: 0, z: 0 });
  const conc = b.mats.get('concreteDark');
  const rust = b.mats.get('rust');
  const card = b.mats.get('cardboard');
  const slabs = Math.max(1, Math.round(o.radius * 0.7 * density));
  for (let i = 0; i < slabs; i++) {
    const a = rng.range(0, TAU);
    const d = rng.range(0.1, 1) * o.radius * 0.85;
    const x = o.x + Math.cos(a) * d;
    const z = o.z + Math.sin(a) * d;
    const w = rng.range(0.7, 1.3);
    const dd = rng.range(0.5, 0.9);
    const yaw = rng.range(0, TAU);
    p.box(conc, w, 0.11, dd, x, 0.08 + rng.range(0, 0.05), z, { ry: yaw, rx: rng.range(-0.14, 0.14), rz: rng.range(-0.14, 0.14) });
    if (rng.chance(0.6)) {
      for (let k = 0; k < 3; k++) {
        const lx = x + Math.cos(yaw) * rng.range(-0.3, 0.3);
        const lz = z - Math.sin(yaw) * rng.range(-0.3, 0.3);
        p.tube(rust, lx, 0.1, lz, lx + rng.range(-0.1, 0.1), 0.45 + rng.range(0, 0.25), lz + rng.range(-0.1, 0.1), 0.012, 4);
      }
    }
    if (rng.chance(0.4)) p.box(card, 0.5, 0.05, 0.4, x + 0.5, 0.03, z + 0.2, { ry: rng.range(0, TAU) });
  }
  if (o.big) {
    // waist-high pile in the centre built from stacked chunks
    const pile = Math.max(6, Math.round(o.radius * 5));
    for (let i = 0; i < pile; i++) {
      const a = rng.range(0, TAU);
      const d = Math.pow(rng.f(), 1.4) * o.radius * 0.45;
      const s = rng.range(0.4, 0.8);
      const h = 0.8 * (1 - d / (o.radius * 0.5)) + 0.2;
      chunks[rng.int(0, 2)]!.add(o.x + Math.cos(a) * d, Math.max(0.15, h * 0.7 * rng.range(0.8, 1.1)), o.z + Math.sin(a) * d, rng.range(0, TAU), s, s * 0.9, s);
    }
    b.collide({ x: o.x, z: o.z, hx: o.radius * 0.42, hz: o.radius * 0.42, rot: rng.range(0, 1.5), y1: 0.85, surface: 'concrete', mapKind: 'prop', tag: 'rubble' });
  }
  p.flush(b);
}

// ---------------------------------------------------------------------------------------------
// dead tree
// ---------------------------------------------------------------------------------------------

/** Leafless dead tree (~4-5 m), trunk collider. */
export function deadTree(b: LevelBuilder, o: Place & { scale?: number; seed?: number }): void {
  const rng = rngFor(o, 211);
  const sc = o.scale ?? 1;
  const p = new Parts(o);
  const bark = b.mats.get('wood');
  // trunk: bent segments
  const segs = 5;
  const trunkH = rng.range(3.4, 4.6) * sc;
  let px = 0;
  let pz = 0;
  const pts: { x: number; y: number; z: number; r: number }[] = [{ x: 0, y: 0, z: 0, r: 0.24 * sc }];
  for (let i = 1; i <= segs; i++) {
    px += rng.range(-0.12, 0.12) * sc;
    pz += rng.range(-0.12, 0.12) * sc;
    pts.push({ x: px, y: (trunkH * i) / segs, z: pz, r: (0.24 - (0.16 * i) / segs) * sc });
  }
  for (let i = 0; i < segs; i++) {
    const a = pts[i]!;
    const c = pts[i + 1]!;
    p.taper(bark, a.x, a.y, a.z, c.x, c.y, c.z, a.r, c.r, 6);
  }
  p.cyl(bark, 0.34 * sc, 0.4 * sc, 0.25 * sc, 7, 0, 0.1, 0); // root flare
  const branch = (x: number, y: number, z: number, dx: number, dy: number, dz: number, len: number, r: number, depth: number): void => {
    const steps = 2;
    let cx = x;
    let cy = y;
    let cz = z;
    let d = new THREE.Vector3(dx, dy, dz).normalize();
    for (let i = 0; i < steps; i++) {
      d = d.clone().add(new THREE.Vector3(rng.range(-0.25, 0.25), rng.range(-0.05, 0.2), rng.range(-0.25, 0.25))).normalize();
      const nx = cx + d.x * (len / steps);
      const ny = cy + d.y * (len / steps);
      const nz = cz + d.z * (len / steps);
      p.taper(bark, cx, cy, cz, nx, ny, nz, r * (1 - i / steps * 0.5), r * (1 - (i + 1) / steps * 0.6) + 0.006, 4);
      cx = nx;
      cy = ny;
      cz = nz;
      if (depth > 0 && rng.chance(0.75)) {
        const az = rng.range(0, TAU);
        const el = rng.range(0.4, 1.0);
        branch(cx, cy, cz, Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el), len * rng.range(0.45, 0.65), r * 0.55, depth - 1);
      }
    }
  };
  const nb = rng.int(6, 9);
  for (let i = 0; i < nb; i++) {
    const t = rng.range(0.35, 0.98);
    const idx = Math.min(segs - 1, Math.floor(t * segs));
    const a = pts[idx]!;
    const c = pts[idx + 1]!;
    const u = t * segs - idx;
    const bx = a.x + (c.x - a.x) * u;
    const by = a.y + (c.y - a.y) * u;
    const bz = a.z + (c.z - a.z) * u;
    const az = rng.range(0, TAU);
    const el = rng.range(0.25, 0.95) * (1.15 - t * 0.5);
    branch(bx, by, bz, Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el), rng.range(1.2, 2.4) * sc * (1.1 - t * 0.4), 0.075 * sc * (1.2 - t * 0.5), 1);
  }
  p.flush(b);
  b.collide({ x: o.x, z: o.z, hx: 0.24 * sc, hz: 0.24 * sc, y0: o.y ?? 0, y1: (o.y ?? 0) + 3.0, surface: 'wood', mapKind: 'prop', tag: 'tree' });
}

// ---------------------------------------------------------------------------------------------
// corpses
// ---------------------------------------------------------------------------------------------

const CIV_JACKETS = [0x5a5e63, 0x4a3f38, 0x35455a, 0x6a5a45, 0x3f4a3c, 0x60423d];
const SKIN = [0x9b7b66, 0x7a5a48, 0xb59079, 0x5d4436];

/**
 * Lying-down human figure for environmental storytelling. Head toward local +X, splayed limbs, dried blood decal.
 * Tasteful and restrained. No collider (you can step over it).
 */
export function corpse(b: LevelBuilder, o: Place & { kind?: 'soldier' | 'civilian' | 'hazmat' | 'bodybag'; seed?: number }): void {
  const kind = o.kind ?? 'soldier';
  const rng = rngFor(o, 221);
  const p = new Parts(o);
  const rubber = b.mats.get('rubber');
  const dark = b.mats.get('steelDark');

  if (kind === 'bodybag') {
    const bag = plainMat(0x17181a, 0.55, 0.05);
    p.bevelBox(bag, 1.85, 0.2, 0.55, 0.08, 0, 0.1, 0);
    p.box(b.mats.get('steel'), 1.6, 0.012, 0.014, 0, 0.205, 0, { cast: false });
    p.box(b.mats.get('paintWhite'), 0.14, 0.01, 0.1, 0.5, 0.208, 0.1, { rz: 0, cast: false });
    p.flush(b);
    return;
  }

  const skin = plainMat(rng.pick(SKIN), 0.8);
  let cloth: THREE.Material;
  let trousers: THREE.Material;
  let vest: THREE.Material | null = null;
  let helmet: THREE.Material | null = null;
  if (kind === 'soldier') {
    cloth = b.mats.get('canvasOlive');
    trousers = b.mats.get('canvasOlive');
    vest = plainMat(0x2c3227, 0.9);
    helmet = b.mats.get('paintOlive');
  } else if (kind === 'hazmat') {
    cloth = plainMat(0xb59d2c, 0.75);
    trousers = cloth;
    helmet = plainMat(0xb59d2c, 0.75);
  } else {
    cloth = plainMat(rng.pick(CIV_JACKETS), 0.9);
    trousers = plainMat(rng.pick([0x2a3140, 0x3a3a3c, 0x4a4136]), 0.9);
  }
  const prone = rng.chance(0.4);
  // blood stain under the body
  const decal = b.mats.decal((['bloodOld0', 'bloodOld1', 'bloodOld2'] as const)[rng.int(0, 2)]!);
  p.plane(decal, 1.6, 1.3, rng.range(-0.1, 0.2), 0.014, rng.range(-0.1, 0.1), { rx: -Math.PI / 2, rz: rng.range(0, TAU), cast: false });

  const yBody = 0.11;
  // torso and pelvis
  p.bevelBox(cloth, 0.62, 0.2, 0.44, 0.06, 0.05, yBody + 0.0, 0, { ry: rng.range(-0.15, 0.15) });
  if (vest) p.bevelBox(vest, 0.4, 0.23, 0.42, 0.05, 0.12, yBody + 0.02, 0);
  p.bevelBox(trousers, 0.26, 0.17, 0.4, 0.05, -0.36, yBody - 0.02, 0);
  // head
  const hx = 0.5;
  p.sphere(skin, 0.105, 8, 6, hx + 0.03, yBody + (prone ? -0.02 : 0.0), rng.range(-0.05, 0.05));
  if (helmet) {
    if (kind === 'hazmat') p.sphere(helmet, 0.135, 8, 6, hx + 0.03, yBody, 0, { sx: 1.0 });
    else p.geo(helmet, new THREE.SphereGeometry(0.125, 8, 5, 0, TAU, 0, Math.PI / 2), hx + 0.03, yBody + 0.02, 0, { rx: rng.range(-0.2, 0.2) });
  }
  if (kind === 'hazmat') p.box(b.mats.get('glassDark'), 0.02, 0.09, 0.13, hx + 0.16, yBody + 0.0, 0);
  // arms: sprawled
  for (const sg of [-1, 1]) {
    const a1 = rng.range(0.25, 1.1) * sg;
    const sx = 0.32;
    const sz = sg * 0.28;
    const ex = sx + Math.cos(a1) * 0.0 + rng.range(-0.05, 0.25);
    const ez = sz + sg * rng.range(0.18, 0.3);
    p.tube(cloth, sx, yBody, sz, ex, yBody - 0.02, ez, 0.055, 6);
    const fx = ex + rng.range(-0.3, 0.3);
    const fz = ez + sg * rng.range(0.1, 0.28);
    p.tube(cloth, ex, yBody - 0.02, ez, fx, 0.06, fz, 0.048, 6);
    p.sphere(kind === 'hazmat' ? rubber : skin, 0.045, 6, 4, fx, 0.05, fz);
  }
  // legs
  for (const sg of [-1, 1]) {
    const kx = -0.36 - 0.42 + rng.range(-0.06, 0.04);
    const kz = sg * rng.range(0.09, 0.2);
    p.tube(trousers, -0.42, yBody - 0.03, sg * 0.1, kx, 0.075, kz, 0.075, 6);
    const fx = kx - 0.4 + rng.range(-0.06, 0.06);
    const fz = kz + sg * rng.range(0.03, 0.15);
    p.tube(trousers, kx, 0.075, kz, fx, 0.06, fz, 0.062, 6);
    p.bevelBox(rubber, 0.26, 0.09, 0.1, 0.02, fx - 0.1, 0.05, fz, { ry: rng.range(-0.6, 0.6) });
  }
  if (kind === 'soldier' && rng.chance(0.6)) {
    // dropped rifle silhouette beside the body
    const rz = rng.sign() * rng.range(0.55, 0.8);
    p.box(dark, 0.62, 0.07, 0.05, 0.1, 0.045, rz, { ry: rng.range(-0.25, 0.25) });
    p.box(dark, 0.3, 0.05, 0.03, 0.55, 0.04, rz + 0.02, { ry: rng.range(-0.25, 0.25) });
    p.box(dark, 0.14, 0.13, 0.05, 0.02, 0.06, rz + 0.04, { rz: 0.3 });
  }
  p.flush(b);
}
