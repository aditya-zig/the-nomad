/** Containers, drums, crates, pallets, dumpsters. */
import * as THREE from 'three';
import type { LevelBuilder } from '../builder';
import { type BarrelColor, type ContainerColor, type Place } from './types';
import { GeoBuilder, Parts, cachedMat, collideLocal, plainMat, rngFor, toWorld, TAU, stencil } from './util';

const CONTAINER_MAT: Record<ContainerColor, string> = {
  red: 'containerRed',
  blue: 'containerBlue',
  green: 'containerGreen',
  olive: 'containerOlive',
  rust: 'containerRust',
  white: 'containerWhite',
  yellow: 'containerYellow',
};
const CONTAINER_COLORS: ContainerColor[] = ['red', 'blue', 'green', 'olive', 'rust', 'white', 'yellow', 'red', 'blue', 'green', 'rust'];
const LINES = [
  { name: 'KESTREL LINE', code: 'KSTU' },
  { name: 'NORTHGATE FREIGHT', code: 'NGFU' },
  { name: 'HALVERSON MARITIME', code: 'HMLU' },
  { name: 'OSPREY CARGO', code: 'OSCU' },
];

// small fixed pool of unit numbers so containers share stencil materials (fewer unique batches)
const ID_POOL = ['407118 3', '512944 0', '386270 7', '629051 2', '744388 9', '298415 5'];

const CL = 12.19;
const CW = 2.44;
const CH = 2.59;

/**
 * ISO shipping container 12.19 x 2.44 x 2.59 m (short: 6.06 m). Collider(s) for every stack level. Fictional freight markings only.
 */
export function container(
  b: LevelBuilder,
  o: Place & { color?: ContainerColor; stack?: 1 | 2 | 3; short?: boolean; doorsOpen?: boolean; seed?: number },
): void {
  const rng = rngFor(o, 11);
  const levels = o.stack ?? 1;
  const L = o.short ? 6.06 : CL;
  const base = o.y ?? 0;
  for (let i = 0; i < levels; i++) {
    const color = o.color ?? (i === 0 ? rng.pick(CONTAINER_COLORS) : rng.pick(CONTAINER_COLORS));
    const jitter = i === 0 ? 0 : 0.07;
    const place: Place = {
      x: o.x + rng.range(-jitter, jitter),
      z: o.z + rng.range(-jitter, jitter),
      y: base + i * CH,
      rot: (o.rot ?? 0) + (i === 0 ? 0 : rng.range(-0.01, 0.01)),
    };
    buildContainer(b, place, color, L, !!o.doorsOpen && i === 0, rng.int(0, 99999));
  }
  collideLocal(b, { x: o.x, z: o.z, rot: o.rot, y: base }, 0, 0, L, CW, CH * levels, { surface: 'metal', mapKind: 'container', tag: 'container' });
}

