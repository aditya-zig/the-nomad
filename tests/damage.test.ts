import { describe, expect, it } from 'vitest';
import { PLAYER, WEAPONS, ZOMBIES } from '../src/config';
import { applyDamageToPlayer, applyPlate, canApplyPlate, regenHealth, zombieHitDamage } from '../src/logic/damage';

describe('player damage and armour', () => {
  it('armour absorbs damage before health', () => {
    const v = { health: 100, armor: 50 };
    const r = applyDamageToPlayer(v, 30);
    expect(v.armor).toBe(20);
    expect(v.health).toBe(100);
    expect(r.armorLost).toBe(30);
    expect(r.healthLost).toBe(0);
  });

  it('overflow damage spills into health and can kill', () => {
    const v = { health: 20, armor: 10 };
    const r = applyDamageToPlayer(v, 50);
    expect(v.armor).toBe(0);
    expect(v.health).toBe(0);
    expect(r.dead).toBe(true);
    expect(r.healthLost).toBe(20);
  });

  it('toxin ignores armour', () => {
    const v = { health: 100, armor: 100 };
    applyDamageToPlayer(v, 10, { ignoreArmor: true });
    expect(v.armor).toBe(100);
    expect(v.health).toBe(90);
  });

  it('ignores zero/negative damage and damage to the dead', () => {
    const v = { health: 100, armor: 0 };
    applyDamageToPlayer(v, 0);
    applyDamageToPlayer(v, -5);
    expect(v.health).toBe(100);
    const dead = { health: 0, armor: 30 };
    applyDamageToPlayer(dead, 10);
    expect(dead.armor).toBe(30);
  });

  it('plates add armour, respect the cap, and are only consumed when used', () => {
    const v = { health: 100, armor: 80 };
    const r = applyPlate(v, 2);
    expect(r).not.toBeNull();
    expect(v.armor).toBe(PLAYER.maxArmor);
    expect(r!.plates).toBe(1);
    expect(r!.armorAdded).toBe(20);
    // full armour: cannot apply, plate count untouched
    expect(canApplyPlate(v, 1)).toBe(false);
    expect(applyPlate(v, 1)).toBeNull();
    // no plates / dead
    expect(applyPlate({ health: 100, armor: 0 }, 0)).toBeNull();
    expect(applyPlate({ health: 0, armor: 0 }, 3)).toBeNull();
  });

  it('health regenerates only after the delay and never above max', () => {
    expect(regenHealth(50, 1, 1)).toBe(50);
    expect(regenHealth(50, PLAYER.healthRegenDelay + 0.1, 1)).toBeGreaterThan(50);
    expect(regenHealth(99, 20, 5)).toBe(PLAYER.maxHealth);
    expect(regenHealth(0, 20, 1)).toBe(0);
  });
});

describe('zombie damage model', () => {
  const rifle = WEAPONS.rifle;
  it('headshots beat body shots on every enemy type', () => {
    for (const z of Object.values(ZOMBIES)) {
      const body = zombieHitDamage(rifle.damage, z, false, rifle.headshotMul, 0, 1);
      const head = zombieHitDamage(rifle.damage, z, true, rifle.headshotMul, 0, 1);
      expect(head).toBeGreaterThan(body);
    }
  });

  it('body armour reduces body damage and armour piercing restores it', () => {
    const armored = ZOMBIES.armored;
    const plain = zombieHitDamage(26, armored, false, 2.2, 0, 1);
    const pierced = zombieHitDamage(26, armored, false, 2.2, 0.35, 1);
    expect(plain).toBeCloseTo(26 * armored.bodyMul);
    expect(pierced).toBeGreaterThan(plain);
    expect(pierced).toBeLessThan(26);
  });

  it('distance falloff scales damage', () => {
    const z = ZOMBIES.shambler;
    expect(zombieHitDamage(26, z, false, 2, 0, 0.5)).toBeCloseTo(13);
    expect(zombieHitDamage(26, z, false, 2, 0, 0)).toBe(0);
  });

  it('time-to-kill is sensible: rifle drops a shambler in ~4 body shots, 2 headshots', () => {
    const z = ZOMBIES.shambler;
    const body = zombieHitDamage(rifle.damage, z, false, rifle.headshotMul, 0, 1);
    const head = zombieHitDamage(rifle.damage, z, true, rifle.headshotMul, 0, 1);
    expect(Math.ceil(z.hp / body)).toBe(4);
    expect(Math.ceil(z.hp / head)).toBe(2);
  });
});
