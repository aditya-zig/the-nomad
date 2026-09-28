/** Ground, roads, sidewalks, markings, street furniture and boundary. */
import * as THREE from 'three';
import { hash2 } from '../../logic/rng';
import { groundDecal, groundRect, perimeterWall, wall, addBox, wallDecal } from '../structures';
import { cones, debris, roadSign, streetLamp, utilityPole, vehicle, jerseyBarrier, barrierLine, bench, hydrant, busShelter, deadTree } from '../props';
import { collapsedRoad, overpassRuin, quarantineGate, skylineBackdrop } from '../landmarks';
import type { VehicleKind, PaintName } from '../props';
import { HALF_PI, isFree, reserve, type Ctx } from './util';

export const BLOCKS = {
  sw1: { x0: -65, z0: 5, x1: -38, z1: 19 },
  sw2: { x0: -30, z0: 5, x1: -5, z1: 19 },
  sw3: { x0: -65, z0: 27, x1: -38, z1: 51 },
  sw4: { x0: -30, z0: 27, x1: -5, z1: 51 },
  lz: { x0: -65, z0: -27, x1: -5, z1: -5 },
  nwn: { x0: -65, z0: -51, x1: -5, z1: -35 },
  depot: { x0: 5, z0: 5, x1: 65, z1: 51 },
  compound: { x0: 5, z0: -51, x1: 65, z1: -5 },
};

const ROADS = [
  { id: 'route9', x0: -65, z0: -5, x1: 65, z1: 5, name: 'ROUTE 9', mat: 'asphaltWet' as const, y: 0.012 },
  { id: 'depot', x0: -5, z0: -51, x1: 5, z1: 51, name: 'DEPOT ROAD', mat: 'asphaltWet' as const, y: 0.013 },
  { id: 'south', x0: -65, z0: 19, x1: -5, z1: 27, name: 'SOUTH STREET', mat: 'asphalt' as const, y: 0.011 },
  { id: 'west', x0: -38, z0: 5, x1: -30, z1: 51, name: 'WEST AVENUE', mat: 'asphalt' as const, y: 0.0115 },
  { id: 'north', x0: -65, z0: -35, x1: -5, z1: -27, name: 'NORTH ROAD', mat: 'asphalt' as const, y: 0.0105 },
];

export function buildGround(c: Ctx): void {
  const { b, d } = c;
  // huge base plane (visible beyond the perimeter)
  const base = new THREE.Mesh(new THREE.PlaneGeometry(1000, 1000), b.mats.get('dirt'));
  base.rotation.x = -Math.PI / 2;
  base.position.y = -0.02;
  base.receiveShadow = true;
  b.add(base);

  for (const r of ROADS) {
    groundRect(b, r.mat, r.x0, r.z0, r.x1, r.z1, r.y);
    d.road(r.x0, r.z0, r.x1, r.z1, r.name);
  }
  // sidewalk slabs for the city blocks; depot + compound get industrial slab
  const sw = (bl: { x0: number; z0: number; x1: number; z1: number }, mat: 'sidewalk' | 'concreteSlab') => groundRect(b, mat, bl.x0, bl.z0, bl.x1, bl.z1, 0.02);
  sw(BLOCKS.sw1, 'sidewalk');
  sw(BLOCKS.sw2, 'sidewalk');
  sw(BLOCKS.sw3, 'sidewalk');
  sw(BLOCKS.sw4, 'sidewalk');
  sw(BLOCKS.nwn, 'sidewalk');
  sw(BLOCKS.lz, 'concreteSlab');
  sw(BLOCKS.depot, 'concreteSlab');
  sw(BLOCKS.compound, 'concreteSlab');

  // region rectangles (first match wins)
  d.regionRects.push(
    { region: 'high', x0: 6, z0: -52, x1: 66, z1: -8 },
    { region: 'medium', x0: 6, z0: -8, x1: 66, z1: 52 },
  );
  d.label('INSERTION', -50, 46, 1);
  d.label('CORNER STORE', -22, 34, 0.8);
  d.label('PARKING', -18, 12, 0.8);
  d.label('APARTMENTS', -52, 12, 0.8);
  d.label('LZ ECHO', -42, -16, 1.1);
  d.label('NORTH ROAD', -35, -31, 0.8);
  d.label('DEPOT', 26, 46, 1);
  d.label('WAREHOUSE', 54, 39, 0.9);
  d.label('RESEARCH COMPOUND', 36, -28, 1.1);
  d.label('ROUTE 9', -30, 0, 0.8);
  d.label('DEPOT ROAD', 0, 30, 0.8);
}

