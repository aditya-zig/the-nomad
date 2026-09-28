/** Depot / warehouse equipment: racking, forklift, tanks, generator, floodlight tower, gantry crane. */
import * as THREE from 'three';
import type { LevelBuilder } from '../builder';
import { pallet } from './containers';
import type { PaintName, Place } from './types';
import { Parts, collideLocal, plainMat, rngFor, roundCollider, toWorld, TAU } from './util';

// ---------------------------------------------------------------------------------------------
// pallet racking
// ---------------------------------------------------------------------------------------------

/** Warehouse pallet racking, 1 m deep, `length` along local X, 4 m tall (levels = shelf beams). Solid collider box. */
export function shelvingRack(b: LevelBuilder, o: Place & { length: number; levels?: number; goods?: boolean; seed?: number }): void {
  const rng = rngFor(o, 161);
  const L = o.length;
  const H = 4.0;
  const levels = Math.max(1, o.levels ?? 3);
  const bays = Math.max(1, Math.round(L / 2.7));
  const bay = L / bays;
  const p = new Parts(o);
  const blue = b.mats.get('paintBlue');
  const orange = plainMat(0xb8541a, 0.5, 0.35);
  const dark = b.mats.get('steelDark');
  const wood = b.mats.get('wood');
  const card = b.mats.get('cardboard');
  const crate = b.mats.get('crateWood');
  const spacing = (H - 0.3) / levels;
  for (let i = 0; i <= bays; i++) {
    const x = -L / 2 + i * bay;
    for (const sz of [-1, 1]) {
      p.box(blue, 0.09, H, 0.07, x, H / 2, sz * 0.46);
      p.box(dark, 0.18, 0.02, 0.16, x, 0.01, sz * 0.46);
    }
    // frame bracing between front and back uprights
    p.strut(dark, x, 0.3, -0.46, x, H - 0.3, 0.46, 0.03);
    p.strut(dark, x, 0.3, 0.46, x, H - 0.3, -0.46, 0.03);
    for (let k = 0; k <= levels; k++) p.box(dark, 0.05, 0.05, 0.9, x, 0.3 + k * spacing - 0.02, 0);
  }
  for (let k = 0; k < levels; k++) {
    const y = 0.3 + k * spacing;
    for (let i = 0; i < bays; i++) {
      const cx = -L / 2 + (i + 0.5) * bay;
      for (const sz of [-1, 1]) p.box(orange, bay, 0.13, 0.055, cx, y, sz * 0.46);
      p.box(wood, bay - 0.06, 0.03, 0.9, cx, y + 0.08, 0, { cast: false });
      if (o.goods === false) continue;
      const free = spacing - 0.22;
      const roll = rng.f();
      if (roll < 0.18) continue; // empty bay
      const stacks = roll < 0.55 ? 2 : 3;
      for (let s = 0; s < stacks; s++) {
        const w = (bay - 0.2) / stacks;
        const sx = cx - (bay - 0.2) / 2 + w * (s + 0.5);
        const kind = rng.f();
        if (kind < 0.7) {
          const layers = free > 1.05 ? 2 : 1;
          for (let ly = 0; ly < layers; ly++) {
            const h = Math.min(0.5, free / layers - 0.02);
            p.box(card, w - 0.08, h, 0.82 + rng.range(-0.05, 0.02), sx + rng.range(-0.02, 0.02), y + 0.1 + h / 2 + ly * (h + 0.01), rng.range(-0.03, 0.03), { ry: rng.range(-0.05, 0.05), worldUV: false });
          }
        } else {
          const h = Math.min(0.85, free - 0.05);
          p.box(crate, w - 0.1, h, 0.8, sx, y + 0.1 + h / 2, 0);
          p.box(dark, w - 0.08, 0.04, 0.82, sx, y + 0.1 + h * 0.5, 0, { cast: false });
        }
      }
    }
  }
  p.flush(b);
  collideLocal(b, o, 0, 0, L, 1.0, H, { surface: 'metal', mapKind: 'prop', tag: 'rack' });
}

