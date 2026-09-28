/**
 * Interior furnishing kit (contract + implementation). Same conventions as `props.ts`.
 * Interiors are lit mostly by fixtures registered through `ceilingLight` / `emergencyLight` (b.light) and by emissive
 * screens/tanks, so failed and flickering lights create tension. Everything here sits INSIDE buildings whose walls,
 * floor and roof are built by the level layout; `y` defaults to 0 (floor level). Interior meshes do not cast shadows
 * (interior lamps are unshadowed), so the kit adds nothing to the shadow pass.
 *
 * Front / operating side: shelves, counters, fridges, server racks and lockers face local +Z; the cage door is on local +X;
 * the desk chair sits on the local +Z side.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { lampIntensityMul } from '../render/lightPool';
import type { LampSpec, LevelBuilder } from './builder';
import { monitorTexture, serverFrontTexture, signMaterial } from './landmarks/tex';
import { Assembly, Rng, cached, cylGeo, emissiveMat, glowSprite, seedFrom, unitBox } from './landmarks/util';
import type { Place } from './props';

// ---------------------------------------------------------------------------------------------
// shared helpers / materials
// ---------------------------------------------------------------------------------------------

const solid = (key: string, hex: number, rough = 0.7, metal = 0.1): THREE.MeshStandardMaterial =>
  cached(key, () => new THREE.MeshStandardMaterial({ color: hex, roughness: rough, metalness: metal }));

const mk = (o: Place): Assembly => new Assembly(o.x, o.y ?? 0, o.z, o.rot ?? 0, { cast: false });

const GOODS = { red: 0x9a3a2e, blue: 0x2f5c8c, yellow: 0xc7a23a, green: 0x3f7a4a, white: 0xcfcbbd, orange: 0xc4682c } as const;
type GoodsColor = keyof typeof GOODS;
const GOOD_COLORS = Object.keys(GOODS) as GoodsColor[];

function goodsSet(b: LevelBuilder, kind: 'box' | 'can' | 'bottle' | 'label', color: GoodsColor | 'glass') {
  const key = `goods:${kind}:${color}`;
  if (kind === 'box' || kind === 'label') {
    const mat = kind === 'label' ? solid('goods:labelMat', 0xe7e3d2, 0.6, 0) : solid(key, GOODS[color as GoodsColor], 0.72, 0.05);
    return b.instanced(key, unitBox(), mat, { cast: false });
  }
  const mat =
    color === 'glass'
      ? cached('goods:glassBottle', () => new THREE.MeshStandardMaterial({ color: 0x4a7a5a, roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.8 }))
      : solid(key, GOODS[color], kind === 'can' ? 0.35 : 0.5, kind === 'can' ? 0.7 : 0.1);
  return b.instanced(key, cylGeo(1, 1, 1, 8), mat, { cast: false });
}

/** Adds one upright item at local (lx, ly, lz) of the assembly. */
function putItem(b: LevelBuilder, asm: Assembly, kind: 'box' | 'can' | 'bottle', color: GoodsColor | 'glass', lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, yaw: number): void {
  const p = asm.world(lx, lz);
  const set = goodsSet(b, kind, color);
  set.add(p.x, asm.y + ly + sy / 2, p.z, asm.rot + yaw, sx, sy, sz);
  if (kind === 'box') {
    // a paler label band on the front (+Z local) face
    const q = asm.world(lx + Math.sin(yaw) * (sz / 2 + 0.003), lz + Math.cos(yaw) * (sz / 2 + 0.003));
    goodsSet(b, 'label', 'white').add(q.x, asm.y + ly + sy * 0.55, q.z, asm.rot + yaw, sx * 0.9, sy * 0.36, 0.004);
  }
}

/** Fills one shelf board (top at `ly`) along local X with runs of products. */
function stockBoard(b: LevelBuilder, asm: Assembly, rng: Rng, length: number, ly: number, lz: number, fill: number, tall: boolean): void {
  let x = -length / 2 + 0.1;
  const end = length / 2 - 0.1;
  while (x < end) {
    if (!rng.chance(fill)) {
      x += rng.range(0.12, 0.34);
      continue;
    }
    const kind = rng.pick(['box', 'box', 'can', 'bottle'] as const);
    const color: GoodsColor = rng.pick(GOOD_COLORS);
    const run = rng.int(2, 6);
    for (let i = 0; i < run && x < end; i++) {
      if (kind === 'box') {
        const w = rng.range(0.13, 0.2);
        const h = tall ? rng.range(0.22, 0.3) : rng.range(0.14, 0.24);
        const d = rng.range(0.09, 0.13);
        putItem(b, asm, 'box', color, x + w / 2, ly, lz, w, h, d, rng.range(-0.06, 0.06));
        x += w + 0.008;
      } else if (kind === 'can') {
        putItem(b, asm, 'can', rng.pick(['red', 'green', 'white', 'blue'] as const), x + 0.04, ly, lz, 0.04, 0.115, 0.04, 0);
        x += 0.085;
      } else {
        putItem(b, asm, 'bottle', 'glass', x + 0.035, ly, lz, 0.033, 0.25, 0.033, 0);
        x += 0.075;
      }
    }
  }
}

function fallenItems(b: LevelBuilder, asm: Assembly, rng: Rng, length: number, count: number): void {
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  for (let i = 0; i < count; i++) {
    const lx = rng.range(-length / 2, length / 2);
    const lz = rng.range(0.32, 0.9);
    const p = asm.world(lx, lz);
    const kind = rng.pick(['box', 'can'] as const);
    const color: GoodsColor = rng.pick(GOOD_COLORS);
    const set = goodsSet(b, kind, color);
    const s = kind === 'box' ? new THREE.Vector3(rng.range(0.13, 0.2), rng.range(0.15, 0.22), rng.range(0.09, 0.12)) : new THREE.Vector3(0.04, 0.115, 0.04);
    e.set(kind === 'box' ? rng.range(-0.4, 0.4) : Math.PI / 2, rng.range(0, 6.28), kind === 'box' ? rng.range(-0.3, 0.3) : 0, 'YXZ');
    q.setFromEuler(e);
    const m4 = new THREE.Matrix4().compose(new THREE.Vector3(p.x, asm.y + (kind === 'box' ? s.y / 2 : 0.04), p.z), q, s);
    set.addMatrix(m4);
  }
}

/** Ticks a dynamic emissive material so it follows the same flicker/fail curve as the pooled lamp. */
function followLamp(b: LevelBuilder, mat: THREE.MeshStandardMaterial, spec: LampSpec, base: number, sprite?: THREE.Sprite, spriteBase = 0.6): void {
  b.tick((_dt, time) => {
    const k = lampIntensityMul(spec, time);
    mat.emissiveIntensity = base * k;
    if (sprite) sprite.material.opacity = spriteBase * k;
  });
}

// ---------------------------------------------------------------------------------------------
// Retail
// ---------------------------------------------------------------------------------------------

