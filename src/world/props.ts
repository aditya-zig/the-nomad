/**
 * Generic environment props - public surface. Implementations live in `props/*.ts` (containers, vehicles, barriers,
 * street furniture, industrial equipment, misc, dressing); this file re-exports them with their contract types.
 *
 * CONVENTIONS (all props):
 *  - `x, z` = footprint centre in world metres, `y` = base height (default 0), `rot` = yaw about +Y in radians using the
 *    same convention as THREE `object.rotation.y` (and as `ColliderSpec.rot`), so meshes and colliders line up.
 *  - Props are modelled with their LONG axis along local +X and (for vehicles/containers/tents) their FRONT / door end
 *    toward local +X. rot = 0 -> long axis runs east-west. rot = +PI/2 points local +X toward north (-Z).
 *    Exceptions (documented on each function): signs face local +Z; boom-barrier arms and fork-lift forks reach toward +X.
 *  - Human scale: doors >= 1.6 m wide, cover you can hop over <= 1.0 m, cover you cannot hop over >= 1.3 m
 *    (jersey barriers 0.8 m and default sandbags 1.1 m are the intentional in-betweens: chest-high firing cover).
 *  - Every prop registers matching collision through `b.collide/collideBox` (or intentionally none for tiny debris).
 *  - Visuals go through `b.add(obj)` (static, merged) or `b.instanced(...)` (repeated single meshes).
 *  - Deterministic: all randomness comes from `opts.seed` (or a hash of x,z) via a seeded PRNG.
 */
export type { BarrelColor, ContainerColor, PaintName, Place, VehicleKind } from './props/types';

export { barrel, barrelGroup, container, crate, crateGroup, dumpster, pallet } from './props/containers';
export { vehicle } from './props/vehicles';
export {
  barrierLine,
  boomBarrier,
  chainlinkFence,
  checkpointBooth,
  hescoWall,
  jerseyBarrier,
  sandbagWall,
  tent,
  watchtower,
} from './props/barriers';
export { bench, busShelter, cone, cones, hydrant, roadSign, streetLamp, trafficLight, utilityPole } from './props/street';
export { craneGantry, floodlightTower, forklift, fuelTank, generator, shelvingRack } from './props/industrial';
export { fireEscape, pipeStack, roofClutter, tireStack } from './props/misc';
export { corpse, debris, deadTree } from './props/dressing';