// ---------------------------------------------------------------------------------------------
// forklift
// ---------------------------------------------------------------------------------------------

const PAINT_MAT = { olive: 'paintOlive', white: 'paintWhite', blue: 'paintBlue', red: 'paintRed', black: 'paintBlack', yellow: 'paintYellow', grey: 'paintGrey' } as const;

/** Counterbalance forklift (front / forks toward local +X, ~2.6 m long incl. forks, 2.1 m tall to the overhead guard). */
export function forklift(b: LevelBuilder, o: Place & { loaded?: boolean; paint?: PaintName }): void {
  const p = new Parts(o);
  const paint = b.mats.get(PAINT_MAT[o.paint ?? 'yellow']);
  const dark = b.mats.get('steelDark');
  const steel = b.mats.get('steel');
  const rubber = b.mats.get('rubber');
  const tire = b.mats.get('tire');
  const seat = b.mats.get('rubber');
  // chassis, counterweight, engine cover
  p.bevelBox(paint, 1.75, 0.7, 1.05, 0.05, -0.15, 0.7, 0);
  p.bevelBox(dark, 0.62, 0.85, 1.12, 0.06, -1.1, 0.78, 0);
  p.bevelBox(paint, 0.78, 0.28, 0.98, 0.04, -0.62, 1.18, 0);
  p.box(dark, 0.9, 0.22, 0.7, 0.4, 0.5, 0);
  // seat, wheel, pedals, dash
  p.box(seat, 0.5, 0.1, 0.5, -0.2, 1.36, 0);
  p.box(seat, 0.1, 0.55, 0.5, -0.45, 1.6, 0, { rz: -0.15 });
  p.cyl(dark, 0.018, 0.018, 0.5, 6, 0.32, 1.35, 0, 'y', { rz: -0.5 });
  p.cyl(dark, 0.15, 0.15, 0.025, 12, 0.24, 1.6, 0, 'y', { rz: -0.5 });
  p.box(dark, 0.3, 0.3, 0.7, 0.42, 1.05, 0);
  // overhead guard
  for (const x of [-0.72, 0.42]) {
    for (const z of [-0.5, 0.5]) p.box(dark, 0.06, 1.05, 0.06, x, 1.65, z);
  }
  for (const z of [-0.5, 0.5]) p.box(dark, 1.3, 0.06, 0.06, -0.15, 2.15, z);
  for (let i = 0; i < 6; i++) p.box(dark, 0.05, 0.05, 1.05, -0.72 + i * 0.228, 2.16, 0);
  // mast, carriage and forks
  for (const z of [-0.34, 0.34]) {
    p.box(dark, 0.1, 2.05, 0.1, 0.98, 1.03, z);
    p.box(dark, 0.14, 2.05, 0.03, 0.98, 1.03, z * 1.28);
  }
  p.box(dark, 0.14, 0.1, 0.9, 0.98, 2.02, 0);
  p.box(dark, 0.06, 0.55, 0.95, 1.08, 0.55, 0);
  for (const z of [-0.3, 0.3]) {
    p.box(dark, 0.06, 0.65, 0.12, 1.12, 0.36, z);
    p.box(dark, 1.15, 0.05, 0.12, 1.68, 0.075, z);
  }
  p.box(dark, 0.06, 0.5, 0.06, 1.1, 1.3, 0.34); // hydraulic ram
  // wheels
  for (const sg of [-1, 1]) {
    p.cyl(tire, 0.32, 0.32, 0.22, 14, 0.6, 0.32, sg * 0.55, 'z');
    p.cyl(steel, 0.17, 0.17, 0.235, 8, 0.6, 0.32, sg * 0.55, 'z');
    p.cyl(tire, 0.24, 0.24, 0.18, 12, -1.0, 0.24, sg * 0.42, 'z');
    p.cyl(steel, 0.12, 0.12, 0.195, 8, -1.0, 0.24, sg * 0.42, 'z');
    p.box(rubber, 0.5, 0.05, 0.12, 0.55, 0.62, sg * 0.63); // mud guard
  }
  p.box(b.mats.get('emAmber'), 0.1, 0.06, 0.08, -0.72, 2.2, 0, { cast: false });
  p.flush(b);
  collideLocal(b, o, -0.3, 0, 1.95, 1.15, 1.3, { surface: 'metal', mapKind: 'vehicle', tag: 'forklift' });
  collideLocal(b, o, 1.0, 0, 0.3, 0.95, 2.1, { surface: 'metal', mapKind: 'vehicle', tag: 'forklift' });
  if (o.loaded) {
    const w = toWorld(o, 1.72, 0);
    pallet(b, { x: w.x, z: w.z, y: (o.y ?? 0) + 0.1, rot: (o.rot ?? 0) + Math.PI / 2, goods: 'boxes', seed: 3 });
  }
}