/** Retail gondola shelf 0.5 m deep, 1.7 m tall; `stocked` fills the boards (else sparse, ransacked). Collider box. */
export function storeShelf(b: LevelBuilder, o: Place & { length?: number; stocked?: boolean; seed?: number }): void {
  const length = o.length ?? 2.4;
  const rng = new Rng(o.seed ?? seedFrom(o.x, o.z, 3));
  const asm = mk(o);
  const frame = solid('store:shelfFrame', 0x848c94, 0.55, 0.2);
  const board = solid('store:shelfBoard', 0x9c9888, 0.6, 0.2);
  const back = solid('store:shelfBack', 0x7d786a, 0.85, 0.05);
  const tag = solid('store:priceStrip', 0xd9d4bd, 0.6, 0);
  asm.box(frame, 0.04, 1.72, 0.5, -length / 2 + 0.02, 0.86, 0);
  asm.box(frame, 0.04, 1.72, 0.5, length / 2 - 0.02, 0.86, 0);
  asm.box(back, length - 0.08, 1.62, 0.02, 0, 0.93, -0.24);
  asm.box(frame, length - 0.08, 0.11, 0.46, 0, 0.055, 0);
  const levels = [0.16, 0.52, 0.88, 1.24, 1.6];
  for (const y of levels) {
    asm.box(board, length - 0.08, 0.025, 0.46, 0, y, 0);
    asm.box(tag, length - 0.1, 0.04, 0.012, 0, y - 0.004, 0.235);
  }
  asm.box(frame, length, 0.04, 0.52, 0, 1.74, 0);
  const fill = o.stocked === false ? 0.22 : 0.84;
  for (const y of levels) {
    stockBoard(b, asm, rng, length, y + 0.0125, 0.1, fill, y > 1.3);
    stockBoard(b, asm, rng, length, y + 0.0125, -0.1, fill * 0.9, true);
  }
  fallenItems(b, asm, rng, length, o.stocked === false ? 5 : 3);
  asm.collide(b, 0, 0, length, 0.54, 1.75, { mapKind: 'prop', surface: 'metal', tag: 'store-shelf' });
  asm.commit(b, { cast: false });
}

/** Checkout / service counter (1.05 m tall) with till, conveyor and a lit sign; `length` m. */
export function checkoutCounter(b: LevelBuilder, o: Place & { length?: number }): void {
  const L = o.length ?? 2.2;
  const asm = mk(o);
  const body = solid('store:counterBody', 0x7c8a82, 0.6, 0.1);
  const top = solid('store:counterTop', 0x2a3034, 0.35, 0.2);
  const dark = solid('store:counterDark', 0x1a1e21, 0.7, 0.3);
  const rubber = b.mats.get('rubber');
  asm.box(dark, L, 0.12, 0.7, 0, 0.06, 0);
  asm.box(body, L, 0.86, 0.66, 0, 0.55, 0);
  asm.box(top, L + 0.06, 0.05, 0.76, 0, 1.005, 0);
  // panel seams
  for (let i = 1; i < Math.round(L / 0.55); i++) asm.box(dark, 0.012, 0.8, 0.005, -L / 2 + i * 0.55, 0.55, 0.334);
  // conveyor belt
  asm.box(rubber, L * 0.55, 0.025, 0.36, -L * 0.18, 1.045, -0.05);
  asm.box(dark, L * 0.55 + 0.04, 0.035, 0.04, -L * 0.18, 1.045, 0.15);
  asm.box(dark, L * 0.55 + 0.04, 0.035, 0.04, -L * 0.18, 1.045, -0.25);
  // till + card reader + scanner
  asm.box(dark, 0.42, 0.24, 0.4, L * 0.32, 1.15, 0.0);
  asm.box(solid('store:till', 0x243038, 0.4, 0.3), 0.36, 0.02, 0.28, L * 0.32, 1.275, 0.0, { rz: 0.0 });
  asm.box(cached('store:tillScreen', () => emissiveMat(0x5ad0ff, 0.35, 0x061014)), 0.22, 0.14, 0.02, L * 0.32, 1.34, -0.12, { rx: -0.35 });
  asm.box(dark, 0.12, 0.05, 0.1, L * 0.32 + 0.3, 1.05, 0.12);
  asm.box(dark, 0.16, 0.04, 0.08, L * 0.32 - 0.34, 1.06, 0.1);
  // bag holder + lit sign on a stand at the far end
  asm.box(solid('store:steel', 0x8a9298, 0.45, 0.3), 0.04, 0.3, 0.04, L * 0.5 - 0.05, 1.2, -0.28);
  const signMat = signMaterial(['OPEN'], { bg: '#10151a', fg: '#ff9a3c', border: '#ff9a3c', aspect: 2.2, emissive: true, worn: false });
  const sign = asm.box(signMat, 0.46, 0.21, 0.03, -L * 0.42, 1.24, 0.28, { rx: -0.1 });
  sign.userData.worldUV = false;
  asm.box(dark, 0.04, 0.2, 0.04, -L * 0.42, 1.12, 0.28);
  asm.collide(b, 0, 0, L, 0.78, 1.1, { mapKind: 'prop', surface: 'wood', tag: 'checkout' });
  asm.commit(b, { cast: false });
  const p = asm.world(-L * 0.42, 0.4);
  b.light({ x: p.x, y: asm.y + 1.3, z: p.z, color: 0xff9a3c, intensity: 5, distance: 3, weight: 0.4, tag: 'sign' });
}

/** Glass-front refrigerated cooler with cold-white emissive interior (flickering, registers a weak lamp). */
export function fridgeCase(b: LevelBuilder, o: Place & { length?: number }): void {
  const L = o.length ?? 2;
  const rng = new Rng(seedFrom(o.x, o.z, 17));
  const asm = mk(o);
  const steel = solid('fridge:steel', 0x8e969d, 0.5, 0.25);
  const dark = solid('fridge:dark', 0x14181b, 0.6, 0.3);
  const glass = cached('fridge:glass', () => new THREE.MeshStandardMaterial({ color: 0x9fc0d4, roughness: 0.08, metalness: 0.05, transparent: true, opacity: 0.16, depthWrite: false }));
  const D = 0.8;
  const H = 2.0;
  asm.box(dark, L, 0.16, D, 0, 0.08, 0);
  asm.box(steel, L, H - 0.16, 0.06, 0, (H + 0.16) / 2, -D / 2 + 0.03);
  asm.box(steel, 0.06, H - 0.16, D, -L / 2 + 0.03, (H + 0.16) / 2, 0);
  asm.box(steel, 0.06, H - 0.16, D, L / 2 - 0.03, (H + 0.16) / 2, 0);
  asm.box(steel, L, 0.06, D, 0, H - 0.03, 0);
  // header with lit label
  const head = asm.box(signMaterial(['COLD DRINKS'], { bg: '#0d2a3d', fg: '#dff4ff', border: '#7fc4e8', aspect: 6, emissive: true, worn: false }), Math.min(L - 0.2, 1.6), 0.24, 0.02, 0, H - 0.18, D / 2 + 0.005);
  head.userData.worldUV = false;
  // interior back panel (dynamic emissive follows the flicker lamp)
  const panelMat = emissiveMat(0xcfe8ff, 1.4, 0x0d1216);
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(L - 0.16, H - 0.5), panelMat);
  panel.position.set(0, (H + 0.14) / 2, -D / 2 + 0.07);
  // shelves + bottles
  for (const y of [0.42, 0.85, 1.28, 1.7]) {
    asm.box(cached('fridge:shelf', () => new THREE.MeshStandardMaterial({ color: 0xbfd0d8, roughness: 0.15, transparent: true, opacity: 0.5, depthWrite: false })), L - 0.14, 0.015, D - 0.2, 0, y, 0.02);
    for (const z of [-0.14, 0.06]) stockBoard(b, asm, rng, L - 0.1, y + 0.008, z, 0.75, false);
  }
  // glass doors with vertical handles
  const nDoors = Math.max(1, Math.round(L / 0.95));
  const dw = (L - 0.12) / nDoors;
  for (let i = 0; i < nDoors; i++) {
    const cx = -L / 2 + 0.06 + dw * (i + 0.5);
    asm.box(glass, dw - 0.02, H - 0.42, 0.03, cx, (H + 0.22) / 2 - 0.02, D / 2 - 0.05, { cast: false });
    asm.box(dark, dw, 0.05, 0.05, cx, 0.2, D / 2 - 0.04);
    asm.box(dark, dw, 0.05, 0.05, cx, H - 0.24, D / 2 - 0.04);
    asm.box(steel, 0.025, 0.7, 0.04, cx + dw / 2 - 0.09, 1.05, D / 2 + 0.01);
  }
  asm.collide(b, 0, 0, L, D, 1.95, { mapKind: 'prop', surface: 'metal', tag: 'fridge' });
  asm.commit(b, { cast: false });
  // dynamic panel + lamp
  const wp = asm.world(0, 0);
  const holder = new THREE.Group();
  holder.position.set(wp.x, asm.y, wp.z);
  holder.rotation.y = asm.rot;
  holder.add(panel);
  b.addDynamic(holder);
  const lp = asm.world(0, 0.35);
  const lamp: LampSpec = { x: lp.x, y: asm.y + 1.7, z: lp.z, color: 0xcfe4ff, intensity: 12, distance: 5.5, mode: 'flicker', phase: rng.range(0, 20), weight: 0.6, tag: 'fridge' };
  b.light(lamp);
  followLamp(b, panelMat, lamp, 1.5);
}