function buildContainer(b: LevelBuilder, place: Place, color: ContainerColor, L: number, open: boolean, seed: number): void {
  const mats = b.mats;
  const skin = mats.get(CONTAINER_MAT[color] as never);
  const dark = mats.get('steelDark');
  const steel = mats.get('steel');
  const p = new Parts(place);
  const hl = L / 2;
  const hw = CW / 2;

  if (!open) {
    p.box(skin, L, CH, CW, 0, CH / 2, 0);
  } else {
    // hollow shell so the doors can hang open
    p.box(skin, L, 0.12, CW, 0, 0.16, 0); // floor slab (dark underside rails hide the rest)
    p.box(skin, L, 0.07, CW, 0, CH - 0.035, 0); // roof
    p.box(skin, L, CH - 0.2, 0.07, 0, 0.1 + (CH - 0.2) / 2, hw - 0.035);
    p.box(skin, L, CH - 0.2, 0.07, 0, 0.1 + (CH - 0.2) / 2, -hw + 0.035);
    p.box(skin, 0.07, CH - 0.1, CW, -hl + 0.035, 0.1 + (CH - 0.1) / 2, 0);
    p.box(mats.get('floorWarehouse'), L - 0.1, 0.02, CW - 0.16, 0, 0.23, 0, { receive: true });
    // door leaves hanging open (hinged on the outer posts)
    for (const s of [1, -1]) {
      const w = CW / 2 - 0.05;
      const th = -s * (Math.PI / 2 + 0.25 + (s > 0 ? 0.12 : 0));
      const hx = hl + 0.02;
      const hz = s * (hw - 0.03);
      const cx = hx + Math.sin(th) * (-s * w * 0.5) * -1;
      const cz = hz + Math.cos(th) * (-s * w * 0.5);
      p.box(skin, 0.06, CH - 0.2, w, cx, 0.1 + (CH - 0.2) / 2, cz, { ry: th });
      p.box(dark, 0.05, CH - 0.24, 0.05, cx, 0.1 + (CH - 0.2) / 2, cz, { ry: th, sz: 0.5 });
    }
  }

  // corner castings and rails
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      p.box(dark, 0.2, 0.14, 0.17, sx * (hl - 0.1), CH - 0.07, sz * (hw - 0.085));
      p.box(dark, 0.2, 0.14, 0.17, sx * (hl - 0.1), 0.07, sz * (hw - 0.085));
    }
  }
  for (const sz of [-1, 1]) {
    p.box(dark, L - 0.3, 0.1, 0.06, 0, 0.06, sz * (hw + 0.005));
    p.box(dark, L - 0.3, 0.08, 0.06, 0, CH - 0.05, sz * (hw + 0.005));
  }
  // underside cross members (dark strip so the box looks raised off the ground)
  p.box(dark, L - 0.4, 0.1, CW - 0.3, 0, 0.05, 0, { receive: false });

  // door end (+X): frame, seam, locking rods, handles
  const ex = hl + 0.012;
  if (!open) {
    p.box(dark, 0.03, CH - 0.2, 0.03, ex, CH / 2, 0); // centre seam
    for (const sz of [-1, 1]) {
      p.box(dark, 0.03, CH - 0.2, 0.04, ex, CH / 2, sz * (hw - 0.06));
      for (const off of [0.34, 0.86]) {
        p.box(steel, 0.05, CH - 0.32, 0.05, ex + 0.012, CH / 2, sz * off);
        p.box(dark, 0.07, 0.1, 0.09, ex + 0.02, CH - 0.5, sz * off);
      }
      p.box(steel, 0.09, 0.05, 0.22, ex + 0.05, 1.15, sz * 0.62); // handle
    }
    p.box(dark, 0.03, 0.06, CW - 0.2, ex, 0.16, 0);
    p.box(dark, 0.03, 0.06, CW - 0.2, ex, CH - 0.16, 0);
  }

  // markings
  const line = LINES[seed % LINES.length]!;
  const lightSkin = color === 'white' || color === 'yellow';
  const ink = lightSkin ? '#1c1f22' : '#e4e0d2';
  const nameMat = stencil(mats, line.name, { color: ink, font: 'stencil', aspect: 7, worn: true });
  const idText = `${line.code} ${ID_POOL[(seed >> 3) % ID_POOL.length]}`;
  const idMat = stencil(mats, idText, { color: ink, font: 'mono', aspect: 9, worn: true });
  const nameX = -hl * 0.32 + ((seed % 7) - 3) * 0.12;
  for (const s of [1, -1]) {
    const ry = s > 0 ? 0 : Math.PI;
    p.plane(nameMat, 3.5, 0.5, s * nameX, CH - 0.55, s * (hw + 0.004), { ry, cast: false });
    p.plane(idMat, 1.35, 0.15, s * (hl - 1.0), CH - 0.4, s * (hw + 0.004), { ry, cast: false });
  }
  p.flush(b);
}

// ---------------------------------------------------------------------------------------------
// drums
// ---------------------------------------------------------------------------------------------