// ---------------------------------------------------------------------------------------------
// tanks
// ---------------------------------------------------------------------------------------------

const TANK_MAT = { white: 'paintWhite', grey: 'paintGrey', olive: 'paintOlive', rust: 'rust' } as const;

/** Storage tank: vertical (radius x height) with ladder, rails and pipes, or horizontal (lying along local X, `height` = length). Round collider via boxes. */
export function fuelTank(
  b: LevelBuilder,
  o: Place & { radius: number; height: number; horizontal?: boolean; color?: 'white' | 'grey' | 'olive' | 'rust' },
): void {
  const r = o.radius;
  const h = o.height;
  const p = new Parts(o);
  const skin = b.mats.get(TANK_MAT[o.color ?? 'grey']);
  const dark = b.mats.get('steelDark');
  const steel = b.mats.get('steel');
  const conc = b.mats.get('concreteSlab');
  const rust = b.mats.get('rust');
  const segs = Math.max(16, Math.min(32, Math.round(r * 10)));

  if (!o.horizontal) {
    p.cyl(conc, r + 0.35, r + 0.4, 0.3, segs, 0, 0.15, 0);
    p.cyl(skin, r, r, h, segs, 0, 0.3 + h / 2, 0);
    for (let k = 1; k <= 3; k++) p.cyl(dark, r + 0.025, r + 0.025, 0.07, segs, 0, 0.3 + (h * k) / 4, 0);
    p.cyl(skin, r * 0.12, r, h * 0.0 + 0.35 + r * 0.06, segs, 0, 0.3 + h + (0.35 + r * 0.06) / 2, 0);
    p.cyl(dark, r * 0.14, r * 0.14, 0.18, 10, 0, 0.3 + h + 0.35 + r * 0.06 + 0.05, 0);
    const topY = 0.3 + h;
    // roof rail ring
    const posts = Math.max(10, Math.round(r * 5));
    for (let i = 0; i < posts; i++) {
      const a0 = (i / posts) * TAU;
      const a1 = ((i + 1) / posts) * TAU;
      const x0 = Math.cos(a0) * (r - 0.05);
      const z0 = Math.sin(a0) * (r - 0.05);
      const x1 = Math.cos(a1) * (r - 0.05);
      const z1 = Math.sin(a1) * (r - 0.05);
      p.box(dark, 0.04, 1.0, 0.04, x0, topY + 0.5, z0);
      p.strut(dark, x0, topY + 1.0, z0, x1, topY + 1.0, z1, 0.035);
      p.strut(dark, x0, topY + 0.55, z0, x1, topY + 0.55, z1, 0.03);
    }
    // caged ladder on the +X side
    for (const dz of [-0.22, 0.22]) p.box(steel, 0.05, h + 0.9, 0.05, r + 0.12, 0.3 + (h + 0.9) / 2 - 0.3, dz);
    for (let y = 0.5; y < h + 0.8; y += 0.3) p.box(steel, 0.04, 0.04, 0.44, r + 0.12, y, 0);
    for (let y = 2.2; y < h + 0.5; y += 1.0) {
      p.box(dark, 0.03, 0.03, 0.9, r + 0.34, y, 0);
      p.box(dark, 0.03, 0.03, 0.9, r + 0.34, y, 0, { ry: 0 });
      p.box(dark, 0.3, 0.03, 0.03, r + 0.2, y, 0.45);
      p.box(dark, 0.3, 0.03, 0.03, r + 0.2, y, -0.45);
    }
    // base pipe, valve, drain
    p.tube(dark, r * 0.6, 0.55, r - 0.05, r * 0.6, 0.55, r + 1.6, 0.11, 8);
    p.tube(dark, r * 0.6, 0.55, r + 1.6, r * 0.6 + 1.6, 0.55, r + 1.6, 0.11, 8);
    p.cyl(rust, 0.2, 0.2, 0.05, 10, r * 0.6, 0.98, r + 1.0, 'y');
    p.box(dark, 0.06, 0.4, 0.06, r * 0.6, 0.78, r + 1.0);
    p.flush(b);
    roundCollider(b, o, 0, 0, r, h + 0.3, { surface: 'metal', mapKind: 'tank', tag: 'tank' });
  } else {
    const legH = 0.5;
    const cy = legH + r;
    p.cyl(skin, r, r, h, segs, 0, cy, 0, 'x');
    for (const sx of [-1, 1]) p.sphere(skin, r, segs, 8, sx * (h / 2), cy, 0, { sx: 0.32 });
    for (const k of [-0.35, 0, 0.35]) p.cyl(dark, r + 0.025, r + 0.025, 0.08, segs, k * h, cy, 0, 'x');
    for (const sx of [-0.32, 0.32]) {
      p.bevelBox(conc, 0.5, legH + 0.2, r * 1.6, 0.04, sx * h, (legH + 0.2) / 2, 0);
      p.strut(dark, sx * h - 0.3, cy + r * 0.72, -r * 0.35, sx * h + 0.3, cy + r * 0.72, -r * 0.35, 0.05);
    }
    p.cyl(dark, 0.36, 0.36, 0.14, 12, -h * 0.1, cy + r + 0.05, 0, 'y');
    p.cyl(steel, 0.3, 0.3, 0.05, 12, -h * 0.1, cy + r + 0.13, 0, 'y');
    p.box(dark, 0.06, 0.06, 0.5, 0, cy + r + 0.02, r * 0.6);
    p.tube(dark, h / 2 - 0.4, cy - r + 0.3, r + 0.02, h / 2 - 0.4, 0.4, r + 0.6, 0.08, 8);
    p.tube(dark, h / 2 - 0.4, 0.4, r + 0.6, h / 2 + 0.6, 0.4, r + 0.6, 0.08, 8);
    p.flush(b);
    collideLocal(b, o, 0, 0, h + r * 0.6, r * 2, cy + r, { surface: 'metal', mapKind: 'tank', tag: 'tank' });
  }
}