/** Simple office desk (1.6 x 0.75 m) with monitor, keyboard, papers, phone; optional swivel chair on the +Z side. */
export function officeDesk(b: LevelBuilder, o: Place & { chair?: boolean }): void {
  const rng = new Rng(seedFrom(o.x, o.z, 21));
  const asm = mk(o);
  const wood = solid('office:wood', 0x6b5238, 0.7, 0.05);
  const dark = solid('office:dark', 0x1c2024, 0.5, 0.3);
  const paper = solid('office:paper', 0xd9d5c4, 0.9, 0);
  const screenMat = cached('office:screen', () => emissiveMat(0x2a5a4a, 0.12, 0x040807));
  asm.box(wood, 1.6, 0.05, 0.75, 0, 0.74, 0);
  asm.box(wood, 0.04, 0.72, 0.7, -0.76, 0.36, 0);
  asm.box(wood, 0.5, 0.72, 0.7, 0.55, 0.36, 0);
  asm.box(wood, 1.1, 0.5, 0.03, -0.2, 0.5, -0.33);
  for (let i = 0; i < 3; i++) {
    asm.box(solid('office:drawer', 0x594430, 0.6, 0.1), 0.44, 0.19, 0.02, 0.55, 0.14 + i * 0.23, 0.36);
    asm.box(dark, 0.14, 0.02, 0.02, 0.55, 0.14 + i * 0.23 + 0.04, 0.38);
  }
  // monitor (dead), keyboard, mug, papers, phone
  asm.box(dark, 0.5, 0.32, 0.04, -0.3, 1.02, -0.18);
  asm.box(screenMat, 0.46, 0.27, 0.005, -0.3, 1.02, -0.155);
  asm.box(dark, 0.06, 0.16, 0.06, -0.3, 0.87, -0.18);
  asm.box(dark, 0.4, 0.02, 0.14, -0.3, 0.775, 0.1);
  asm.cyl(solid('office:mug', 0xb8b4a6, 0.5, 0.1), 0.045, 0.1, 0.25, 0.815, 0.05, 10);
  for (let i = 0; i < 4; i++) asm.box(paper, rng.range(0.18, 0.24), 0.004, rng.range(0.26, 0.3), 0.15 + rng.range(-0.05, 0.05), 0.768 + i * 0.004, 0.18 + rng.range(-0.05, 0.05), { ry: rng.range(-0.5, 0.5) });
  asm.box(dark, 0.18, 0.06, 0.2, 0.62, 0.8, -0.1, { ry: 0.3 });
  asm.collide(b, 0, 0, 1.6, 0.76, 0.8, { mapKind: 'prop', surface: 'wood', tag: 'desk' });
  if (o.chair) {
    const cx = rng.range(-0.3, 0.2);
    const cz = 0.95;
    const yaw = rng.range(-0.7, 0.7);
    const seat = solid('office:chairSeat', 0x2a3238, 0.85, 0.05);
    asm.box(seat, 0.48, 0.07, 0.46, cx, 0.5, cz, { ry: yaw });
    asm.box(seat, 0.46, 0.5, 0.06, cx + Math.sin(yaw) * 0.22, 0.78, cz + Math.cos(yaw) * 0.22, { ry: yaw, rx: 0.1 });
    asm.cyl(dark, 0.035, 0.32, cx, 0.32, cz, 8);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + yaw;
      asm.strut(dark, [cx, 0.17, cz], [cx + Math.cos(a) * 0.27, 0.07, cz + Math.sin(a) * 0.27], 0.035);
      asm.cyl(dark, 0.028, 0.04, cx + Math.cos(a) * 0.27, 0.04, cz + Math.sin(a) * 0.27, 6);
    }
  }
  asm.commit(b, { cast: false });
}

/** Row of steel lockers (0.4 x 0.5 x 1.9 m each), doors face +Z; some hang open. */
export function lockerRow(b: LevelBuilder, o: Place & { count?: number }): void {
  const n = o.count ?? 4;
  const rng = new Rng(seedFrom(o.x, o.z, 31));
  const asm = mk(o);
  const tint = rng.pick([0x7d8f84, 0x7a8796, 0x8a8c70]);
  const bodyMat = solid(`locker:body${tint}`, tint, 0.5, 0.3);
  const doorMat = solid(`locker:door${tint}`, new THREE.Color(tint).multiplyScalar(1.12).getHex(), 0.45, 0.3);
  const dark = solid('locker:dark', 0x0e1114, 0.8, 0.2);
  const w = 0.4;
  const total = n * w;
  asm.box(bodyMat, total, 1.9, 0.5, 0, 0.95, 0);
  asm.box(dark, total + 0.02, 0.1, 0.52, 0, 0.05, 0);
  asm.box(bodyMat, total + 0.02, 0.05, 0.52, 0, 1.925, 0);
  for (let i = 0; i < n; i++) {
    const cx = -total / 2 + w * (i + 0.5);
    const hinge = cx - w / 2 + 0.015;
    const open = rng.chance(0.3);
    const g = new THREE.Group();
    g.position.set(hinge, 0.97, 0.255);
    g.rotation.y = open ? -rng.range(0.7, 1.7) : 0;
    const door = new THREE.Mesh(unitBox(), doorMat);
    door.scale.set(w - 0.03, 1.78, 0.025);
    door.position.set((w - 0.03) / 2, 0, 0);
    g.add(door);
    for (let k = 0; k < 3; k++) {
      const v = new THREE.Mesh(unitBox(), dark);
      v.scale.set(0.22, 0.012, 0.03);
      v.position.set((w - 0.03) / 2, 0.68 + k * 0.045, 0.006);
      g.add(v);
    }
    const handle = new THREE.Mesh(unitBox(), solid('locker:handle', 0xa9b0b6, 0.35, 0.4));
    handle.scale.set(0.02, 0.1, 0.03);
    handle.position.set(w - 0.07, 0.05, 0.03);
    g.add(handle);
    asm.group.add(g);
    if (open) asm.box(dark, w - 0.05, 1.7, 0.02, cx, 0.95, 0.2);
  }
  asm.collide(b, 0, 0, total, 0.5, 1.95, { mapKind: 'prop', surface: 'metal', tag: 'lockers' });
  asm.commit(b, { cast: false });
}

