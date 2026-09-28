/** Passenger road vehicles: sedan, hatch, suv, pickup, van, jeep, ambulance. */
import { collideLocal, stencil } from './util';
import {
  type VCtx,
  arch,
  bumperBar,
  finish,
  handle,
  headlights,
  mirror,
  pillar,
  plate,
  roofPanel,
  seam,
  shards,
  shell,
  taillights,
  underbody,
  wheel,
} from './vehicleKit';

type Pt = [number, number];

interface CarSpec {
  lower: Pt[];
  width: number;
  gh: Pt[];
  ghWidth: number;
  roof: [number, number, number];
  pillars: [Pt, Pt][];
  bPillars: number[];
  axles: [number, number];
  wheelR: number;
  wheelW: number;
  head: { x: number; y: number; z: number };
  tail: { x: number; y: number; z: number };
  grille: { x: number; y: number; w: number };
  bumperF: { x: number; y: number; w: number };
  bumperR: { x: number; y: number; w: number };
  seams: number[];
  handles: number[];
  seamY: [number, number];
  mirror: { x: number; y: number };
  belt: number;
  colliders: { cx: number; len: number; w: number; h: number }[];
  plateY: number;
  cladding?: { len: number; cx: number; y: number };
  roofRails?: boolean;
  hinge: { x: number; len: number };
}

function boxyCar(c: VCtx, s: CarSpec): void {
  const p = c.p;
  const bevel = 0.04;
  shell(c, s.lower, s.width, c.paint, bevel, 0.03);
  shell(c, s.gh, s.ghWidth, c.glass, 0);
  roofPanel(c, s.roof[0], s.roof[1], s.roof[2], s.ghWidth + 0.02);
  for (const [a, b] of s.pillars) pillar(c, a, b, s.ghWidth / 2 - 0.01);
  for (const x of s.bPillars) for (const sg of [-1, 1]) p.box(c.paint, 0.07, s.roof[2] - s.belt, 0.05, x, (s.roof[2] + s.belt) / 2, sg * (s.ghWidth / 2 - 0.01));
  const half = s.width / 2 + bevel;
  underbody(c, s.lower[0]![0] * -1 + s.lower[s.lower.length - 1]![0] - 0.6, s.width - 0.2, 0.22, 0.18, 0);
  if (s.cladding) p.box(c.dark, s.cladding.len, 0.16, s.width + 0.1, s.cladding.cx, s.cladding.y, 0);
  for (const ax of s.axles) {
    for (const sg of [-1, 1]) {
      wheel(c, ax, sg * (half - s.wheelW / 2 + 0.03), s.wheelR, s.wheelW);
      arch(c, ax, sg * (half + 0.004), s.wheelR);
    }
  }
  headlights(c, s.head.x, s.head.y, s.head.z);
  taillights(c, s.tail.x, s.tail.y, s.tail.z);
  p.box(c.dark, 0.03, 0.16, s.grille.w, s.grille.x, s.grille.y, 0);
  for (let i = -2; i <= 2; i++) p.box(c.steel, 0.02, 0.012, s.grille.w * 0.9, s.grille.x + 0.012, s.grille.y + i * 0.03, 0, { cast: false });
  bumperBar(c, s.bumperF.x, s.bumperF.y, s.bumperF.w, 0.2, 0.12);
  bumperBar(c, s.bumperR.x, s.bumperR.y, s.bumperR.w, 0.2, 0.12);
  plate(c, s.tail.x - 0.02, s.plateY, -1);
  mirror(c, s.mirror.x, s.mirror.y, half);
  for (const x of s.seams) seam(c, x, s.seamY[0], s.seamY[1], half);
  for (const x of s.handles) handle(c, x, s.seamY[1] - 0.09, half);
  if (s.roofRails) for (const sg of [-1, 1]) p.box(c.steelDark, (s.roof[1] - s.roof[0]) * 0.9, 0.04, 0.04, (s.roof[0] + s.roof[1]) / 2, s.roof[2] + 0.09, sg * s.ghWidth * 0.42);
  // wipers resting along the base of the windscreen
  const wb = s.pillars[0]![0];
  for (const z of [-0.36, 0.36]) {
    p.strut(c.dark, wb[0] - 0.03, wb[1] + 0.035, z - 0.28, wb[0] - 0.03, wb[1] + 0.035, z + 0.28, 0.014, { cast: false });
    p.box(c.dark, 0.02, 0.03, 0.03, wb[0] - 0.03, wb[1] + 0.03, z + (z < 0 ? 0.28 : -0.28), { cast: false });
  }
  // antenna
  if (c.rng.chance(0.5)) p.cyl(c.dark, 0.006, 0.01, 0.6, 4, s.roof[0] + 0.2, s.roof[2] + 0.36, s.ghWidth * 0.38, 'y');
  if (c.wrecked) {
    for (const sg of [-1, 1]) shards(c, (s.roof[0] + s.roof[1]) / 2, (s.belt + s.roof[2]) / 2, sg * (s.ghWidth / 2 + 0.003), (s.roof[1] - s.roof[0]) * 0.9, s.roof[2] - s.belt - 0.06, sg > 0 ? 0 : Math.PI);
    // crumpled hood edge: a dark gap
    p.box(c.dark, 0.5, 0.05, s.width * 0.8, s.lower[s.lower.length - 3]![0] - 0.1, s.lower[s.lower.length - 3]![1] + 0.03, 0);
  }
  if (c.open) openDoor(c, s.hinge.x, s.hinge.len, s.seamY[0], s.seamY[1] + 0.05, half, 1);
  else if (c.wrecked && c.rng.chance(0.3)) openDoor(c, s.hinge.x, s.hinge.len, s.seamY[0], s.seamY[1] + 0.05, half, -1);
  for (const col of s.colliders) collideLocal(c.b, c.o, col.cx, 0, col.len, col.w, col.h, { surface: 'metal', mapKind: 'vehicle', tag: 'vehicle' });
  finish(c);
}

