/** South-west block: insertion checkpoint SIERRA, corner store, garage, parking lot, apartment ruins (LOW threat). */
import { hash2 } from '../../logic/rng';
import { checkoutCounter, ceilingLight, fridgeCase, storeShelf, officeDesk } from '../interiors';
import {
  barrel,
  barrelGroup,
  barrierLine,
  boomBarrier,
  checkpointBooth,
  chainlinkFence,
  cones,
  corpse,
  crate,
  crateGroup,
  debris,
  dumpster,
  fireEscape,
  floodlightTower,
  generator,
  hescoWall,
  jerseyBarrier,
  pallet,
  roofClutter,
  sandbagWall,
  tent,
  vehicle,
  roadSign,
  tireStack,
} from '../props';
import { addBox, building, groundDecal, groundRect, solidBlock, wallDecal } from '../structures';
import { yawFacing } from './data';
import { HALF_PI, isFree, reserve, type Ctx } from './util';

export function buildCheckpoint(c: Ctx): void {
  const { b, d, rng } = c;
  // concrete pad
  groundRect(b, 'concreteSlab', -64.8, 27.5, -38.6, 50.8, 0.03);
  groundDecal(b, 'stencilKeepOut', -46, 29.4, 6, 2, 0, 0.06);
  groundDecal(b, 'chevrons', -40.4, 40, 3.2, 8, HALF_PI, 0.06);

  // perimeter of HESCO bastions with two gates
  hescoWall(b, { x0: -64.5, z0: 28.6, x1: -50.5, z1: 28.6, height: 1.7 });
  hescoWall(b, { x0: -41.5, z0: 28.6, x1: -39.2, z1: 28.6, height: 1.7 });
  hescoWall(b, { x0: -39.2, z0: 28.6, x1: -39.2, z1: 35.2, height: 1.7 });
  hescoWall(b, { x0: -39.2, z0: 44.8, x1: -39.2, z1: 50.2, height: 1.7 });
  // sandbag firing positions inside the north gate and at the east gate
  sandbagWall(b, { x0: -56.5, z0: 31.2, x1: -52.4, z1: 31.2, height: 1.2 });
  sandbagWall(b, { x0: -48.2, z0: 31.2, x1: -44.2, z1: 31.2, height: 1.2 });
  sandbagWall(b, { x0: -42.4, z0: 33.2, x1: -42.4, z1: 36.6, height: 1.1 });
  sandbagWall(b, { x0: -42.4, z0: 43.4, x1: -42.4, z1: 46.6, height: 1.1 });
  // jersey barriers at the gates (staggered chicane)
  barrierLine(b, { x0: -47.6, z0: 26.2, x1: -44.4, z1: 26.2 });
  jerseyBarrier(b, { x: -49.5, z: 24.6, rot: 0.25 });
  jerseyBarrier(b, { x: -37.2, z: 38, rot: HALF_PI });
  jerseyBarrier(b, { x: -36.4, z: 42.6, rot: HALF_PI + 0.2 });

  // tents (command, medical, small)
  tent(b, { x: -60, z: 34.5, rot: 0, kind: 'command', w: 8, d: 5.6 });
  tent(b, { x: -59.6, z: 47, rot: 0, kind: 'medical', w: 8, d: 4.6 });
  tent(b, { x: -47.4, z: 48.6, rot: 0, kind: 'small', w: 4, d: 3 });

  // vehicles: an APC husk at the gate, a jeep, a supply truck against the west wall
  vehicle(b, { x: -47.3, z: 35.4, rot: 0.42, kind: 'apc', paint: 'olive', wrecked: false, seed: 4 });
  vehicle(b, { x: -44, z: 46.8, rot: -1.9, kind: 'jeep', paint: 'olive', doorsOpen: true, seed: 8 });
  vehicle(b, { x: -62.7, z: 41.2, rot: HALF_PI, kind: 'boxTruck', paint: 'olive', seed: 9 });

  // power + light: generator, floodlights (cool white against the warm streetlights outside)
  generator(b, { x: -44.6, z: 43.6, rot: 0, running: true });
  floodlightTower(b, { x: -55.6, z: 29.6, rot: 0, height: 8, on: true });
  floodlightTower(b, { x: -41.4, z: 49.4, rot: 0, height: 8, on: true });
  floodlightTower(b, { x: -63.4, z: 50, rot: 0, height: 8, on: false });

  // supplies and clutter
  crateGroup(b, { x: -52, z: 49, count: 4, radius: 2.4, kind: 'mil', seed: 21 });
  crate(b, { x: -63.2, z: 30.2, size: 1.0, kind: 'mil', stack: 2, seed: 2 });
  barrelGroup(b, { x: -62.4, z: 30.6, count: 5, radius: 1.8, seed: 5, colors: ['green', 'rust'] });
  pallet(b, { x: -56.4, z: 43.4, rot: 0.2, goods: 'boxes', seed: 3 });
  tireStack(b, { x: -46.6, z: 30.2 });
  cones(b, { x0: -50, z0: 27.2, x1: -42, z1: 27.2, spacing: 2.4 });

  // signs + stencils
  roadSign(b, { x: -40, z: 29.6, rot: HALF_PI, lines: ['CHECKPOINT', 'SIERRA'], kind: 'warning', poleHeight: 2.6 });
  wallDecal(b, 'stencilQuarantine', -64.15, 2.4, 44, 7, 2, HALF_PI);
  wallDecal(b, 'biohazard', -64.15, 2.6, 36, 2.6, 2.6, HALF_PI);
  wallDecal(b, 'stencilQuarantine', -52, 2.4, 50.15, 7, 2, Math.PI);

  // aftermath: fallen soldiers, dried blood
  corpse(b, { x: -49.4, z: 32.5, rot: 0.6, kind: 'soldier', seed: 1 });
  corpse(b, { x: -45.6, z: 29.6, rot: 2.4, kind: 'soldier', seed: 2 });
  corpse(b, { x: -41.5, z: 40.4, rot: -0.4, kind: 'civilian', seed: 3 });
  corpse(b, { x: -57.8, z: 40.4, rot: 1.9, kind: 'bodybag', seed: 4 });
  for (let i = 0; i < 6; i++) groundDecal(b, rng.pick(['bloodOld0', 'bloodOld1', 'bloodOld2'] as const), rng.range(-56, -42), rng.range(30, 44), rng.range(2, 3.4), rng.range(2, 3), rng.range(0, 6.28), 0.062);
  groundDecal(b, 'bloodDrag', -47, 31.4, 5, 1.6, 0.3, 0.063);
  debris(b, { x: -38.6, z: 46.5, radius: 2, seed: 4 });

  reserve(c, -47.3, 35.4, 5);
  reserve(c, -53.5, 36.5, 3);

  // gameplay: buy station near the spawn, low-tier crates, spawn points and ambient dead
  d.station({ kind: 'buy', name: 'SUPPLY CAGE', x: -53.5, z: 36.6, yaw: yawFacing(0.35, 0.94), region: 'low' });
  d.crate(-60.8, 49.4, yawFacing(1, -0.3), 'low');
  d.crate(-40.6, 47.6, yawFacing(-1, -0.2), 'low');
  d.zombies('low', 'shambler', [[-47, 22.6], [-39, 21.4], [-54, 21.8]]);
  d.zombies('low', 'runner', [[-33.5, 30.4]]);
}