let barrelGeoCache: THREE.BufferGeometry | null = null;
function barrelGeo(): THREE.BufferGeometry {
  if (barrelGeoCache) return barrelGeoCache;
  const prof: [number, number][] = [
    [0.0, 0.0],
    [0.26, 0.0],
    [0.285, 0.02],
    [0.29, 0.04],
    [0.29, 0.26],
    [0.305, 0.28],
    [0.29, 0.3],
    [0.29, 0.58],
    [0.305, 0.6],
    [0.29, 0.62],
    [0.29, 0.84],
    [0.285, 0.87],
    [0.27, 0.88],
    [0.25, 0.87],
    [0.0, 0.87],
  ];
  const pts = prof.map(([r, y]) => new THREE.Vector2(r, y - 0.44));
  barrelGeoCache = new THREE.LatheGeometry(pts, 12);
  return barrelGeoCache;
}

const BARREL_MAT: Record<BarrelColor, string> = {
  blue: 'barrelBlue',
  red: 'barrelRed',
  green: 'barrelGreen',
  yellow: 'barrelYellow',
  bio: 'barrelBio',
  rust: 'barrelRust',
};

function placeBarrel(b: LevelBuilder, color: BarrelColor, x: number, y: number, z: number, yaw: number, fallen: boolean): void {
  const set = b.instanced(`barrel:${color}`, barrelGeo(), b.mats.get(BARREL_MAT[color] as never));
  if (!fallen) {
    set.add(x, y + 0.44, z, yaw);
  } else {
    const m = new THREE.Matrix4().makeRotationY(yaw).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2));
    m.setPosition(x, y + 0.3, z);
    set.addMatrix(m);
  }
}

/** 200 L drum, 0.58 m wide x 0.88 m tall (instanced). Standing drums have a small box collider. */
export function barrel(b: LevelBuilder, o: Place & { color?: BarrelColor; fallen?: boolean }): void {
  const color = o.color ?? 'blue';
  const base = o.y ?? 0;
  placeBarrel(b, color, o.x, base, o.z, o.rot ?? 0, !!o.fallen);
  if (!o.fallen) {
    b.collide({ x: o.x, z: o.z, hx: 0.26, hz: 0.26, y0: base, y1: base + 0.88, surface: 'metal', mapKind: 'prop', tag: 'barrel' });
  } else {
    collideLocal(b, o, 0, 0, 0.88, 0.58, 0.58, { surface: 'metal', mapKind: 'prop', tag: 'barrel' });
  }
}

/** Scatter of drums (some fallen) inside `radius`, no overlaps. */
export function barrelGroup(b: LevelBuilder, o: Place & { count: number; radius: number; seed?: number; colors?: BarrelColor[] }): void {
  const rng = rngFor(o, 21);
  const colors: BarrelColor[] = o.colors && o.colors.length > 0 ? o.colors : ['blue', 'red', 'green', 'yellow', 'rust'];
  const placed: { x: number; z: number; r: number }[] = [];
  let tries = 0;
  while (placed.length < o.count && tries++ < o.count * 40) {
    const a = rng.range(0, TAU);
    const d = Math.sqrt(rng.f()) * o.radius;
    const x = o.x + Math.cos(a) * d;
    const z = o.z + Math.sin(a) * d;
    const fallen = rng.chance(0.22);
    const r = fallen ? 0.6 : 0.34;
    if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + r + 0.03)) continue;
    placed.push({ x, z, r });
    barrel(b, { x, z, y: o.y, rot: rng.range(0, TAU), color: rng.pick(colors), fallen });
  }
}

// ---------------------------------------------------------------------------------------------
// crates
// ---------------------------------------------------------------------------------------------