/** A door hanging open on its front hinge, plus the dark cavity it leaves. side +1 = right (+Z). */
export function openDoor(c: VCtx, hingeX: number, len: number, y0: number, y1: number, zBody: number, side: 1 | -1, ang = 1.05): void {
  const h = y1 - y0;
  const th = ang * side;
  const cx = hingeX + Math.cos(th) * (-len / 2);
  const cz = side * zBody + Math.sin(th) * (len / 2);
  c.p.bevelBox(c.paint, len, h, 0.05, 0.012, cx, (y0 + y1) / 2, cz, { ry: th });
  c.p.box(c.glass, len * 0.8, h * 0.35, 0.03, cx, y1 - h * 0.25, cz, { ry: th });
  c.p.plane(c.dark, len, h, hingeX - len / 2, (y0 + y1) / 2, side * (zBody + 0.006), { ry: side > 0 ? 0 : Math.PI, cast: false });
}

export function sedan(c: VCtx): void {
  boxyCar(c, {
    lower: [[-2.2, 0.3], [-2.24, 0.5], [-2.24, 0.88], [-1.92, 0.96], [-1.3, 0.99], [0.95, 0.99], [1.58, 0.93], [2.12, 0.82], [2.22, 0.7], [2.22, 0.48], [2.18, 0.3]],
    width: 1.74,
    gh: [[-1.32, 0.99], [-0.82, 1.4], [0.28, 1.42], [0.95, 0.99]],
    ghWidth: 1.5,
    roof: [-0.84, 0.3, 1.41],
    pillars: [[[0.95, 0.99], [0.28, 1.42]], [[-1.32, 0.99], [-0.82, 1.4]]],
    bPillars: [-0.15],
    axles: [1.38, -1.3],
    wheelR: 0.33,
    wheelW: 0.22,
    head: { x: 2.2, y: 0.72, z: 0.62 },
    tail: { x: -2.245, y: 0.84, z: 0.64 },
    grille: { x: 2.235, y: 0.6, w: 0.9 },
    bumperF: { x: 2.24, y: 0.42, w: 1.7 },
    bumperR: { x: -2.26, y: 0.42, w: 1.7 },
    seams: [0.72, -0.15, -1.0],
    handles: [0.25, -0.62],
    seamY: [0.4, 0.98],
    mirror: { x: 0.7, y: 1.04 },
    belt: 0.99,
    colliders: [
      { cx: -0.01, len: 4.55, w: 1.8, h: 0.99 },
      { cx: -0.19, len: 2.2, w: 1.5, h: 1.45 },
    ],
    plateY: 0.66,
    hinge: { x: 0.72, len: 0.95 },
  });
}

