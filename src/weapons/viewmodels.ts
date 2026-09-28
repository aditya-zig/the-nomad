/**
 * First-person viewmodels: five procedurally built rigs (KR-16 rifle, VX-9 pistol, PS-12 shotgun, frag grenade throw and
 * armour plate application), each with gloved hands and forearms, animated entirely from a `ViewmodelPose`.
 * See `./viewmodel/` for the geometry kit, hands, materials, muzzle flash and per-weapon rigs, and
 * `./viewmodelTypes.ts` for the contract.
 */
import { createGrenade } from './viewmodel/grenade';
import { acquireTextures, releaseTextures } from './viewmodel/materials';
import { createPistol } from './viewmodel/pistol';
import { createPlate } from './viewmodel/plate';
import { createRifle } from './viewmodel/rifle';
import { createShotgun } from './viewmodel/shotgun';
import type { ViewmodelSet } from './viewmodelTypes';

export function createViewmodels(): ViewmodelSet {
  const tex = acquireTextures();
  const rifle = createRifle(tex);
  const pistol = createPistol(tex);
  const shotgun = createShotgun(tex);
  const grenade = createGrenade(tex);
  const plate = createPlate(tex);
  let disposed = false;
  return {
    rifle,
    pistol,
    shotgun,
    grenade,
    plate,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const r of [rifle, pistol, shotgun, grenade, plate]) r.dispose();
      releaseTextures();
    },
  };
}
