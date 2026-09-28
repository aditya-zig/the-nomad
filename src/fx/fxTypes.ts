/**
 * Visual effects contract: particles, decals, tracers, casings and atmosphere. Everything is BOUNDED: fixed-size
 * pools (ring buffers) with explicit caps from `FX` in config, nothing allocates per event in steady state, and
 * every effect has a hard lifetime. Implementation in `fx.ts` (`createFx`).
 */
import type * as THREE from 'three';
import type { SurfaceKind, Vec3Like, WeaponId } from '../types';

export interface FlareHandle {
  /** Current flicker intensity 0..1 for the game to drive a real light (call each frame). */
  intensity(): number;
  setPosition(p: Vec3Like): void;
  stop(): void;
}

export type EmitterKind = 'steam' | 'toxic' | 'sparks' | 'smoke' | 'embers' | 'mist';

export interface FxApi {
  /** Add to the world scene once. */
  readonly root: THREE.Object3D;
  /** Scale particle counts / decal caps (0.3..1) from the quality preset. */
  setQuality(particleScale: number, decalScale: number): void;

  /** Bullet impact: sparks / dust / chips by surface, a puff, and a bullet-hole decal (not on 'flesh'). `n` = surface normal. */
  impact(p: Vec3Like, n: Vec3Like, surface: SurfaceKind, opts?: { strong?: boolean }): void;
  /** Blood burst at a hit on an infected. `dir` = travel direction of the bullet. Restrained, dark, short-lived; heavy on kills. */
  blood(p: Vec3Like, dir: Vec3Like, opts?: { amount?: number; head?: boolean; kill?: boolean }): void;
  /** Grenade explosion: flash, fireball, smoke plume, sparks, debris, shockwave ring, scorch decal, dust. */
  explosion(p: Vec3Like, radius: number): void;
  /** Bullet tracer streak (0.06 s life). */
  tracer(from: Vec3Like, to: Vec3Like, colorHex: number): void;
  /** Short muzzle smoke wisp. */
  muzzleSmoke(p: Vec3Like, dir: Vec3Like, strong?: boolean): void;
  /** Ejected casing with a small arc, bounce and fade (bounded pool of 24). */
  casing(p: Vec3Like, vel: Vec3Like, kind: WeaponId): void;
  /** Footstep / landing dust puff. `amount` 0..1. */
  dust(p: Vec3Like, amount: number): void;
  /** Coloured sparkle burst (pickups, upgrades, purchases). */
  sparkle(p: Vec3Like, colorHex: number, count?: number): void;
  /** A burning red signal flare: bright core, sparks, thick red-tinted smoke plume drifting with the wind. */
  flare(p: Vec3Like): FlareHandle;
  /** Rotor downwash: call every frame while the helicopter is low; kicks up dust rings and debris within `radius`. `strength` 0..1. */
  downwash(center: Vec3Like, radius: number, strength: number): void;
  /** Permanent ambient emitter (level dressing). Returns nothing; emitters persist across `clear()`. */
  emitter(kind: EmitterKind, p: Vec3Like, opts?: { rate?: number; radius?: number; height?: number }): void;

  /** Advance simulation. `camera` drives billboard orientation, culling of far emitters and the camera-following ambient drift (dust motes / ash). */
  update(dt: number, camera: THREE.Camera): void;
  /** Remove every transient effect and decal (restart). Ambient emitters remain. */
  clear(): void;
  dispose(): void;
}