export function hatch(c: VCtx): void {
  boxyCar(c, {
    lower: [[-1.86, 0.3], [-1.93, 0.5], [-1.93, 0.92], [0.78, 0.95], [1.3, 0.9], [1.8, 0.8], [1.9, 0.66], [1.9, 0.46], [1.86, 0.3]],
    width: 1.68,
    gh: [[-1.9, 0.93], [-1.7, 1.44], [0.2, 1.46], [0.8, 0.95]],
    ghWidth: 1.46,
    roof: [-1.72, 0.22, 1.45],
    pillars: [[[0.8, 0.95], [0.2, 1.46]], [[-1.9, 0.93], [-1.7, 1.44]]],
    bPillars: [-0.5],
    axles: [1.22, -1.2],
    wheelR: 0.3,
    wheelW: 0.2,
    head: { x: 1.88, y: 0.7, z: 0.58 },
    tail: { x: -1.94, y: 0.86, z: 0.6 },
    grille: { x: 1.9, y: 0.58, w: 0.8 },
    bumperF: { x: 1.92, y: 0.42, w: 1.62 },
    bumperR: { x: -1.95, y: 0.42, w: 1.62 },
    seams: [0.62, -0.5],
    handles: [0.2],
    seamY: [0.4, 0.94],
    mirror: { x: 0.62, y: 1.0 },
    belt: 0.95,
    colliders: [
      { cx: 0, len: 3.85, w: 1.72, h: 0.95 },
      { cx: -0.55, len: 2.5, w: 1.45, h: 1.47 },
    ],
    plateY: 0.66,
    hinge: { x: 0.62, len: 0.9 },
  });
}

export function suv(c: VCtx): void {
  boxyCar(c, {
    lower: [[-2.3, 0.36], [-2.38, 0.55], [-2.38, 1.05], [0.98, 1.08], [1.6, 1.02], [2.22, 0.95], [2.36, 0.8], [2.36, 0.55], [2.28, 0.36]],
    width: 1.9,
    gh: [[-2.3, 1.06], [-2.16, 1.68], [0.18, 1.7], [1.0, 1.08]],
    ghWidth: 1.64,
    roof: [-2.18, 0.2, 1.69],
    pillars: [[[1.0, 1.08], [0.18, 1.7]], [[-2.3, 1.06], [-2.16, 1.68]]],
    bPillars: [-0.3, -1.4],
    axles: [1.48, -1.36],
    wheelR: 0.38,
    wheelW: 0.26,
    head: { x: 2.34, y: 0.86, z: 0.68 },
    tail: { x: -2.4, y: 0.95, z: 0.72 },
    grille: { x: 2.37, y: 0.7, w: 1.0 },
    bumperF: { x: 2.38, y: 0.48, w: 1.84 },
    bumperR: { x: -2.42, y: 0.48, w: 1.84 },
    seams: [0.8, -0.3, -1.4],
    handles: [0.3, -0.85],
    seamY: [0.5, 1.06],
    mirror: { x: 0.85, y: 1.14 },
    belt: 1.08,
    colliders: [
      { cx: 0, len: 4.78, w: 1.92, h: 1.08 },
      { cx: -0.98, len: 3.2, w: 1.64, h: 1.72 },
    ],
    plateY: 0.72,
    cladding: { len: 4.0, cx: 0, y: 0.5 },
    roofRails: true,
    hinge: { x: 0.8, len: 1.0 },
  });
}