export function buildCornerStore(c: Ctx): void {
  const { b, d } = c;
  // store lot
  groundRect(b, 'concreteSlab', -29.6, 41.2, -15.2, 50.8, 0.03);
  const info = building(b, {
    x: -22,
    z: 35,
    w: 14,
    d: 12,
    height: 4.2,
    wallMaterial: 'brick',
    roofMaterial: 'roof',
    floorMaterial: 'floorStore',
    ceilingMaterial: 'plaster',
    parapet: 0.5,
    sides: {
      N: {
        openings: [
          { at: 2.3, width: 2.6, height: 1.7, sill: 0.9, kind: 'window', lit: false },
          { at: 7, width: 1.9, height: 2.3, kind: 'door', frame: 'steelDark' },
          { at: 11.7, width: 2.6, height: 1.7, sill: 0.9, kind: 'window', lit: true },
        ],
      },
      E: { openings: [{ at: 8.6, width: 1.7, height: 2.3, kind: 'door', frame: 'steelDark' }] },
      W: { openings: [{ at: 6, width: 2.4, height: 1.6, sill: 1.0, kind: 'window' }] },
      S: { openings: [{ at: 5, width: 2, height: 1.2, sill: 2.4, kind: 'window' }, { at: 10, width: 2, height: 1.2, sill: 2.4, kind: 'window' }] },
    },
    partitions: [{ x0: -28.6, z0: 37.3, x1: -15.4, z1: 37.3, thickness: 0.22, openings: [{ at: 4.2, width: 1.6, height: 2.3, kind: 'door', frame: 'wood' }], material: 'plaster' }],
    tag: 'store',
  });
  void info;
  // shop floor: gondolas, coolers, counter
  storeShelf(b, { x: -24, z: 31.9, rot: 0, length: 6, stocked: true, seed: 11 });
  storeShelf(b, { x: -24, z: 34.5, rot: 0, length: 6, stocked: true, seed: 12 });
  storeShelf(b, { x: -18.2, z: 34.2, rot: HALF_PI, length: 3.2, stocked: true, seed: 13 });
  fridgeCase(b, { x: -28.1, z: 33.2, rot: HALF_PI, length: 5 });
  checkoutCounter(b, { x: -18.4, z: 31, rot: 0, length: 3 });
  // back room: storage
  storeShelf(b, { x: -26.4, z: 39.9, rot: 0, length: 3.2, stocked: true, seed: 14 });
  storeShelf(b, { x: -19.4, z: 39.9, rot: 0, length: 3.2, stocked: true, seed: 15 });
  crate(b, { x: -22.8, z: 39.6, size: 0.8, kind: 'wood', stack: 2, seed: 4 });
  officeDesk(b, { x: -16.6, z: 38.4, rot: -HALF_PI, chair: true });
  // light: failing tubes make the shop tense
  ceilingLight(b, { x: -24, z: 32.6, y: 4.0, kind: 'tube', mode: 'flicker', rot: 0 });
  ceilingLight(b, { x: -19.6, z: 32.6, y: 4.0, kind: 'tube', mode: 'steady', rot: 0 });
  ceilingLight(b, { x: -24, z: 35.6, y: 4.0, kind: 'tube', mode: 'fail', rot: 0 });
  ceilingLight(b, { x: -22, z: 39.2, y: 4.0, kind: 'tube', mode: 'steady', rot: 0 });
  roofClutter(b, { x: -22, z: 35, w: 12, d: 10, y: 4.6, seed: 5, density: 0.6 });
  wallDecal(b, 'stencilDanger', -22, 3.4, 28.78, 3.4, 0.9, 0);

  // alley between store and garage: dumpsters, a crate, fence at the dead end
  dumpster(b, { x: -13.6, z: 33, rot: HALF_PI, color: 'green' });
  dumpster(b, { x: -13.2, z: 43.6, rot: HALF_PI, color: 'rust', lidOpen: true });
  crate(b, { x: -13.4, z: 48.6, size: 1.1, kind: 'wood', seed: 6 });
  crate(b, { x: -12.6, z: 47.6, size: 0.7, kind: 'wood', seed: 7 });
  barrel(b, { x: -14.3, z: 49.3, color: 'blue' });
  chainlinkFence(b, { x0: -15, z0: 50.4, x1: -12, z1: 50.4, height: 2.4 });

  // garage: closed building mass beside the alley
  solidBlock(b, {
    x: -8.75,
    z: 38,
    w: 6.5,
    d: 18,
    height: 5,
    wallMaterial: 'metalPanel',
    facade: { floors: 1, floorHeight: 3, litFraction: 0, seed: 3, faces: ['W', 'S'] },
    tag: 'garage',
  });
  addBox(b, 'corrugatedRust', -12.05, 2, 34, 0.15, 3.4, 3.6, 0, { cast: false }); // roll-up door
  roofClutter(b, { x: -8.75, z: 38, w: 6, d: 17, y: 5.4, seed: 6, density: 0.4 });

  // lot B behind the store: three abandoned cars
  vehicle(b, { x: -25.5, z: 45.4, rot: 0.3, kind: 'sedan', paint: 'grey', wrecked: true, seed: 1 });
  vehicle(b, { x: -20, z: 47.6, rot: -0.15, kind: 'suv', paint: 'white', seed: 2 });
  vehicle(b, { x: -17.6, z: 43.6, rot: 2.9, kind: 'hatch', paint: 'red', burnt: true, seed: 3 });
  debris(b, { x: -27.4, z: 49.2, radius: 2, seed: 9 });
  reserve(c, -25.5, 45.4, 3);
  reserve(c, -20, 47.6, 3);

  // gameplay
  d.crate(-26.4, 38.6, HALF_PI, 'low'); // back room of the store
  d.crate(-13.4, 45.4, Math.PI, 'low'); // alley
  d.spawn('low', 'general', [[-13.5, 47.5], [-24, 46.5], [-9, 24.6], [-18, 24.2]]);
  d.zombies('low', 'shambler', [[-21, 33.4], [-14, 40], [-22, 45.8]]);
}

