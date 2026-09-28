/** Gallery layouts for the props harness (one zone per page load). */
import type { LevelBuilder } from '../src/world/builder';
import * as props from '../src/world/props';
import { vehicle } from '../src/world/props';
import type { PaintName, VehicleKind } from '../src/world/props';

export interface ZoneInfo {
  cam?: [number, number, number, number, number, number];
  shots?: Record<string, [number, number, number, number, number, number]>;
}

export function buildZone(zone: string, b: LevelBuilder): ZoneInfo {
  switch (zone) {
    case 'containers':
      return zoneContainers(b);
    case 'vehicles':
      return zoneVehicles(b);
    case 'trucks':
      return zoneTrucks(b);
    case 'military':
      return zoneMilitary(b);
    case 'street':
      return zoneStreet(b);
    case 'industrial':
      return zoneIndustrial(b);
    case 'dressing':
      return zoneDressing(b);
    case 'stress':
      return zoneStress(b);
    case 'hero':
      return zoneHero(b);
    default:
      return {};
  }
}

function zoneContainers(b: LevelBuilder): ZoneInfo {
  const c = props;
  // containers row
  c.container(b, { x: -20, z: 0, rot: 0, color: 'red' });
  c.container(b, { x: -20, z: 6, rot: 0, color: 'blue', stack: 2 });
  c.container(b, { x: -20, z: -6, rot: 0.15, color: 'olive', short: true });
  c.container(b, { x: -2, z: -6, rot: Math.PI / 2, color: 'white', doorsOpen: true });
  c.container(b, { x: 4, z: 0, rot: Math.PI / 2, color: 'rust', stack: 3, seed: 5 });
  c.container(b, { x: 10, z: 0, rot: Math.PI / 2, color: 'yellow', seed: 9 });
  c.container(b, { x: 16, z: 0, rot: Math.PI / 2, color: 'green', seed: 14 });
  // drums
  const colors = ['blue', 'red', 'green', 'yellow', 'bio', 'rust'] as const;
  colors.forEach((col, i) => c.barrel(b, { x: -10 + i * 1.0, z: 12, color: col }));
  c.barrel(b, { x: -3, z: 13.5, color: 'blue', fallen: true, rot: 0.6 });
  c.barrelGroup(b, { x: 2, z: 14, radius: 3, count: 10, seed: 3 });
  // crates
  c.crate(b, { x: 8, z: 12, size: 0.9, kind: 'wood' });
  c.crate(b, { x: 10, z: 12, size: 0.9, kind: 'mil' });
  c.crate(b, { x: 12, z: 12, size: 0.7, kind: 'wood', stack: 2, seed: 4 });
  c.crateGroup(b, { x: 17, z: 14, radius: 3, count: 8, seed: 7 });
  // pallets
  (['none', 'boxes', 'wrapped', 'sacks', 'barrels'] as const).forEach((g, i) => c.pallet(b, { x: -10 + i * 2, z: 18, goods: g, seed: i }));
  // dumpsters
  c.dumpster(b, { x: -12, z: 23, color: 'green' });
  c.dumpster(b, { x: -8, z: 23, color: 'blue', lidOpen: true });
  c.dumpster(b, { x: -4, z: 23, color: 'rust', rot: 0.4 });
  return { cam: [12, 7, 28, -2, 1.5, 6] };
}

function zoneVehicles(b: LevelBuilder): ZoneInfo {
  const cars: { kind: VehicleKind; paint?: PaintName; wrecked?: boolean; burnt?: boolean; doorsOpen?: boolean }[] = [
    { kind: 'sedan', paint: 'grey' },
    { kind: 'sedan', paint: 'blue', wrecked: true, doorsOpen: true },
    { kind: 'sedan', paint: 'red', burnt: true },
    { kind: 'hatch', paint: 'yellow' },
    { kind: 'suv', paint: 'black', wrecked: true },
    { kind: 'suv', paint: 'olive' },
    { kind: 'pickup', paint: 'red' },
    { kind: 'pickup', paint: 'white', wrecked: true, doorsOpen: true },
    { kind: 'van', paint: 'white' },
    { kind: 'jeep', paint: 'olive' },
    { kind: 'ambulance', paint: 'white' },
  ];
  cars.forEach((v, i) => vehicle(b, { x: -24 + (i % 6) * 6.5, z: Math.floor(i / 6) * 8, rot: 0, ...v, seed: i + 1 }));
  return { cam: [10, 8, 22, -2, 1, 4] };
}