export function van(c: VCtx): void {
  const p = c.p;
  shell(c, [[-2.62, 0.35], [-2.7, 0.55], [-2.7, 2.02], [-2.62, 2.08], [1.3, 2.08], [1.85, 1.62], [2.45, 1.12], [2.7, 0.95], [2.7, 0.5], [2.62, 0.35]], 1.98, c.paint, 0.04, 0.03);
  underbody(c, 5.0, 1.7, 0.22, 0.18, 0);
  // windscreen on the front slope, cab side windows, rear door windows
  p.box(c.glass, 0.74, 0.03, 1.72, 1.617, 1.898, 0, { rz: -0.698 });
  for (const sg of [-1, 1]) {
    p.box(c.glass, 0.85, 0.46, 0.02, 1.0, 1.66, sg * 1.045);
    p.box(c.paint, 0.05, 0.5, 0.03, 1.44, 1.66, sg * 1.045);
    p.box(c.dark, 0.02, 0.5, 0.1, -2.75, 1.62, sg * 0.45);
    p.box(c.glass, 0.02, 0.5, 0.42, -2.755, 1.62, sg * 0.45);
  }
  // sliding door (right side) and cargo panel lines
  for (const x of [0.55, -0.55, -2.0]) seam(c, x, 0.45, 1.95, 1.04);
  p.box(c.dark, 1.05, 0.02, 0.012, -0.55, 0.42, 1.044);
  for (const sg of [-1, 1]) {
    p.box(c.dark, 3.2, 0.03, 0.012, -0.9, 1.15, sg * 1.044);
    handle(c, 0.35, 1.2, 1.04);
  }
  for (const ax of [1.75, -1.55]) {
    for (const sg of [-1, 1]) {
      wheel(c, ax, sg * (1.03 - 0.12 + 0.04), 0.36, 0.24);
      arch(c, ax, sg * 1.044, 0.36);
    }
  }
  headlights(c, 2.68, 0.86, 0.7, [0.06, 0.16, 0.36]);
  taillights(c, -2.72, 0.98, 0.86, [0.05, 0.42, 0.1]);
  p.box(c.dark, 0.03, 0.2, 1.0, 2.71, 0.72, 0);
  bumperBar(c, 2.72, 0.42, 1.95, 0.22, 0.12);
  bumperBar(c, -2.74, 0.42, 1.95, 0.22, 0.12);
  plate(c, -2.74, 0.7, -1);
  mirror(c, 1.55, 1.55, 1.04, 1.4);
  p.box(c.steel, 5.0, 0.03, 0.03, -0.05, 2.14, 0.6); // roof rack rails
  p.box(c.steel, 5.0, 0.03, 0.03, -0.05, 2.14, -0.6);
  if (c.open) openDoor(c, 1.44, 0.95, 0.5, 1.95, 1.04, 1);
  if (c.wrecked) shards(c, 1.0, 1.66, 1.056, 0.8, 0.4, 0);
  collideLocal(c.b, c.o, 0, 0, 5.4, 1.98, 2.08, { surface: 'metal', mapKind: 'vehicle', tag: 'vehicle' });
  finish(c);
}