// ---------------------------------------------------------------------------------------------
// Laboratory
// ---------------------------------------------------------------------------------------------

/** Lab bench with equipment/glassware; 0.95 m tall; `length` m. */
export function labBench(b: LevelBuilder, o: Place & { length?: number }): void {
  const L = o.length ?? 2.4;
  const rng = new Rng(seedFrom(o.x, o.z, 41));
  const asm = mk(o);
  const cab = b.mats.get('labPanel');
  const epoxy = solid('lab:epoxy', 0x161c20, 0.25, 0.25);
  const dark = solid('lab:dark', 0x0f1316, 0.7, 0.3);
  const steel = solid('lab:steel', 0x9aa3aa, 0.4, 0.35);
  const glassM = cached('lab:glass', () => new THREE.MeshStandardMaterial({ color: 0xbfe0e8, roughness: 0.05, metalness: 0.05, transparent: true, opacity: 0.32, depthWrite: false }));
  const liquidG = cached('lab:liquidG', () => emissiveMat(0x2bff70, 0.85, 0x04120a));
  const liquidB = cached('lab:liquidB', () => emissiveMat(0x3fa8ff, 0.8, 0x040c14));
  const liquidA = cached('lab:liquidA', () => emissiveMat(0xffa020, 0.8, 0x140c04));
  asm.box(dark, L, 0.1, 0.72, 0, 0.05, 0);
  asm.box(cab, L, 0.8, 0.7, 0, 0.5, 0);
  for (let i = 0; i < Math.round(L / 0.6); i++) {
    const cx = -L / 2 + 0.3 + i * 0.6;
    asm.box(dark, 0.012, 0.72, 0.006, cx + 0.3, 0.5, 0.352, { cast: false });
    asm.box(steel, 0.12, 0.02, 0.02, cx, 0.72, 0.36);
  }
  asm.box(epoxy, L + 0.04, 0.05, 0.8, 0, 0.925, 0);
  // equipment
  let x = -L / 2 + 0.3;
  let mi = 0;
  while (x < L / 2 - 0.25) {
    const kind = rng.int(0, 5);
    if (kind === 0) {
      // microscope
      asm.box(steel, 0.2, 0.03, 0.18, x, 0.965, 0.05);
      asm.box(steel, 0.05, 0.28, 0.05, x - 0.05, 1.1, -0.02, { rx: 0.1 });
      asm.box(dark, 0.06, 0.2, 0.06, x, 1.08, 0.09, { rx: 0.5 });
      asm.cyl(steel, 0.02, 0.1, x, 1.2, 0.13, 8, { rx: 0.5 });
      x += 0.42;
    } else if (kind === 1) {
      // monitor
      asm.box(dark, 0.42, 0.28, 0.03, x, 1.13, -0.16, { rx: -0.12 });
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.38, 0.235), monitorMat(mi++));
      scr.position.set(x, 1.135, -0.143);
      scr.rotation.x = -0.12;
      asm.group.add(scr);
      asm.box(dark, 0.05, 0.14, 0.05, x, 1.02, -0.18);
      asm.box(dark, 0.3, 0.015, 0.1, x, 0.955, 0.1);
      x += 0.55;
    } else if (kind === 2) {
      // flasks / beakers with glowing liquid
      for (let k = 0; k < 3; k++) {
        const r = rng.range(0.04, 0.07);
        const h = rng.range(0.1, 0.2);
        const lx = x + k * 0.13;
        asm.cyl(glassM, r, h, lx, 0.95 + h / 2, rng.range(-0.05, 0.12), 10, { cast: false });
        asm.cyl(rng.pick([liquidG, liquidB, liquidA]), r * 0.86, h * rng.range(0.4, 0.75), lx, 0.95 + h * 0.35, 0, 10, { cast: false });
      }
      x += 0.5;
    } else if (kind === 3) {
      // centrifuge
      asm.cyl(steel, 0.15, 0.16, x, 1.03, 0.0, 14);
      asm.cyl(dark, 0.14, 0.02, x, 1.12, 0, 14);
      asm.box(dark, 0.1, 0.03, 0.04, x + 0.14, 1.0, 0.1);
      x += 0.45;
    } else if (kind === 4) {
      // test tube rack
      asm.box(steel, 0.3, 0.02, 0.1, x, 0.96, 0.05);
      for (let k = 0; k < 6; k++) asm.cyl(rng.chance(0.5) ? liquidG : glassM, 0.014, 0.12, x - 0.12 + k * 0.048, 1.02, 0.05, 6, { cast: false });
      x += 0.42;
    } else {
      // petri dishes + spill
      for (let k = 0; k < 3; k++) asm.cyl(glassM, 0.055, 0.015, x + k * 0.13, 0.958, 0.1, 12, { cast: false });
      asm.cyl(liquidG, 0.09, 0.006, x + 0.35, 0.952, -0.1, 14, { cast: false });
      x += 0.55;
    }
  }
  asm.collide(b, 0, 0, L, 0.8, 0.96, { mapKind: 'prop', surface: 'metal', tag: 'lab-bench' });
  asm.commit(b, { cast: false });
}