function zoneTrucks(b: LevelBuilder): ZoneInfo {
  const list: { kind: VehicleKind; paint?: PaintName; wrecked?: boolean; burnt?: boolean; doorsOpen?: boolean; x: number; z: number; rot?: number }[] = [
    { kind: 'boxTruck', paint: 'white', x: -22, z: 0 },
    { kind: 'bus', paint: 'yellow', x: -6, z: 0 },
    { kind: 'bus', paint: 'blue', wrecked: true, x: -6, z: -8 },
    { kind: 'apc', paint: 'olive', x: 14, z: 0 },
    { kind: 'apc', paint: 'olive', burnt: true, x: 14, z: 10, rot: 0.5 },
    { kind: 'tanker', paint: 'grey', x: -20, z: 12 },
    { kind: 'semiCab', paint: 'red', x: -2, z: 14 },
    { kind: 'trailer', paint: 'white', x: -14, z: 22 },
    { kind: 'boxTruck', paint: 'olive', wrecked: true, doorsOpen: true, x: 8, z: 22, rot: 0.3 },
  ];
  list.forEach((v, i) => vehicle(b, { rot: 0, ...v, seed: i + 1 }));
  return { cam: [10, 9, 34, -4, 1.5, 8] };
}

function zoneMilitary(b: LevelBuilder): ZoneInfo {
  const m = props;
  m.sandbagWall(b, { x0: -24, z0: 0, x1: -14, z1: 0 });
  m.sandbagWall(b, { x0: -24, z0: 4, x1: -18, z1: 6, height: 0.7 });
  m.sandbagWall(b, { x0: -13, z0: 0, x1: -13, z1: 6, height: 1.4 });
  m.jerseyBarrier(b, { x: -8, z: 0, rot: 0 });
  m.barrierLine(b, { x0: -6, z0: 3, x1: 10, z1: 3, gaps: [{ at: 7, width: 4 }] });
  m.barrierLine(b, { x0: -6, z0: 6, x1: 10, z1: 7, stagger: true });
  m.hescoWall(b, { x0: -24, z0: 12, x1: -12, z1: 12 });
  m.hescoWall(b, { x0: -12, z0: 12, x1: -12, z1: 18, height: 2 });
  m.chainlinkFence(b, { x0: -8, z0: 12, x1: 12, z1: 12, barbed: true, gaps: [{ at: 8, width: 4 }] });
  m.chainlinkFence(b, { x0: -8, z0: 16, x1: 12, z1: 16, damaged: true });
  m.tent(b, { x: 22, z: 4, rot: 0, kind: 'command' });
  m.tent(b, { x: 22, z: 16, rot: 0.2, kind: 'medical' });
  m.tent(b, { x: 34, z: 4, rot: -0.1, kind: 'mess' });
  m.tent(b, { x: 34, z: 14, rot: 0.3, kind: 'small' });
  m.checkpointBooth(b, { x: -20, z: 26, rot: 0 });
  m.boomBarrier(b, { x: -14, z: 24, rot: 0 });
  m.boomBarrier(b, { x: -14, z: 28, rot: 0, open: true });
  m.watchtower(b, { x: 0, z: 26, rot: 0 });
  return { cam: [-2, 8, 40, -2, 1.5, 8] };
}

