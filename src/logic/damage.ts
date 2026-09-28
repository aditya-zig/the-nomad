/** Damage, armour and plate rules (pure). */
import { PLAYER, type ZombieDef } from '../config';

export interface Vitals {
  health: number;
  armor: number;
}

export interface DamageResult {
  healthLost: number;
  armorLost: number;
  dead: boolean;
}

/** Armour absorbs damage 1:1 before health. `ignoreArmor` (toxins) hits health directly. */
export function applyDamageToPlayer(v: Vitals, amount: number, opts: { ignoreArmor?: boolean } = {}): DamageResult {
  if (!(amount > 0) || v.health <= 0) return { healthLost: 0, armorLost: 0, dead: v.health <= 0 };
  let remaining = amount;
  let armorLost = 0;
  if (!opts.ignoreArmor && v.armor > 0) {
    armorLost = Math.min(v.armor, remaining);
    v.armor -= armorLost;
    remaining -= armorLost;
  }
  const healthLost = Math.min(v.health, remaining);
  v.health -= healthLost;
  if (v.health < 0.0001) v.health = 0;
  return { healthLost, armorLost, dead: v.health <= 0 };
}

/** Can an armour plate be applied (has plates, armour not already full, alive)? */
export function canApplyPlate(v: Vitals, plates: number): boolean {
  return v.health > 0 && plates > 0 && v.armor < PLAYER.maxArmor - 0.001;
}

/** Apply one plate: returns the new plate count and armour, or null when not allowed. */
export function applyPlate(v: Vitals, plates: number): { plates: number; armorAdded: number } | null {
  if (!canApplyPlate(v, plates)) return null;
  const before = v.armor;
  v.armor = Math.min(PLAYER.maxArmor, v.armor + PLAYER.plateArmor);
  return { plates: plates - 1, armorAdded: v.armor - before };
}

/** Health regeneration after a delay without damage. Returns the new health. */
export function regenHealth(health: number, timeSinceDamage: number, dt: number): number {
  if (health <= 0 || health >= PLAYER.maxHealth) return health;
  if (timeSinceDamage < PLAYER.healthRegenDelay) return health;
  return Math.min(PLAYER.maxHealth, health + PLAYER.healthRegenRate * dt);
}

/** Damage dealt by one projectile to a zombie. */
export function zombieHitDamage(
  base: number,
  zombie: ZombieDef,
  head: boolean,
  headshotMul: number,
  armorPierce: number,
  distanceMul: number,
): number {
  const dmul = head
    ? headshotMul * (zombie.headMul + (1 - zombie.headMul) * armorPierce)
    : zombie.bodyMul + (1 - zombie.bodyMul) * armorPierce;
  return Math.max(0, base * distanceMul * dmul);
}