const MONITORS: THREE.MeshStandardMaterial[] = [];
const monitorTickBound = new WeakSet<LevelBuilder>();
function monitorMat(i: number): THREE.MeshStandardMaterial {
  const v = i % 3;
  if (!MONITORS[v]) {
    const tex = monitorTexture(v);
    MONITORS[v] = new THREE.MeshStandardMaterial({ color: 0x0a0d0e, map: tex, emissiveMap: tex, emissive: new THREE.Color(0xffffff), emissiveIntensity: 0.9, roughness: 0.3, metalness: 0.1 });
  }
  return MONITORS[v]!;
}
/** Large cylindrical containment tank (default radius 0.9, height 2.8) with glowing fluid, pipes, pulsing lamp; `broken` = cracked, low, leaking. */
export function labTank(b: LevelBuilder, o: Place & { radius?: number; height?: number; glow?: 'green' | 'blue' | 'amber'; broken?: boolean }): void {
  const r = o.radius ?? 0.9;
  const h = o.height ?? 2.8;
  const broken = o.broken ?? false;
  const glow = o.glow ?? 'green';
  const hex = { green: 0x2bff70, blue: 0x3fa8ff, amber: 0xffa020 }[glow];
  const rng = new Rng(seedFrom(o.x, o.z, 51));
  const asm = mk(o);
  const steelDark = b.mats.get('steelDark');
  const steel = b.mats.get('steel');
  const rubber = b.mats.get('rubber');
  const glass = cached('lab:tankGlass', () => new THREE.MeshStandardMaterial({ color: 0xaadcd0, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }));
  const gy0 = 0.5;
  const gh = h - 0.82;
  asm.taper(steelDark, r + 0.24, r + 0.34, 0.34, 0, 0.17, 0, 24);
  asm.taper(steel, r + 0.12, r + 0.16, 0.16, 0, 0.42, 0, 24);
  asm.taper(steel, r + 0.14, r + 0.12, 0.16, 0, h - 0.32, 0, 24);
  asm.taper(steelDark, r + 0.08, r + 0.16, 0.24, 0, h - 0.12, 0, 24);
  // glass (a wedge is missing when broken)
  const glassGeo = new THREE.CylinderGeometry(r, r, gh, 28, 1, true, broken ? 1.3 : 0, broken ? 4.2 : Math.PI * 2);
  asm.mesh(glassGeo, glass, 0, gy0 + gh / 2, 0);
  // vertical frame ribs
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    asm.box(steel, 0.05, gh, 0.05, Math.cos(a) * (r + 0.02), gy0 + gh / 2, Math.sin(a) * (r + 0.02), { ry: -a, cast: false });
  }
  // pipes from the top cap and a control box + cables at the base
  asm.tube(steelDark, [0.35, h, 0], [0.35, h + 0.7, 0], 0.07, 8);
  asm.tube(steelDark, [-0.3, h, 0.2], [-0.3, h + 0.6, 0.2], 0.05, 8);
  asm.box(solid('lab:ctrlBox', 0x1c2226, 0.5, 0.4), 0.5, 0.4, 0.22, 0, 0.32, r + 0.42);
  for (let i = 0; i < 3; i++) asm.box(cached(`lab:led${i}`, () => emissiveMat([0x2bff70, 0xffa020, 0xff3a20][i]!, 1.6, 0x101010)), 0.06, 0.04, 0.02, -0.14 + i * 0.14, 0.4, r + 0.54, { cast: false });
  asm.tube(rubber, [0.1, 0.06, r + 0.42], [1.4, 0.05, r + 1.2], 0.04, 5, { cast: false });
  // fluid: translucent emissive, merged with bubbles
  const fluidTop = broken ? gy0 + gh * 0.42 : gy0 + gh - 0.06;
  const parts: THREE.BufferGeometry[] = [];
  const fg = new THREE.CylinderGeometry(r * 0.95, r * 0.95, fluidTop - gy0, 24, 1, false);
  fg.translate(0, (fluidTop + gy0) / 2, 0);
  parts.push(fg);
  const nb = broken ? 3 : 14;
  for (let i = 0; i < nb; i++) {
    const a = rng.range(0, Math.PI * 2);
    const rr = rng.range(0, r * 0.7);
    const s = new THREE.SphereGeometry(rng.range(0.025, 0.06), 8, 6);
    s.translate(Math.cos(a) * rr, rng.range(gy0 + 0.2, fluidTop - 0.1), Math.sin(a) * rr);
    parts.push(s);
  }
  const fluidGeo = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  const fluidMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(hex).multiplyScalar(0.15), emissive: new THREE.Color(hex), emissiveIntensity: broken ? 0.5 : 1.3, transparent: true, opacity: broken ? 0.4 : 0.62, depthWrite: false, roughness: 0.2 });
  const wp = asm.world(0, 0);
  const holder = new THREE.Group();
  holder.position.set(wp.x, asm.y, wp.z);
  holder.rotation.y = asm.rot;
  holder.add(new THREE.Mesh(fluidGeo, fluidMat));
  // a dark specimen suspended in the fluid (intact tanks): torso, head and limbs from primitives
  if (!broken) {
    const body = solid('lab:specimen', 0x0a0c0d, 0.9, 0);
    const sy = gy0 + gh * 0.52;
    const parts2: [THREE.BufferGeometry, number, number, number][] = [];
    const torso = new THREE.CapsuleGeometry(0.17, 0.45, 4, 8);
    torso.rotateZ(rng.range(-0.25, 0.25));
    parts2.push([torso, 0, sy, 0]);
    parts2.push([new THREE.SphereGeometry(0.14, 10, 8), 0.04, sy + 0.44, 0.02]);
    for (const s of [-1, 1]) {
      const arm = new THREE.CapsuleGeometry(0.05, 0.4, 3, 6);
      arm.rotateZ(s * rng.range(0.5, 1.1));
      parts2.push([arm, s * 0.26, sy + 0.12, 0.05]);
      const leg = new THREE.CapsuleGeometry(0.06, 0.45, 3, 6);
      leg.rotateZ(s * rng.range(0.05, 0.3));
      parts2.push([leg, s * 0.1, sy - 0.5, 0]);
    }
    const merged = mergeGeometries(
      parts2.map(([g, x, y, z]) => {
        g.translate(x, y, z);
        return g;
      }),
      false,
    )!;
    const mesh = new THREE.Mesh(merged, body);
    mesh.rotation.y = rng.range(0, 6);
    holder.add(mesh);
  } else {
    // leak puddle and glass shards
    const pm = cached(`lab:puddle${hex}`, () => new THREE.MeshStandardMaterial({ color: new THREE.Color(hex).multiplyScalar(0.12), emissive: new THREE.Color(hex), emissiveIntensity: 0.55, transparent: true, opacity: 0.75, roughness: 0.1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    const pud = new THREE.Mesh(new THREE.CircleGeometry(r * 1.6, 20), pm);
    pud.rotation.x = -Math.PI / 2;
    pud.position.set(r * 0.5, 0.02, r * 0.7);
    pud.scale.set(1.2, 0.8, 1);
    holder.add(pud);
    for (let i = 0; i < 9; i++) {
      const shard = new THREE.Mesh(unitBox(), glass);
      shard.scale.set(rng.range(0.06, 0.2), 0.012, rng.range(0.05, 0.14));
      shard.position.set(r * 0.5 + rng.range(-0.7, 0.9), 0.03, r * 0.8 + rng.range(-0.5, 0.8));
      shard.rotation.y = rng.range(0, 3);
      holder.add(shard);
    }
  }
  b.addDynamic(holder);
  asm.commit(b, { cast: false });

  const cp = asm.world(0, 0);
  const lamp: LampSpec = {
    x: cp.x,
    y: asm.y + h * 0.55,
    z: cp.z,
    color: hex,
    intensity: broken ? 55 : 105,
    distance: 9,
    mode: broken ? 'flicker' : 'pulse',
    period: 3.4 + rng.range(0, 1.6),
    phase: rng.range(0, 5),
    weight: 0.9,
    glow: r * 2.1,
    tag: 'lab-tank',
  };
  b.light(lamp);
  b.tick((_dt, time) => {
    const k = lampIntensityMul(lamp, time);
    fluidMat.emissiveIntensity = (broken ? 0.35 : 0.9) + (broken ? 0.4 : 0.8) * k;
  });
  const s = r * 1.7;
  asm.collide(b, 0, 0, s, s, h, { mapKind: 'tank', surface: 'metal', tag: 'lab-tank' });
  asm.collide(b, 0, 0, s, s, h, { rot: Math.PI / 4, mapKind: 'tank', surface: 'metal', tag: 'lab-tank' });
}

/** Specimen cage / holding cell (w x d, 2.4 m tall bars); door on the local +X face, `open` = door ajar. Bars block movement, not bullets. */
export function specimenCage(b: LevelBuilder, o: Place & { w?: number; d?: number; open?: boolean }): void {
  const w = o.w ?? 3;
  const d = o.d ?? 3;
  const rng = new Rng(seedFrom(o.x, o.z, 61));
  const asm = mk(o);
  const barMat = solid('cage:bar', 0x2a2f34, 0.55, 0.7);
  const frameMat = solid('cage:frame', 0x3b4249, 0.5, 0.7);
  const rust = b.mats.get('rust');
  const grating = b.mats.get('grating');
  const H = 2.4;
  const bars = b.instanced('cage:bars', unitBox(), barMat, { cast: false });
  const doorW = Math.min(1.75, d - 0.6);
  const doorHalf = doorW / 2;
  const addBar = (lx: number, lz: number) => {
    const p = asm.world(lx, lz);
    bars.add(p.x, asm.y + H / 2, p.z, asm.rot, 0.025, H - 0.1, 0.025);
  };
  const side = (x0: number, z0: number, x1: number, z1: number, skip?: (t: number) => boolean) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(2, Math.round(len / 0.13));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      if (skip?.(t)) continue;
      addBar(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t);
    }
  };
  // floor grating, corner posts, top/bottom/mid rails
  asm.box(grating, w, 0.05, d, 0, 0.03, 0);
  const hx = w / 2;
  const hz = d / 2;
  for (const [px, pz] of [
    [-hx, -hz],
    [hx, -hz],
    [hx, hz],
    [-hx, hz],
  ] as const) {
    asm.box(frameMat, 0.1, H, 0.1, px, H / 2, pz);
  }
  const rails = (x0: number, z0: number, x1: number, z1: number) => {
    for (const y of [0.12, 1.2, H - 0.05]) asm.strut(frameMat, [x0, y, z0], [x1, y, z1], 0.06, { cast: false });
  };
  rails(-hx, -hz, hx, -hz);
  rails(-hx, hz, hx, hz);
  rails(-hx, -hz, -hx, hz);
  // front (+X) rails leave the door opening
  for (const y of [0.12, 1.2]) {
    asm.strut(frameMat, [hx, y, -hz], [hx, y, -doorHalf], 0.06, { cast: false });
    asm.strut(frameMat, [hx, y, doorHalf], [hx, y, hz], 0.06, { cast: false });
  }
  asm.strut(frameMat, [hx, H - 0.05, -hz], [hx, H - 0.05, hz], 0.06, { cast: false });
  side(-hx, -hz, hx, -hz);
  side(-hx, hz, hx, hz);
  side(-hx, -hz, -hx, hz);
  side(hx, -hz, hx, hz, (t) => Math.abs((t - 0.5) * d) < doorHalf + 0.02);
  // roof bars
  for (let x = -hx + 0.3; x < hx; x += 0.4) asm.strut(barMat, [x, H, -hz], [x, H, hz], 0.03, { cast: false });
  // door leaf (hinged at +Z jamb), swung open or closed
  {
    const g = new THREE.Group();
    g.position.set(hx, 0, -doorHalf);
    g.rotation.y = o.open ? 1.9 : 0;
    const nb = Math.round(doorW / 0.13);
    for (let i = 0; i <= nb; i++) {
      const bar = new THREE.Mesh(unitBox(), barMat);
      bar.scale.set(0.025, H - 0.4, 0.025);
      bar.position.set(0, (H - 0.4) / 2 + 0.15, (doorW * i) / nb);
      g.add(bar);
    }
    for (const y of [0.15, H - 0.25, 1.2]) {
      const r = new THREE.Mesh(unitBox(), frameMat);
      r.scale.set(0.05, 0.06, doorW);
      r.position.set(0, y, doorW / 2);
      g.add(r);
    }
    asm.group.add(g);
  }
  // interior: cot, bucket, chains, stains
  asm.box(solid('cage:cot', 0x3a3c36, 0.9, 0.2), 1.9, 0.08, 0.7, -hx + 1.1, 0.42, -hz + 0.6);
  asm.box(solid('cage:mattress', 0x5d5a4a, 1, 0), 1.8, 0.1, 0.62, -hx + 1.1, 0.5, -hz + 0.6);
  for (const [lx, lz] of [
    [-hx + 0.2, -hz + 0.3],
    [-hx + 2.0, -hz + 0.3],
    [-hx + 0.2, -hz + 0.9],
    [-hx + 2.0, -hz + 0.9],
  ] as const) asm.box(frameMat, 0.05, 0.4, 0.05, lx, 0.22, lz);
  asm.cyl(rust, 0.15, 0.3, hx - 0.6, 0.18, hz - 0.5, 10);
  asm.tube(solid('cage:chain', 0x30363b, 0.5, 0.8), [-hx + 0.05, 1.6, -hz + 1.1], [-hx + 0.45, 0.9, -hz + 1.2], 0.02, 5, { cast: false });
  asm.tube(solid('cage:chain', 0x30363b, 0.5, 0.8), [-hx + 0.45, 0.9, -hz + 1.2], [-hx + 0.6, 0.1, -hz + 1.6], 0.02, 5, { cast: false });
  const stain = solid('cage:stain', 0x2a1412, 1, 0);
  for (let i = 0; i < 5; i++) asm.cyl(stain, rng.range(0.15, 0.45), 0.006, rng.range(-hx + 0.4, hx - 0.4), 0.062, rng.range(-hz + 0.4, hz - 0.4), 10, { cast: false });
  // colliders: bars block movement, bullets pass
  const t = 0.12;
  const wallOpts = { blocksShots: false, mapKind: 'fence' as const, surface: 'metal' as const, tag: 'cage' };
  asm.collide(b, 0, -hz, w, t, H, wallOpts);
  asm.collide(b, 0, hz, w, t, H, wallOpts);
  asm.collide(b, -hx, 0, t, d, H, wallOpts);
  const segLen = hz - doorHalf;
  if (segLen > 0.05) {
    asm.collide(b, hx, -(doorHalf + segLen / 2), t, segLen, H, wallOpts);
    asm.collide(b, hx, doorHalf + segLen / 2, t, segLen, H, wallOpts);
  }
  if (!o.open) asm.collide(b, hx, 0, t, doorW, H, wallOpts);
  asm.commit(b, { cast: false });
}

