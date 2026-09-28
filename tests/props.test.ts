import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { MEASURE_CASES } from '../dev/props-zones';
import { LevelBuilder } from '../src/world/builder';
import { CollisionWorld } from '../src/world/collision';
import { DECAL_NAMES, MATERIAL_NAMES, type MaterialLib, type MaterialName } from '../src/world/materials';
import * as props from '../src/world/props';
import type { VehicleKind } from '../src/world/props';

/** DOM-free material library: flat materials, tile sizes on the tiling names, and a stencil that (like the real one) puts a newline in the name. */
function stubLib(): MaterialLib {
  const cache = new Map<string, THREE.MeshStandardMaterial>();
  const tiled: Partial<Record<MaterialName, number>> = { asphalt: 8, concreteWall: 4, chainlink: 2.4, containerRed: 2.4, containerBlue: 2.4, containerGreen: 2.4, containerOlive: 2.4, containerRust: 2.4, containerWhite: 2.4, containerYellow: 2.4, wood: 2, brick: 3 };
  const make = (key: string, tile?: number): THREE.MeshStandardMaterial => {
    let m = cache.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color: 0x888888 });
      m.name = key;
      if (tile) m.userData.tile = tile;
      cache.set(key, m);
    }
    return m;
  };
  return {
    get: (n) => make(n, tiled[n]),
    decal: (n) => make(`decal:${n}`),
    stencil: (text, opts) => make(`stencil:${text}|${JSON.stringify(opts ?? {})}`),
    glowTexture: new THREE.Texture(),
    lightPoolTexture: new THREE.Texture(),
    dispose() {},
  };
}

const bounds = { minX: -80, maxX: 80, minZ: -80, maxZ: 80 };

function build(fn: (b: LevelBuilder) => void): { b: LevelBuilder; world: CollisionWorld } {
  const world = new CollisionWorld(bounds);
  const b = new LevelBuilder(stubLib(), world);
  fn(b);
  b.finalize();
  return { b, world };
}

function assertSane(b: LevelBuilder, world: CollisionWorld, label: string): void {
  for (const c of world.colliders) {
    for (const v of [c.cx, c.cz, c.hx, c.hz, c.y0, c.y1, c.rot]) expect(Number.isFinite(v), `${label}: collider value`).toBe(true);
    expect(c.hx, label).toBeGreaterThan(0);
    expect(c.hz, label).toBeGreaterThan(0);
    expect(c.y1, label).toBeGreaterThan(c.y0);
  }
  let meshes = 0;
  b.root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    meshes++;
    const geo = m.geometry;
    geo.computeBoundingSphere();
    expect(Number.isFinite(geo.boundingSphere!.radius), `${label}: bounding sphere`).toBe(true);
    const pos = geo.attributes.position!;
    for (let i = 0; i < pos.array.length; i++) if (!Number.isFinite(pos.array[i]!)) throw new Error(`${label}: NaN vertex data`);
  });
  expect(meshes, `${label}: produced geometry`).toBeGreaterThan(0);
}

