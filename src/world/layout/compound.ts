/** North-east: the research compound - walled yard, main lab with the containment hall, dome and spire (HIGH threat). */
import {
  ceilingLight,
  emergencyLight,
  gurney,
  labBench,
  labConsole,
  labTank,
  lockerRow,
  officeDesk,
  serverRack,
  specimenCage,
  pipeRun,
} from '../interiors';
import { containmentDome, quarantineGate, spire, toxicPool, type SpireHandle } from '../landmarks';
import {
  barrelGroup,
  barrierLine,
  checkpointBooth,
  chainlinkFence,
  cones,
  corpse,
  crate,
  crateGroup,
  debris,
  floodlightTower,
  generator,
  jerseyBarrier,
  pallet,
  pipeStack,
  roofClutter,
  sandbagWall,
  tent,
  vehicle,
  watchtower,
  roadSign,
} from '../props';
import { addBox, building, groundDecal, groundRect, wall, wallDecal } from '../structures';
import { yawFacing } from './data';
import { HALF_PI, type Ctx } from './util';

export const COMPOUND = {
  wardenX: 30,
  wardenZ: -40,
  spire: { x: 55, z: -38 },
  dome: { x: 54, z: -22, radius: 8 },
  lab: { x: 30, z: -40, w: 28, d: 14 },
};

export interface CompoundResult {
  spire: SpireHandle;
}