export function pickup(c: VCtx): void {
  const p = c.p;
  const half = 0.99 + 0.04;
  shell(c, [[-0.7, 0.4], [-0.7, 1.05], [1.15, 1.07], [1.95, 1.0], [2.6, 0.9], [2.65, 0.72], [2.65, 0.52], [2.55, 0.4]], 1.98, c.paint, 0.04, 0.03);
  shell(c, [[-0.68, 1.06], [-0.6, 1.8], [0.95, 1.82], [1.25, 1.08]], 1.72, c.glass, 0);
  roofPanel(c, -0.62, 0.98, 1.81, 1.74);
  for (const [a, b] of [[[1.25, 1.08], [0.95, 1.82]], [[-0.68, 1.06], [-0.6, 1.8]]] as [Pt, Pt][]) pillar(c, a, b, 0.85);
  for (const sg of [-1, 1]) p.box(c.paint, 0.07, 0.75, 0.05, 0.28, 1.44, sg * 0.85);
  underbody(c, 4.8, 1.6, 0.24, 0.2, -0.2);
  // bed
  p.box(c.dark, 1.95, 0.32, 1.6, -1.68, 0.62, 0);
  p.box(c.dark, 1.94, 0.05, 1.84, -1.68, 0.86, 0);
  for (const sg of [-1, 1]) {
    p.bevelBox(c.paint, 2.0, 0.55, 0.07, 0.02, -1.66, 1.13, sg * 0.955);
    p.box(c.paint, 0.55, 0.28, 0.32, -1.74, 1.0, sg * 0.78); // wheel wells
  }
  p.bevelBox(c.paint, 0.07, 0.55, 1.98, 0.02, -2.66, 1.13, 0);
  p.bevelBox(c.paint, 0.07, 0.55, 1.98, 0.02, -0.74, 1.13, 0);
  for (const ax of [1.75, -1.45]) {
    for (const sg of [-1, 1]) {
      wheel(c, ax, sg * (half - 0.14 + 0.03), 0.4, 0.28);
      arch(c, ax, sg * (half + 0.004), 0.4);
    }
  }
  headlights(c, 2.63, 0.78, 0.7, [0.06, 0.14, 0.4]);
  taillights(c, -2.69, 1.1, 0.9, [0.05, 0.16, 0.1]);
  p.box(c.dark, 0.03, 0.2, 1.0, 2.66, 0.66, 0);
  bumperBar(c, 2.68, 0.46, 1.98, 0.22, 0.14, c.steel);
  bumperBar(c, -2.74, 0.5, 1.98, 0.2, 0.12, c.steel);
  plate(c, -2.72, 0.75, -1);
  mirror(c, 0.98, 1.28, half, 1.3);
  for (const x of [0.9, 0.28, -0.35]) seam(c, x, 0.42, 1.02, half);
  handle(c, 0.6, 0.98, half);
  if (c.open) openDoor(c, 0.9, 0.95, 0.42, 1.55, half, 1);
  if (c.wrecked) for (const sg of [-1, 1]) shards(c, 0.3, 1.44, sg * 0.87, 1.0, 0.5, sg > 0 ? 0 : Math.PI);
  collideLocal(c.b, c.o, 0.97, 0, 3.35, 1.98, 1.07, { surface: 'metal', mapKind: 'vehicle', tag: 'vehicle' });
  collideLocal(c.b, c.o, 0.1, 0, 1.95, 1.72, 1.85, { surface: 'metal', mapKind: 'vehicle', tag: 'vehicle' });
  collideLocal(c.b, c.o, -1.68, 0, 1.98, 1.95, 0.95, { surface: 'metal', mapKind: 'vehicle', tag: 'vehicle' });
  finish(c);
}

