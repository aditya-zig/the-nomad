import { describe, expect, it } from 'vitest';
import { WEAPONS } from '../src/config';
import {
  addReserve,
  cancelReload,
  canFire,
  consumeRound,
  createAmmo,
  requestShellStop,
  reloadProgress,
  startReload,
  updateReload,
  type AmmoState,
} from '../src/logic/ammo';
import { getWeaponStats, falloffMul } from '../src/logic/weaponStats';

const rifle = getWeaponStats(WEAPONS.rifle, 0);
const shotgun = getWeaponStats(WEAPONS.shotgun, 0);

function run(a: AmmoState, seconds: number, stats = rifle, step = 1 / 60) {
  for (let t = 0; t < seconds; t += step) updateReload(a, step, stats);
}

describe('magazine reloads', () => {
  it('transfers ammunition once and conserves the total', () => {
    const a = createAmmo(30, 100, 240, 12);
    const total = a.mag + a.reserve;
    expect(startReload(a, 'magazine', rifle, WEAPONS.rifle.reloadTransferAt)).toBe(true);
    run(a, 5);
    expect(a.reload).toBeNull();
    expect(a.mag).toBe(30);
    expect(a.reserve).toBe(total - 30);
    expect(a.mag + a.reserve).toBe(total);
  });

  it('does not transfer more than the reserve holds', () => {
    const a = createAmmo(30, 7, 240, 0);
    startReload(a, 'magazine', rifle, 0.72);
    run(a, 5);
    expect(a.mag).toBe(7);
    expect(a.reserve).toBe(0);
  });

  it('refuses to start a reload when full, empty reserve, or already reloading', () => {
    const full = createAmmo(30, 100, 240);
    expect(startReload(full, 'magazine', rifle, 0.7)).toBe(false);
    const dry = createAmmo(30, 0, 240, 5);
    expect(startReload(dry, 'magazine', rifle, 0.7)).toBe(false);
    const a = createAmmo(30, 100, 240, 5);
    expect(startReload(a, 'magazine', rifle, 0.7)).toBe(true);
    expect(startReload(a, 'magazine', rifle, 0.7)).toBe(false);
  });

  it('cancelling before the transfer point loses nothing and duplicates nothing', () => {
    const a = createAmmo(30, 100, 240, 5);
    startReload(a, 'magazine', rifle, 0.72);
    run(a, 0.5); // well before 0.72 * duration
    cancelReload(a);
    expect(a.reload).toBeNull();
    expect(a.mag).toBe(5);
    expect(a.reserve).toBe(100);
    // can start again cleanly and completes exactly once
    startReload(a, 'magazine', rifle, 0.72);
    run(a, 5);
    expect(a.mag).toBe(30);
    expect(a.reserve).toBe(75);
  });

  it('cancelling after the transfer keeps the transferred rounds without transferring twice', () => {
    const a = createAmmo(30, 100, 240, 5);
    startReload(a, 'magazine', rifle, 0.72);
    run(a, rifle.reloadTactical * 0.8);
    expect(a.mag).toBe(30);
    cancelReload(a);
    run(a, 3);
    expect(a.mag).toBe(30);
    expect(a.reserve).toBe(75);
  });

  it('empty reloads take longer than tactical ones and cannot fire while reloading', () => {
    const empty = createAmmo(30, 100, 240, 0);
    const tactical = createAmmo(30, 100, 240, 10);
    startReload(empty, 'magazine', rifle, 0.72);
    startReload(tactical, 'magazine', rifle, 0.72);
    expect(empty.reload && empty.reload.kind === 'mag' && empty.reload.duration).toBeGreaterThan(
      tactical.reload && tactical.reload.kind === 'mag' ? tactical.reload.duration : 0,
    );
    expect(canFire(tactical, 'magazine')).toBe(false);
    expect(canFire(createAmmo(30, 0, 240, 3), 'magazine')).toBe(true);
    expect(canFire(createAmmo(30, 50, 240, 0), 'magazine')).toBe(false);
  });

  it('progress is monotonic 0..1', () => {
    const a = createAmmo(30, 100, 240, 0);
    startReload(a, 'magazine', rifle, 0.72);
    let last = -1;
    for (let i = 0; i < 400 && a.reload; i++) {
      updateReload(a, 1 / 60, rifle);
      if (!a.reload) break;
      const p = reloadProgress(a);
      expect(p).toBeGreaterThanOrEqual(last);
      expect(p).toBeLessThanOrEqual(1);
      last = p;
    }
  });

  it('consumeRound never goes below zero', () => {
    const a = createAmmo(3, 0, 10);
    expect(consumeRound(a)).toBe(true);
    expect(consumeRound(a)).toBe(true);
    expect(consumeRound(a)).toBe(true);
    expect(consumeRound(a)).toBe(false);
    expect(a.mag).toBe(0);
  });
});

