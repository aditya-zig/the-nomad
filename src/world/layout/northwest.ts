/** North-west: LZ ECHO (extraction landing zone), ruined hangar, ruined houses, bus depot (LOW threat). */
import { debris, floodlightTower, jerseyBarrier, barrierLine, sandbagWall, vehicle, crate, crateGroup, barrelGroup, checkpointBooth, boomBarrier, chainlinkFence, deadTree, corpse, roadSign, cones, pallet, tent, dumpster } from '../props';
import { helipad } from '../landmarks';
import { addBox, building, groundDecal, groundRect, solidBlock, wallDecal } from '../structures';
import { yawFacing } from './data';
import { HALF_PI, reserve, type Ctx } from './util';

export const LZ = { x: -42, z: -16, radius: 14, terminalX: -33.2, terminalZ: -11.2 };

export function buildLandingZone(c: Ctx): void {
  const { b, d, rng } = c;
  helipad(b, { x: LZ.x, z: LZ.z, rot: 0, radius: 8.6 });
  groundDecal(b, 'stencilLZ', LZ.x, LZ.z + 11.4, 8, 2.6, 0, 0.06);
  groundDecal(b, 'chevrons', LZ.x + 12.5, LZ.z, 2.6, 9, HALF_PI, 0.06);

  // perimeter: jersey-barrier lines with staggered gaps (lanes for the final horde)
  barrierLine(b, { x0: -64, z0: -7.6, x1: -8, z1: -7.6, gaps: [{ at: 7.5, width: 5 }, { at: 33, width: 6 }, { at: 51, width: 5 }] });
  barrierLine(b, { x0: -64, z0: -25.6, x1: -8, z1: -25.6, gaps: [{ at: 13, width: 5 }, { at: 40, width: 6 }] });
  // light towers (cool white) around the apron
  floodlightTower(b, { x: -53.5, z: -9.4, rot: 0, height: 9, on: true });
  floodlightTower(b, { x: -31, z: -9.4, rot: 0, height: 9, on: true });
  floodlightTower(b, { x: -53.5, z: -23.6, rot: 0, height: 9, on: true });
  floodlightTower(b, { x: -31, z: -23.6, rot: 0, height: 9, on: false });

  // cover around the pad (outside the rotor disc, ~11-16 m from the pad centre)
  vehicle(b, { x: -56.4, z: -12.2, rot: 0.35, kind: 'boxTruck', paint: 'olive', wrecked: true, seed: 31 });
  vehicle(b, { x: -26.6, z: -21.6, rot: 0.08, kind: 'bus', paint: 'white', wrecked: true, seed: 32 });
  vehicle(b, { x: -46.5, z: -8.6, rot: -0.1, kind: 'jeep', paint: 'olive', seed: 33 });
  jerseyBarrier(b, { x: -30.2, z: -10.8, rot: 0.5 });
  jerseyBarrier(b, { x: -52.4, z: -21.8, rot: -0.35 });
  jerseyBarrier(b, { x: -37.6, z: -24.2, rot: 0.1 });
  sandbagWall(b, { x0: -30.6, z0: -18.6, x1: -30.6, z1: -13.6, height: 1.1 });
  sandbagWall(b, { x0: -53.6, z0: -18.4, x1: -53.6, z1: -14.2, height: 1.1 });
  tent(b, { x: -14, z: -14.4, rot: 0, kind: 'small', w: 4, d: 3.4 });
  crateGroup(b, { x: -14.4, z: -19.6, count: 4, radius: 2, kind: 'mil', seed: 51 });
  barrelGroup(b, { x: -58.6, z: -8.8, count: 4, radius: 1.4, seed: 52, colors: ['green', 'rust'] });
  pallet(b, { x: -49.4, z: -25, rot: 0.1, goods: 'wrapped', seed: 6 });
  cones(b, { x0: -47.5, z0: -6.8, x1: -36.5, z1: -6.8, spacing: 2.2 });
  debris(b, { x: -21, z: -8.8, radius: 2.2, seed: 53 });
  debris(b, { x: -60.5, z: -25, radius: 2.4, seed: 54 });

  // east guard post + boom barrier
  checkpointBooth(b, { x: -11.4, z: -10.4, rot: 0 });
  boomBarrier(b, { x: -11, z: -16, rot: HALF_PI, width: 5, open: true });
  roadSign(b, { x: -12.6, z: -20.6, rot: HALF_PI, lines: ['LZ ECHO', 'EXTRACTION', 'POINT'], kind: 'info', poleHeight: 3 });

  // ruined hangar shell on the west end: an open-air structure with breaches; a wrecked APC inside
  building(b, {
    x: -59,
    z: -17,
    w: 10,
    d: 15,
    height: 4.6,
    wallMaterial: 'corrugatedRust',
    floorMaterial: 'concreteSlab',
    roof: false,
    sides: {
      N: { openings: [{ at: 5, width: 3.6, height: 3.4, kind: 'gate' }] },
      S: { openings: [{ at: 5, width: 3.6, height: 3.4, kind: 'gate' }, { at: 8.4, width: 1.6, height: 2.2, kind: 'door' }] },
      E: { openings: [{ at: 7.5, width: 4, height: 3.4, kind: 'gate' }] },
    },
    tag: 'hangar',
  });
  vehicle(b, { x: -60.4, z: -17.4, rot: 0.9, kind: 'apc', paint: 'olive', burnt: true, seed: 35 });
  crate(b, { x: -62.4, z: -12, size: 1.0, kind: 'mil', stack: 2, seed: 8 });
  corpse(b, { x: -58.4, z: -13.4, rot: 2.2, kind: 'soldier', seed: 41 });
  corpse(b, { x: -56.4, z: -19.5, rot: 0.4, kind: 'soldier', seed: 42 });
  wallDecal(b, 'stencilLZ', -59, 3.2, -24.35, 4.4, 1.2, 0);

  // ground grime on the apron
  for (let i = 0; i < 9; i++) groundDecal(b, rng.pick(['oilStain', 'dirtPatch', 'crackLarge', 'skid'] as const), rng.range(-62, -10), rng.range(-24, -8), rng.range(2, 4.5), rng.range(2, 4), rng.range(0, 6.28), 0.045);
  for (let i = 0; i < 5; i++) groundDecal(b, rng.pick(['bloodOld0', 'bloodOld1', 'bloodOld2'] as const), rng.range(-56, -18), rng.range(-24, -9), rng.range(2, 3.2), rng.range(2, 3), rng.range(0, 6.28), 0.05);

  reserve(c, LZ.x, LZ.z, 9);

  // gameplay
  d.station({ kind: 'buy', name: 'FORWARD CACHE', x: -24.6, z: -11.6, yaw: yawFacing(-0.9, 0.2), region: 'low' });
  d.crate(-59.6, -21.6, yawFacing(1, 0.2), 'low');
  d.crate(-14.2, -22.8, yawFacing(-1, 0.3), 'low');
  d.spawn(
    'low',
    'lz',
    [
      [-63, -9],
      [-63, -22],
      [-56, -6.3],
      [-30, -6.3],
      [-14, -6.3],
      [-50, -26.4],
      [-24, -26.4],
      [-10, -16],
      [-36, -33],
      [-58, -33],
    ],
    1,
  );
  d.spawn('low', 'general', [[-30, -30.6], [-56, -30.6], [-22, -12]]);
  d.zombies('low', 'shambler', [[-58.4, -15.4], [-21, -18], [-44, -27]]);
}

