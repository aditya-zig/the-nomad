import { describe, expect, it } from 'vitest';
import { ECONOMY, GRENADE, MISSION, PLAYER, REGIONS, WEAPONS, ZOMBIES } from '../src/config';
import {
  addCash,
  applyContractReward,
  applyCrateReward,
  buyMenu,
  carries,
  createInventory,
  killReward,
  purchaseBuy,
  purchaseUpgrade,
  rollCrateReward,
  spendCash,
  upgradeMenu,
} from '../src/logic/economy';
import { Rng } from '../src/logic/rng';

describe('wallet', () => {
  it('spending is atomic and never goes negative', () => {
    const inv = createInventory();
    inv.cash = 100;
    expect(spendCash(inv, 150)).toBe(false);
    expect(inv.cash).toBe(100);
    expect(spendCash(inv, 100)).toBe(true);
    expect(inv.cash).toBe(0);
    expect(spendCash(inv, 1)).toBe(false);
    expect(inv.cash).toBe(0);
    expect(spendCash(inv, -5)).toBe(false);
  });

  it('kill rewards scale with threat region and headshots', () => {
    const z = ZOMBIES.shambler;
    const low = killReward(z, false, 'low');
    const high = killReward(z, false, 'high');
    expect(high).toBeGreaterThan(low);
    expect(killReward(z, true, 'low')).toBeGreaterThan(low);
    expect(low).toBe(Math.round(z.reward * REGIONS.low.rewardMul * ECONOMY.killCashMul));
  });
});

describe('buy station', () => {
  it('denies unaffordable purchases without changing anything', () => {
    const inv = createInventory();
    inv.cash = 100;
    inv.plates = 0;
    const before = JSON.stringify(inv);
    const r = purchaseBuy(inv, 'plate');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('unaffordable');
    expect(JSON.stringify(inv)).toBe(before);
  });

  it('buys armor plates until the cap', () => {
    const inv = createInventory();
    inv.cash = 5000;
    inv.plates = 0;
    for (let i = 0; i < PLAYER.maxPlates; i++) expect(purchaseBuy(inv, 'plate').ok).toBe(true);
    expect(inv.plates).toBe(PLAYER.maxPlates);
    const r = purchaseBuy(inv, 'plate');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('full');
    expect(inv.cash).toBe(5000 - ECONOMY.platePrice * PLAYER.maxPlates);
  });

  it('ammo refill tops up magazine and reserve, and refuses when already full', () => {
    const inv = createInventory();
    inv.cash = 1000;
    const w = inv.slots[0]!;
    w.ammo.mag = 3;
    w.ammo.reserve = 10;
    const r = purchaseBuy(inv, 'ammo0');
    expect(r.ok).toBe(true);
    expect(w.ammo.mag).toBe(w.ammo.magSize);
    expect(w.ammo.reserve).toBe(w.ammo.reserveMax);
    expect(inv.cash).toBe(1000 - WEAPONS.rifle.ammoPrice);
    const again = purchaseBuy(inv, 'ammo0');
    expect(again.ok).toBe(false);
    expect(again.reason).toBe('full');
  });

  it('the shotgun replaces the equipped weapon, costs once, and cannot be bought twice', () => {
    const inv = createInventory();
    inv.cash = 3000;
    inv.activeSlot = 1; // pistol equipped
    const r = purchaseBuy(inv, 'shotgun');
    expect(r.ok).toBe(true);
    expect(inv.slots[1]!.id).toBe('shotgun');
    expect(inv.slots[0]!.id).toBe('rifle');
    expect(inv.cash).toBe(3000 - WEAPONS.shotgun.price);
    expect(carries(inv, 'pistol')).toBe(false);
    const again = purchaseBuy(inv, 'shotgun');
    expect(again.ok).toBe(false);
    expect(again.reason).toBe('owned');
    expect(inv.cash).toBe(3000 - WEAPONS.shotgun.price);
    // the missing standard weapon can be re-bought
    const rearm = purchaseBuy(inv, 'rearm');
    expect(rearm.ok).toBe(true);
    expect(inv.slots[1]!.id).toBe('pistol');
  });

  it('grenades respect the carry cap', () => {
    const inv = createInventory();
    inv.cash = 5000;
    inv.grenades = GRENADE.max - 1;
    expect(purchaseBuy(inv, 'grenades').ok).toBe(true);
    expect(inv.grenades).toBe(GRENADE.max);
    expect(purchaseBuy(inv, 'grenades').ok).toBe(false);
  });

  it('menu states reflect affordability and never leave items enabled that would fail', () => {
    const inv = createInventory();
    inv.cash = 0;
    for (const item of buyMenu(inv)) {
      expect(['unaffordable', 'full', 'owned', 'maxed', 'unavailable']).toContain(item.state);
    }
    inv.cash = 100000;
    for (const item of buyMenu(inv)) {
      if (item.state === 'ok') {
        const copy = structuredClone(inv);
        expect(purchaseBuy(copy, item.id as never).ok).toBe(true);
      }
    }
  });
});

