/** South-east: Depot 4 - container yard with the relay arena, fuel farm, loading dock and warehouse (MEDIUM threat). */
import { ceilingLight, emergencyLight } from '../interiors';
import { transmitterSite, type TransmitterHandle } from '../landmarks';
import {
  barrel,
  barrelGroup,
  boomBarrier,
  checkpointBooth,
  chainlinkFence,
  container,
  craneGantry,
  crate,
  crateGroup,
  debris,
  floodlightTower,
  forklift,
  fuelTank,
  generator,
  jerseyBarrier,
  pallet,
  pipeStack,
  roadSign,
  roofClutter,
  sandbagWall,
  shelvingRack,
  vehicle,
  corpse,
  tireStack,
  cones,
  dumpster,
} from '../props';
import type { ContainerColor } from '../props';
import { addBox, building, groundDecal, wallDecal } from '../structures';
import { yawFacing } from './data';
import { CL, CS, CW, HALF_PI, reserve, type Ctx } from './util';

export const DEPOT = {
  arena: { x: 26, z: 34, radius: 9 },
  warehouse: { x: 54, z: 39, w: 20, d: 22 },
};

const COLORS: ContainerColor[] = ['red', 'blue', 'green', 'rust', 'olive', 'white', 'yellow', 'rust', 'blue', 'red'];

export interface DepotResult {
  transmitter: TransmitterHandle;
}

