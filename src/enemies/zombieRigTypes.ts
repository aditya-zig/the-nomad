/**
 * Zombie visual rig contract. The game owns AI, movement and hit resolution; a rig owns the model and procedural
 * (skeletal / hierarchical) animation. The rig's root is placed at the zombie's FEET; the model faces local -Z
 * (forward = (-sin yaw, 0, -cos yaw) for `root.rotation.y = yaw`), matching the camera convention.
 *
 * Performance budget: up to ~40 rigs alive at once, so each rig should cost O(1) draw calls (a single SkinnedMesh with a
 * shared material is ideal; avoid dozens of separate Meshes per zombie) and allocate nothing in `update`.
 */
import type * as THREE from 'three';
import type { ZombieType } from '../types';

export type ZombieMode = 'idle' | 'walk' | 'run' | 'attack' | 'stagger' | 'death' | 'slam' | 'charge' | 'roar';

export interface ZombieAnimState {
  mode: ZombieMode;
  /** Current ground speed in m/s: scales gait frequency and stride. */
  speed: number;
  /** Seconds, monotonic. The rig adds its own per-instance phase offset so hordes never march in sync. */
  time: number;
  /** Progress 0..1 through attack / slam / charge-windup / roar. Attack: windup [0, 0.55), strike [0.55, 0.72), recovery [0.72, 1]. */
  actionT: number;
  /** Progress 0..1 through a stagger reaction. */
  staggerT: number;
  /** Seconds since death began (rig settles completely still by ~1.8 s and stays lying there). */
  deathT: number;
  /** 0..1 agitation (head jerks, faster arm swing). */
  aggro: number;
  /** 0..1 flinch impulse, set to 1 by the game on each hit and decayed by it. */
  hitKick: number;
  /** Death variation: 0 fall backward, 1 collapse forward, 2 crumple to the side. */
  deathStyle: 0 | 1 | 2;
  /** Killed by a headshot: head snaps back / slumps. */
  headshotDeath: boolean;
  /** Warden only: enraged below half health (glow brightens, posture more aggressive). */
  enraged: boolean;
}

export interface ZombieRig {
  readonly type: ZombieType;
  /** Position at feet, `rotation.y` = yaw. */
  readonly root: THREE.Group;
  /** Physical dimensions the rig was built to (match `ZOMBIES[type]` in config). */
  readonly radius: number;
  readonly height: number;
  readonly headRadius: number;
  /** Re-randomise appearance / gait phase for pooled reuse. Must not allocate large objects. */
  reset(seed: number): void;
  /** Pose the rig. Call once per frame per visible zombie. */
  update(state: ZombieAnimState, dt: number): void;
  /** Animated centre of the head sphere in world space (used for headshot detection). */
  getHeadWorld(out: THREE.Vector3): THREE.Vector3;
  /** Animated upper-torso centre in world space. */
  getChestWorld(out: THREE.Vector3): THREE.Vector3;
  /** Animated position of the striking hand in world space. */
  getHandWorld(out: THREE.Vector3): THREE.Vector3;
  setVisible(visible: boolean): void;
  dispose(): void;
}

export interface ZombieFactory {
  create(type: ZombieType, seed: number): ZombieRig;
  dispose(): void;
}
