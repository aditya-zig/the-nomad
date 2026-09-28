/** Shared building blocks for vehicles: context, wheels, lights, seams, glass shards. Vehicle-local axes: +X front, +Y up, +Z right side. */
import * as THREE from 'three';
import type { LevelBuilder } from '../builder';
import type { MaterialName } from '../materials';
import type { PaintName, Place, VehicleKind } from './types';
import { Parts, type PartOpts, Rng, cachedMat, dentGeometry, extrudeProfile, placeMatrix, rngFor } from './util';

export interface VehicleOpts extends Place {
  kind: VehicleKind;
  paint?: PaintName;
  wrecked?: boolean;
  burnt?: boolean;
  doorsOpen?: boolean;
  seed?: number;
}

const PAINT_MAT: Record<PaintName, MaterialName> = {
  olive: 'paintOlive',
  white: 'paintWhite',
  blue: 'paintBlue',
  red: 'paintRed',
  black: 'paintBlack',
  yellow: 'paintYellow',
  grey: 'paintGrey',
};

export interface VCtx {
  b: LevelBuilder;
  p: Parts;
  o: VehicleOpts;
  rng: Rng;
  paint: THREE.Material;
  glass: THREE.Material;
  shard: THREE.Material;
  dark: THREE.Material;
  steel: THREE.Material;
  steelDark: THREE.Material;
  rubber: THREE.Material;
  tire: THREE.Material;
  head: THREE.Material;
  tail: THREE.Material;
  wrecked: boolean;
  burnt: boolean;
  open: boolean;
}

export function makeCtx(b: LevelBuilder, o: VehicleOpts, defaultPaint: PaintName): VCtx {
  const rng = rngFor(o, 71);
  const burnt = !!o.burnt;
  const wrecked = !!o.wrecked || burnt;
  const mats = b.mats;
  const paint = burnt ? mats.get('burnt') : mats.get(PAINT_MAT[o.paint ?? defaultPaint]);
  const lit = rng.chance(0.22) && !wrecked;
  const p = new Parts(o);
  if (wrecked) {
    const tilt = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rng.range(-0.035, 0.035), 0, rng.range(-0.025, 0.025)));
    p.setBase(placeMatrix(o).multiply(tilt));
  }
  return {
    b,
    p,
    o,
    rng,
    paint,
    glass: mats.get('glassDark'),
    shard: mats.get('glass'),
    dark: mats.get('steelDark'),
    steel: mats.get('steel'),
    steelDark: mats.get('steelDark'),
    rubber: mats.get('rubber'),
    tire: mats.get('tire'),
    head: cachedMat(`veh:head:${lit}`, () => new THREE.MeshStandardMaterial({ color: 0xcfd6db, emissive: 0xbfd0e0, emissiveIntensity: lit ? 0.7 : 0.1, roughness: 0.2, metalness: 0.3 })),
    tail: cachedMat(`veh:tail:${lit}`, () => new THREE.MeshStandardMaterial({ color: 0x5a0e0e, emissive: 0xff2010, emissiveIntensity: lit ? 0.9 : 0.18, roughness: 0.3 })),
    wrecked,
    burnt,
    open: !!o.doorsOpen,
  };
}

/** Wheel with tyre, rim and hub. `z` is the wheel-centre offset (its sign selects the side). */
export function wheel(c: VCtx, x: number, z: number, r: number, w: number, flatOverride?: boolean, simple = false): void {
  const flat = flatOverride ?? (c.wrecked && c.rng.chance(0.55));
  const cy = flat ? r * 0.8 : r;
  if (c.burnt) {
    c.p.cyl(c.steelDark, r * 0.62, r * 0.62, w * 0.6, 10, x, r * 0.62, z, 'z');
    return;
  }
  c.p.cyl(c.tire, r, r, w, 12, x, cy, z, 'z', flat ? { sy: 0.8 } : {});
  if (simple) return;
  c.p.cyl(c.steel, r * 0.58, r * 0.58, w + 0.014, 8, x, cy, z, 'z', flat ? { sy: 0.8 } : {});
  c.p.cyl(c.steelDark, r * 0.2, r * 0.2, w + 0.026, 5, x, cy, z, 'z');
}

/** Dark disc on the body side behind a wheel so it reads as a wheel well. */
export function arch(c: VCtx, x: number, zSide: number, r: number): void {
  if (c.burnt) return; // no tyres: the bare rim sits in an open well, no dark disc
  c.p.cyl(c.dark, r * 1.3, r * 1.3, 0.02, 18, x, r, zSide + Math.sign(zSide) * 0.004, 'z', { receive: false });
}