describe('shell (shotgun) reloads', () => {
  it('loads one shell at a time and ends when full', () => {
    const a = createAmmo(6, 30, 48, 2);
    startReload(a, 'shell', shotgun, 0.6);
    run(a, 10, shotgun);
    expect(a.reload).toBeNull();
    expect(a.mag).toBe(6);
    expect(a.reserve).toBe(26);
  });

  it('stops after the current shell when asked and keeps loaded shells', () => {
    const a = createAmmo(6, 30, 48, 0);
    startReload(a, 'shell', shotgun, 0.6);
    run(a, shotgun.shellStart + shotgun.shellEach * 1.2, shotgun);
    requestShellStop(a);
    run(a, 10, shotgun);
    expect(a.reload).toBeNull();
    expect(a.mag).toBeGreaterThanOrEqual(1);
    expect(a.mag).toBeLessThan(6);
    expect(a.mag + a.reserve).toBe(30);
  });

  it('firing interrupts a shell reload without losing ammunition', () => {
    const a = createAmmo(6, 30, 48, 3);
    startReload(a, 'shell', shotgun, 0.6);
    run(a, shotgun.shellStart + shotgun.shellEach * 1.3, shotgun);
    const total = a.mag + a.reserve;
    expect(canFire(a, 'shell')).toBe(true);
    expect(consumeRound(a)).toBe(true);
    expect(a.reload).toBeNull();
    expect(a.mag + a.reserve).toBe(total - 1);
  });

  it('a dry gun chambers a round (pump phase) after the first shell', () => {
    const a = createAmmo(6, 30, 48, 0);
    startReload(a, 'shell', shotgun, 0.6);
    const phases = new Set<string>();
    for (let i = 0; i < 1200 && a.reload; i++) {
      if (a.reload.kind === 'shell') phases.add(a.reload.phase);
      updateReload(a, 1 / 60, shotgun);
    }
    expect(phases.has('pump')).toBe(true);
    expect(a.mag).toBe(6);
  });

  it('survives huge frame deltas without corruption (pause/resume spike)', () => {
    const a = createAmmo(6, 30, 48, 0);
    startReload(a, 'shell', shotgun, 0.6);
    updateReload(a, 30, shotgun);
    expect(a.reload).toBeNull();
    expect(a.mag).toBeLessThanOrEqual(6);
    expect(a.mag + a.reserve).toBe(30);
  });
});

describe('reserve and stats', () => {
  it('addReserve clamps to the maximum and reports the actual amount', () => {
    const a = createAmmo(30, 230, 240);
    expect(addReserve(a, 30)).toBe(10);
    expect(a.reserve).toBe(240);
    expect(addReserve(a, 5)).toBe(0);
  });

  it('upgrade tiers change real stats', () => {
    const base = getWeaponStats(WEAPONS.rifle, 0);
    const t1 = getWeaponStats(WEAPONS.rifle, 1);
    const t2 = getWeaponStats(WEAPONS.rifle, 2);
    expect(t1.damage).toBeGreaterThan(base.damage);
    expect(t2.damage).toBeGreaterThan(t1.damage);
    expect(t1.magSize).toBeGreaterThan(base.magSize);
    expect(t2.fireInterval).toBeLessThan(base.fireInterval);
    expect(getWeaponStats(WEAPONS.shotgun, 1).pellets).toBe(WEAPONS.shotgun.pellets + 2);
    expect(t2.armorPierce).toBeGreaterThan(0);
  });

  it('damage falloff is 1 up close, decreases, and is 0 beyond max range', () => {
    const d = WEAPONS.rifle;
    expect(falloffMul(d, 5)).toBe(1);
    const mid = falloffMul(d, (d.falloffStart + d.falloffEnd) / 2);
    expect(mid).toBeLessThan(1);
    expect(mid).toBeGreaterThan(d.minMul);
    expect(falloffMul(d, d.falloffEnd + 1)).toBeCloseTo(d.minMul);
    expect(falloffMul(d, d.maxRange + 1)).toBe(0);
  });
});
