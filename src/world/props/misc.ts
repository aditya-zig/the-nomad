/** Tyres, pipes, fire escapes and rooftop clutter. */
import * as THREE from 'three';
import type { LevelBuilder } from '../builder';
import type { Place } from './types';
import { Parts, collideLocal, rngFor, TAU } from './util';

let tireGeoCache: THREE.BufferGeometry | null = null;
function tireGeo(): THREE.BufferGeometry {
  if (tireGeoCache) return tireGeoCache;
  const g = new THREE.TorusGeometry(0.21, 0.105, 6, 12);
  g.rotateX(Math.PI / 2);
  tireGeoCache = g;
  return g;
}

/** Stack of `count` (default 4) lorry / car tyres, tidy or slumped. Hop-over (<= 0.9 m). */
export function tireStack(b: LevelBuilder, o: Place & { count?: number }): void {
  const count = Math.max(1, Math.min(4, o.count ?? 4));
  const rng = rngFor(o, 171);
  const set = b.instanced('tire', tireGeo(), b.mats.get('tire'));
  const base = o.y ?? 0;
  for (let i = 0; i < count; i++) {
    set.add(o.x + rng.range(-0.04, 0.04) * i, base + 0.105 + i * 0.205, o.z + rng.range(-0.04, 0.04) * i, rng.range(0, TAU));
  }
  b.collide({ x: o.x, z: o.z, hx: 0.33, hz: 0.33, y0: base, y1: base + 0.21 * count + 0.02, surface: 'metal', mapKind: 'prop', tag: 'tires' });
}

/** Pyramid stack of large steel pipes (`length` along local X, default 6 m). `count` = approximate pipes (default 8). Chocked at the ends. */
export function pipeStack(b: LevelBuilder, o: Place & { length?: number; count?: number }): void {
  const L = o.length ?? 6;
  const count = o.count ?? 8;
  const rng = rngFor(o, 181);
  const n0 = Math.max(2, Math.ceil((-1 + Math.sqrt(1 + 8 * count)) / 2));
  const p = new Parts(o);
  const dark = b.mats.get('steelDark');
  const rust = b.mats.get('rust');
  const wood = b.mats.get('wood');
  const R = 0.25;
  for (let row = 0; row < n0; row++) {
    const inRow = n0 - row;
    for (let i = 0; i < inRow; i++) {
      const z = (i - (inRow - 1) / 2) * (R * 2 + 0.01);
      const y = R + row * R * 1.732;
      p.cyl(rng.chance(0.3) ? rust : dark, R, R, L, 12, 0, y, z, 'x');
      p.cyl(b.mats.get('rubber'), R * 0.86, R * 0.86, 0.02, 12, L / 2 + 0.005, y, z, 'x');
    }
  }
  for (const sx of [-1, 1]) {
    p.box(wood, 0.16, 0.2, n0 * R * 2 + 0.3, sx * (L / 2 - 0.4), 0.1, 0);
    p.box(wood, 0.16, 0.5, 0.16, sx * (L / 2 - 0.4), 0.25, -(n0 * R + 0.15));
    p.box(wood, 0.16, 0.5, 0.16, sx * (L / 2 - 0.4), 0.25, n0 * R + 0.15);
  }
  p.flush(b);
  const h = R * 2 + (n0 - 1) * R * 1.732;
  collideLocal(b, o, 0, 0, L, n0 * R * 2 + 0.05, h, { surface: 'metal', mapKind: 'prop', tag: 'pipes' });
}

/**
 * Rusty external fire escape: a landing every 3 m up to `height`, joined by diagonal flights that alternate direction along
 * the wall (so the whole structure is ~`width` + 3.4 m wide), railings, and a drop-down ladder hanging from the first landing
 * to 2.4 m above ground. The wall it clings to is on the local -Z side; the structure extends toward +Z. Visual only
 * (nothing reaches the ground, so no colliders).
 */