function markings(c: Ctx): void {
  const { b } = c;
  const dash = (x0: number, z0: number, x1: number, z1: number, decal: 'laneDash' | 'laneSolid' | 'laneYellow', width: number, seg: number, gap: number) => {
    const L = Math.hypot(x1 - x0, z1 - z0);
    const ux = (x1 - x0) / L;
    const uz = (z1 - z0) / L;
    const rot = Math.atan2(-uz, ux);
    for (let s = seg / 2; s < L - seg / 2; s += seg + gap) {
      groundDecal(b, decal, x0 + ux * s, z0 + uz * s, seg, width, rot, 0.05);
    }
  };
  // Route 9: double yellow in the middle (broken by the intersection), white edge lines
  dash(-64, 0, -6.5, 0, 'laneYellow', 0.5, 9, 0.8);
  dash(6.5, 0, 64, 0, 'laneYellow', 0.5, 9, 0.8);
  dash(-64, -4.3, -6.5, -4.3, 'laneSolid', 0.16, 9, 0.5);
  dash(-64, 4.3, -6.5, 4.3, 'laneSolid', 0.16, 9, 0.5);
  dash(6.5, -4.3, 64, -4.3, 'laneSolid', 0.16, 9, 0.5);
  dash(6.5, 4.3, 64, 4.3, 'laneSolid', 0.16, 9, 0.5);
  // Depot Road
  dash(0, -50, 0, -6.5, 'laneYellow', 0.5, 9, 0.8);
  dash(0, 6.5, 0, 50, 'laneYellow', 0.5, 9, 0.8);
  dash(-4.3, -50, -4.3, -6.5, 'laneSolid', 0.16, 9, 0.5);
  dash(4.3, -50, 4.3, -6.5, 'laneSolid', 0.16, 9, 0.5);
  dash(-4.3, 6.5, -4.3, 50, 'laneSolid', 0.16, 9, 0.5);
  dash(4.3, 6.5, 4.3, 50, 'laneSolid', 0.16, 9, 0.5);
  // side streets: dashed centre lines
  dash(-64, 23, -6, 23, 'laneDash', 0.2, 3, 4);
  dash(-34, 6.5, -34, 18, 'laneDash', 0.2, 3, 4);
  dash(-34, 28, -34, 50, 'laneDash', 0.2, 3, 4);
  dash(-64, -31, -6, -31, 'laneDash', 0.2, 3, 4);
  // crosswalks and stop lines at the central intersection
  groundDecal(b, 'crosswalk', 0, -6.6, 9.6, 2.4, 0, 0.05);
  groundDecal(b, 'crosswalk', 0, 6.6, 9.6, 2.4, 0, 0.05);
  groundDecal(b, 'crosswalk', -6.6, 0, 2.4, 9.6, HALF_PI, 0.05);
  groundDecal(b, 'crosswalk', 6.6, 0, 2.4, 9.6, HALF_PI, 0.05);
  groundDecal(b, 'stopLine', -2.4, -8.6, 4.4, 0.5, 0, 0.05);
  groundDecal(b, 'stopLine', 2.4, 8.6, 4.4, 0.5, Math.PI, 0.05);
  groundDecal(b, 'arrow', -2.4, 12, 1.4, 3, HALF_PI, 0.05);
  // grime: oil, cracks, puddles, dried blood along the roads
  const decals = ['oilStain', 'crackLarge', 'puddle', 'dirtPatch', 'skid', 'bloodOld0', 'bloodOld1', 'bloodOld2', 'bloodDrag'] as const;
  for (const r of ROADS) {
    const w = r.x1 - r.x0;
    const h = r.z1 - r.z0;
    const n = Math.round((w * h) / 60);
    for (let i = 0; i < n; i++) {
      const x = r.x0 + c.rng.f() * w;
      const z = r.z0 + c.rng.f() * h;
      const name = c.rng.pick(decals);
      const s = name === 'puddle' ? c.rng.range(2.5, 5) : c.rng.range(1.6, 3.4);
      groundDecal(b, name, x, z, s, s * c.rng.range(0.6, 1), c.rng.range(0, Math.PI), 0.04 + c.rng.f() * 0.005);
    }
  }
}