export function headlights(c: VCtx, x: number, y: number, zSpan: number, size: [number, number, number] = [0.06, 0.13, 0.34]): void {
  for (const s of [-1, 1]) {
    c.p.box(c.head, size[0], size[1], size[2], x, y, s * zSpan, { cast: false });
    c.p.box(c.dark, size[0] * 0.6, size[1] + 0.05, size[2] + 0.05, x - 0.02, y, s * zSpan, { cast: false });
  }
}

export function taillights(c: VCtx, x: number, y: number, zSpan: number, size: [number, number, number] = [0.05, 0.13, 0.34]): void {
  for (const s of [-1, 1]) {
    c.p.box(c.dark, size[0] * 0.6, size[1] + 0.05, size[2] + 0.05, x + 0.015, y, s * zSpan, { cast: false });
    c.p.box(c.tail, size[0], size[1], size[2], x, y, s * zSpan, { cast: false });
  }
}

export function plate(c: VCtx, x: number, y: number, facing: 1 | -1): void {
  const mat = c.b.mats.get('paintWhite');
  c.p.box(mat, 0.02, 0.13, 0.34, x + facing * 0.01, y, 0, { cast: false });
}

export function mirror(c: VCtx, x: number, y: number, zBody: number, size = 1): void {
  for (const s of [-1, 1]) {
    c.p.box(c.dark, 0.07 * size, 0.12 * size, 0.05 * size, x, y, s * (zBody + 0.09 * size));
    c.p.box(c.paint, 0.05 * size, 0.02 * size, 0.1 * size, x, y, s * (zBody + 0.03 * size));
  }
}

/** Thin vertical door seam on both sides. */
export function seam(c: VCtx, x: number, y0: number, y1: number, zSide: number): void {
  for (const s of [-1, 1]) c.p.box(c.dark, 0.014, y1 - y0, 0.012, x, (y0 + y1) / 2, s * (zSide + 0.004), { cast: false, receive: false });
}

export function handle(c: VCtx, x: number, y: number, zSide: number): void {
  for (const s of [-1, 1]) c.p.box(c.steel, 0.14, 0.025, 0.02, x, y, s * (zSide + 0.01), { cast: false });
}

/** Broken windshield/window shards: a few glass slivers poking into a rectangular opening. */
export function shards(c: VCtx, x: number, y: number, z: number, w: number, h: number, ry = 0, rx = 0): void {
  if (!c.wrecked || c.burnt) return;
  const n = c.rng.int(3, 6);
  for (let i = 0; i < n; i++) {
    const sx = c.rng.range(-w / 2, w / 2);
    const sy = c.rng.range(-h / 2, h / 2);
    const tri = new THREE.BufferGeometry();
    const a = c.rng.range(0.05, 0.16);
    tri.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, a, 0, 0, a * 0.4, a * c.rng.range(0.6, 1.4), 0], 3));
    tri.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, 1], 2));
    const cosr = Math.cos(ry);
    const sinr = Math.sin(ry);
    c.p.geo(c.shard, tri, x + sx * cosr, y + sy, z - sx * sinr, { ry, rx, rz: c.rng.range(0, 6.28), cast: false });
  }
}

/** Body shell from a side profile (x,y), extruded across `width`; dented when wrecked. */
export function shell(c: VCtx, pts: readonly (readonly [number, number])[], width: number, mat: THREE.Material, bevel = 0.04, dent = 0): void {
  const g = extrudeProfile(pts, width, bevel);
  if (c.wrecked && dent > 0) dentGeometry(g, dent, 2.3, c.rng.range(0, 50));
  c.p.geo(mat, g, 0, 0, 0, { worldUV: true });
}

/** Underbody dark plate so bodies do not look like they float. */
export function underbody(c: VCtx, len: number, w: number, y = 0.22, h = 0.18, x = 0): void {
  c.p.box(c.dark, len, h, w, x, y, 0, { receive: false });
}

export function bumperBar(c: VCtx, x: number, y: number, width: number, h = 0.2, d = 0.16, mat?: THREE.Material): void {
  c.p.bevelBox(mat ?? c.rubber, d, h, width, 0.03, x, y, 0);
}

/** Pillar between two profile points, on both sides at |z| = zHalf. */
export function pillar(c: VCtx, a: readonly [number, number], b: readonly [number, number], zHalf: number, th = 0.06, depth = 0.05): void {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  const ang = Math.atan2(dy, dx);
  for (const s of [-1, 1]) c.p.box(c.paint, len + 0.03, th, depth, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, s * zHalf, { rz: ang });
}

export function roofPanel(c: VCtx, x0: number, x1: number, y: number, width: number, th = 0.05): void {
  c.p.bevelBox(c.paint, x1 - x0, th, width, 0.015, (x0 + x1) / 2, y + th / 2, 0);
}

export function finish(c: VCtx): void {
  c.p.flush(c.b);
}

export type { PartOpts };