export function buildCompound(c: Ctx): CompoundResult {
  const { b, d, rng } = c;
  // ---- ground: drive lanes ----
  groundRect(b, 'asphalt', 24, -26, 30, -8.4, 0.03);
  groundRect(b, 'asphalt', 8.6, -34, 44, -28, 0.031);
  groundRect(b, 'asphalt', 40, -30, 46, -10, 0.032);
  groundRect(b, 'dirt', 46, -50, 64.8, -42, 0.028);
  for (let i = 0; i < 10; i++) groundDecal(b, rng.pick(['oilStain', 'crackLarge', 'dirtPatch', 'bloodOld2', 'bloodOld0'] as const), rng.range(10, 62), rng.range(-30, -10), rng.range(2, 4), rng.range(2, 3.4), rng.range(0, 6.28), 0.05);
  groundDecal(b, 'biohazard', 27, -17, 5, 5, 0, 0.06);
  groundDecal(b, 'chevrons', 27, -12.2, 9, 2, 0, 0.06);

  // ---- perimeter wall with two gates ----
  wall(b, {
    x0: 8,
    z0: -50.8,
    x1: 8,
    z1: -8.4,
    height: 4.6,
    thickness: 1.0,
    material: 'concreteWall',
    openings: [{ at: 19.8, width: 6, height: 4.6, kind: 'gate', frame: 'steelDark' }],
    mapKind: 'wall',
    tag: 'compound-wall',
  });
  wall(b, {
    x0: 8,
    z0: -8.4,
    x1: 64.8,
    z1: -8.4,
    height: 4.6,
    thickness: 1.0,
    material: 'concreteWall',
    openings: [{ at: 19, width: 10, height: 4.6, kind: 'gate', frame: 'steelDark' }],
    mapKind: 'wall',
    tag: 'compound-wall',
  });
  quarantineGate(b, { x: 27, z: -8.4, rot: 0, width: 10, open: 0.55 });
  quarantineGate(b, { x: 8, z: -31, rot: HALF_PI, width: 6, open: 0.5 });
  wallDecal(b, 'stencilRestricted', 8 + 0.55, 3, -42, 6, 1.8, HALF_PI);
  wallDecal(b, 'biohazard', 14, 3.2, -8.4 + 0.55, 2.4, 2.4, 0);
  wallDecal(b, 'stencilDanger', 40, 3, -8.4 + 0.55, 7, 2, 0);
  watchtower(b, { x: 11.4, z: -12.4, rot: 0, height: 6.5 });
  watchtower(b, { x: 62.4, z: -39, rot: 0, height: 6.5 });
  checkpointBooth(b, { x: 11.6, z: -36.6, rot: HALF_PI });
  roadSign(b, { x: 6.8, z: -25.4, rot: -HALF_PI, lines: ['BIOHAZARD', 'LEVEL 4', 'DECON MANDATORY'], kind: 'warning', poleHeight: 2.8 });

  // ---- decon funnel at the south gate ----
  barrierLine(b, { x0: 12, z0: -11.4, x1: 22.6, z1: -11.4 });
  barrierLine(b, { x0: 31.4, z0: -11.4, x1: 44, z1: -11.4 });
  sandbagWall(b, { x0: 22.8, z0: -14.6, x1: 22.8, z1: -12.2, height: 1.2 });
  sandbagWall(b, { x0: 31.2, z0: -14.6, x1: 31.2, z1: -12.2, height: 1.2 });
  cones(b, { x0: 24.4, z0: -10, x1: 29.6, z1: -10, spacing: 1.7 });
  tent(b, { x: 15.5, z: -16.4, rot: 0, kind: 'medical', w: 7, d: 4.6 });
  tent(b, { x: 16, z: -23.4, rot: 0, kind: 'command', w: 7.6, d: 5 });
  vehicle(b, { x: 19.6, z: -13.2, rot: 0.05, kind: 'ambulance', paint: 'white', wrecked: true, seed: 101 });
  vehicle(b, { x: 45.6, z: -13.4, rot: Math.PI - 0.1, kind: 'van', paint: 'white', burnt: true, seed: 102 });
  vehicle(b, { x: 58, z: -12.4, rot: 0.3, kind: 'apc', paint: 'olive', wrecked: true, seed: 103 });
  floodlightTower(b, { x: 21.4, z: -18.4, rot: 0, height: 9, on: true });
  floodlightTower(b, { x: 34.4, z: -19.6, rot: 0, height: 9, on: true });
  floodlightTower(b, { x: 60.4, z: -30, rot: 0, height: 9, on: false });

  // ---- main laboratory ----
  const L = COMPOUND.lab;
  building(b, {
    x: L.x,
    z: L.z,
    w: L.w,
    d: L.d,
    height: 5.2,
    wallMaterial: 'concreteWall',
    floorMaterial: 'labFloor',
    ceilingMaterial: 'tile',
    roofMaterial: 'roof',
    parapet: 0.6,
    thickness: 0.45,
    sides: {
      S: {
        openings: [
          { at: 4, width: 1.8, height: 2.3, kind: 'door', frame: 'steelDark' },
          { at: 14, width: 2.8, height: 2.6, kind: 'door', frame: 'hazard' },
          { at: 8, width: 2, height: 1.4, sill: 1.5, kind: 'window', lit: true },
          { at: 20, width: 2, height: 1.4, sill: 1.5, kind: 'window' },
          { at: 24, width: 2, height: 1.4, sill: 1.5, kind: 'window' },
        ],
      },
      E: { openings: [{ at: 9.6, width: 1.8, height: 2.3, kind: 'door', frame: 'steelDark' }] },
      W: { openings: [{ at: 3.6, width: 1.8, height: 2.3, kind: 'door', frame: 'steelDark' }] },
      N: { openings: [4, 10, 16, 22].map((at) => ({ at, width: 1.6, height: 1.2, sill: 2.6, kind: 'window' as const })) },
    },
    partitions: [
      { x0: 24, z0: -47, x1: 24, z1: -33, thickness: 0.25, material: 'labPanel', openings: [{ at: 3.4, width: 1.6, height: 2.4, kind: 'door', frame: 'steelDark' }, { at: 10.6, width: 1.6, height: 2.4, kind: 'door', frame: 'steelDark' }] },
      { x0: 36, z0: -47, x1: 36, z1: -33, thickness: 0.25, material: 'labPanel', openings: [{ at: 3.4, width: 1.6, height: 2.4, kind: 'door', frame: 'steelDark' }, { at: 10.6, width: 1.6, height: 2.4, kind: 'door', frame: 'steelDark' }] },
      { x0: 16.4, z0: -40, x1: 24, z1: -40, thickness: 0.22, material: 'labPanel', openings: [{ at: 3.8, width: 1.5, height: 2.3, kind: 'door', frame: 'steelDark' }] },
      { x0: 36, z0: -40, x1: 43.6, z1: -40, thickness: 0.22, material: 'labPanel', openings: [{ at: 3.8, width: 1.5, height: 2.3, kind: 'door', frame: 'steelDark' }] },
    ],
    tag: 'lab',
  });
  // structural pillars in the containment hall (cover for the boss fight)
  for (const [px, pz] of [[27, -43.4], [33, -43.4], [27, -36.6], [33, -36.6]] as const) {
    addBox(b, 'concreteDark', px, 2.6, pz, 0.9, 5.2, 0.9, 0);
    b.collideBox(px, pz, 0.9, 0.9, 5.2, { mapKind: 'prop', tag: 'pillar' });
  }
  // containment hall dressing
  labTank(b, { x: 26.4, z: -45.6, radius: 0.9, height: 3.2, glow: 'green' });
  labTank(b, { x: 30, z: -45.6, radius: 1.0, height: 3.4, glow: 'green', broken: true });
  labTank(b, { x: 33.6, z: -45.6, radius: 0.9, height: 3.2, glow: 'green' });
  specimenCage(b, { x: 25.6, z: -39.6, rot: 0, w: 2.6, d: 2.6, open: true });
  specimenCage(b, { x: 34.4, z: -40.4, rot: 0, w: 2.6, d: 2.6, open: false });
  labConsole(b, { x: 30, z: -34.6, rot: Math.PI, width: 3 });
  gurney(b, { x: 28.6, z: -38.4, rot: 0.6, covered: true });
  gurney(b, { x: 31.6, z: -42, rot: -0.3 });
  corpse(b, { x: 30.4, z: -37, rot: 1.4, kind: 'hazmat', seed: 71 });
  groundDecal(b, 'bloodDrag', 30, -39.5, 5, 1.8, 1.2, 0.05);
  groundDecal(b, 'biohazard', 30, -40, 4, 4, 0, 0.045);
  // wings
  labBench(b, { x: 20.2, z: -45.2, rot: 0, length: 5 });
  labTank(b, { x: 17.6, z: -43.4, radius: 0.8, height: 3, glow: 'blue', broken: true });
  lockerRow(b, { x: 20.2, z: -33.9, rot: Math.PI, count: 5 });
  gurney(b, { x: 22, z: -37.4, rot: 1.9 });
  serverRack(b, { x: 39, z: -46.2, rot: 0, count: 4 });
  labConsole(b, { x: 42.6, z: -43, rot: -HALF_PI, width: 2.6 });
  officeDesk(b, { x: 40, z: -34.6, rot: Math.PI, chair: true });
  officeDesk(b, { x: 42.8, z: -37.4, rot: -HALF_PI, chair: true });
  // lighting: unstable tubes and emergency beacons - the hall glows green from its tanks
  ceilingLight(b, { x: 28, z: -41, y: 5.0, kind: 'panel', mode: 'fail' });
  ceilingLight(b, { x: 32, z: -38, y: 5.0, kind: 'panel', mode: 'flicker' });
  ceilingLight(b, { x: 30, z: -35, y: 5.0, kind: 'panel', mode: 'steady' });
  ceilingLight(b, { x: 20, z: -43, y: 4.9, kind: 'tube', mode: 'flicker' });
  ceilingLight(b, { x: 20, z: -36.5, y: 4.9, kind: 'tube', mode: 'steady' });
  ceilingLight(b, { x: 40, z: -43, y: 4.9, kind: 'tube', mode: 'steady' });
  ceilingLight(b, { x: 40, z: -36.5, y: 4.9, kind: 'tube', mode: 'fail' });
  emergencyLight(b, { x: 24.3, y: 4.2, z: -34.6, period: 1.4 });
  emergencyLight(b, { x: 35.7, y: 4.2, z: -45.6, period: 1.4, phase: 0.7 });
  emergencyLight(b, { x: 30, y: 4.4, z: -33.7, period: 1.4, phase: 0.35 });
  pipeRun(b, { x0: 16.6, y0: 4.7, z0: -46.3, x1: 43.4, y1: 4.7, z1: -46.3, radius: 0.12 });
  roofClutter(b, { x: L.x, z: L.z, w: 26, d: 12, y: 5.8, seed: 21, density: 0.8 });

  // ---- dome and spire ----
  containmentDome(b, { x: COMPOUND.dome.x, z: COMPOUND.dome.z, rot: 0, radius: COMPOUND.dome.radius });
  const spireHandle = spire(b, { x: COMPOUND.spire.x, z: COMPOUND.spire.z, rot: 0, height: 58 });
  chainlinkFence(b, { x0: 43.6, z0: -30, x1: 43.6, z1: -14, height: 2.4, barbed: true, gaps: [{ at: 8, width: 3.6 }] });
  toxicPool(b, { x: 39, z: -17.8, w: 6, d: 4 });
  toxicPool(b, { x: 60, z: -30, w: 5, d: 3.6 });
  barrelGroup(b, { x: 47, z: -12.6, count: 6, radius: 1.8, seed: 111, colors: ['bio', 'yellow'] });
  barrelGroup(b, { x: 62, z: -21, count: 5, radius: 1.6, seed: 112, colors: ['bio', 'rust'] });
  generator(b, { x: 47.6, z: -47.6, rot: 0, running: true });
  generator(b, { x: 50.8, z: -47.6, rot: 0, running: false });
  pipeStack(b, { x: 60, z: -14.6, rot: 0, length: 6, count: 5 });
  crateGroup(b, { x: 13, z: -19, count: 4, radius: 1.8, kind: 'mil', seed: 113 });
  pallet(b, { x: 11.6, z: -27, rot: 0.2, goods: 'barrels', seed: 3 });
  jerseyBarrier(b, { x: 13, z: -30, rot: HALF_PI });
  jerseyBarrier(b, { x: 13.4, z: -36, rot: HALF_PI });
  debris(b, { x: 40, z: -24, radius: 2.6, seed: 114, big: true });
  debris(b, { x: 22, z: -30, radius: 2, seed: 115 });
  corpse(b, { x: 24.4, z: -12.8, rot: 0.8, kind: 'soldier', seed: 72 });
  corpse(b, { x: 34, z: -22.4, rot: 2.5, kind: 'hazmat', seed: 73 });
  corpse(b, { x: 51, z: -17, rot: 1.3, kind: 'hazmat', seed: 74 });
  corpse(b, { x: 12.6, z: -33.2, rot: -0.3, kind: 'soldier', seed: 75 });
  // small NE service shed
  building(b, {
    x: 60.6,
    z: -46.6,
    w: 6,
    d: 5,
    height: 3,
    wallMaterial: 'metalPanel',
    floorMaterial: 'concreteSlab',
    ceilingMaterial: 'concreteDark',
    sides: { S: { openings: [{ at: 2.2, width: 1.8, height: 2.3, kind: 'door' }] } },
    tag: 'shed',
  });
  crate(b, { x: 61.6, z: -47.8, size: 0.9, kind: 'mil', seed: 9 });
  emergencyLight(b, { x: 58, y: 2.6, z: -49, period: 1.8 });

  // ---- gameplay data ----
  d.crate(42.2, -35, yawFacing(-0.5, -1), 'high');
  d.crate(17.6, -45.4, yawFacing(1, 0.3), 'high');
  d.crate(35.2, -35.4, yawFacing(-0.6, -0.8), 'high');
  d.crate(52, -44.6, yawFacing(0.2, 1), 'high');
  d.crate(61.6, -47.6, yawFacing(-0.5, 1), 'high');
  d.crate(12.8, -38, yawFacing(1, 0.1), 'high');
  d.spawn(
    'high',
    'general',
    [
      [28, -12.2],
      [12, -31],
      [20, -20],
      [40, -26],
      [56, -14],
      [58, -44],
      [46, -46],
      [36, -30],
      [14, -46],
      [63, -26],
    ],
    1,
  );
  d.zombies('high', 'shambler', [[20, -14], [38, -13], [46, -21], [52, -31], [16, -28], [36, -27], [58, -40], [26, -24], [28, -44], [20, -36.5], [40, -44]]);
  d.zombies('high', 'runner', [[24, -22], [44, -28], [50, -14], [14, -44], [35, -44], [40, -36.5]]);
  d.zombies('high', 'armored', [[32, -36.5], [12, -20], [56, -22]]);
  return { spire: spireHandle };
}