const LED_COLORS = [0x2bff70, 0x2bff70, 0xffa020, 0xff3a20, 0x3fa8ff];

/** Server racks (0.6 x 1.0 x 2.0 m each) in a row along local X; blinking status LEDs; fronts face +Z. */
export function serverRack(b: LevelBuilder, o: Place & { count?: number }): void {
  const n = o.count ?? 2;
  const rng = new Rng(seedFrom(o.x, o.z, 71));
  const asm = mk(o);
  const body = solid('server:body', 0x2a3037, 0.5, 0.3);
  const trim = solid('server:trim', 0x424a52, 0.5, 0.3);
  const frontMat = cached('server:front', () => new THREE.MeshStandardMaterial({ color: 0xffffff, map: serverFrontTexture(), roughness: 0.55, metalness: 0.5 }));
  const rw = 0.62;
  const total = n * rw;
  for (let i = 0; i < n; i++) {
    const cx = -total / 2 + rw * (i + 0.5);
    asm.box(body, rw - 0.02, 2.0, 0.96, cx, 1.0, -0.02);
    const front = new THREE.Mesh(new THREE.PlaneGeometry(rw - 0.08, 1.86), frontMat);
    front.position.set(cx, 1.0, 0.465);
    asm.group.add(front);
    asm.box(trim, rw - 0.02, 0.06, 1.0, cx, 2.03, -0.02);
    asm.box(trim, rw - 0.02, 0.08, 1.0, cx, 0.05, -0.02);
    // status LEDs (GPU-blinked glows)
    for (let k = 0; k < 6; k++) {
      const ly = 0.3 + rng.range(0, 1.6);
      const lx = cx - rw / 2 + 0.1 + (k % 3) * 0.05;
      const p = asm.world(lx, 0.49);
      b.glow({ x: p.x, y: asm.y + ly, z: p.z, color: rng.pick(LED_COLORS), size: 0.11, intensity: 2.4, mode: rng.chance(0.6) ? 'blink' : 'steady', period: rng.range(0.4, 2.4), duty: rng.range(0.2, 0.7), phase: rng.range(0, 3) });
    }
    // cable bundle over the top
    asm.tube(b.mats.get('rubber'), [cx - rw * 0.4, 2.075, -0.3], [cx + rw * 0.4, 2.075, -0.28], 0.03, 5, { cast: false });
  }
  asm.collide(b, 0, -0.02, total, 0.98, 2.05, { mapKind: 'prop', surface: 'metal', tag: 'server-rack' });
  asm.commit(b, { cast: false });
}