export function jeep(c: VCtx): void {
  const p = c.p;
  const canvasTop = c.rng.chance(0.55);
  const tan = c.b.mats.get('canvasTan');
  // hood block + fenders
  shell(c, [[0.35, 0.4], [0.35, 1.0], [1.3, 1.06], [1.85, 1.02], [1.95, 0.9], [1.95, 0.5], [1.86, 0.4]], 1.5, c.paint, 0.04, 0.03);
  for (const sg of [-1, 1]) {
    p.bevelBox(c.paint, 1.0, 0.09, 0.36, 0.02, 1.2, 1.0, sg * 0.82);
    p.bevelBox(c.paint, 0.9, 0.09, 0.36, 0.02, -1.15, 0.99, sg * 0.86);
  }
  // tub: floor, sides, back, seats
  p.box(c.dark, 2.3, 0.08, 1.6, -0.75, 0.46, 0);
  for (const sg of [-1, 1]) p.bevelBox(c.paint, 2.3, 0.56, 0.06, 0.015, -0.78, 0.72, sg * 0.83);
  p.bevelBox(c.paint, 0.06, 0.56, 1.72, 0.015, -1.94, 0.72, 0);
  p.bevelBox(c.paint, 0.06, 0.6, 1.72, 0.015, 0.36, 0.72, 0);
  const seatMat = c.b.mats.get('rubber');
  for (const sg of [-1, 1]) {
    p.box(seatMat, 0.5, 0.14, 0.5, -0.1, 0.62, sg * 0.4);
    p.box(seatMat, 0.1, 0.55, 0.5, -0.35, 0.95, sg * 0.4, { rz: 0.15 });
  }
  p.box(seatMat, 0.5, 0.14, 1.4, -1.2, 0.62, 0);
  p.box(seatMat, 0.1, 0.5, 1.4, -1.5, 0.9, 0, { rz: 0.12 });
  p.box(c.dark, 0.32, 0.22, 1.5, 0.28, 1.06, 0); // dash
  // windscreen frame + glass
  for (const sg of [-1, 1]) p.box(c.paint, 0.05, 0.62, 0.05, 0.42, 1.34, sg * 0.79, { rz: 0.16 });
  p.box(c.paint, 0.05, 0.05, 1.62, 0.34, 1.65, 0, { rz: 0.16 });
  p.box(c.glass, 0.03, 0.55, 1.5, 0.42, 1.36, 0, { rz: 0.16 });
  // roll bar / canvas top
  for (const sg of [-1, 1]) {
    p.cyl(c.steelDark, 0.025, 0.025, 1.0, 6, -0.95, 1.5, sg * 0.75, 'y');
  }
  p.cyl(c.steelDark, 0.025, 0.025, 1.5, 6, -0.95, 1.98, 0, 'z');
  if (canvasTop) {
    p.bevelBox(tan, 1.35, 0.04, 1.7, 0.01, -0.62, 1.98, 0);
    for (const sg of [-1, 1]) p.box(tan, 1.3, 0.5, 0.03, -0.62, 1.72, sg * 0.86, { rx: sg * 0.08 });
  }
  // spare, grille, lights, bumper
  p.cyl(c.tire, 0.33, 0.33, 0.2, 12, -2.06, 0.9, 0, 'x');
  p.cyl(c.steel, 0.19, 0.19, 0.22, 8, -2.06, 0.9, 0, 'x');
  for (const sg of [-1, 1]) {
    p.cyl(c.head, 0.09, 0.09, 0.06, 10, 1.96, 0.78, sg * 0.55, 'x', { cast: false });
    p.cyl(c.dark, 0.11, 0.11, 0.04, 10, 1.945, 0.78, sg * 0.55, 'x');
  }
  for (let i = -3; i <= 3; i++) p.box(c.dark, 0.03, 0.34, 0.035, 1.96, 0.72, i * 0.08);
  taillights(c, -1.97, 0.86, 0.72, [0.04, 0.12, 0.12]);
  bumperBar(c, 2.02, 0.48, 1.7, 0.16, 0.16, c.steelDark);
  bumperBar(c, -1.98, 0.5, 1.7, 0.16, 0.14, c.steelDark);
  for (const ax of [1.2, -1.15]) {
    for (const sg of [-1, 1]) wheel(c, ax, sg * 0.86, 0.37, 0.27);
  }
  p.box(c.dark, 3.5, 0.14, 1.3, 0, 0.36, 0);
  mirror(c, 0.55, 1.2, 0.86, 0.9);
  if (c.wrecked) shards(c, 0.42, 1.36, 0, 1.4, 0.5, Math.PI / 2, 0);
  collideLocal(c.b, c.o, 0, 0, 3.95, 1.72, 1.05, { surface: 'metal', mapKind: 'vehicle', tag: 'vehicle' });
  if (canvasTop) collideLocal(c.b, c.o, -0.62, 0, 1.4, 1.7, 2.0, { surface: 'fabric', mapKind: 'vehicle', tag: 'vehicle' });
  finish(c);
}