function streetFurniture(c: Ctx): void {
  const { b, rng } = c;
  // street lamps every ~22 m on alternating sides
  const lamp = (x: number, z: number, armDir: number, i: number) => {
    const roll = hash2(x, z) % 10;
    const mode = roll === 0 ? 'fail' : roll === 1 ? 'flicker' : 'steady';
    streetLamp(b, { x, z, rot: armDir, armDir, style: i % 5 === 0 ? 'double' : 'cobra', mode, on: true });
  };
  // Route 9
  let i = 0;
  for (let x = -58; x <= 58; x += 23) {
    if (Math.abs(x) < 9) continue;
    lamp(x, -6.3, HALF_PI, i);
    lamp(x + 11, 6.3, -HALF_PI, i);
    i++;
  }
  // Depot Road
  for (let z = -44; z <= 44; z += 22) {
    if (Math.abs(z) < 9) continue;
    lamp(-6.3, z, 0, i);
    lamp(6.3, z + 11, Math.PI, i);
    i++;
  }
  // south street & north road (west block), west avenue
  for (let x = -58; x <= -10; x += 24) {
    lamp(x, 17.6, -HALF_PI, i++);
    lamp(x + 12, 28.4, HALF_PI, i++);
    lamp(x, -25.6, -HALF_PI, i++);
    lamp(x + 12, -36.4, HALF_PI, i++);
  }
  for (let z = 12; z <= 48; z += 24) lamp(-28.6, z, Math.PI, i++);
  // intersection lamp + traffic lights (dead)
  lamp(6.5, 6.5, Math.PI, 5);

  // utility poles with sagging wires along the north side of Route 9
  const poleXs = [-56, -30, -6, 20, 46];
  poleXs.forEach((x, k) => {
    const next = poleXs[k + 1];
    utilityPole(b, { x, z: -7.6, rot: 0, wireTo: next !== undefined ? [{ x: next, z: -7.6 }] : undefined, leaning: k === 2 ? 0.14 : 0 });
  });

  // signage
  roadSign(b, { x: -6.6, z: 8, rot: -HALF_PI, lines: ['ROUTE 9', 'EAST  DEPOT', 'WEST  LZ'], kind: 'route' });
  roadSign(b, { x: -44, z: 25.5, rot: 0, lines: ['CHECKPOINT', 'SIERRA', 'ENTRY ONLY'], kind: 'warning' });
  roadSign(b, { x: 6.6, z: -12, rot: -HALF_PI, lines: ['QUARANTINE', 'ZONE', 'NO ENTRY'], kind: 'quarantine' });
  roadSign(b, { x: -6.6, z: -22, rot: HALF_PI, lines: ['RESEARCH', 'COMPOUND', 'AUTHORIZED ONLY'], kind: 'warning' });
  roadSign(b, { x: 6.6, z: 30, rot: -HALF_PI, lines: ['DEPOT 4', 'FREIGHT ONLY'], kind: 'depot' });
  roadSign(b, { x: -20, z: -25.6, rot: 0, lines: ['LZ ECHO', 'HELIPAD'], kind: 'info' });

  // dead trees in the corners of blocks and along the edges
  const treeSpots: [number, number][] = [[-63, 8], [-40.5, 52 - 4], [-62, -49], [-8, -49], [-9, 10], [-63, 49], [-26, -37.6], [-50, -37]];
  for (const [x, z] of treeSpots) deadTree(b, { x, z, scale: rng.range(0.9, 1.4), seed: hash2(x, z) });

  // benches, hydrants, a bus shelter
  busShelter(b, { x: -14, z: 7.3, rot: Math.PI });
  bench(b, { x: -22, z: 6.6, rot: Math.PI });
  hydrant(b, { x: -12, z: 17.5 });
  hydrant(b, { x: -47, z: 25.5 });
  hydrant(b, { x: 7, z: 40 });
}

