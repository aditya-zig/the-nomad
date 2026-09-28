/**
 * Zombie rig factory: procedural, skinned, animated infected humans (shambler, runner, armored, warden).
 * See `zombie/` for the body builders, garments, gear, animation and rig implementation.
 */
import * as THREE from 'three';
import { ZOMBIES } from '../config';
import type { ZombieType } from '../types';
import { createDetailTexture, createZombieMaterial } from './zombie/material';
import { disposeShapeCache } from './zombie/mesh';
import { type TypeAssets, ZombieRigImpl, makeTypeAssets, variantGeometry } from './zombie/rig';
import type { ZombieFactory, ZombieRig } from './zombieRigTypes';

export interface ZombieFactoryExt extends ZombieFactory {
  /** Bake every appearance variant now (avoids a few ms of hitching on first spawn of each variant). */
  prewarm(): void;
  /** Shared material (debug / harness). */
  readonly material: THREE.MeshStandardMaterial;
}

export function createZombieFactory(): ZombieFactoryExt {
  const texture = createDetailTexture();
  const material = createZombieMaterial(texture);
  const assets = new Map<ZombieType, TypeAssets>();
  const rigs = new Set<ZombieRigImpl>();
  const get = (type: ZombieType): TypeAssets => {
    let a = assets.get(type);
    if (!a) {
      a = makeTypeAssets(type);
      assets.set(type, a);
    }
    return a;
  };
  return {
    material,
    create(type: ZombieType, seed: number): ZombieRig {
      const def = ZOMBIES[type];
      const rig = new ZombieRigImpl(get(type), material, { radius: def.radius, height: def.height, headRadius: def.headRadius }, seed);
      rigs.add(rig);
      const dispose = rig.dispose.bind(rig);
      rig.dispose = (): void => {
        rigs.delete(rig);
        dispose();
      };
      return rig;
    },
    prewarm(): void {
      for (const type of ['shambler', 'runner', 'armored', 'warden'] as ZombieType[]) {
        const a = get(type);
        for (let i = 0; i < a.variants.length; i++) variantGeometry(a, i);
      }
    },
    dispose(): void {
      for (const r of rigs) r.dispose();
      rigs.clear();
      for (const a of assets.values()) for (const g of a.variants) g?.dispose();
      assets.clear();
      material.dispose();
      texture.dispose();
      disposeShapeCache();
    },
  };
}
