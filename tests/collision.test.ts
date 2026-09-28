import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CollisionWorld, makeRayHit } from '../src/world/collision';

const bounds = { minX: -50, maxX: 50, minZ: -50, maxZ: 50 };

describe('CollisionWorld', () => {
  it('uses the same rotation convention as THREE rotation.y', () => {
    const world = new CollisionWorld(bounds);
    const rot = Math.PI / 2;
    // long axis is local X (hx = 3) -> world axis after rotation by rot about Y
    world.add({ x: 10, z: 5, hx: 3, hz: 0.5, rot, y1: 2 });
    const obj = new THREE.Object3D();
    obj.rotation.y = rot;
    obj.position.set(10, 0, 5);
    obj.updateMatrixWorld();
    const tip = new THREE.Vector3(2.8, 1, 0).applyMatrix4(obj.matrixWorld); // just inside the far end of the long axis
    expect(world.pointInSolid(tip.x, 1, tip.z)).toBe(true);
    const side = new THREE.Vector3(0, 1, 2.8).applyMatrix4(obj.matrixWorld); // outside the thin axis
    expect(world.pointInSolid(side.x, 1, side.z)).toBe(false);
  });

  it('pushes a circle out of a box and slides along it', () => {
    const world = new CollisionWorld(bounds);
    world.add({ x: 0, z: 0, hx: 2, hz: 2, y1: 3 });
    const p = { x: 2.1, z: 0.5 };
    const moved = world.resolveCircle(p, 0.34, 0, 1.8);
    expect(moved).toBe(true);
    expect(p.x).toBeGreaterThanOrEqual(2.34 - 1e-6);
    expect(p.z).toBeCloseTo(0.5, 5);
  });

  it('ignores low colliders below the step threshold for horizontal blocking', () => {
    const world = new CollisionWorld(bounds);
    world.add({ x: 0, z: 0, hx: 2, hz: 2, y1: 0.3 });
    const p = { x: 0, z: 0 };
    // player feet at 0.42 (stepHeight) -> yMin = feet + step; curb top 0.3 does not block
    expect(world.resolveCircle(p, 0.34, 0.42, 1.8)).toBe(false);
  });

  it('raycasts the nearest surface, returns normals, and is stopped by walls', () => {
    const world = new CollisionWorld(bounds);
    world.add({ x: 0, z: -10, hx: 5, hz: 0.5, y1: 4 });
    world.add({ x: 0, z: -20, hx: 5, hz: 0.5, y1: 4 });
    const hit = world.raycast(0, 1.6, 0, 0, 0, -1, 100);
    expect(hit).not.toBeNull();
    expect(hit!.t).toBeCloseTo(9.5, 4);
    expect(hit!.nz).toBeCloseTo(1, 5);
    // the far wall must not be reached
    const hit2 = world.raycast(0, 1.6, 0, 0, 0, -1, 100, 'shots', makeRayHit());
    expect(hit2!.collider!.cz).toBe(-10);
  });

  it('hits the ground plane for downward rays and reports its surface', () => {
    const world = new CollisionWorld(bounds);
    const d = new THREE.Vector3(0.3, -0.6, -0.5).normalize();
    const hit = world.raycast(0, 1.7, 0, d.x, d.y, d.z, 60);
    expect(hit).not.toBeNull();
    expect(hit!.collider).toBeNull();
    expect(hit!.y).toBe(0);
    expect(hit!.ny).toBe(1);
  });

  it('raycasts rotated boxes with correct normals', () => {
    const world = new CollisionWorld(bounds);
    const rot = Math.PI / 4;
    world.add({ x: 0, z: -10, hx: 2, hz: 2, rot, y1: 3 });
    const hit = world.raycast(0, 1, 0, 0, 0, -1, 50);
    expect(hit).not.toBeNull();
    // 45 degree box, ray along -Z hits the corner facing +Z at distance 10 - 2*sqrt(2)
    expect(hit!.t).toBeCloseTo(10 - 2 * Math.SQRT2, 3);
  });

  it('respects the move/shots filters (fences block movement but not bullets)', () => {
    const world = new CollisionWorld(bounds);
    world.add({ x: 0, z: -5, hx: 4, hz: 0.05, y1: 2.4, blocksShots: false, blocksMove: true });
    expect(world.raycast(0, 1.5, 0, 0, 0, -1, 30, 'shots')).toBeNull();
    expect(world.raycast(0, 1.5, 0, 0, 0, -1, 30, 'move')).not.toBeNull();
    expect(world.segmentBlocked(0, 1.5, 0, 0, 1.5, -10, 'shots')).toBe(false);
    expect(world.segmentBlocked(0, 1.5, 0, 0, 1.5, -10, 'move')).toBe(true);
  });

  it('bounces a sphere off walls and the floor', () => {
    const world = new CollisionWorld(bounds);
    world.add({ x: 3, z: 0, hx: 0.5, hz: 5, y1: 4 });
    const pos = { x: 2.45, y: 1, z: 0 };
    const vel = { x: 10, y: -3, z: 0 };
    const hit = world.collideSphere(pos, vel, 0.1, 0.4, 0.8);
    expect(hit).toBe(true);
    expect(vel.x).toBeLessThan(0);
    const floorPos = { x: 0, y: 0.05, z: 0 };
    const floorVel = { x: 0, y: -5, z: 0 };
    world.collideSphere(floorPos, floorVel, 0.1, 0.4, 0.8);
    expect(floorPos.y).toBeGreaterThanOrEqual(0.1);
    expect(floorVel.y).toBeGreaterThan(0);
  });

  it('finds ground height on top of low crates and ceilings above', () => {
    const world = new CollisionWorld(bounds);
    world.add({ x: 0, z: 0, hx: 1, hz: 1, y1: 0.9 });
    world.add({ x: 5, z: 0, hx: 1, hz: 1, y0: 2.0, y1: 3 });
    expect(world.groundHeight(0, 0, 0.34, 1.0)).toBeCloseTo(0.9, 5);
    expect(world.groundHeight(0, 0, 0.34, 0.5)).toBe(0);
    expect(world.ceilingHeight(5, 0, 0.34, 1.25)).toBeCloseTo(2.0, 5);
    expect(world.ceilingHeight(0, 0, 0.34, 1.25)).toBe(Infinity);
  });
});
