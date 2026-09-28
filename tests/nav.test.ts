import { describe, expect, it } from 'vitest';
import { CollisionWorld } from '../src/world/collision';
import { FlowField, NavGrid, UNREACHABLE } from '../src/world/nav';
import { Rng } from '../src/logic/rng';

const bounds = { minX: -66, maxX: 66, minZ: -52, maxZ: 52 };

/** A long wall along x = 0 with a 1.6 m doorway at z = 10. */
function wallWorld(): CollisionWorld {
  const w = new CollisionWorld(bounds);
  w.add({ x: 0, z: -21, hx: 0.2, hz: 30.2, y1: 3 }); // z from -51.2 to 9.2 (door 9.2 .. 10.8)
  w.add({ x: 0, z: 31.4, hx: 0.2, hz: 20.6, y1: 3 }); // z from 10.8 to 52
  return w;
}

describe('NavGrid & FlowField', () => {
  it('rasterises colliders (inflated) and leaves doorways passable', () => {
    const world = wallWorld();
    const grid = new NavGrid(bounds, world);
    expect(grid.isBlockedAt(0, -20)).toBe(true);
    expect(grid.isBlockedAt(-10, -20)).toBe(false);
    // the doorway centre must be free even after inflation
    expect(grid.isBlockedAt(0, 10)).toBe(false);
    expect(grid.isBlockedAt(0, 9.0)).toBe(true);
  });

  it('routes around a wall through the doorway instead of straight through it', () => {
    const world = wallWorld();
    const grid = new NavGrid(bounds, world);
    const field = new FlowField(grid);
    expect(field.compute(10, -20)).toBe(true);
    // a point across the wall is reachable but far along the path (must detour via the door at z=10)
    const direct = Math.hypot(20, 0);
    const d = field.distanceMeters(-10, -20);
    expect(d).toBeGreaterThan(direct * 1.5);
    // following the field from across the wall heads toward the doorway (positive z), not straight at the goal
    const out = { x: 0, z: 0 };
    let x = -10;
    let z = -20;
    let reached = false;
    for (let i = 0; i < 400; i++) {
      if (!field.follow(x, z, out)) break;
      // step towards the target 0.4 m
      const dx = out.x - x;
      const dz = out.z - z;
      const l = Math.hypot(dx, dz) || 1;
      const nx = x + (dx / l) * 0.4;
      const nz = z + (dz / l) * 0.4;
      expect(world.circleBlocked(nx, nz, 0.3, 0.5, 1.7)).toBe(false); // never walks into a wall
      x = nx;
      z = nz;
      if (Math.hypot(x - 10, z + 20) < 1.0) {
        reached = true;
        break;
      }
    }
    expect(reached).toBe(true);
  });

  it('marks fully enclosed areas as unreachable', () => {
    const world = new CollisionWorld(bounds);
    // closed 6x6 room
    world.add({ x: 0, z: -3, hx: 3.2, hz: 0.2, y1: 3 });
    world.add({ x: 0, z: 3, hx: 3.2, hz: 0.2, y1: 3 });
    world.add({ x: -3, z: 0, hx: 0.2, hz: 3.2, y1: 3 });
    world.add({ x: 3, z: 0, hx: 0.2, hz: 3.2, y1: 3 });
    const grid = new NavGrid(bounds, world);
    const field = new FlowField(grid);
    field.compute(20, 20);
    expect(field.distanceMeters(0, 0)).toBe(Infinity);
    expect(field.isReachable(10, 10)).toBe(true);
    expect(field.dist[grid.index(0, 0)]).toBe(UNREACHABLE);
  });

  it('ignores low kerbs and overhead lintels, blocks waist-high cover', () => {
    const world = new CollisionWorld(bounds);
    world.add({ x: 0, z: 0, hx: 2, hz: 2, y1: 0.3 }); // kerb
    world.add({ x: 10, z: 0, hx: 2, hz: 2, y0: 2.4, y1: 3 }); // lintel above head
    world.add({ x: 20, z: 0, hx: 2, hz: 2, y1: 0.9 }); // waist-high crate
    const grid = new NavGrid(bounds, world);
    expect(grid.isBlockedAt(0, 0)).toBe(false);
    expect(grid.isBlockedAt(10, 0)).toBe(false);
    expect(grid.isBlockedAt(20, 0)).toBe(true);
  });

  it('computes a full-map field quickly (budget check)', () => {
    const world = new CollisionWorld(bounds);
    const rng = new Rng(11);
    for (let i = 0; i < 260; i++) {
      world.add({
        x: rng.range(-60, 60),
        z: rng.range(-46, 46),
        hx: rng.range(0.5, 4),
        hz: rng.range(0.5, 2),
        rot: rng.range(0, 3),
        y1: 2.5,
      });
    }
    const grid = new NavGrid(bounds, world);
    const field = new FlowField(grid);
    expect(field.compute(0, 0)).toBe(true); // warm up
    let reachable = 0;
    for (let i = 0; i < grid.count; i++) if (field.dist[i] !== UNREACHABLE) reachable++;
    expect(reachable).toBeGreaterThan(grid.count * 0.4);
    const t0 = performance.now();
    const runs = 10;
    for (let i = 0; i < runs; i++) field.compute(i - 5, 3);
    const per = (performance.now() - t0) / runs;
    // generous bound for CI noise; the game budget is a few ms per recompute at ~3 Hz
    expect(per).toBeLessThan(40);
    console.log(`flow field compute: ${per.toFixed(2)} ms (${grid.count} cells)`);
  });
});