function zoneStreet(b: LevelBuilder): ZoneInfo {
  const s = props;
  s.streetLamp(b, { x: -20, z: 0, rot: 0, style: 'cobra' });
  s.streetLamp(b, { x: -12, z: 0, rot: Math.PI, style: 'cobra', mode: 'flicker' });
  s.streetLamp(b, { x: -4, z: 0, rot: 0, style: 'double' });
  s.streetLamp(b, { x: 4, z: 0, rot: 0, style: 'cobra', mode: 'fail' });
  s.streetLamp(b, { x: 12, z: 0, rot: 0, style: 'cobra', on: false });
  s.streetLamp(b, { x: 20, z: 0, rot: 0, style: 'short' });
  const kinds = ['warning', 'info', 'stop', 'quarantine', 'route', 'depot'] as const;
  const texts: string[][] = [['DANGER', 'INFECTED AREA'], ['LZ ECHO', 'NORTH ROAD', '400 M'], [], ['QUARANTINE', 'ZONE 7', 'NO ENTRY'], ['ROUTE 9', 'DEPOT RD'], ['DEPOT 4', 'AUTHORISED', 'PERSONNEL']];
  kinds.forEach((k, i) => s.roadSign(b, { x: -20 + i * 3.5, z: 8, rot: 0, kind: k, lines: texts[i]! }));
  s.trafficLight(b, { x: -20, z: 14, rot: 0, mode: 'dead' });
  s.trafficLight(b, { x: -12, z: 14, rot: 0, mode: 'red' });
  s.trafficLight(b, { x: -4, z: 14, rot: 0, mode: 'flash' });
  s.utilityPole(b, { x: 6, z: 14, rot: 0, wireTo: [{ x: 22, z: 14 }] });
  s.utilityPole(b, { x: 22, z: 14, rot: 0, leaning: 0.08 });
  s.cones(b, { x0: -20, z0: 20, x1: -8, z1: 24 });
  s.cone(b, { x: -6, z: 22 });
  s.bench(b, { x: 0, z: 22 });
  s.busShelter(b, { x: 8, z: 24 });
  s.hydrant(b, { x: 14, z: 22 });
  return { cam: [4, 7, 34, 0, 2, 8] };
}

function zoneIndustrial(b: LevelBuilder): ZoneInfo {
  const i = props;
  i.shelvingRack(b, { x: -20, z: 0, length: 10, seed: 1 });
  i.shelvingRack(b, { x: -20, z: 4, length: 8, seed: 2, levels: 4 });
  i.forklift(b, { x: -8, z: 0, rot: 0.3 });
  i.forklift(b, { x: -8, z: 5, rot: 3.3, loaded: true, paint: 'olive' });
  i.fuelTank(b, { x: 6, z: 0, radius: 3, height: 8, color: 'white' });
  i.fuelTank(b, { x: 16, z: 0, radius: 2.2, height: 6, color: 'olive' });
  i.fuelTank(b, { x: 8, z: 12, radius: 1.3, height: 7, horizontal: true, color: 'grey' });
  i.generator(b, { x: -12, z: 14, rot: 0 });
  i.generator(b, { x: -12, z: 18, rot: 0.4, running: true });
  i.floodlightTower(b, { x: -4, z: 16, rot: 0.6 });
  i.craneGantry(b, { x: 8, z: 28, span: 14, height: 15, length: 10 });
  return { cam: [-2, 8, 34, -2, 2, 8] };
}

function zoneDressing(b: LevelBuilder): ZoneInfo {
  const d = props;
  d.debris(b, { x: -20, z: 0, radius: 3 });
  d.debris(b, { x: -12, z: 0, radius: 3.5, big: true });
  d.debris(b, { x: -4, z: 0, radius: 2, density: 0.6 });
  d.deadTree(b, { x: 4, z: 0, seed: 1 });
  d.deadTree(b, { x: 10, z: 2, seed: 2, scale: 1.2 });
  d.deadTree(b, { x: 16, z: -1, seed: 3, scale: 0.8 });
  (['soldier', 'civilian', 'hazmat', 'bodybag'] as const).forEach((k, i) => d.corpse(b, { x: -20 + i * 3.2, z: 10, rot: i * 0.9, kind: k, seed: i + 1 }));
  d.corpse(b, { x: -6, z: 10, rot: 2.2, kind: 'soldier', seed: 9 });
  d.corpse(b, { x: -3, z: 12, rot: 4, kind: 'civilian', seed: 11 });
  d.tireStack(b, { x: 4, z: 10 });
  d.tireStack(b, { x: 5.2, z: 10.4, count: 2 });
  d.pipeStack(b, { x: 12, z: 12, length: 6 });
  // building wall with fire escape
  b.add(wallBox(b, 26, 6, 12, 10, 0.4));
  d.fireEscape(b, { x: 26, z: 6.2, rot: 0, height: 9 });
  d.fireEscape(b, { x: 40, z: 6.2, rot: 0, height: 6, width: 1.6 });
  b.add(wallBox(b, 40, 6, 9, 8, 0.4));
  // roof platform with clutter
  b.add(wallBox(b, 0, 26, 12, 3.5, 10, 0));
  d.roofClutter(b, { x: 0, z: 26, w: 12, d: 10, y: 3.5, seed: 4 });
  d.cones(b, { x0: -20, z0: 18, x1: -8, z1: 18 });
  return { cam: [-6, 8, 38, -6, 1.5, 8] };
}

