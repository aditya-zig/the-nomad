/** Heavy vehicles: box truck, bus, APC, tanker, tractor cab, trailer. */
import { collideLocal, stencil } from './util';
import {
  type VCtx,
  arch,
  bumperBar,
  finish,
  headlights,
  mirror,
  plate,
  seam,
  shards,
  shell,
  taillights,
  underbody,
  wheel,
} from './vehicleKit';
import { openDoor } from './cars';

const COL = { surface: 'metal', mapKind: 'vehicle', tag: 'vehicle' } as const;

/** Single or dual wheel set on both sides. `zOuter` is the outer wheel-centre offset (positive). */
function wheelSet(c: VCtx, x: number, zOuter: number, r: number, w: number, dual: boolean, archZ?: number): void {
  for (const sg of [-1, 1]) {
    wheel(c, x, sg * zOuter, r, w);
    if (dual) wheel(c, x, sg * (zOuter - w - 0.04), r, w, undefined, true);
    if (archZ !== undefined) arch(c, x, sg * archZ, r);
  }
}

// ---------------------------------------------------------------------------------------------
// box truck
// ---------------------------------------------------------------------------------------------

export function boxTruck(c: VCtx): void {
  const p = c.p;
  const half = 1.15 + 0.04;
  // cab-over cab
  shell(c, [[1.62, 0.75], [1.62, 2.85], [3.3, 2.9], [3.68, 2.2], [3.76, 1.8], [3.76, 0.8], [3.6, 0.62], [1.9, 0.62]], 2.3, c.paint, 0.04, 0.03);
  p.box(c.glass, 0.8, 0.03, 2.05, 3.547, 2.581, 0, { rz: -1.07 });
  for (const sg of [-1, 1]) {
    p.box(c.glass, 1.0, 0.85, 0.02, 2.85, 2.3, sg * (half + 0.012));
    p.box(c.dark, 0.05, 0.9, 0.03, 2.28, 2.3, sg * (half + 0.012));
    for (const st of [0.9, 1.5]) p.box(c.steel, 0.5, 0.04, 0.26, 2.9, st - 0.05, sg * (half + 0.08));
    seam(c, 2.3, 0.8, 2.75, half);
    p.box(c.dark, 0.12, 0.5, 0.05, 3.35, 2.55, sg * (half + 0.2)); // mirror
    p.box(c.dark, 0.05, 0.03, 0.25, 3.35, 2.4, sg * (half + 0.12));
  }
  p.box(c.dark, 0.03, 0.7, 1.3, 3.775, 1.35, 0);
  headlights(c, 3.77, 1.0, 0.85, [0.06, 0.2, 0.4]);
  bumperBar(c, 3.85, 0.62, 2.3, 0.26, 0.16, c.steelDark);
  // cargo box
  p.bevelBox(c.paint, 5.3, 2.35, 2.4, 0.04, -1.1, 2.125, 0);
  p.box(c.dark, 5.4, 0.08, 2.44, -1.1, 0.98, 0);
  const label = stencil(c.b.mats, 'HALLORAN MOVING', { color: '#a8302a', font: 'sans', aspect: 6, worn: true });
  for (const sg of [-1, 1]) {
    p.plane(label, 3.2, 0.55, -1.0, 2.3, sg * (1.2 + 0.046), { ry: sg > 0 ? 0 : Math.PI, cast: false });
    for (let i = 0; i < 4; i++) p.box(c.dark, 5.2, 0.014, 0.012, -1.1, 1.3 + i * 0.6, sg * 1.245, { cast: false });
    for (let i = 0; i < 9; i++) p.box(c.dark, 0.014, 2.2, 0.012, -3.5 + i * 0.6, 2.1, sg * 1.246, { cast: false });
  }
  // rear roll door and lights
  for (let i = 0; i < 9; i++) p.box(c.dark, 0.012, 0.014, 2.1, -3.755, 1.25 + i * 0.22, 0, { cast: false });
  for (const sg of [-1, 1]) p.box(c.steel, 0.05, 2.1, 0.06, -3.77, 2.1, sg * 1.05);
  taillights(c, -3.79, 1.2, 1.05, [0.05, 0.36, 0.12]);
  bumperBar(c, -3.85, 0.62, 2.3, 0.22, 0.14, c.steelDark);
  p.box(c.dark, 6.2, 0.32, 1.4, -0.2, 0.7, 0); // chassis
  p.cyl(c.steel, 0.3, 0.3, 1.1, 10, 0.4, 0.62, half - 0.4, 'x'); // fuel tank
  wheelSet(c, 2.6, half - 0.15 + 0.03, 0.5, 0.3, false, half + 0.004);
  wheelSet(c, -2.0, half - 0.15 + 0.03, 0.5, 0.3, true);
  for (const sg of [-1, 1]) p.box(c.rubber, 0.05, 0.5, 0.35, -2.55, 0.55, sg * (half - 0.2)); // mudflap
  plate(c, -3.8, 0.7, -1);
  if (c.open) openDoor(c, 2.28, 0.95, 0.85, 2.75, half, 1);
  if (c.wrecked) shards(c, 2.85, 2.3, half + 0.024, 0.8, 0.7, 0);
  collideLocal(c.b, c.o, 2.7, 0, 2.15, 2.3, 2.85, COL);
  collideLocal(c.b, c.o, -1.1, 0, 5.3, 2.4, 3.3, COL);
  collideLocal(c.b, c.o, 0, 0, 7.5, 2.2, 0.95, COL);
  finish(c);
}