export function ambulance(c: VCtx): void {
  const p = c.p;
  const red = c.b.mats.get('paintRed');
  const blue = c.b.mats.get('paintBlue');
  // box body + cab
  p.bevelBox(c.paint, 4.1, 2.08, 2.1, 0.05, -0.95, 1.46, 0);
  shell(c, [[1.02, 0.4], [1.02, 1.85], [1.36, 1.9], [2.05, 1.42], [2.85, 1.12], [3.0, 0.98], [3.0, 0.5], [2.9, 0.4]], 2.0, c.paint, 0.04, 0.03);
  underbody(c, 5.6, 1.7, 0.24, 0.2, 0);
  p.box(c.glass, 0.86, 0.03, 1.8, 1.742, 1.712, 0, { rz: -0.6 });
  for (const sg of [-1, 1]) {
    p.box(c.glass, 0.7, 0.5, 0.02, 1.42, 1.5, sg * 1.05);
    // stripes
    p.box(red, 4.0, 0.2, 0.012, -0.95, 1.2, sg * 1.06);
    p.box(blue, 4.0, 0.05, 0.012, -0.95, 1.02, sg * 1.06);
    p.box(red, 1.85, 0.2, 0.012, 2.0, 0.85, sg * 1.03);
    // compartment seams
    p.box(c.dark, 0.014, 1.0, 0.012, -0.5, 1.4, sg * 1.06);
    p.box(c.dark, 0.014, 1.0, 0.012, -1.7, 1.4, sg * 1.06);
    p.box(c.dark, 0.02, 0.5, 0.42, -3.01, 1.6, sg * 0.5);
    p.box(c.glass, 0.02, 0.46, 0.4, -3.012, 1.6, sg * 0.5);
  }
  const label = stencil(c.b.mats, 'AMBULANCE', { color: '#b3141b', font: 'sans', aspect: 6 });
  p.plane(label, 2.1, 0.36, -1.7, 1.78, 1.064, { cast: false });
  p.plane(label, 2.1, 0.36, -1.7, 1.78, -1.064, { ry: Math.PI, cast: false });
  // roof light bar
  const redLens = c.b.mats.get('lampRed');
  const blueLens = c.b.mats.get('emBlue');
  p.box(c.dark, 0.3, 0.1, 1.5, 0.9, 2.55, 0);
  p.box(redLens, 0.24, 0.07, 0.6, 0.9, 2.6, 0.4, { cast: false });
  p.box(blueLens, 0.24, 0.07, 0.6, 0.9, 2.6, -0.4, { cast: false });
  p.box(c.steel, 0.4, 0.05, 0.6, -1.5, 2.54, 0.4); // roof vent
  for (const ax of [1.95, -1.6]) {
    for (const sg of [-1, 1]) {
      wheel(c, ax, sg * (1.05 - 0.13 + 0.03), 0.38, 0.26);
      arch(c, ax, sg * 1.054, 0.38);
    }
  }
  headlights(c, 2.98, 0.86, 0.72, [0.06, 0.16, 0.36]);
  taillights(c, -3.02, 0.9, 0.88, [0.05, 0.36, 0.1]);
  p.box(c.dark, 0.03, 0.2, 1.0, 3.01, 0.72, 0);
  bumperBar(c, 3.04, 0.44, 2.0, 0.22, 0.12);
  bumperBar(c, -3.06, 0.44, 2.05, 0.22, 0.12);
  mirror(c, 1.5, 1.6, 1.02, 1.5);
  if (c.open) openDoor(c, 1.6, 0.9, 0.42, 1.6, 1.04, 1);
  if (c.wrecked) shards(c, 1.4, 1.5, 1.04, 0.6, 0.4, 0);
  collideLocal(c.b, c.o, -0.95, 0, 4.1, 2.1, 2.5, { surface: 'metal', mapKind: 'vehicle', tag: 'vehicle' });
  collideLocal(c.b, c.o, 2.0, 0, 2.0, 2.0, 1.9, { surface: 'metal', mapKind: 'vehicle', tag: 'vehicle' });
  finish(c);
}