function abandonedTraffic(c: Ctx): void {
  const { b, rng } = c;
  const kinds: VehicleKind[] = ['sedan', 'hatch', 'suv', 'pickup', 'van', 'sedan', 'suv'];
  const paints: PaintName[] = ['white', 'blue', 'grey', 'black', 'red', 'olive', 'yellow'];
  const put = (x: number, z: number, rot: number, kind?: VehicleKind, wrecked = false, burnt = false) => {
    if (!isFree(c, x, z, 2.4)) return;
    reserve(c, x, z, kind === 'bus' || kind === 'boxTruck' ? 5 : 2.6);
    vehicle(b, { x, z, rot, kind: kind ?? rng.pick(kinds), paint: rng.pick(paints), wrecked, burnt, doorsOpen: rng.chance(0.25), seed: Math.floor(rng.f() * 1e6) });
  };
  // Route 9 west of the centre - a stalled column heading west, plus a few wrecks
  put(-14, -2.4, Math.PI, 'sedan');
  put(-19.5, -2.2, Math.PI + 0.06, 'suv', true);
  put(-27, 2.6, 0.05, 'van');
  put(-38, -2.6, Math.PI - 0.08, 'pickup', false, true);
  put(-48, 2.4, 0.02, 'hatch', true);
  put(-56.5, -2.5, Math.PI, 'sedan');
  // Route 9 east
  put(14, 2.5, 0.04, 'sedan');
  put(23, -2.6, Math.PI - 0.05, 'suv', true);
  put(38, 2.2, 0.03, 'van', true, true);
  put(50, -2.4, Math.PI + 0.06, 'pickup');
  // Depot Road
  put(-2.4, 16, -HALF_PI + 0.05, 'sedan', true);
  put(2.6, 30, HALF_PI - 0.04, 'hatch');
  put(-2.5, 44, HALF_PI + 0.05, 'suv');
  put(2.4, -19, HALF_PI, 'van', true);
  put(-2.6, -40, -HALF_PI - 0.03, 'sedan');
  // the central intersection: a crashed bus and a burnt car
  put(-1.5, 9.8, 0.55, 'bus', true);
  put(3.6, -3.5, 1.1, 'sedan', true, true);
  // South Street / West Avenue / North Road
  put(-58, 21.6, 0.02, 'sedan');
  put(-46, 24.6, Math.PI - 0.03, 'pickup', true);
  put(-22, 21.4, 0.05, 'suv');
  put(-11, 24.4, Math.PI, 'sedan', true);
  put(-34.2, 36, HALF_PI + 0.05, 'van');
  put(-31.5, 12, -HALF_PI, 'hatch', true);
  put(-60, -29, 0.04, 'sedan');
  put(-46, -33, Math.PI, 'suv', true, true);
  put(-27, -29.5, 0.05, 'van');
  put(-12, -32.5, Math.PI + 0.04, 'pickup');
  // lone cones & debris near roadblocks
  cones(b, { x0: -4.2, z0: -13, x1: -4.2, z1: -8, spacing: 1.6 });
  cones(b, { x0: 4.2, z0: 13, x1: 4.2, z1: 8.5, spacing: 1.6 });
}