// ---------------------------------------------------------------------------------------------
// bus
// ---------------------------------------------------------------------------------------------

export function bus(c: VCtx): void {
  const p = c.p;
  const half = 1.25;
  p.bevelBox(c.paint, 11, 2.7, 2.5, 0.15, 0, 1.75, 0);
  p.box(c.dark, 10.9, 0.42, 2.54, 0, 0.66, 0);
  const stripe = c.b.mats.get('paintBlue');
  for (const sg of [-1, 1]) {
    p.box(stripe, 10.7, 0.22, 0.012, 0, 1.02, sg * (half + 0.006), { cast: false });
    // window band: individual panes with pillars between them
    for (let i = 0; i < 8; i++) {
      const x = -4.7 + i * 1.28;
      if (i === 5 || i === 6) continue;
      p.box(c.glass, 1.1, 0.95, 0.02, x, 2.15, sg * (half + 0.012));
    }
    // front and middle doors (right side only)
    if (sg > 0) {
      for (const dx of [4.25, 3.75]) p.box(c.glass, 0.46, 1.75, 0.02, dx, 1.55, half + 0.012);
      for (const dx of [-0.45, -0.95]) p.box(c.glass, 0.46, 1.75, 0.02, dx, 1.55, half + 0.012);
      p.box(c.dark, 0.03, 1.8, 0.03, 4.0, 1.55, half + 0.015);
      p.box(c.dark, 0.03, 1.8, 0.03, -0.7, 1.55, half + 0.015);
    }
    // wheel arches + wheels
    arch(c, 3.6, sg * (half + 0.004), 0.5);
    arch(c, -3.2, sg * (half + 0.004), 0.5);
    p.box(c.dark, 0.5, 0.14, 0.03, 0.0, 2.85, sg * (half + 0.01)); // side route sign
    p.box(c.b.mats.get('emAmber'), 0.4, 0.08, 0.02, 0.0, 2.85, sg * (half + 0.03), { cast: false });
  }
  wheelSet(c, 3.6, half - 0.16 + 0.03, 0.5, 0.32, false);
  wheelSet(c, -3.2, half - 0.16 + 0.03, 0.5, 0.32, true);
  // windscreen + route sign, headlights
  p.box(c.glass, 0.03, 1.05, 2.25, 5.52, 2.32, 0);
  p.box(c.dark, 0.03, 0.34, 1.7, 5.52, 2.95, 0);
  p.box(c.b.mats.get('emAmber'), 0.02, 0.22, 1.5, 5.53, 2.95, 0, { cast: false });
  for (const sg of [-1, 1]) {
    p.box(c.head, 0.05, 0.16, 0.34, 5.52, 0.98, sg * 0.95, { cast: false });
    p.box(c.dark, 0.3, 0.32, 0.1, 5.4, 2.6, sg * 1.42); // mirror bracket
    p.box(c.dark, 0.08, 0.5, 0.2, 5.4, 2.35, sg * 1.55);
  }
  p.box(c.dark, 0.05, 0.4, 1.0, 5.52, 1.2, 0);
  bumperBar(c, 5.56, 0.6, 2.4, 0.26, 0.14, c.steelDark);
  // rear
  p.box(c.glass, 0.02, 0.6, 1.3, -5.52, 2.5, 0);
  for (let i = 0; i < 5; i++) p.box(c.dark, 0.03, 0.03, 1.5, -5.52, 1.2 + i * 0.1, 0);
  taillights(c, -5.53, 1.9, 1.05, [0.04, 0.5, 0.1]);
  bumperBar(c, -5.56, 0.6, 2.4, 0.26, 0.14, c.steelDark);
  p.box(c.steel, 2.2, 0.3, 1.6, -2.5, 3.25, 0); // roof AC
  p.box(c.dark, 1.4, 0.16, 1.0, -0.5, 3.18, 0.2);
  if (c.rng.chance(0.6)) p.cyl(c.dark, 0.01, 0.01, 1.2, 4, -4.5, 3.7, -0.9, 'y');
  underbody(c, 10.4, 2.1, 0.32, 0.3, 0);
  plate(c, -5.54, 0.75, -1);
  mirror(c, 5.3, 2.2, 1.5, 0.6);
  if (c.wrecked) for (const sg of [-1, 1]) shards(c, 1.5, 2.15, sg * (half + 0.024), 3.0, 0.8, sg > 0 ? 0 : Math.PI);
  collideLocal(c.b, c.o, 0, 0, 11.0, 2.5, 3.1, COL);
  finish(c);
}