const crateGeoCache = new Map<string, THREE.BufferGeometry>();
function crateGeo(kind: 'wood' | 'mil'): THREE.BufferGeometry {
  const hit = crateGeoCache.get(kind);
  if (hit) return hit;
  const g = new GeoBuilder();
  if (kind === 'wood') {
    g.box(0.94, 0.94, 0.94, 0, 0, 0);
    for (const y of [-0.46, 0.46]) for (const z of [-0.46, 0.46]) g.box(1.0, 0.08, 0.08, 0, y, z);
    for (const x of [-0.46, 0.46]) for (const z of [-0.46, 0.46]) g.box(0.08, 1.0, 0.08, x, 0, z);
    for (const x of [-0.46, 0.46]) for (const y of [-0.46, 0.46]) g.box(0.08, 0.08, 1.0, x, y, 0);
    const brace = 1.28;
    for (const s of [-1, 1]) {
      g.box(0.07, brace, 0.03, 0, 0, s * 0.48, { rz: Math.PI / 4 });
      g.box(0.03, brace, 0.07, s * 0.48, 0, 0, { rx: Math.PI / 4 });
    }
  } else {
    g.box(0.96, 0.96, 0.96, 0, 0, 0);
    g.box(1.0, 0.07, 1.0, 0, 0.45, 0);
    g.box(1.0, 0.07, 1.0, 0, -0.45, 0);
    for (const s of [-1, 1]) {
      g.box(0.05, 0.28, 0.4, s * 0.49, 0.02, 0); // side rope handles
      g.box(0.1, 0.06, 0.12, 0.2, 0.3, s * 0.49); // latches
      g.box(0.1, 0.06, 0.12, -0.2, 0.3, s * 0.49);
      g.box(0.06, 0.96, 0.08, s * 0.3, 0, 0.49);
      g.box(0.06, 0.96, 0.08, s * 0.3, 0, -0.49);
    }
  }
  const geo = g.build();
  crateGeoCache.set(kind, geo);
  return geo;
}

/** Crate. `size` 0.5-1.3 m cube-ish. `stack` levels tall. */
export function crate(b: LevelBuilder, o: Place & { size?: number; kind?: 'wood' | 'mil'; stack?: number; seed?: number }): void {
  const size = o.size ?? 0.9;
  const kind = o.kind ?? 'wood';
  const levels = Math.max(1, Math.floor(o.stack ?? 1));
  const rng = rngFor(o, 31);
  const mat = b.mats.get(kind === 'wood' ? 'crateWood' : 'crateMil');
  const set = b.instanced(`crate:${kind}`, crateGeo(kind), mat);
  const base = o.y ?? 0;
  for (let i = 0; i < levels; i++) {
    const j = i === 0 ? 0 : 0.05;
    set.add(o.x + rng.range(-j, j), base + size * (i + 0.5), o.z + rng.range(-j, j), (o.rot ?? 0) + (i === 0 ? 0 : rng.range(-0.18, 0.18)), size);
  }
  b.collide({
    x: o.x,
    z: o.z,
    hx: size / 2,
    hz: size / 2,
    rot: o.rot ?? 0,
    y0: base,
    y1: base + size * levels,
    surface: 'wood',
    mapKind: 'prop',
    tag: 'crate',
  });
}

/** Scattered / stacked crates inside `radius`. Sizes are either clearly hop-over (<= 0.9 m) or clearly not (>= 1.3 m). */
export function crateGroup(b: LevelBuilder, o: Place & { count: number; radius: number; kind?: 'wood' | 'mil'; seed?: number }): void {
  const rng = rngFor(o, 41);
  const placed: { x: number; z: number; r: number }[] = [];
  let tries = 0;
  while (placed.length < o.count && tries++ < o.count * 40) {
    const a = rng.range(0, TAU);
    const d = Math.sqrt(rng.f()) * o.radius;
    const x = o.x + Math.cos(a) * d;
    const z = o.z + Math.sin(a) * d;
    const tall = rng.chance(0.3);
    const size = tall ? rng.pick([0.7, 0.75]) : rng.range(0.55, 0.9);
    const stack = tall ? 2 : 1;
    const r = size * 0.75;
    if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + r)) continue;
    placed.push({ x, z, r });
    crate(b, { x, z, y: o.y, rot: rng.range(0, TAU), size, stack, kind: o.kind ?? (rng.chance(0.35) ? 'mil' : 'wood'), seed: rng.int(0, 99999) });
  }
}