export function buildParkingLot(c: Ctx): void {
  const { b, d, rng } = c;
  groundRect(b, 'concreteSlab', -29.6, 6.6, -5.4, 17.4, 0.03);
  // painted stalls
  for (let x = -28; x <= -7; x += 3.6) {
    groundDecal(b, 'laneSolid', x, 8.6, 5, 0.12, HALF_PI, 0.05);
    groundDecal(b, 'laneSolid', x, 14.8, 5, 0.12, HALF_PI, 0.05);
  }
  chainlinkFence(b, { x0: -29.6, z0: 18.3, x1: -5.4, z1: 18.3, height: 2.2, gaps: [{ at: 7, width: 5 }, { at: 17, width: 5 }] });
  chainlinkFence(b, { x0: -29.6, z0: 6.2, x1: -5.4, z1: 6.2, height: 2.2, gaps: [{ at: 14, width: 4 }], damaged: true });
  checkpointBooth(b, { x: -27.6, z: 16.6, rot: 0 });
  boomBarrier(b, { x: -24, z: 18.9, rot: 0, width: 5, open: true });
  // cars parked in stalls (a few missing, a few wrecked)
  const kinds = ['sedan', 'hatch', 'suv', 'pickup', 'van'] as const;
  const paints = ['white', 'grey', 'blue', 'red', 'black', 'yellow'] as const;
  for (let x = -26; x <= -8; x += 3.6) {
    for (const z of [8.6, 14.8]) {
      if (rng.chance(0.42)) continue;
      const rot = z < 11 ? -HALF_PI + rng.range(-0.06, 0.06) : HALF_PI + rng.range(-0.06, 0.06);
      vehicle(b, { x: x + rng.range(-0.25, 0.25), z, rot, kind: rng.pick(kinds), paint: rng.pick(paints), wrecked: rng.chance(0.3), burnt: rng.chance(0.1), doorsOpen: rng.chance(0.2), seed: hash2(x, z) });
    }
  }
  dumpster(b, { x: -6.6, z: 11.6, rot: HALF_PI, color: 'blue' });
  debris(b, { x: -8, z: 11.4, radius: 1.6, seed: 8 });
  d.spawn('low', 'general', [[-28, 12], [-8, 18.2]]);
  d.zombies('low', 'shambler', [[-18, 11.6], [-10, 8.6]]);
  d.zombies('low', 'runner', [[-24, 12]]);
}