// ---------------------------------------------------------------------------------------------
// APC
// ---------------------------------------------------------------------------------------------

export function apc(c: VCtx): void {
  const p = c.p;
  const hull = c.paint;
  shell(c, [[-3.5, 0.55], [-3.5, 1.95], [-3.2, 2.1], [1.9, 2.1], [3.45, 1.5], [3.5, 0.95], [3.35, 0.6]], 2.86, hull, 0.05, 0.02);
  // upper deck plates and skirts
  p.bevelBox(hull, 4.4, 0.16, 2.5, 0.03, -1.1, 2.18, 0);
  for (const sg of [-1, 1]) {
    p.bevelBox(hull, 6.3, 0.3, 0.14, 0.03, -0.1, 1.2, sg * 1.53); // side skirt above wheels
    for (const ax of [2.35, 0.85, -0.7, -2.25]) p.bevelBox(hull, 1.15, 0.1, 0.5, 0.02, ax, 1.16, sg * 1.62); // fenders
    for (let i = 0; i < 6; i++) p.box(c.dark, 0.012, 0.32, 0.012, -2.7 + i * 1.05, 1.5, sg * 1.5, { cast: false }); // door seams
  }
  // wheels: 4 axles
  for (const ax of [2.35, 0.85, -0.7, -2.25]) wheelSet(c, ax, 1.42, 0.55, 0.42, false);
  // driver slits + headlights + tow hooks
  for (const z of [-0.8, 0, 0.8]) p.box(c.glass, 0.03, 0.14, 0.4, 2.62 + 0.0, 1.85, z, { rz: -0.42 });
  for (const sg of [-1, 1]) {
    p.box(c.dark, 0.14, 0.26, 0.32, 3.5, 1.1, sg * 1.05);
    p.box(c.head, 0.05, 0.16, 0.24, 3.58, 1.1, sg * 1.05, { cast: false });
    p.box(c.steelDark, 0.14, 0.06, 0.06, 3.55, 0.7, sg * 0.55);
  }
  p.box(c.dark, 0.05, 0.4, 1.2, 3.52, 1.2, 0);
  // turret / RWS, cupola, hatches, launchers, antennas
  p.bevelBox(hull, 0.95, 0.5, 0.85, 0.05, 0.6, 2.5, 0.5);
  p.cyl(c.steelDark, 0.045, 0.045, 1.7, 8, 1.6, 2.55, 0.5, 'x');
  p.sphere(c.dark, 0.16, 8, 6, 0.3, 2.85, 0.5);
  for (const dz of [0.22, 0.34, 0.46]) for (const sg of [-1, 1]) p.cyl(c.steelDark, 0.035, 0.035, 0.22, 6, 0.95, 2.55, 0.5 + sg * dz + 0.0, 'x', { rz: 0.5 });
  p.cyl(hull, 0.42, 0.46, 0.3, 10, -0.6, 2.4, -0.55, 'y');
  p.cyl(c.dark, 0.34, 0.34, 0.05, 10, -0.6, 2.56, -0.55, 'y');
  for (const [hx, hz] of [[-2.0, 0.6], [-2.0, -0.6]] as const) {
    p.cyl(hull, 0.36, 0.38, 0.1, 10, hx, 2.3, hz, 'y');
    p.cyl(c.dark, 0.3, 0.3, 0.03, 10, hx, 2.36, hz, 'y');
  }
  for (const [ax, az] of [[-3.2, 1.1], [-1.4, -1.0]] as const) {
    p.cyl(c.dark, 0.02, 0.025, 2.4, 5, ax, 3.4, az, 'y');
    p.cyl(c.steelDark, 0.07, 0.09, 0.1, 6, ax, 2.3, az, 'y');
  }
  // rear: ramp lines, jerry cans
  p.box(c.dark, 0.03, 1.2, 1.5, -3.55, 1.3, 0);
  for (const sg of [-1, 1]) {
    p.box(hull, 0.16, 0.5, 0.36, -3.65, 1.05, sg * 1.2);
    p.box(c.dark, 0.06, 0.1, 0.16, -3.72, 1.32, sg * 1.2);
  }
  taillights(c, -3.53, 1.6, 1.15, [0.05, 0.14, 0.2]);
  underbody(c, 6.6, 2.2, 0.55, 0.36, 0);
  if (c.wrecked) p.box(c.dark, 0.6, 0.06, 1.2, 2.9, 1.78, 0);
  collideLocal(c.b, c.o, 0, 0, 7.0, 2.9, 2.15, COL);
  collideLocal(c.b, c.o, 0.6, 0.5, 1.0, 0.9, 2.65, COL);
  finish(c);
}