/** Perimeter walls, natural boundaries (collapsed roads, gates) and the skyline backdrop. */
export function buildBoundary(c: Ctx): void {
  const { b } = c;
  const X = 65.4;
  const Z = 51.4;
  // north wall (compound + NW strip); Depot Road gate gap x in [-6, 6]
  perimeterWall(b, -X, -Z, -6.2, -Z);
  perimeterWall(b, 6.2, -Z, X, -Z);
  // south wall
  perimeterWall(b, -X, Z, -6.2, Z);
  perimeterWall(b, 6.2, Z, X, Z);
  // west wall with the Route 9 collapse gap z in [-7, 7]
  perimeterWall(b, -X, -Z, -X, -7.2);
  perimeterWall(b, -X, 7.2, -X, Z);
  // east wall with the Route 9 collapse gap
  perimeterWall(b, X, -Z, X, -7.2);
  perimeterWall(b, X, 7.2, X, Z);

  // quarantine gates closing Depot Road at both ends (closed: no passable gap - leaves are solid here)
  quarantineGate(b, { x: 0, z: -49.6, rot: 0, width: 12, open: 0 });
  quarantineGate(b, { x: 0, z: 49.6, rot: Math.PI, width: 12, open: 0 });
  // safety colliders under the gates (the gate leaves are the visual)
  b.collideBox(0, -51, 12.4, 1.6, 4.5, { mapKind: 'wall', tag: 'gate' });
  b.collideBox(0, 51, 12.4, 1.6, 4.5, { mapKind: 'wall', tag: 'gate' });

  // collapsed roads at both ends of Route 9
  collapsedRoad(b, { x: -60.5, z: 0, rot: 0, w: 9, d: 16, seed: 3 });
  collapsedRoad(b, { x: 60.5, z: 0, rot: Math.PI, w: 9, d: 16, seed: 5 });
  b.collideBox(-64.6, 0, 1.8, 16, 6, { mapKind: 'wall', tag: 'collapse-backstop' });
  b.collideBox(64.6, 0, 1.8, 16, 6, { mapKind: 'wall', tag: 'collapse-backstop' });
  overpassRuin(b, { x: -62, z: -36, rot: HALF_PI, length: 28, width: 9 });
  wallDecal(b, 'stencilQuarantine', -X + 0.62, 2.6, -30, 8, 2.2, HALF_PI);
  wallDecal(b, 'stencilDanger', X - 0.62, 2.6, 30, 8, 2.2, -HALF_PI);
  wallDecal(b, 'stencilKeepOut', 20, 2.6, -Z + 0.62, 8, 2.2, 0);
  wallDecal(b, 'stencilQuarantine', -20, 2.6, Z - 0.62, 8, 2.2, Math.PI);
  wallDecal(b, 'stencilQuarantine', -50, 2.6, Z - 0.62, 8, 2.2, Math.PI);

  // extra invisible backstops beyond the walls so nothing can ever leave the map
  const B = 70;
  b.collide({ x: 0, z: -B, hx: 80, hz: 2, y1: 30, mapKind: 'none' });
  b.collide({ x: 0, z: B - 12, hx: 80, hz: 2, y1: 30, mapKind: 'none' });
  b.collide({ x: -B, z: 0, hx: 2, hz: 60, y1: 30, mapKind: 'none' });
  b.collide({ x: B, z: 0, hx: 2, hz: 60, y1: 30, mapKind: 'none' });

  skylineBackdrop(b, { bounds: { minX: -66, maxX: 66, minZ: -52, maxZ: 52 }, seed: 17 });
}

export function buildRoads(c: Ctx): void {
  buildGround(c);
  markings(c);
  streetFurniture(c);
  abandonedTraffic(c);
  buildBoundary(c);
  void jerseyBarrier;
  void barrierLine;
  void debris;
  void wall;
  void addBox;
}