describe('props', () => {
  it('exports every contract function', () => {
    const names = [
      'container', 'barrel', 'barrelGroup', 'crate', 'crateGroup', 'pallet', 'dumpster', 'sandbagWall', 'jerseyBarrier', 'barrierLine', 'hescoWall',
      'chainlinkFence', 'tent', 'vehicle', 'streetLamp', 'roadSign', 'trafficLight', 'utilityPole', 'cone', 'cones', 'debris', 'deadTree', 'corpse',
      'shelvingRack', 'forklift', 'fuelTank', 'generator', 'floodlightTower', 'craneGantry', 'checkpointBooth', 'boomBarrier', 'watchtower', 'bench',
      'busShelter', 'hydrant', 'tireStack', 'pipeStack', 'fireEscape', 'roofClutter',
    ];
    for (const n of names) expect(typeof (props as unknown as Record<string, unknown>)[n], n).toBe('function');
  });

  it('builds every prop with finite geometry and sane colliders', () => {
    for (const [name, fn] of MEASURE_CASES) {
      const { b, world } = build(fn);
      assertSane(b, world, name);
    }
  });

  it('builds every vehicle kind in every condition', () => {
    const kinds: VehicleKind[] = ['sedan', 'hatch', 'suv', 'pickup', 'van', 'boxTruck', 'bus', 'apc', 'jeep', 'ambulance', 'tanker', 'semiCab', 'trailer'];
    const conditions = [{}, { wrecked: true }, { burnt: true }, { doorsOpen: true }, { wrecked: true, doorsOpen: true, burnt: true }];
    for (const kind of kinds) {
      for (const cond of conditions) {
        const { b, world } = build((bb) => props.vehicle(bb, { x: 3, z: -2, rot: 0.7, kind, seed: 4, ...cond }));
        assertSane(b, world, `${kind} ${JSON.stringify(cond)}`);
        expect(world.colliders.length).toBeGreaterThan(0);
        // vehicles stay near their footprint
        for (const c of world.colliders) expect(Math.hypot(c.cx - 3, c.cz + 2)).toBeLessThan(8);
      }
    }
  });

  it('stays within triangle budgets (vehicles <= 2600, containers <= 400)', () => {
    const kinds: VehicleKind[] = ['sedan', 'hatch', 'suv', 'pickup', 'van', 'boxTruck', 'bus', 'apc', 'jeep', 'ambulance', 'tanker', 'semiCab', 'trailer'];
    for (const kind of kinds) {
      const { b } = build((bb) => props.vehicle(bb, { x: 0, z: 0, kind, wrecked: true, doorsOpen: true }));
      expect(b.stats.triangles, kind).toBeLessThanOrEqual(2600);
    }
    for (const color of ['red', 'white', 'rust'] as const) {
      const { b } = build((bb) => props.container(bb, { x: 0, z: 0, color }));
      expect(b.stats.triangles, `container ${color}`).toBeLessThanOrEqual(400);
    }
  });

  it('is deterministic for a given seed and position', () => {
    const run = (): string => {
      const { b, world } = build((bb) => {
        props.vehicle(bb, { x: 5, z: 5, kind: 'sedan', wrecked: true, seed: 9 });
        props.barrelGroup(bb, { x: 0, z: 0, radius: 3, count: 8, seed: 2 });
        props.debris(bb, { x: -4, z: 4, radius: 3, big: true });
        props.corpse(bb, { x: 8, z: 8, kind: 'civilian' });
      });
      return JSON.stringify({ t: b.stats.triangles, m: b.stats.bakedMeshes, c: world.colliders.map((c) => [c.cx, c.cz, c.hx, c.hz, c.y1].map((v) => Math.round(v * 1e4))) });
    };
    expect(run()).toBe(run());
  });

  it('keeps visual and collision footprints aligned (rotated container)', () => {
    const rot = Math.PI / 5;
    const { world } = build((b) => props.container(b, { x: 10, z: 5, rot, color: 'red' }));
    const c = world.colliders[0]!;
    expect(c.rot).toBeCloseTo(rot, 6);
    expect(c.hx * 2).toBeCloseTo(12.19, 2);
    expect(c.y1).toBeCloseTo(2.59, 2);
    expect(c.mapKind).toBe('container');
  });

  it('fences block movement but not shots; gaps split the collider', () => {
    const { world } = build((b) => props.chainlinkFence(b, { x0: 0, z0: 0, x1: 20, z1: 0, gaps: [{ at: 8, width: 4 }] }));
    expect(world.colliders.length).toBe(2);
    for (const c of world.colliders) {
      expect(c.blocksMove).toBe(true);
      expect(c.blocksShots).toBe(false);
      expect(c.mapKind).toBe('fence');
    }
    // the gap is passable, the fence is not
    expect(world.circleBlocked(10, 0, 0.34, 0, 1.8)).toBe(false);
    expect(world.circleBlocked(3, 0, 0.34, 0, 1.8)).toBe(true);
  });

  it('registers lamps for street lamps only when lit', () => {
    const on = build((b) => props.streetLamp(b, { x: 0, z: 0 }));
    expect(on.b.lights.length).toBe(1);
    expect(on.b.lights[0]!.y).toBeGreaterThan(5.5);
    const off = build((b) => props.streetLamp(b, { x: 0, z: 0, on: false }));
    expect(off.b.lights.length).toBe(0);
    const dbl = build((b) => props.streetLamp(b, { x: 0, z: 0, style: 'double' }));
    expect(dbl.b.lights.length).toBe(2);
  });

  it('flattens multi-line stencil material names (shader names must be single-line)', () => {
    const { b } = build((bb) => props.roadSign(bb, { x: 0, z: 0, lines: ['QUARANTINE', 'ZONE 7', 'NO ENTRY'], kind: 'quarantine' }));
    b.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) expect(/[\r\n]/.test((m.material as THREE.Material).name)).toBe(false);
    });
  });

  it('material name lists are non-empty (contract sanity)', () => {
    expect(MATERIAL_NAMES.length).toBeGreaterThan(40);
    expect(DECAL_NAMES.length).toBeGreaterThan(20);
  });
});