export function buildNorthStrip(c: Ctx): void {
  const { b, d, rng } = c;
  groundRect(b, 'dirt', -64.8, -50.8, -5.4, -35.6, 0.025);
  // row of ruined houses
  const houses: [number, number, number, number, number][] = [
    [-58, -44.4, 10, 8, 5.4],
    [-46, -44.4, 9, 8, 6.2],
    [-22, -44.6, 10, 8, 5.6],
  ];
  houses.forEach(([x, z, w, dd, h], i) => {
    solidBlock(b, { x, z, w, d: dd, height: h, wallMaterial: i % 2 ? 'plaster' : 'brick', facade: { floors: 2, floorHeight: 2.7, windowW: 1.1, windowH: 1.3, litFraction: 0.03, seed: 10 + i, faces: ['S', 'E', 'W'] }, tag: 'house' });
  });
  // the enterable ruin: open to the sky, breached walls
  building(b, {
    x: -34,
    z: -43.6,
    w: 10,
    d: 9,
    height: 3.6,
    wallMaterial: 'plaster',
    floorMaterial: 'floorStore',
    roof: false,
    sides: {
      S: { openings: [{ at: 4.6, width: 1.8, height: 2.3, kind: 'door' }, { at: 1.6, width: 1.5, height: 1.4, sill: 0.9, kind: 'window' }, { at: 8.2, width: 1.5, height: 1.4, sill: 0.9, kind: 'window' }] },
      E: { openings: [{ at: 4, width: 1.6, height: 2.2, kind: 'door' }] },
      W: { openings: [{ at: 4.6, width: 3, height: 3.6, kind: 'gate' }] },
    },
    partitions: [{ x0: -34, z0: -47.6, x1: -34, z1: -42.6, thickness: 0.2, openings: [{ at: 3.6, width: 1.6, height: 2.3, kind: 'door' }] }],
    tag: 'ruin',
  });
  debris(b, { x: -36, z: -45.6, radius: 2.2, seed: 61, big: true });
  crate(b, { x: -31.6, z: -46.6, size: 0.9, kind: 'wood', seed: 12 });
  corpse(b, { x: -33, z: -41.4, rot: 1.0, kind: 'civilian', seed: 44 });
  // bus depot at the east end
  vehicle(b, { x: -13, z: -47.8, rot: 0.02, kind: 'bus', paint: 'yellow', wrecked: true, seed: 71 });
  vehicle(b, { x: -13.6, z: -43.6, rot: -0.03, kind: 'bus', paint: 'yellow', seed: 72 });
  chainlinkFence(b, { x0: -19.5, z0: -50.6, x1: -19.5, z1: -37, height: 2.4, gaps: [{ at: 8, width: 3.4 }], damaged: true });
  dumpster(b, { x: -8, z: -39.2, rot: 0 });
  for (const [x, z] of [[-62, -38.6], [-28, -38.5], [-8.6, -49.6]] as const) deadTree(b, { x, z, scale: rng.range(1, 1.5), seed: Math.floor(x * 7 + z) });
  debris(b, { x: -52, z: -39, radius: 2.4, seed: 62 });
  d.crate(-32.4, -46.4, yawFacing(0, 1), 'low');
  d.spawn('low', 'general', [[-30, -50], [-58, -49.6], [-9, -41], [-46, -37]]);
  d.zombies('low', 'shambler', [[-46, -39.6], [-16, -40.6]]);
  void addBox;
}