export function buildDepot(c: Ctx): DepotResult {
  const { b, d, rng } = c;
  let colorIdx = 0;
  const nextColor = (): ContainerColor => COLORS[colorIdx++ % COLORS.length]!;
  const box = (x: number, z: number, rot: number, short: boolean, stack: 1 | 2 | 3 = 1, color?: ContainerColor) => {
    container(b, { x, z, rot, short, stack, color: color ?? nextColor(), seed: Math.floor(x * 13 + z * 7) });
  };

  // ---- the relay arena: pinwheel of double-stacked containers with four 4 m openings ----
  // north wall (z centre 25.78): short | gap | long
  box(19.03, 25.78, 0, true, 2);
  box(32.155, 25.78, 0, false, 2);
  // east wall (x centre 37.22, along Z): short | gap | short
  box(37.22, 30.03, HALF_PI, true, 2);
  box(37.22, 40.09, HALF_PI, true, 2);
  // south wall (z centre 42.22): long | gap | short
  box(19.655, 42.22, 0, false, 2);
  box(32.78, 42.22, 0, true, 2);
  // west wall (x centre 14.78, along Z): short | gap | short
  box(14.78, 27.59, HALF_PI, true, 2);
  box(14.78, 37.65, HALF_PI, true, 2);

  // ---- yard rows and columns (single-stacked, some double) ----
  box(20.1, 10, 0, false, 1);
  box(32.3, 10, 0, true, 2);
  box(20.1, 15, 0, false, 2);
  box(32.3, 15, 0, true, 1);
  box(10, 34.6, HALF_PI, false, 1);
  box(10, 46.5, HALF_PI, true, 2);
  box(18.1, 47, 0, false, 1);
  box(31.3, 47, 0, false, 2);
  // stacks near the east alley and an odd angled container as a landmark
  box(40.9, 8.6, HALF_PI, true, 1);
  box(21, 6.9, 0, true, 1);
  container(b, { x: 40.8, z: 47.6, rot: HALF_PI + 0.35, color: 'rust', stack: 1, short: true, doorsOpen: true });

  // ---- the relay ----
  const transmitter = transmitterSite(b, { x: DEPOT.arena.x, z: DEPOT.arena.z, rot: 0, radius: DEPOT.arena.radius });
  floodlightTower(b, { x: 30, z: 22.4, rot: 0, height: 9, on: true });
  floodlightTower(b, { x: 40.9, z: 30.2, rot: 0, height: 9, on: true });
  crateGroup(b, { x: 20, z: 29, count: 3, radius: 1.5, kind: 'mil', seed: 91 });
  generator(b, { x: 33.4, z: 38.4, rot: 0.2, running: true });
  sandbagWall(b, { x0: 21.4, z0: 30, x1: 23.6, z1: 30, height: 1.0 });
  jerseyBarrier(b, { x: 24, z: 22.4, rot: 0.15 });
  barrelGroup(b, { x: 34.4, z: 29.4, count: 4, radius: 1.2, seed: 93, colors: ['rust', 'blue'] });

  // ---- gate, lane, buy station ----
  chainlinkFence(b, { x0: 8, z0: 6.4, x1: 8, z1: 50.4, height: 2.4, barbed: true, gaps: [{ at: 16.6, width: 10 }] });
  checkpointBooth(b, { x: 10.2, z: 15.2, rot: HALF_PI });
  boomBarrier(b, { x: 9.4, z: 22, rot: HALF_PI, width: 5, open: true });
  sandbagWall(b, { x0: 10.2, z0: 11.2, x1: 14, z1: 11.2, height: 1.2 });
  sandbagWall(b, { x0: 10.2, z0: 11.2, x1: 10.2, z1: 13.4, height: 1.2 });
  roadSign(b, { x: 9.2, z: 27.6, rot: HALF_PI, lines: ['DEPOT 4', 'FREIGHT ONLY'], kind: 'depot', poleHeight: 3 });
  groundDecal(b, 'stencilDepot', 14, 21, 6, 2, 0, 0.06);
  groundDecal(b, 'arrow', 18, 20.2, 1.6, 3.2, -HALF_PI, 0.06);
  groundDecal(b, 'arrow', 34, 21, 1.6, 3.2, -HALF_PI, 0.06);
  craneGantry(b, { x: 30, z: 20.4, rot: HALF_PI, span: 9, height: 9.5, length: 6 });
  d.station({ kind: 'buy', name: 'DEPOT SUPPLY', x: 12.6, z: 13.4, yaw: yawFacing(0.2, 1), region: 'medium' });

  // ---- east alley clutter ----
  vehicle(b, { x: 41, z: 17.6, rot: HALF_PI + 0.05, kind: 'boxTruck', paint: 'white', wrecked: true, seed: 81 });
  forklift(b, { x: 41.4, z: 39.4, rot: 0.7, loaded: true, paint: 'yellow' });
  pallet(b, { x: 40.6, z: 26.2, rot: 0.3, goods: 'wrapped', seed: 5 });
  pallet(b, { x: 42, z: 44.8, rot: -0.2, goods: 'boxes', seed: 6 });
  crateGroup(b, { x: 40.8, z: 24, count: 3, radius: 1.2, kind: 'wood', seed: 96 });
  barrelGroup(b, { x: 38.8, z: 12.6, count: 5, radius: 1.5, seed: 97 });
  dumpster(b, { x: 39.2, z: 38.6, rot: HALF_PI, color: 'green' });
  tireStack(b, { x: 42.4, z: 9.4, count: 4 });
  cones(b, { x0: 39, z0: 20.4, x1: 43, z1: 20.4, spacing: 1.8 });
  debris(b, { x: 22, z: 22.6, radius: 1.8, seed: 92 });
  debris(b, { x: 12, z: 42, radius: 1.6, seed: 94 });
  corpse(b, { x: 23.5, z: 18.6, rot: 0.6, kind: 'soldier', seed: 51 });
  corpse(b, { x: 13.5, z: 24.4, rot: 2.1, kind: 'civilian', seed: 52 });
  pipeStack(b, { x: 26, z: 8.2, rot: 0, length: 8, count: 6 });
  for (let i = 0; i < 8; i++) groundDecal(b, rng.pick(['oilStain', 'dirtPatch', 'skid', 'bloodOld1', 'crackLarge'] as const), rng.range(10, 44), rng.range(8, 48), rng.range(2, 4), rng.range(2, 3.4), rng.range(0, 6.28), 0.045);

  // ---- fuel farm (north-east) ----
  fuelTank(b, { x: 51, z: 13, rot: 0, radius: 4, height: 9, color: 'white' });
  fuelTank(b, { x: 59.4, z: 13, rot: 0, radius: 4, height: 9, color: 'grey' });
  fuelTank(b, { x: 54.5, z: 21.4, rot: 0, radius: 1.9, height: 12, horizontal: true, color: 'olive' });
  chainlinkFence(b, { x0: 44.5, z0: 7, x1: 63.6, z1: 7, height: 2.2 });
  chainlinkFence(b, { x0: 44.5, z0: 7, x1: 44.5, z1: 23.2, height: 2.2, gaps: [{ at: 8, width: 4 }] });
  barrelGroup(b, { x: 47, z: 21, count: 5, radius: 1.6, seed: 98, colors: ['yellow', 'red'] });
  crate(b, { x: 62.6, z: 9.6, size: 1.0, kind: 'mil', stack: 2, seed: 4 });
  vehicle(b, { x: 47.2, z: 17.6, rot: 0.2, kind: 'tanker', paint: 'white', seed: 83 });

  // ---- loading dock (decorative raised platform) with trucks backed up to it ----
  const W = DEPOT.warehouse;
  const x0 = W.x - W.w / 2;
  const z0 = W.z - W.d / 2;
  addBox(b, 'concreteSlab', W.x, 0.6, z0 - 1, W.w - 2, 1.2, 2, 0);
  b.collideBox(W.x, z0 - 1, W.w - 2, 2, 1.2, { mapKind: 'building', tag: 'dock' });
  addBox(b, 'rubber', W.x, 0.6, z0 - 2.05, W.w - 2, 0.5, 0.1, 0, { cast: false });
  for (let i = 0; i < 4; i++) {
    const dx = x0 + 4 + i * 5;
    addBox(b, 'corrugated', dx, 2.9, z0 - 0.12, 3.4, 3.6, 0.2, 0);
    addBox(b, 'hazard', dx, 0.3, z0 - 0.02, 3.6, 0.5, 0.12, 0, { cast: false });
  }
  vehicle(b, { x: x0 + 4, z: z0 - 4.6, rot: HALF_PI, kind: 'boxTruck', paint: 'white', seed: 85 });
  vehicle(b, { x: x0 + 14, z: z0 - 4.6, rot: HALF_PI + 0.06, kind: 'trailer', paint: 'grey', seed: 86 });
  vehicle(b, { x: x0 + 14, z: z0 - 11.5, rot: HALF_PI + 0.06, kind: 'semiCab', paint: 'red', seed: 87 });
  reserve(c, x0 + 9, z0 - 6, 8);

  // ---- warehouse (enterable) ----
  building(b, {
    x: W.x,
    z: W.z,
    w: W.w,
    d: W.d,
    height: 8,
    wallMaterial: 'metalPanel',
    floorMaterial: 'floorWarehouse',
    ceilingMaterial: 'concreteDark',
    thickness: 0.4,
    parapet: 0.4,
    sides: {
      W: {
        openings: [
          { at: 6, width: 3.8, height: 4.2, kind: 'gate', frame: 'hazard' },
          { at: 11, width: 1.8, height: 2.4, kind: 'door', frame: 'steelDark' },
          { at: 16, width: 3.8, height: 4.2, kind: 'gate', frame: 'hazard' },
        ],
      },
      N: { openings: [3.5, 8.5, 13.5, 18].map((at) => ({ at, width: 2.6, height: 1.6, sill: 5.6, kind: 'window' as const })) },
      S: { openings: [3.5, 8.5, 13.5, 18].map((at) => ({ at, width: 2.6, height: 1.6, sill: 5.6, kind: 'window' as const })) },
    },
    tag: 'warehouse',
  });
  wallDecal(b, 'stencilDepot', x0 - 0.06, 6.4, W.z - 3, 6, 1.6, -HALF_PI);
  // racking: two aisles of shelving with a cross aisle; open main aisle by the doors
  for (const rx of [52.6, 57.2]) {
    shelvingRack(b, { x: rx, z: 33, rot: HALF_PI, length: 7, levels: 4, goods: true, seed: Math.floor(rx * 10) });
    shelvingRack(b, { x: rx, z: 45, rot: HALF_PI, length: 7, levels: 4, goods: true, seed: Math.floor(rx * 10) + 1 });
  }
  shelvingRack(b, { x: 47.4, z: 47.4, rot: 0, length: 5, levels: 3, goods: true, seed: 33 });
  forklift(b, { x: 47.2, z: 40.6, rot: -0.5, loaded: false, paint: 'yellow' });
  pallet(b, { x: 48.6, z: 35.6, rot: 0.3, goods: 'boxes', seed: 11 });
  pallet(b, { x: 49.4, z: 44.4, rot: -0.1, goods: 'wrapped', seed: 12 });
  pallet(b, { x: 46.4, z: 31.2, rot: 0.6, goods: 'sacks', seed: 13 });
  barrelGroup(b, { x: 62.6, z: 31.4, count: 4, radius: 1.3, seed: 99, colors: ['blue', 'rust'] });
  crateGroup(b, { x: 60.6, z: 47.6, count: 3, radius: 1.5, kind: 'wood', seed: 100 });
  corpse(b, { x: 49, z: 39.4, rot: 1.5, kind: 'civilian', seed: 61 });
  // caged armory bench at the back of the warehouse
  chainlinkFence(b, { x0: 58.4, z0: 35.6, x1: 58.4, z1: 42.6, height: 2.6, gaps: [{ at: 3.5, width: 3 }] });
  chainlinkFence(b, { x0: 58.4, z0: 35.6, x1: 63.6, z1: 35.6, height: 2.6 });
  chainlinkFence(b, { x0: 58.4, z0: 42.6, x1: 63.6, z1: 42.6, height: 2.6 });
  d.station({ kind: 'upgrade', name: 'ARMORY BENCH', x: 62.5, z: 39, yaw: yawFacing(-1, 0), region: 'medium' });
  // light: caged bay lamps (some dead) and red emergency beacons
  const lampModes: ('steady' | 'flicker' | 'fail')[] = ['steady', 'fail', 'steady', 'steady', 'flicker', 'steady', 'fail', 'steady', 'steady'];
  let li = 0;
  for (const lz of [32, 39, 46]) for (const lx of [48, 54, 60]) ceilingLight(b, { x: lx, z: lz, y: 7.3, kind: 'caged', mode: lampModes[li++]! });
  emergencyLight(b, { x: 44.6, y: 6.4, z: 30, period: 1.6 });
  emergencyLight(b, { x: 63.4, y: 6.4, z: 48, period: 1.6, phase: 0.8 });
  generator(b, { x: 45.3, z: 49, rot: 0, running: true });
  roofClutter(b, { x: W.x, z: W.z, w: 18, d: 20, y: 8.4, seed: 8, density: 0.7 });

  // ---- gameplay data ----
  d.crate(62.4, 30.6, yawFacing(-0.6, 1), 'medium');
  d.crate(62.4, 47.8, yawFacing(-0.6, -1), 'medium');
  d.crate(24.6, 12.5, yawFacing(0, 1), 'medium');
  d.crate(41, 11.2, yawFacing(-1, 0.4), 'medium');
  d.crate(60.6, 9.6, yawFacing(-1, 0.4), 'medium');
  d.crate(12.6, 41, yawFacing(1, 0.2), 'medium');
  d.spawn(
    'medium',
    'general',
    [
      [40.6, 8.6],
      [40.6, 47.6],
      [12, 48.6],
      [26, 49.2],
      [50, 6.4],
      [57, 24.6],
      [24, 12.4],
      [42, 33],
      [12, 40.8],
    ],
    1,
  );
  d.spawn('medium', 'defense', [[22, 16.6], [30, 17.2], [41.6, 34], [41.6, 40], [24.5, 45.6], [31.5, 45.6], [11.6, 31], [12, 38.4]], 1);
  d.zombies('medium', 'shambler', [[18, 20.5], [24, 12.3], [26, 44.4], [41, 44], [58, 10], [49, 36], [60, 33], [28, 19.5]]);
  d.zombies('medium', 'runner', [[34, 22], [12, 44], [46, 12], [55, 42]]);
  d.zombies('medium', 'armored', [[41, 20], [50, 18], [52, 46]]);
  void CL;
  void CS;
  void CW;
  void barrel;
  return { transmitter };
}