export function fireEscape(b: LevelBuilder, o: Place & { height: number; width?: number }): void {
  const Wl = o.width ?? 2.2;
  const Fl = 3.4;
  const D = 1.0;
  const floors = Math.max(1, Math.floor(o.height / 3));
  const p = new Parts(o);
  const iron = b.mats.get('rust');
  const dark = b.mats.get('steelDark');
  const grate = b.mats.get('grating');
  const landingX = (f: number): number => (f % 2 === 1 ? -1 : 1) * (Fl / 2);
  for (let f = 1; f <= floors; f++) {
    const y = f * 3.0;
    const cx = landingX(f);
    p.box(grate, Wl, 0.06, D, cx, y, D / 2);
    p.box(iron, Wl, 0.1, 0.06, cx, y - 0.05, D);
    for (const sx of [-1, 1]) p.box(iron, 0.06, 0.1, D, cx + sx * (Wl / 2), y - 0.05, D / 2);
    // railings: outer edge and the closed end (the flight side stays open)
    const flightDir = f < floors ? Math.sign(landingX(f + 1) - cx) : 0;
    const prevDir = f > 1 ? Math.sign(landingX(f - 1) - cx) : 0;
    const rail = (x0: number, z0: number, x1: number, z1: number): void => {
      p.strut(dark, x0, y + 0.95, z0, x1, y + 0.95, z1, 0.04);
      p.strut(dark, x0, y + 0.5, z0, x1, y + 0.5, z1, 0.03);
    };
    rail(cx - Wl / 2, D, cx + Wl / 2, D);
    for (const sx of [-1, 1]) {
      if (sx === flightDir || sx === prevDir) continue;
      rail(cx + (sx * Wl) / 2, 0.05, cx + (sx * Wl) / 2, D);
    }
    for (const sx of [-1, 0, 1]) p.box(dark, 0.05, 1.0, 0.05, cx + (sx * Wl) / 2, y + 0.5, D);
    for (const sx of [-1, 1]) p.strut(iron, cx + sx * (Wl / 2 - 0.1), y - 0.05, 0.05, cx + sx * (Wl / 2 - 0.1), y - 0.95, D * 0.9, 0.07);
    // diagonal flight up to the next landing
    if (f < floors) {
      const nx = landingX(f + 1);
      const sx = cx + flightDir * (Wl / 2);
      const ex = nx - flightDir * (Wl / 2);
      const steps = 16;
      const run = Math.abs(ex - sx) / steps;
      for (let i = 0; i < steps; i++) {
        const t = (i + 0.5) / steps;
        p.box(grate, run + 0.03, 0.04, 0.8, sx + (ex - sx) * t, y + 3.0 * t, 0.5, { cast: false });
      }
      for (const z of [0.1, 0.9]) p.strut(iron, sx, y - 0.05, z, ex, y + 3.0 - 0.05, z, 0.07);
      p.strut(dark, sx, y + 0.95, 0.92, ex, y + 3.95, 0.92, 0.04);
      p.strut(dark, sx, y + 0.5, 0.92, ex, y + 3.5, 0.92, 0.03);
      for (let i = 1; i < 5; i++) {
        const t = i / 5;
        p.box(dark, 0.04, 0.95, 0.04, sx + (ex - sx) * t, y + 3.0 * t + 0.48, 0.92);
      }
    }
  }
  // drop-down ladder from the first landing (left end)
  const lx = landingX(1) - Wl / 2 + 0.4;
  for (const dz of [-0.22, 0.22]) p.box(dark, 0.05, 1.6, 0.05, lx + dz, 3.0 - 0.8, D - 0.1);
  for (let y = 1.5; y < 3.0; y += 0.28) p.box(dark, 0.44, 0.04, 0.04, lx, y, D - 0.1);
  p.flush(b);
}