// ---------------------------------------------------------------------------------------------
// pallets
// ---------------------------------------------------------------------------------------------

let palletGeoCache: THREE.BufferGeometry | null = null;
function palletGeo(): THREE.BufferGeometry {
  if (palletGeoCache) return palletGeoCache;
  const g = new GeoBuilder();
  for (let i = 0; i < 7; i++) g.box(1.2, 0.022, 0.1, 0, 0.133, -0.45 + i * 0.15);
  for (const x of [-0.55, 0, 0.55]) g.box(0.1, 0.09, 1.0, x, 0.077, 0);
  for (const z of [-0.45, 0, 0.45]) g.box(1.2, 0.022, 0.1, 0, 0.011, z);
  palletGeoCache = g.build();
  return palletGeoCache;
}

let sackGeoCache: THREE.BufferGeometry | null = null;
function sackGeo(): THREE.BufferGeometry {
  if (sackGeoCache) return sackGeoCache;
  const g = new THREE.SphereGeometry(1, 9, 6);
  const pos = g.attributes.position!;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    pos.setXYZ(i, Math.sign(x) * Math.pow(Math.abs(x), 0.7) * 0.3, Math.sign(y) * Math.pow(Math.abs(y), 0.7) * 0.1, Math.sign(z) * Math.pow(Math.abs(z), 0.7) * 0.2);
  }
  g.computeVertexNormals();
  sackGeoCache = g;
  return g;
}

/** 1.2 x 1.0 m pallet, optionally loaded (goods make it up to ~1.4 m tall and solid). */
export function pallet(b: LevelBuilder, o: Place & { goods?: 'none' | 'boxes' | 'wrapped' | 'sacks' | 'barrels'; seed?: number }): void {
  const goods = o.goods ?? 'none';
  const rng = rngFor(o, 51);
  const base = o.y ?? 0;
  const rot = o.rot ?? 0;
  b.instanced('pallet', palletGeo(), b.mats.get('pallet')).add(o.x, base, o.z, rot);
  if (goods === 'none') return;
  const place: Place = { x: o.x, z: o.z, y: base + 0.144, rot };
  let height = 0.144;
  if (goods === 'boxes' || goods === 'wrapped') {
    const p = new Parts(place);
    const card = b.mats.get('cardboard');
    const layers = 3;
    for (let l = 0; l < layers; l++) {
      for (let i = 0; i < 2; i++) {
        for (let k = 0; k < 2; k++) {
          const w = 0.56 + rng.range(-0.03, 0.02);
          const d = 0.46 + rng.range(-0.03, 0.02);
          p.box(card, w, 0.4, d, -0.3 + i * 0.6 + rng.range(-0.01, 0.01), 0.2 + l * 0.4, -0.25 + k * 0.5 + rng.range(-0.01, 0.01), {
            ry: rng.range(-0.04, 0.04),
            worldUV: false, // printed text must not be mirrored by the world-space projection
          });
        }
      }
    }
    height += layers * 0.4;
    if (goods === 'wrapped') {
      const wrap = cachedMat(
        'stretchWrap',
        () => new THREE.MeshStandardMaterial({ color: 0xc9d4da, roughness: 0.25, metalness: 0.0, transparent: true, opacity: 0.32, depthWrite: false }),
      );
      p.box(wrap, 1.24, layers * 0.4 + 0.02, 1.04, 0, (layers * 0.4) / 2, 0, { cast: false });
    }
    p.flush(b);
  } else if (goods === 'sacks') {
    const mat = b.mats.get('canvasTan');
    const set = b.instanced('sack', sackGeo(), mat);
    const layers = 4;
    for (let l = 0; l < layers; l++) {
      for (let i = 0; i < 2; i++) {
        for (let k = 0; k < 2; k++) {
          const p = toWorld({ x: o.x, z: o.z, rot }, -0.3 + i * 0.6 + (l % 2) * 0.05, -0.25 + k * 0.5);
          set.add(p.x, base + 0.144 + 0.1 + l * 0.2, p.z, rot + (l % 2 ? Math.PI / 2 : 0) * 0 + rng.range(-0.15, 0.15));
        }
      }
    }
    height += layers * 0.2;
  } else {
    for (let i = 0; i < 2; i++) {
      for (let k = 0; k < 2; k++) {
        const p = toWorld({ x: o.x, z: o.z, rot }, -0.3 + i * 0.6, -0.25 + k * 0.5);
        placeBarrel(b, rng.pick(['blue', 'green', 'rust', 'red'] as BarrelColor[]), p.x, base + 0.144, p.z, rng.range(0, TAU), false);
      }
    }
    height += 0.88;
  }
  collideLocal(b, { x: o.x, z: o.z, rot, y: base }, 0, 0, 1.2, 1.0, height, { surface: goods === 'barrels' ? 'metal' : 'wood', mapKind: 'prop', tag: 'pallet' });
}