describe('upgrade station', () => {
  it('upgrades change tier once per purchase, refill ammo, and stop at max', () => {
    const inv = createInventory();
    inv.cash = 20000;
    const w = inv.slots[0]!;
    const magBefore = w.ammo.magSize;
    const r1 = purchaseUpgrade(inv, 0);
    expect(r1.ok).toBe(true);
    expect(w.tier).toBe(1);
    expect(w.ammo.magSize).toBeGreaterThan(magBefore);
    expect(w.ammo.mag).toBe(w.ammo.magSize);
    const r2 = purchaseUpgrade(inv, 0);
    expect(r2.ok).toBe(true);
    expect(w.tier).toBe(2);
    const cashAfter = inv.cash;
    const r3 = purchaseUpgrade(inv, 0);
    expect(r3.ok).toBe(false);
    expect(r3.reason).toBe('maxed');
    expect(inv.cash).toBe(cashAfter);
    expect(upgradeMenu(inv)[0]!.state).toBe('maxed');
  });

  it('denies an unaffordable upgrade cleanly', () => {
    const inv = createInventory();
    inv.cash = 10;
    const r = purchaseUpgrade(inv, 1);
    expect(r.ok).toBe(false);
    expect(inv.cash).toBe(10);
    expect(inv.slots[1]!.tier).toBe(0);
  });
});

describe('loot', () => {
  it('crate rewards scale with region and never overflow capacity', () => {
    const inv = createInventory();
    const rng = new Rng(7);
    const low = rollCrateReward('low', inv, rng);
    const high = rollCrateReward('high', inv, rng);
    expect(low.cash).toBeGreaterThanOrEqual(ECONOMY.crates.low.cash[0] - 5);
    expect(high.cash).toBeGreaterThanOrEqual(ECONOMY.crates.high.cash[0] - 5);
    inv.plates = PLAYER.maxPlates;
    inv.grenades = GRENADE.max;
    const applied = applyCrateReward(inv, { cash: 100, ammo: [30, 13], plates: 1, grenades: 1 });
    expect(applied.plates).toBe(0);
    expect(applied.grenades).toBe(0);
    expect(inv.plates).toBe(PLAYER.maxPlates);
    expect(inv.slots[0]!.ammo.reserve).toBeLessThanOrEqual(inv.slots[0]!.ammo.reserveMax);
  });

  it('contract rewards apply cash and clamp plates', () => {
    const inv = createInventory();
    const cash = inv.cash;
    inv.plates = PLAYER.maxPlates - 1;
    const r = applyContractReward(inv, MISSION.hunt.reward);
    expect(inv.cash).toBe(cash + MISSION.hunt.reward.cash);
    expect(r.plates).toBe(1);
    addCash(inv, -50);
    expect(inv.cash).toBe(cash + MISSION.hunt.reward.cash);
  });
});