import * as THREE from 'three';
function wallBox(b: LevelBuilder, x: number, z: number, w: number, h: number, d: number, _t = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), b.mats.get('brick'));
  m.position.set(x, h / 2, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** One entry per public prop (single instance, default options) for budget measurements. */
export const MEASURE_CASES: [string, (b: LevelBuilder) => void][] = [
  ['container', (b) => props.container(b, { x: 0, z: 0, color: 'red' })],
  ['container(open,x3)', (b) => props.container(b, { x: 0, z: 0, color: 'white', doorsOpen: true, stack: 3 })],
  ['barrel', (b) => props.barrel(b, { x: 0, z: 0 })],
  ['crate', (b) => props.crate(b, { x: 0, z: 0 })],
  ['pallet(boxes)', (b) => props.pallet(b, { x: 0, z: 0, goods: 'boxes' })],
  ['dumpster', (b) => props.dumpster(b, { x: 0, z: 0 })],
  ['sandbagWall(6m)', (b) => props.sandbagWall(b, { x0: 0, z0: 0, x1: 6, z1: 0 })],
  ['jerseyBarrier', (b) => props.jerseyBarrier(b, { x: 0, z: 0 })],
  ['hescoWall(6m)', (b) => props.hescoWall(b, { x0: 0, z0: 0, x1: 6, z1: 0 })],
  ['chainlinkFence(10m,barbed)', (b) => props.chainlinkFence(b, { x0: 0, z0: 0, x1: 10, z1: 0, barbed: true })],
  ['tent(command)', (b) => props.tent(b, { x: 0, z: 0, kind: 'command' })],
  ['checkpointBooth', (b) => props.checkpointBooth(b, { x: 0, z: 0 })],
  ['boomBarrier', (b) => props.boomBarrier(b, { x: 0, z: 0 })],
  ['watchtower', (b) => props.watchtower(b, { x: 0, z: 0 })],
  ...(['sedan', 'hatch', 'suv', 'pickup', 'van', 'boxTruck', 'bus', 'apc', 'jeep', 'ambulance', 'tanker', 'semiCab', 'trailer'] as VehicleKind[]).map(
    (k): [string, (b: LevelBuilder) => void] => [`vehicle:${k}`, (b) => props.vehicle(b, { x: 0, z: 0, kind: k })],
  ),
  ['vehicle:sedan(wrecked)', (b) => props.vehicle(b, { x: 0, z: 0, kind: 'sedan', wrecked: true, doorsOpen: true })],
  ['streetLamp', (b) => props.streetLamp(b, { x: 0, z: 0 })],
  ['roadSign', (b) => props.roadSign(b, { x: 0, z: 0, lines: ['DANGER'] })],
  ['trafficLight', (b) => props.trafficLight(b, { x: 0, z: 0 })],
  ['utilityPole', (b) => props.utilityPole(b, { x: 0, z: 0 })],
  ['cone', (b) => props.cone(b, { x: 0, z: 0 })],
  ['bench', (b) => props.bench(b, { x: 0, z: 0 })],
  ['busShelter', (b) => props.busShelter(b, { x: 0, z: 0 })],
  ['hydrant', (b) => props.hydrant(b, { x: 0, z: 0 })],
  ['shelvingRack(10m)', (b) => props.shelvingRack(b, { x: 0, z: 0, length: 10 })],
  ['forklift', (b) => props.forklift(b, { x: 0, z: 0 })],
  ['fuelTank(vertical r3 h8)', (b) => props.fuelTank(b, { x: 0, z: 0, radius: 3, height: 8 })],
  ['fuelTank(horizontal)', (b) => props.fuelTank(b, { x: 0, z: 0, radius: 1.3, height: 7, horizontal: true })],
  ['generator', (b) => props.generator(b, { x: 0, z: 0, running: true })],
  ['floodlightTower', (b) => props.floodlightTower(b, { x: 0, z: 0 })],
  ['craneGantry', (b) => props.craneGantry(b, { x: 0, z: 0, span: 14, height: 15, length: 10 })],
  ['tireStack', (b) => props.tireStack(b, { x: 0, z: 0 })],
  ['pipeStack', (b) => props.pipeStack(b, { x: 0, z: 0 })],
  ['fireEscape(9m)', (b) => props.fireEscape(b, { x: 0, z: 0, height: 9 })],
  ['roofClutter(12x10)', (b) => props.roofClutter(b, { x: 0, z: 0, w: 12, d: 10, y: 4 })],
  ['debris(r3)', (b) => props.debris(b, { x: 0, z: 0, radius: 3 })],
  ['deadTree', (b) => props.deadTree(b, { x: 0, z: 0 })],
  ['corpse(soldier)', (b) => props.corpse(b, { x: 0, z: 0 })],
];

/** Level-scale build: ~350 mixed props over a 130 x 100 m area (used for build-time / draw-call / frame-time numbers). */
function zoneStress(b: LevelBuilder): ZoneInfo {
  const rng = mulberry(7);
  const kinds: VehicleKind[] = ['sedan', 'hatch', 'suv', 'pickup', 'van', 'boxTruck', 'bus', 'apc', 'jeep', 'ambulance', 'tanker', 'semiCab', 'trailer'];
  const t0 = performance.now();
  let n = 0;
  const at = (): { x: number; z: number; rot: number } => ({ x: -60 + rng() * 120, z: -48 + rng() * 96, rot: rng() * 6.28 });
  for (let i = 0; i < 40; i++) props.vehicle(b, { ...at(), kind: kinds[i % kinds.length]!, wrecked: rng() < 0.4, seed: i }), n++;
  for (let i = 0; i < 36; i++) props.container(b, { ...at(), rot: (Math.floor(rng() * 4) * Math.PI) / 2, stack: (1 + Math.floor(rng() * 2)) as 1 | 2, seed: i }), n++;
  for (let i = 0; i < 30; i++) props.streetLamp(b, { ...at(), style: i % 5 === 0 ? 'double' : 'cobra', mode: i % 7 === 0 ? 'flicker' : 'steady' }), n++;
  for (let i = 0; i < 24; i++) props.barrelGroup(b, { ...at(), count: 6, radius: 2 }), n++;
  for (let i = 0; i < 24; i++) props.crateGroup(b, { ...at(), count: 6, radius: 2.5 }), n++;
  for (let i = 0; i < 16; i++) props.sandbagWall(b, { x0: -60 + rng() * 110, z0: -48 + rng() * 90, x1: -60 + rng() * 110 + 4, z1: -48 + rng() * 90 }), n++;
  for (let i = 0; i < 12; i++) props.barrierLine(b, { x0: -60 + rng() * 100, z0: -48 + rng() * 90, x1: -60 + rng() * 100 + 12, z1: -48 + rng() * 90 }), n++;
  for (let i = 0; i < 10; i++) props.chainlinkFence(b, { x0: -60 + rng() * 100, z0: -48 + rng() * 90, x1: -60 + rng() * 100 + 16, z1: -48 + rng() * 90, barbed: true }), n++;
  for (let i = 0; i < 10; i++) props.debris(b, { ...at(), radius: 3, big: i % 3 === 0 }), n++;
  for (let i = 0; i < 12; i++) props.roadSign(b, { ...at(), lines: ['DANGER', 'INFECTED AREA'], kind: 'warning' }), n++;
  for (let i = 0; i < 12; i++) props.corpse(b, { ...at(), kind: 'soldier' }), n++;
  for (let i = 0; i < 8; i++) props.deadTree(b, { ...at(), seed: i }), n++;
  for (let i = 0; i < 6; i++) props.tent(b, { ...at(), kind: (['command', 'medical', 'small', 'mess'] as const)[i % 4]! }), n++;
  for (let i = 0; i < 6; i++) props.shelvingRack(b, { ...at(), length: 8 }), n++;
  for (let i = 0; i < 6; i++) props.forklift(b, { ...at() }), n++;
  for (let i = 0; i < 5; i++) props.generator(b, { ...at(), running: i % 2 === 0 }), n++;
  for (let i = 0; i < 4; i++) props.fuelTank(b, { ...at(), radius: 2.5, height: 7 }), n++;
  for (let i = 0; i < 4; i++) props.floodlightTower(b, { ...at() }), n++;
  const buildMs = performance.now() - t0;
  (window as unknown as Record<string, unknown>).__buildMs = buildMs;
  (window as unknown as Record<string, unknown>).__propCount = n;
  return { cam: [0, 60, 90, 0, 0, 0] };
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A composed checkpoint tableau used for eye-level review shots at the game's real exposure. */
function zoneHero(b: LevelBuilder): ZoneInfo {
  const h = props;
  // road-side checkpoint
  h.checkpointBooth(b, { x: 6, z: -3, rot: 0 });
  h.boomBarrier(b, { x: -6, z: -1, rot: 0, width: 6 });
  h.barrierLine(b, { x0: -12, z0: -4, x1: -3, z1: -4 });
  h.barrierLine(b, { x0: -12, z0: 3, x1: 4, z1: 3, gaps: [{ at: 8, width: 3 }] });
  h.sandbagWall(b, { x0: 8, z0: 5, x1: 14, z1: 5 });
  h.sandbagWall(b, { x0: 14, z0: 5, x1: 14, z1: 1, height: 1.1 });
  h.streetLamp(b, { x: -2, z: -6, rot: 0, armDir: Math.PI / 2 * 0 + Math.PI / 2 });
  h.streetLamp(b, { x: 12, z: -6, rot: 0, mode: 'flicker' });
  h.floodlightTower(b, { x: 16, z: -8, rot: 2.5 });
  h.roadSign(b, { x: -10, z: -6, rot: 0, kind: 'quarantine', lines: ['QUARANTINE', 'ZONE 7', 'NO ENTRY'] });
  h.roadSign(b, { x: 4, z: 8, rot: 0.3, kind: 'stop', lines: [] });
  h.vehicle(b, { x: 22, z: 2, kind: 'apc', rot: -0.3 });
  h.vehicle(b, { x: -18, z: 8, kind: 'sedan', wrecked: true, doorsOpen: true, rot: 2.2, paint: 'blue' });
  h.vehicle(b, { x: -8, z: 12, kind: 'bus', rot: 0.15, wrecked: true, paint: 'yellow' });
  h.vehicle(b, { x: 2, z: 16, kind: 'pickup', rot: 3.3, burnt: true });
  h.container(b, { x: -22, z: -8, rot: 0.1, stack: 2, color: 'red' });
  h.container(b, { x: -22, z: -13, rot: 0, color: 'blue' });
  h.container(b, { x: 30, z: -8, rot: Math.PI / 2, color: 'olive', doorsOpen: true });
  h.barrelGroup(b, { x: 26, z: 9, radius: 2, count: 7, seed: 1 });
  h.crateGroup(b, { x: 10, z: 12, radius: 2, count: 5, seed: 2 });
  h.tent(b, { x: 36, z: 4, rot: 0.2, kind: 'command' });
  h.corpse(b, { x: 2, z: 6, rot: 1.2, kind: 'soldier', seed: 3 });
  h.corpse(b, { x: 15, z: 8, rot: 0.3, kind: 'civilian', seed: 5 });
  h.debris(b, { x: -14, z: 14, radius: 3 });
  h.cones(b, { x0: -14, z0: 0, x1: -14, z1: 6 });
  h.deadTree(b, { x: -30, z: 4, seed: 4 });
  h.deadTree(b, { x: 40, z: -12, seed: 8, scale: 1.2 });
  return { cam: [-14, 1.7, -14, 4, 1.4, 0] };
}