/** Desk-height console with several glowing monitors. */
export function labConsole(b: LevelBuilder, o: Place & { width?: number }): void {
  const W = o.width ?? 2;
  const rng = new Rng(seedFrom(o.x, o.z, 81));
  const asm = mk(o);
  const cab = b.mats.get('labPanel');
  const dark = solid('lab:consoleDark', 0x101417, 0.5, 0.4);
  const top = solid('lab:consoleTop', 0x1c2328, 0.35, 0.3);
  const key = solid('lab:key', 0x808a91, 0.5, 0.4);
  const led = [cached('lab:cledG', () => emissiveMat(0x2bff70, 1.8, 0x0a100c)), cached('lab:cledA', () => emissiveMat(0xffa020, 1.8, 0x100c08)), cached('lab:cledR', () => emissiveMat(0xff3a20, 1.8, 0x100808))];
  asm.box(dark, W, 0.08, 0.8, 0, 0.04, 0);
  asm.box(cab, W, 0.78, 0.72, 0, 0.47, 0);
  asm.box(top, W + 0.04, 0.05, 0.8, 0, 0.885, 0);
  // slanted control surface
  asm.box(dark, W - 0.1, 0.05, 0.36, 0, 0.98, 0.16, { rx: 0.35 });
  for (let i = 0; i < Math.round(W / 0.14); i++) {
    const lx = -W / 2 + 0.15 + i * 0.14;
    if (rng.chance(0.55)) asm.box(key, 0.05, 0.02, 0.05, lx, 1.02, 0.2 + rng.range(-0.04, 0.04), { rx: 0.35 });
    else asm.box(rng.pick(led), 0.03, 0.015, 0.03, lx, 1.03, 0.2, { rx: 0.35 });
  }
  // monitors on stands
  const nm = Math.max(2, Math.round(W / 0.62));
  for (let i = 0; i < nm; i++) {
    const cx = -W / 2 + (W * (i + 0.5)) / nm;
    asm.box(dark, 0.5, 0.34, 0.04, cx, 1.24, -0.2, { rx: -0.14, ry: (i - (nm - 1) / 2) * 0.12 });
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.29), monitorMat(i + Math.floor(o.x * 3)));
    scr.position.set(cx, 1.245, -0.176);
    scr.rotation.order = 'YXZ';
    scr.rotation.set(-0.14, (i - (nm - 1) / 2) * 0.12, 0);
    asm.group.add(scr);
    asm.box(dark, 0.06, 0.26, 0.06, cx, 1.03, -0.22);
  }
  if (!monitorTickBound.has(b)) {
    monitorTickBound.add(b);
    b.tick((_dt, time) => {
      for (let v = 0; v < MONITORS.length; v++) {
        const m = MONITORS[v];
        if (m) m.emissiveIntensity = 0.78 + 0.12 * Math.sin(time * (7 + v * 2.3)) + (Math.sin(time * 1.9 + v * 5) > 0.97 ? -0.4 : 0);
      }
    });
  }
  asm.collide(b, 0, 0, W, 0.8, 0.95, { mapKind: 'prop', surface: 'metal', tag: 'lab-console' });
  asm.commit(b, { cast: false });
  const p = asm.world(0, 0.9);
  b.light({ x: p.x, y: asm.y + 1.4, z: p.z, color: 0x7acbff, intensity: 20, distance: 5, mode: 'flicker', phase: rng.range(0, 9), weight: 0.6, tag: 'console' });
}

/** Hospital gurney (2.0 x 0.7 m); `covered` = a sheeted, stained body lies on it. */
export function gurney(b: LevelBuilder, o: Place & { covered?: boolean }): void {
  const rng = new Rng(seedFrom(o.x, o.z, 91));
  const asm = mk(o);
  const steel = solid('gurney:steel', 0xaab1b7, 0.4, 0.4);
  const vinyl = solid('gurney:vinyl', 0x4a5a66, 0.5, 0.05);
  const sheet = solid('gurney:sheet', 0xb9b7ab, 0.95, 0);
  const stain = solid('gurney:stain', 0x5a1a14, 0.9, 0);
  const rubber = b.mats.get('rubber');
  for (const z of [-0.3, 0.3]) {
    asm.box(steel, 1.9, 0.04, 0.04, 0, 0.72, z);
    asm.box(steel, 1.9, 0.04, 0.04, 0, 0.42, z);
  }
  for (const x of [-0.88, 0.88]) {
    asm.box(steel, 0.04, 0.32, 0.64, x, 0.57, 0);
    for (const z of [-0.3, 0.3]) {
      asm.box(steel, 0.04, 0.46, 0.04, x, 0.24, z);
      asm.cyl(rubber, 0.06, 0.05, x, 0.06, z, 10);
    }
  }
  asm.box(vinyl, 1.9, 0.11, 0.64, 0, 0.8, 0);
  asm.box(vinyl, 0.4, 0.13, 0.5, -0.66, 0.9, 0, { rz: 0.1 });
  if (o.covered) {
    asm.sphere(sheet, 0.115, -0.6, 0.98, 0, 12);
    asm.box(sheet, 0.5, 0.2, 0.42, -0.2, 0.96, 0);
    asm.box(sheet, 0.55, 0.13, 0.3, 0.32, 0.92, 0.01);
    asm.box(sheet, 0.4, 0.1, 0.26, 0.72, 0.9, 0.0, { rz: 0.1 });
    asm.box(stain, 0.2, 0.004, 0.16, -0.05, 1.062, rng.range(-0.08, 0.08), { ry: rng.range(0, 3) });
    asm.box(stain, 0.14, 0.004, 0.1, 0.4, 0.99, 0.07, { ry: 0.7 });
  }
  asm.collide(b, 0, 0, 2.0, 0.7, 0.95, { mapKind: 'prop', surface: 'metal', tag: 'gurney' });
  asm.commit(b, { cast: false });
}