// ---------------------------------------------------------------------------------------------
// generator, floodlight tower
// ---------------------------------------------------------------------------------------------

/** Diesel generator on a skid with exhaust; `running` adds a faint amber glow / hum lamp. Service door faces local +Z. */
export function generator(b: LevelBuilder, o: Place & { running?: boolean }): void {
  const p = new Parts(o);
  const paint = b.mats.get('paintOlive');
  const dark = b.mats.get('steelDark');
  const steel = b.mats.get('steel');
  const rubber = b.mats.get('rubber');
  p.box(dark, 2.3, 0.18, 1.05, 0, 0.09, 0);
  p.bevelBox(paint, 2.0, 0.95, 0.98, 0.05, -0.05, 0.68, 0);
  // radiator grille on the +X end
  p.box(dark, 0.06, 0.7, 0.8, 0.98, 0.7, 0);
  for (let i = -3; i <= 3; i++) p.box(steel, 0.02, 0.66, 0.02, 1.015, 0.7, i * 0.1, { cast: false });
  // service doors, handles and vent louvres
  for (const sz of [-1, 1]) {
    p.box(dark, 1.2, 0.012, 0.012, -0.05, 0.68, sz * 0.5, { cast: false });
    p.box(dark, 0.012, 0.8, 0.012, -0.65, 0.68, sz * 0.5, { cast: false });
    p.box(dark, 0.012, 0.8, 0.012, 0.55, 0.68, sz * 0.5, { cast: false });
    p.box(steel, 0.14, 0.04, 0.03, 0.3, 0.72, sz * 0.52);
    for (let i = 0; i < 5; i++) p.box(dark, 0.4, 0.012, 0.012, -0.85, 0.5 + i * 0.07, sz * 0.5, { cast: false });
  }
  // exhaust + muffler, lifting eye, cables
  p.cyl(dark, 0.06, 0.06, 0.6, 8, -0.75, 1.4, 0.25, 'y');
  p.cyl(dark, 0.13, 0.13, 0.5, 10, -0.75, 1.35, -0.2, 'x');
  p.cyl(dark, 0.02, 0.02, 0.2, 5, 0.1, 1.28, 0, 'y');
  p.geo(rubber, new THREE.TorusGeometry(0.25, 0.03, 6, 14), 0.5, 0.12, 0.75, { rx: Math.PI / 2 });
  p.box(dark, 0.3, 0.32, 0.05, 0.62, 0.9, 0.53); // control panel
  p.box(b.mats.get(o.running ? 'emGreen' : 'glassDark'), 0.05, 0.05, 0.02, 0.55, 0.98, 0.56, { cast: false });
  p.box(b.mats.get(o.running ? 'emAmber' : 'glassDark'), 0.05, 0.05, 0.02, 0.68, 0.98, 0.56, { cast: false });
  p.flush(b);
  collideLocal(b, o, 0, 0, 2.3, 1.05, 1.3, { surface: 'metal', mapKind: 'prop', tag: 'generator' });
  if (o.running) {
    const w = toWorld(o, 0.62, 0.7);
    b.light({ x: w.x, y: (o.y ?? 0) + 1.0, z: w.z, color: 0xffa040, intensity: 20, distance: 7, mode: 'pulse', period: 3.2, glow: 0.35, weight: 0.5 });
  }
}