// ---------------------------------------------------------------------------------------------
// dumpster
// ---------------------------------------------------------------------------------------------

/** 1.9 x 1.2 x 1.4 m steel dumpster. */
export function dumpster(b: LevelBuilder, o: Place & { color?: 'green' | 'blue' | 'rust'; lidOpen?: boolean }): void {
  const rng = rngFor(o, 61);
  const color = o.color ?? 'green';
  const skin = b.mats.get(color === 'green' ? 'containerGreen' : color === 'blue' ? 'containerBlue' : 'containerRust');
  const dark = b.mats.get('steelDark');
  const lidMat = plainMat(0x1d2124, 0.65, 0.2);
  const p = new Parts(o);
  // body (slightly flared), rim, ribs
  p.bevelBox(skin, 1.9, 1.02, 1.1, 0.03, 0, 0.62, 0);
  p.box(skin, 1.9, 0.5, 1.2, 0, 1.1, 0, { worldUV: true });
  p.box(dark, 1.94, 0.06, 1.24, 0, 1.36, 0);
  p.box(dark, 1.94, 0.08, 1.14, 0, 0.14, 0);
  for (const s of [-1, 1]) {
    p.box(dark, 0.07, 0.12, 0.5, s * 0.5, 0.42, 0.62); // fork pockets
    p.box(dark, 0.07, 0.12, 0.5, s * 0.5, 0.42, -0.62);
    p.cyl(dark, 0.09, 0.09, 0.06, 8, s * 0.72, 0.09, 0.4, 'z');
    p.cyl(dark, 0.09, 0.09, 0.06, 8, s * 0.72, 0.09, -0.4, 'z');
  }
  p.box(dark, 1.7, 0.05, 0.05, 0, 0.9, 0.62); // front bar
  // lids
  const lidW = 0.95;
  if (!o.lidOpen) {
    p.box(lidMat, lidW, 0.05, 1.28, -0.5, 1.42, 0, { rz: 0.04 });
    p.box(lidMat, lidW, 0.05, 1.28, 0.5, 1.42, 0, { rz: -0.04 });
  } else {
    p.box(lidMat, lidW, 0.05, 1.28, -0.5, 1.42, 0, { rz: 0.04 });
    p.box(lidMat, lidW, 0.05, 1.28, 0.95, 1.9, 0, { rz: -Math.PI / 2 + 0.25 + rng.range(-0.05, 0.05) });
  }
  p.flush(b);
  collideLocal(b, o, 0, 0, 1.9, 1.2, 1.38, { surface: 'metal', mapKind: 'prop', tag: 'dumpster' });
}