// ---------------------------------------------------------------------------------------------
// Lighting fixtures
// ---------------------------------------------------------------------------------------------

/**
 * Ceiling light fixture at height `y` (fixture geometry + `b.light` lamp + glow). `mode: 'fail'` = mostly dead with rare
 * flickers; 'flicker' = unstable. `kind` tube (1.2 m), panel, or caged industrial bay lamp. `intensity` is candela
 * (default: tube 32, panel 40, caged 72).
 */
export function ceilingLight(
  b: LevelBuilder,
  o: { x: number; z: number; y: number; kind?: 'tube' | 'panel' | 'caged'; mode?: 'steady' | 'flicker' | 'fail'; color?: number; intensity?: number; rot?: number },
): void {
  const kind = o.kind ?? 'tube';
  const mode = o.mode ?? 'steady';
  const rot = o.rot ?? 0;
  const seed = seedFrom(o.x, o.z, 101);
  const rng = new Rng(seed);
  const asm = new Assembly(o.x, o.y, o.z, rot, { cast: false });
  const housing = solid('light:housing', 0xb4b8bb, 0.5, 0.4);
  const dim = solid('light:dim', 0x1a2024, 0.6, 0.2);
  const color = o.color ?? (kind === 'caged' ? 0xffdcae : kind === 'panel' ? 0xe8f0ff : 0xdfeaff);
  const intensity = o.intensity ?? (kind === 'caged' ? 72 : kind === 'panel' ? 40 : 32);
  const dynamic = mode !== 'steady';
  const lampMat = dynamic ? emissiveMat(color, 2.6, 0x101416) : cached(`light:em${color}`, () => emissiveMat(color, 2.6, 0x101416));
  // fixture geometry (local: hangs below y)
  if (kind === 'tube') {
    asm.box(housing, 1.25, 0.06, 0.18, 0, -0.03, 0);
    asm.box(dim, 1.3, 0.02, 0.04, 0, -0.07, 0);
    asm.box(lampMat, 1.14, 0.028, 0.045, 0, -0.085, -0.045);
    asm.box(lampMat, 1.14, 0.028, 0.045, 0, -0.085, 0.045);
  } else if (kind === 'panel') {
    asm.box(housing, 0.66, 0.05, 0.66, 0, -0.025, 0);
    asm.box(lampMat, 0.56, 0.012, 0.56, 0, -0.056, 0);
  } else {
    asm.cyl(dim, 0.05, 0.16, 0, -0.08, 0, 8);
    asm.taper(housing, 0.12, 0.34, 0.2, 0, -0.26, 0, 14);
    asm.sphere(lampMat, 0.1, 0, -0.42, 0, 10);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      asm.box(dim, 0.012, 0.28, 0.012, Math.cos(a) * 0.17, -0.42, Math.sin(a) * 0.17, { cast: false });
    }
    const ring = new THREE.TorusGeometry(0.17, 0.008, 4, 16);
    ring.rotateX(Math.PI / 2);
    asm.mesh(ring, dim, 0, -0.56, 0, { cast: false });
  }
  asm.commit(b, { cast: false });
  const lp = asm.world(0, 0);
  const lamp: LampSpec = {
    x: lp.x,
    y: o.y - (kind === 'caged' ? 0.55 : 0.28),
    z: lp.z,
    color,
    intensity,
    distance: kind === 'caged' ? 13 : 10.5,
    mode,
    phase: rng.range(0, 30),
    weight: 1,
    tag: 'ceiling-light',
    glow: dynamic ? 0 : kind === 'panel' ? 0.7 : kind === 'caged' ? 0.9 : 0.7,
  };
  b.light(lamp);
  if (dynamic) {
    const glowSpr = glowSprite(b.mats.glowTexture, color, kind === 'caged' ? 0.9 : 0.7, 1.2, 0.6);
    glowSpr.position.set(lp.x, lamp.y + 0.05, lp.z);
    b.addDynamic(glowSpr);
    followLamp(b, lampMat, lamp, 2.6, glowSpr, 0.6);
  }
}

/** Wall-mounted red emergency beacon (blink) that registers a red lamp + glow. */
export function emergencyLight(b: LevelBuilder, o: { x: number; y: number; z: number; period?: number; phase?: number }): void {
  const period = o.period ?? 1.4;
  const phase = o.phase ?? 0;
  const asm = new Assembly(o.x, o.y, o.z, 0, { cast: false });
  const dark = solid('emerg:housing', 0x1a1d20, 0.6, 0.4);
  asm.box(dark, 0.2, 0.06, 0.2, 0, -0.03, 0);
  asm.cyl(dark, 0.09, 0.05, 0, 0.02, 0, 12);
  asm.commit(b, { cast: false });
  const lens = emissiveMat(0xff2a1a, 3.2, 0x2a0806);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), lens);
  dome.position.set(o.x, o.y + 0.045, o.z);
  b.addDynamic(dome);
  const lamp: LampSpec = { x: o.x, y: o.y + 0.15, z: o.z, color: 0xff2a1a, intensity: 85, distance: 12, mode: 'blink', period, duty: 0.5, phase, weight: 1.1, glow: 0.7, tag: 'emergency' };
  b.light(lamp);
  b.tick((_dt, time) => {
    lens.emissiveIntensity = 3.2 * lampIntensityMul(lamp, time) + 0.25;
  });
}

/** Horizontal pipe / conduit run between two points (visual) with couplings and hanger brackets. */
export function pipeRun(b: LevelBuilder, o: { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; radius?: number }): void {
  const r = o.radius ?? 0.08;
  const asm = new Assembly(0, 0, 0, 0, { cast: false });
  const pipe = solid('pipe:steel', 0x76808a, 0.5, 0.3);
  const band = solid('pipe:band', 0xb59a2a, 0.6, 0.3);
  const a: [number, number, number] = [o.x0, o.y0, o.z0];
  const c: [number, number, number] = [o.x1, o.y1, o.z1];
  asm.tube(pipe, a, c, r, 8);
  const len = Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
  if (len < 0.01) return;
  const d: [number, number, number] = [(c[0] - a[0]) / len, (c[1] - a[1]) / len, (c[2] - a[2]) / len];
  const n = Math.max(1, Math.floor(len / 2.4));
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * len;
    const p: [number, number, number] = [a[0] + d[0] * t, a[1] + d[1] * t, a[2] + d[2] * t];
    asm.tube(band, [p[0] - d[0] * 0.04, p[1] - d[1] * 0.04, p[2] - d[2] * 0.04], [p[0] + d[0] * 0.04, p[1] + d[1] * 0.04, p[2] + d[2] * 0.04], r * 1.35, 8, { cast: false });
    asm.box(pipe, 0.04, 0.3, 0.04, p[0], p[1] + r + 0.15, p[2], { cast: false });
  }
  asm.commit(b, { cast: false });
}