/** Rooftop clutter (AC units, vents, pipes, antennae, a water tank) on a roof rectangle at height `y`. Visual only. */
export function roofClutter(b: LevelBuilder, o: { x: number; z: number; w: number; d: number; y: number; seed?: number; density?: number }): void {
  const rng = rngFor(o, 191);
  const p = new Parts({ x: o.x, z: o.z, y: o.y });
  const metal = b.mats.get('metalPanel');
  const dark = b.mats.get('steelDark');
  const steel = b.mats.get('steel');
  const conc = b.mats.get('concreteDark');
  const glass = b.mats.get('glassDark');
  const items = Math.max(2, Math.round(((o.w * o.d) / 32) * (o.density ?? 1)));
  const placed: { x: number; z: number; r: number }[] = [];
  const spot = (r: number): { x: number; z: number } | null => {
    for (let t = 0; t < 30; t++) {
      const x = rng.range(-o.w / 2 + r + 0.4, o.w / 2 - r - 0.4);
      const z = rng.range(-o.d / 2 + r + 0.4, o.d / 2 - r - 0.4);
      if (placed.every((q) => Math.hypot(q.x - x, q.z - z) > q.r + r)) {
        placed.push({ x, z, r });
        return { x, z };
      }
    }
    return null;
  };
  // roof access box first (big)
  if (o.w > 6 && o.d > 6 && rng.chance(0.8)) {
    const s = spot(1.6);
    if (s) {
      p.box(conc, 2.0, 2.3, 2.4, s.x, 1.15, s.z);
      p.box(dark, 0.05, 1.9, 0.9, s.x + 1.03, 0.95, s.z, {});
      p.box(dark, 2.2, 0.1, 2.6, s.x, 2.34, s.z);
    }
  }
  for (let i = 0; i < items; i++) {
    const kind = rng.f();
    if (kind < 0.4) {
      const s = spot(0.9);
      if (!s) continue;
      const ry = rng.range(-0.3, 0.3);
      p.box(metal, 1.4, 0.9, 1.0, s.x, 0.45 + 0.1, s.z, { ry });
      p.box(dark, 1.5, 0.1, 1.1, s.x, 0.05, s.z, { ry });
      p.cyl(dark, 0.36, 0.36, 0.04, 14, s.x, 1.0 + 0.1, s.z, 'y');
      for (let k = 0; k < 3; k++) p.box(dark, 0.7, 0.012, 0.03, s.x, 1.13, s.z, { ry: (k * Math.PI) / 3 });
    } else if (kind < 0.62) {
      const s = spot(0.4);
      if (!s) continue;
      p.cyl(metal, 0.16, 0.16, 0.7 + rng.range(0, 0.5), 8, s.x, 0.4, s.z);
      p.cyl(dark, 0.22, 0.05, 0.12, 8, s.x, 0.9 + rng.range(0, 0.3), s.z);
    } else if (kind < 0.76) {
      const s = spot(1.2);
      if (!s) continue;
      const len = rng.range(1.5, 3.5);
      p.cyl(steel, 0.11, 0.11, len, 8, s.x, 0.5, s.z, rng.chance(0.5) ? 'x' : 'z');
      for (const t of [-len / 2 + 0.2, len / 2 - 0.2]) p.box(dark, 0.1, 0.5, 0.1, s.x + (rng.chance(0.5) ? t : 0), 0.25, s.z);
    } else if (kind < 0.88) {
      const s = spot(0.3);
      if (!s) continue;
      const h = rng.range(2.5, 4.5);
      p.cyl(dark, 0.02, 0.025, h, 5, s.x, h / 2, s.z);
      for (let k = 0; k < 3; k++) p.box(dark, 0.02, 0.02, 0.5 - k * 0.1, s.x, h - 0.3 - k * 0.35, s.z);
    } else if (kind < 0.95) {
      const s = spot(1.0);
      if (!s) continue;
      p.cyl(dark, 0.05, 0.05, 1.1, 5, s.x, 0.55, s.z);
      p.geo(steel, new THREE.SphereGeometry(0.5, 12, 6, 0, TAU, 0, Math.PI / 2.4), s.x, 1.4, s.z, { rx: -1.2, ry: rng.range(0, TAU) });
    } else {
      const s = spot(1.0);
      if (!s) continue;
      p.cyl(b.mats.get('wood'), 0.9, 0.9, 1.5, 12, s.x, 2.2, s.z);
      p.cyl(dark, 0.95, 0.05, 0.4, 12, s.x, 3.15, s.z);
      for (const [dx, dz] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]] as const) p.box(dark, 0.08, 1.5, 0.08, s.x + dx, 0.75, s.z + dz);
    }
  }
  p.box(glass, 1.2, 0.3, 0.9, -o.w * 0.25, 0.15, o.d * 0.2, { ry: 0 });
  p.flush(b);
}