export function buildApartments(c: Ctx): void {
  const { b, d } = c;
  groundRect(b, 'concreteSlab', -64.8, 5.5, -37.5, 18.6, 0.03);
  solidBlock(b, {
    x: -57,
    z: 11.5,
    w: 14,
    d: 11,
    height: 12,
    wallMaterial: 'brick',
    facade: { floors: 3, floorHeight: 3.4, litFraction: 0.05, seed: 5, faces: ['N', 'S', 'E'] },
    tag: 'apartments',
  });
  solidBlock(b, {
    x: -42,
    z: 11.5,
    w: 6,
    d: 11,
    height: 9,
    wallMaterial: 'plaster',
    facade: { floors: 2, floorHeight: 3.4, litFraction: 0.08, seed: 9, faces: ['N', 'S', 'W'] },
    tag: 'apartments-b',
  });
  roofClutter(b, { x: -57, z: 11.5, w: 13, d: 10, y: 12.4, seed: 2, density: 0.7 });
  roofClutter(b, { x: -42, z: 11.5, w: 5, d: 10, y: 9.4, seed: 3, density: 0.5 });
  fireEscape(b, { x: -49.9, z: 11.5, rot: 0, height: 9, width: 1.2 });
  // rubble at the collapsed north-east corner + a barricade across the alley mouth
  debris(b, { x: -49.4, z: 6.8, radius: 3.4, seed: 12, big: true });
  crateGroup(b, { x: -47, z: 16.2, count: 3, radius: 1.6, kind: 'wood', seed: 33 });
  jerseyBarrier(b, { x: -46, z: 17.4, rot: 0.3 });
  dumpster(b, { x: -46.4, z: 7.6, rot: -HALF_PI, color: 'rust' });
  vehicle(b, { x: -47, z: 12.2, rot: HALF_PI + 0.1, kind: 'van', paint: 'white', wrecked: true, seed: 31 });
  corpse(b, { x: -45.7, z: 15.2, rot: 1.2, kind: 'civilian', seed: 6 });
  addBox(b, 'corrugatedRust', -63.6, 1.4, 7, 0.3, 2.8, 2.6, 0, { cast: false }); // fence panel on the west edge
  d.crate(-47.2, 8.8, HALF_PI, 'low');
  d.spawn('low', 'general', [[-56, 20.6], [-40, 20.6], [-47, 6.4]]);
  d.zombies('low', 'shambler', [[-47, 14.6], [-52, 19.4]]);
  void isFree;
}