/** Mobile floodlight tower (trailer base, telescopic mast, 4-lamp bank facing local +X). Registers a strong cool-white lamp when `on`. */
export function floodlightTower(b: LevelBuilder, o: Place & { height?: number; on?: boolean }): void {
  const H = o.height ?? 7;
  const on = o.on ?? true;
  const p = new Parts(o);
  const paint = b.mats.get('paintOlive');
  const dark = b.mats.get('steelDark');
  const steel = b.mats.get('steel');
  const tire = b.mats.get('tire');
  const lampM = on ? b.mats.get('lampCool') : b.mats.get('glassDark');
  p.bevelBox(dark, 2.4, 0.22, 1.3, 0.04, 0, 0.5, 0);
  p.bevelBox(paint, 1.0, 0.65, 0.9, 0.04, -0.6, 0.93, 0);
  p.strut(dark, 1.2, 0.5, 0, 2.6, 0.4, 0, 0.09);
  p.cyl(dark, 0.06, 0.06, 0.2, 6, 2.65, 0.32, 0, 'y');
  for (const sg of [-1, 1]) {
    p.cyl(tire, 0.32, 0.32, 0.2, 12, -0.1, 0.32, sg * 0.78, 'z');
    p.cyl(steel, 0.16, 0.16, 0.22, 8, -0.1, 0.32, sg * 0.78, 'z');
    for (const sx of [-1, 1]) {
      p.strut(dark, sx * 1.0, 0.45, sg * 0.55, sx * 1.35, 0.1, sg * 1.0, 0.07);
      p.box(dark, 0.3, 0.04, 0.3, sx * 1.4, 0.03, sg * 1.02);
    }
  }
  // mast
  const sections = 3;
  for (let i = 0; i < sections; i++) {
    const y0 = 0.6 + (H * i) / sections;
    p.cyl(steel, 0.09 - i * 0.012, 0.1 - i * 0.012, H / sections + 0.05, 8, 0.2, y0 + H / sections / 2, 0);
    p.cyl(dark, 0.11 - i * 0.012, 0.11 - i * 0.012, 0.06, 8, 0.2, y0 + 0.03, 0);
  }
  // lamp bank
  const top = 0.6 + H;
  p.box(dark, 0.16, 0.95, 1.4, 0.24, top, 0);
  for (const dy of [0.25, -0.25]) {
    for (const dz of [-0.34, 0.34]) {
      p.bevelBox(dark, 0.36, 0.38, 0.5, 0.04, 0.5, top + dy, dz, { rz: -0.35 });
      p.box(lampM, 0.03, 0.3, 0.42, 0.7, top + dy - 0.05, dz, { rz: -0.35, cast: false });
    }
  }
  p.flush(b);
  collideLocal(b, o, 0, 0, 2.4, 1.3, 1.1, { surface: 'metal', mapKind: 'prop', tag: 'floodlight' });
  collideLocal(b, o, 0.2, 0, 0.35, 0.35, 0.6 + H, { surface: 'metal', mapKind: 'prop', tag: 'floodlight' });
  if (on) {
    const w = toWorld(o, 1.0, 0);
    b.light({ x: w.x, y: (o.y ?? 0) + top - 0.1, z: w.z, color: 0xdfeaff, intensity: 240, distance: 32, glow: 2.4, pool: 8, mode: 'steady', weight: 1.3 });
  }
}