// ---------------------------------------------------------------------------------------------
// cab + tractor + tanker + trailer
// ---------------------------------------------------------------------------------------------

/** Conventional sleeper cab with long nose. Front at x = xf; returns nothing. */
function conventionalCab(c: VCtx, xShift: number): void {
  const p = c.p;
  const X = (x: number): number => x + xShift;
  shell(c, [[X(-1.4), 0.9], [X(-1.4), 3.55], [X(0.6), 3.6], [X(1.0), 3.0], [X(1.12), 2.6], [X(1.12), 0.9]], 2.4, c.paint, 0.04, 0.03);
  p.box(c.glass, 0.6, 0.03, 2.1, X(0.83), 3.34, 0, { rz: -1.0 });
  shell(c, [[X(1.1), 1.2], [X(1.1), 2.6], [X(2.5), 2.45], [X(3.0), 2.25], [X(3.05), 1.65], [X(2.95), 1.2]], 1.75, c.paint, 0.04, 0.03);
  const half = 1.2 + 0.04;
  for (const sg of [-1, 1]) {
    p.box(c.glass, 0.95, 0.85, 0.02, X(0.35), 2.85, sg * (half + 0.012));
    p.box(c.paint, 0.05, 0.95, 0.03, X(-0.15), 2.85, sg * (half + 0.012));
    p.box(c.dark, 0.02, 0.5, 0.03, X(-1.42), 3.1, sg * 0.5); // sleeper
    p.box(c.dark, 0.014, 1.9, 0.012, X(0.85), 1.9, sg * (half + 0.004));
    p.box(c.steel, 0.5, 0.04, 0.26, X(0.4), 1.05, sg * (half + 0.09));
    p.box(c.steel, 0.5, 0.04, 0.26, X(0.4), 1.65, sg * (half + 0.09));
    p.box(c.dark, 0.14, 0.6, 0.06, X(0.95), 2.9, sg * (half + 0.28));
    p.cyl(c.steel, 0.07, 0.07, 2.0, 8, X(-1.55), 2.9, sg * 1.2, 'y'); // exhaust stacks
    p.cyl(c.steel, 0.36, 0.36, 1.5, 10, X(0.0), 0.85, sg * (half + 0.16), 'x'); // saddle tanks
    p.box(c.head, 0.06, 0.2, 0.38, X(3.03), 1.85, sg * 0.62, { cast: false });
    p.box(c.dark, 0.08, 0.28, 0.44, X(3.0), 1.85, sg * 0.62);
  }
  // grille: chrome frame with dark slats
  p.box(c.steel, 0.06, 1.0, 0.82, X(3.06), 1.7, 0);
  for (let i = -2; i <= 2; i++) p.box(c.dark, 0.07, 0.9, 0.03, X(3.075), 1.7, i * 0.15);
  bumperBar(c, X(3.1), 0.95, 2.35, 0.3, 0.2, c.steel);
}

