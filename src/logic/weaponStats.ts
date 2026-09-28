/** Effective weapon stats after upgrade tiers, and damage falloff. Pure functions. */
import type { WeaponDef } from '../config';

export type Tier = 0 | 1 | 2;

export interface WeaponStats {
  damage: number;
  pellets: number;
  headshotMul: number;
  fireInterval: number;
  magSize: number;
  reserveMax: number;
  reloadTactical: number;
  reloadEmpty: number;
  shellStart: number;
  shellEach: number;
  shellEnd: number;
  shellPump: number;
  spreadHip: number;
  spreadAds: number;
  spreadMove: number;
  spreadAir: number;
  spreadPerShot: number;
  spreadMax: number;
  recoilPitch: number;
  recoilYaw: number;
  armorPierce: number;
}

export function getWeaponStats(def: WeaponDef, tier: Tier): WeaponStats {
  const t = tier > 0 ? def.tiers[tier - 1]! : null;
  const dmg = t?.damageMul ?? 1;
  const reload = t?.reloadMul ?? 1;
  const spread = t?.spreadMul ?? 1;
  const recoil = t?.recoilMul ?? 1;
  return {
    damage: def.damage * dmg,
    pellets: def.pellets + (t?.pelletsAdd ?? 0),
    headshotMul: def.headshotMul + (t?.headshotMulAdd ?? 0),
    fireInterval: def.fireInterval / (t?.fireRateMul ?? 1),
    magSize: def.magSize + (t?.magSizeAdd ?? 0),
    reserveMax: def.reserveMax + (t?.reserveMaxAdd ?? 0),
    reloadTactical: def.reloadTactical * reload,
    reloadEmpty: def.reloadEmpty * reload,
    shellStart: def.shellStart * reload,
    shellEach: def.shellEach * reload,
    shellEnd: def.shellEnd * reload,
    shellPump: def.shellPump * reload,
    spreadHip: def.spreadHip * spread,
    spreadAds: def.spreadAds * spread,
    spreadMove: def.spreadMove * spread,
    spreadAir: def.spreadAir * spread,
    spreadPerShot: def.spreadPerShot * spread,
    spreadMax: def.spreadMax * spread,
    recoilPitch: def.recoilPitch * recoil,
    recoilYaw: def.recoilYaw * recoil,
    armorPierce: t?.armorPierce ?? 0,
  };
}

/** Damage multiplier by distance: 1 up to falloffStart, linear to minMul at falloffEnd, 0 beyond maxRange. */
export function falloffMul(def: WeaponDef, dist: number): number {
  if (dist > def.maxRange) return 0;
  if (dist <= def.falloffStart) return 1;
  if (dist >= def.falloffEnd) return def.minMul;
  const k = (dist - def.falloffStart) / (def.falloffEnd - def.falloffStart);
  return 1 + (def.minMul - 1) * k;
}