// ---------------------------------------------------------------------------------------------
// gantry crane
// ---------------------------------------------------------------------------------------------

/**
 * Container-yard gantry crane: four legs (colliders) at the corners of a `length` (X) by `span` (Z) rectangle, two top girders
 * across the span, longitudinal bridge beams, a trolley with hoist cables and spreader, and an operator cabin.
 */
export function craneGantry(b: LevelBuilder, o: Place & { span: number; height: number; length: number }): void {
  const { span, height: H, length: L } = o;
  const p = new Parts(o);
  const yellow = b.mats.get('paintYellow');
  const dark = b.mats.get('steelDark');
  const steel = b.mats.get('steel');
  const glass = b.mats.get('glassDark');
  const hx = L / 2;
  const hz = span / 2;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      p.bevelBox(yellow, 0.7, H, 0.7, 0.05, sx * hx, H / 2, sz * hz);
      p.box(dark, 1.0, 0.25, 1.0, sx * hx, 0.125, sz * hz);
      p.strut(dark, sx * hx, H * 0.15, sz * hz * 0.98, sx * hx, H * 0.5, sz * hz * 0.6, 0.12);
    }
    // top girder across the span at each end
    p.bevelBox(yellow, 0.7, 0.9, span + 0.7, 0.05, sx * hx, H - 0.45, 0);
    p.box(dark, 0.5, 0.08, span, sx * hx, H + 0.02, 0);
  }
  for (const sz of [-1, 1]) {
    p.bevelBox(yellow, L + 0.7, 0.6, 0.5, 0.05, 0, H - 1.0, sz * hz);
    p.bevelBox(yellow, L + 0.7, 0.4, 0.5, 0.04, 0, 0.7, sz * hz);
  }
  // trolley + hoist + spreader
  p.bevelBox(yellow, 2.4, 0.9, 1.7, 0.05, 0, H + 0.5, 0);
  p.box(dark, 0.2, 0.2, 0.2, 0.9, H + 1.05, 0.5);
  for (const dx of [-0.9, 0.9]) for (const dz of [-0.4, 0.4]) p.box(steel, 0.03, 4.5, 0.03, dx, H - 1.8, dz);
  p.bevelBox(dark, 2.6, 0.22, 0.6, 0.04, 0, H - 4.2, 0);
  for (const dx of [-1.2, 1.2]) p.box(dark, 0.14, 0.22, 0.2, dx, H - 4.4, 0);
  // cabin
  p.bevelBox(yellow, 1.3, 1.5, 1.4, 0.05, hx + 0.7, H - 2.1, hz * 0.5);
  p.box(glass, 1.0, 0.7, 0.02, hx + 0.7, H - 1.9, hz * 0.5 + 0.71);
  p.flush(b);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) collideLocal(b, o, sx * hx, sz * hz, 0.9, 0.9, H, { surface: 'metal', mapKind: 'prop', tag: 'crane' });
}