export function semiCab(c: VCtx): void {
  const p = c.p;
  conventionalCab(c, -0.15);
  // frame, fifth wheel, air lines, wheels (steer + tandem drive)
  p.box(c.dark, 6.3, 0.3, 1.3, -0.1, 0.9, 0);
  p.box(c.dark, 1.4, 0.16, 1.7, -2.6, 1.3, 0);
  p.box(c.steelDark, 0.7, 0.12, 0.7, -2.5, 1.42, 0);
  wheelSet(c, 2.3, 1.05, 0.52, 0.32, false, 1.24);
  wheelSet(c, -2.1, 1.05, 0.5, 0.3, true);
  wheelSet(c, -3.4, 1.05, 0.5, 0.3, true);
  for (const sg of [-1, 1]) {
    p.box(c.rubber, 0.05, 0.5, 0.4, -3.95, 0.6, sg * 0.95);
    p.cyl(c.dark, 0.02, 0.02, 1.4, 4, -2.7, 1.35, sg * 0.4, 'z');
  }
  taillights(c, -4.0, 1.0, 0.9, [0.05, 0.2, 0.14]);
  collideLocal(c.b, c.o, -0.9, 0, 2.05, 2.45, 3.6, COL);
  collideLocal(c.b, c.o, 1.5, 0, 2.0, 1.78, 2.5, COL);
  collideLocal(c.b, c.o, -0.5, 0, 7.0, 2.2, 1.05, COL);
  finish(c);
}

export function tanker(c: VCtx): void {
  const p = c.p;
  conventionalCab(c, 3.3);
  p.box(c.dark, 9.2, 0.3, 1.3, 0, 0.9, 0);
  // tank: horizontal cylinder with domed ends and bands
  const r = 1.12;
  const cy = 2.1;
  const tankMat = c.paint;
  p.cyl(tankMat, r, r, 6.6, 18, -1.6, cy, 0, 'x', { sz: 1.08 });
  for (const sx of [1, -1]) p.sphere(tankMat, r, 10, 6, -1.6 + sx * 3.3, cy, 0, { sx: 0.3, sz: 1.08 });
  for (let i = 0; i < 4; i++) p.cyl(c.dark, r + 0.025, r + 0.025, 0.1, 18, -3.6 + i * 1.6, cy, 0, 'x', { sz: 1.08 });
  p.cyl(c.dark, 0.34, 0.34, 0.16, 12, -0.4, cy + r + 0.06, 0, 'y');
  p.cyl(c.steel, 0.3, 0.3, 0.06, 12, -0.4, cy + r + 0.16, 0, 'y');
  p.cyl(c.dark, 0.34, 0.34, 0.16, 12, -2.8, cy + r + 0.06, 0, 'y');
  for (const sg of [-1, 1]) p.box(c.steelDark, 5.4, 0.04, 0.04, -1.6, cy + r + 0.3, sg * 0.35); // top rails
  p.box(c.steelDark, 0.06, 0.08, 0.7, -2.0, cy + r + 0.32, 0);
  // rear valves, ladder, hoses
  p.box(c.dark, 0.5, 0.5, 0.9, -4.85, 1.0, 0);
  for (const dz of [-0.28, 0, 0.28]) p.cyl(c.steel, 0.06, 0.06, 0.25, 8, -5.15, 0.95, dz, 'x');
  for (let i = 0; i < 6; i++) p.box(c.steelDark, 0.04, 0.03, 0.4, -5.0, 1.0 + i * 0.35, 1.0);
  p.box(c.steelDark, 0.04, 2.2, 0.04, -5.0, 2.1, 0.8);
  p.box(c.steelDark, 0.04, 2.2, 0.04, -5.0, 2.1, 1.2);
  wheelSet(c, 3.0, 1.1, 0.52, 0.32, false, 1.24);
  wheelSet(c, -2.9, 1.05, 0.5, 0.3, true);
  wheelSet(c, -4.2, 1.05, 0.5, 0.3, true);
  taillights(c, -5.2, 1.05, 0.95, [0.05, 0.2, 0.14]);
  bumperBar(c, -5.25, 0.6, 2.3, 0.22, 0.14, c.steelDark);
  collideLocal(c.b, c.o, 3.4, 0, 2.05, 2.45, 3.6, COL);
  collideLocal(c.b, c.o, 4.9, 0, 2.0, 1.78, 2.5, COL);
  collideLocal(c.b, c.o, -1.6, 0, 6.8, 2.3, 3.25, COL);
  collideLocal(c.b, c.o, 0, 0, 9.2, 2.2, 1.05, COL);
  finish(c);
}

export function trailer(c: VCtx): void {
  const p = c.p;
  p.bevelBox(c.paint, 13.4, 2.9, 2.55, 0.05, 0, 2.55, 0);
  const mats = c.b.mats;
  const label = stencil(mats, 'KESTREL LINE', { color: '#e6e2d6', font: 'stencil', aspect: 7, worn: true });
  const dark = c.dark;
  p.box(dark, 13.5, 0.06, 2.6, 0, 1.13, 0);
  for (const sg of [-1, 1]) {
    p.box(dark, 13.3, 0.1, 0.03, 0, 3.98, sg * 1.28);
    for (let i = 0; i < 22; i++) p.box(dark, 0.02, 2.8, 0.014, -6.3 + i * 0.6, 2.55, sg * 1.279, { cast: false });
    p.plane(label, 3.6, 0.5, 1.0, 2.9, sg * 1.285, { ry: sg > 0 ? 0 : Math.PI, cast: false });
  }
  // chassis rails and cross members
  for (const sg of [-1, 1]) p.box(dark, 12.6, 0.26, 0.14, 0.2, 0.95, sg * 0.85);
  for (let i = 0; i < 6; i++) p.box(dark, 0.1, 0.16, 1.9, -5 + i * 2, 1.0, 0);
  // landing gear
  for (const sg of [-1, 1]) {
    p.box(c.steelDark, 0.14, 0.9, 0.14, 4.6, 0.6, sg * 0.95);
    p.box(c.steelDark, 0.35, 0.05, 0.3, 4.6, 0.14, sg * 0.95);
  }
  wheelSet(c, -4.6, 1.05, 0.5, 0.3, true);
  wheelSet(c, -5.95, 1.05, 0.5, 0.3, true);
  for (const sg of [-1, 1]) p.box(c.rubber, 0.05, 0.5, 0.45, -6.45, 0.6, sg * 0.9);
  // rear doors: locking bars, hinges, bumper
  for (const sg of [-1, 1]) {
    p.box(mats.get('steel'), 0.06, 2.6, 0.05, -6.72, 2.5, sg * 0.55);
    p.box(mats.get('steel'), 0.06, 2.6, 0.05, -6.72, 2.5, sg * 1.1);
    p.box(dark, 0.06, 0.2, 0.14, -6.72, 2.35, sg * 0.55);
  }
  p.box(dark, 0.03, 2.7, 0.03, -6.71, 2.55, 0);
  p.box(dark, 0.14, 0.24, 2.3, -6.8, 0.75, 0);
  taillights(c, -6.73, 1.5, 1.1, [0.05, 0.4, 0.12]);
  p.box(c.steelDark, 0.4, 0.3, 0.4, 5.4, 1.2, 0); // kingpin plate hint
  collideLocal(c.b, c.o, 0, 0, 13.4, 2.55, 4.0, COL);
  finish(c);
}
