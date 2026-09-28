/**
 * Inventory, currency, purchases, upgrades and loot rewards (pure logic; the game wraps it with feedback).
 * Every mutation is atomic: cash can never go negative and a failed purchase changes nothing.
 */
import { ECONOMY, GRENADE, PLAYER, REGIONS, WEAPONS, ZOMBIES, type ZombieDef } from '../config';
import type { Region, WeaponId, ZombieType } from '../types';
import { type AmmoState, addReserve, applyUpgradeAmmo, createAmmo, isFull } from './ammo';
import type { Rng } from './rng';
import { getWeaponStats, type Tier } from './weaponStats';

export interface CarriedWeapon {
  id: WeaponId;
  tier: Tier;
  ammo: AmmoState;
}

export interface Inventory {
  cash: number;
  cashEarned: number;
  cashSpent: number;
  plates: number;
  grenades: number;
  slots: [CarriedWeapon | null, CarriedWeapon | null];
  activeSlot: 0 | 1;
  ammoCollected: number;
  platesCollected: number;
}

export function createCarried(id: WeaponId, tier: Tier = 0): CarriedWeapon {
  const def = WEAPONS[id];
  const s = getWeaponStats(def, tier);
  return { id, tier, ammo: createAmmo(s.magSize, def.reserveStart, s.reserveMax) };
}

export function createInventory(): Inventory {
  return {
    cash: PLAYER.startCash,
    cashEarned: 0,
    cashSpent: 0,
    plates: PLAYER.startPlates,
    grenades: PLAYER.startGrenades,
    slots: [createCarried('rifle'), createCarried('pistol')],
    activeSlot: 0,
    ammoCollected: 0,
    platesCollected: 0,
  };
}

export function activeWeapon(inv: Inventory): CarriedWeapon | null {
  return inv.slots[inv.activeSlot];
}

export function carries(inv: Inventory, id: WeaponId): boolean {
  return inv.slots[0]?.id === id || inv.slots[1]?.id === id;
}

export function addCash(inv: Inventory, amount: number): void {
  if (!(amount > 0)) return;
  inv.cash += amount;
  inv.cashEarned += amount;
}

/** Atomically spend cash; returns false (and changes nothing) when it cannot be afforded. */
export function spendCash(inv: Inventory, amount: number): boolean {
  if (!(amount >= 0) || inv.cash < amount) return false;
  inv.cash -= amount;
  inv.cashSpent += amount;
  return true;
}

export function killReward(def: ZombieDef, headshot: boolean, region: Region): number {
  const base = def.reward + (headshot ? def.headshotBonus : 0);
  return Math.round(base * REGIONS[region].rewardMul * ECONOMY.killCashMul);
}

export function killRewardByType(type: ZombieType, headshot: boolean, region: Region): number {
  return killReward(ZOMBIES[type], headshot, region);
}

// ---------------------------------------------------------------------------------------------
// Stations
// ---------------------------------------------------------------------------------------------

export type ItemState = 'ok' | 'unaffordable' | 'full' | 'owned' | 'maxed' | 'unavailable';

export interface StationItem {
  id: string;
  key: string;
  label: string;
  detail: string;
  cost: number;
  state: ItemState;
  note?: string;
}

export interface PurchaseResult {
  ok: boolean;
  reason: ItemState | 'invalid';
  cost: number;
  message: string;
}

export type BuyItemId = 'ammo0' | 'ammo1' | 'plate' | 'grenades' | 'shotgun' | 'rearm';

const fail = (reason: PurchaseResult['reason'], cost: number, message: string): PurchaseResult => ({
  ok: false,
  reason,
  cost,
  message,
});

function rearmTarget(inv: Inventory): WeaponId | null {
  if (!carries(inv, 'rifle')) return 'rifle';
  if (!carries(inv, 'pistol')) return 'pistol';
  return null;
}

function stateFor(inv: Inventory, cost: number, blocked: ItemState | null): ItemState {
  if (blocked) return blocked;
  return inv.cash >= cost ? 'ok' : 'unaffordable';
}

/** Items listed on the buy station panel (keys 1-6). */
export function buyMenu(inv: Inventory): StationItem[] {
  const items: StationItem[] = [];
  for (const slot of [0, 1] as const) {
    const w = inv.slots[slot];
    const key = String(slot + 1);
    if (!w) {
      items.push({ id: `ammo${slot}`, key, label: `AMMO - SLOT ${slot + 1}`, detail: 'Empty slot', cost: 0, state: 'unavailable' });
      continue;
    }
    const def = WEAPONS[w.id];
    items.push({
      id: `ammo${slot}`,
      key,
      label: `AMMO - ${def.short}`,
      detail: `Refill magazine and reserve (${w.ammo.reserve}/${w.ammo.reserveMax})`,
      cost: def.ammoPrice,
      state: stateFor(inv, def.ammoPrice, isFull(w.ammo) ? 'full' : null),
      note: inv.activeSlot === slot ? 'EQUIPPED' : undefined,
    });
  }
  items.push({
    id: 'plate',
    key: '3',
    label: 'ARMOR PLATE',
    detail: `+${PLAYER.plateArmor} armor when applied (carrying ${inv.plates}/${PLAYER.maxPlates})`,
    cost: ECONOMY.platePrice,
    state: stateFor(inv, ECONOMY.platePrice, inv.plates >= PLAYER.maxPlates ? 'full' : null),
  });
  items.push({
    id: 'grenades',
    key: '4',
    label: `FRAG GRENADES x${GRENADE.purchaseAmount}`,
    detail: `Carrying ${inv.grenades}/${GRENADE.max}`,
    cost: GRENADE.price,
    state: stateFor(inv, GRENADE.price, inv.grenades >= GRENADE.max ? 'full' : null),
  });
  const sg = WEAPONS.shotgun;
  const equipped = activeWeapon(inv);
  items.push({
    id: 'shotgun',
    key: '5',
    label: sg.name.toUpperCase(),
    detail: 'Eight-pellet close-range pump gun',
    cost: sg.price,
    state: stateFor(inv, sg.price, carries(inv, 'shotgun') ? 'owned' : null),
    note: equipped && !carries(inv, 'shotgun') ? `REPLACES ${WEAPONS[equipped.id].short}` : undefined,
  });
  const re = rearmTarget(inv);
  if (re) {
    items.push({
      id: 'rearm',
      key: '6',
      label: WEAPONS[re].name.toUpperCase(),
      detail: 'Re-arm a standard-issue weapon',
      cost: WEAPONS[re].price,
      state: stateFor(inv, WEAPONS[re].price, null),
      note: equipped ? `REPLACES ${WEAPONS[equipped.id].short}` : undefined,
    });
  } else {
    items.push({ id: 'rearm', key: '6', label: 'RE-ARM', detail: 'Both standard weapons carried', cost: 0, state: 'unavailable' });
  }
  return items;
}

function giveWeapon(inv: Inventory, id: WeaponId): string {
  const slot = inv.activeSlot;
  const old = inv.slots[slot];
  inv.slots[slot] = createCarried(id);
  return old ? `${WEAPONS[id].short} replaces ${WEAPONS[old.id].short}` : `${WEAPONS[id].short} acquired`;
}

export function purchaseBuy(inv: Inventory, id: BuyItemId): PurchaseResult {
  const menu = buyMenu(inv);
  const item = menu.find((m) => m.id === id);
  if (!item) return fail('invalid', 0, 'Unknown item');
  if (item.state === 'unavailable') return fail('unavailable', item.cost, 'Not available');
  if (item.state === 'full') return fail('full', item.cost, 'Already full');
  if (item.state === 'owned') return fail('owned', item.cost, 'Already carried');
  if (item.state === 'unaffordable') return fail('unaffordable', item.cost, 'Not enough cash');
  if (!spendCash(inv, item.cost)) return fail('unaffordable', item.cost, 'Not enough cash');
  let message = item.label;
  switch (id) {
    case 'ammo0':
    case 'ammo1': {
      const w = inv.slots[id === 'ammo0' ? 0 : 1]!;
      w.ammo.reserve = w.ammo.reserveMax;
      w.ammo.mag = w.ammo.magSize;
      w.ammo.reload = null;
      message = `${WEAPONS[w.id].short} resupplied`;
      break;
    }
    case 'plate':
      inv.plates += 1;
      message = 'Armor plate acquired';
      break;
    case 'grenades':
      inv.grenades = Math.min(GRENADE.max, inv.grenades + GRENADE.purchaseAmount);
      message = 'Frag grenades acquired';
      break;
    case 'shotgun':
      message = giveWeapon(inv, 'shotgun');
      break;
    case 'rearm': {
      const target = rearmTarget(inv)!;
      message = giveWeapon(inv, target);
      break;
    }
  }
  return { ok: true, reason: 'ok', cost: item.cost, message };
}

/** Items on the upgrade station panel (keys 1-2, one per slot). */
export function upgradeMenu(inv: Inventory): StationItem[] {
  return ([0, 1] as const).map((slot) => {
    const w = inv.slots[slot];
    const key = String(slot + 1);
    if (!w) return { id: `up${slot}`, key, label: `SLOT ${slot + 1}`, detail: 'Empty', cost: 0, state: 'unavailable' as ItemState };
    const def = WEAPONS[w.id];
    if (w.tier >= 2) {
      return { id: `up${slot}`, key, label: `${def.short} ${def.tiers[1].label}`, detail: 'Fully upgraded', cost: 0, state: 'maxed' as ItemState };
    }
    const next = def.tiers[w.tier as 0 | 1]!;
    return {
      id: `up${slot}`,
      key,
      label: `${def.short} -> ${next.label}`,
      detail: next.description,
      cost: next.cost,
      state: stateFor(inv, next.cost, null),
      note: inv.activeSlot === slot ? 'EQUIPPED' : undefined,
    };
  });
}

export function purchaseUpgrade(inv: Inventory, slot: 0 | 1): PurchaseResult {
  const w = inv.slots[slot];
  if (!w) return fail('unavailable', 0, 'No weapon in that slot');
  if (w.tier >= 2) return fail('maxed', 0, 'Already fully upgraded');
  const def = WEAPONS[w.id];
  const next = def.tiers[w.tier as 0 | 1]!;
  if (inv.cash < next.cost) return fail('unaffordable', next.cost, 'Not enough cash');
  if (!spendCash(inv, next.cost)) return fail('unaffordable', next.cost, 'Not enough cash');
  w.tier = (w.tier + 1) as Tier;
  const s = getWeaponStats(def, w.tier);
  applyUpgradeAmmo(w.ammo, s.magSize, s.reserveMax);
  return { ok: true, reason: 'ok', cost: next.cost, message: `${def.short} upgraded to ${next.label}` };
}

// ---------------------------------------------------------------------------------------------
// Loot
// ---------------------------------------------------------------------------------------------

export interface CrateReward {
  cash: number;
  /** Rounds per carried weapon slot. */
  ammo: [number, number];
  plates: number;
  grenades: number;
}

export interface AppliedReward {
  cash: number;
  ammo: [number, number];
  plates: number;
  grenades: number;
}

/** Roll a crate's contents (pure; does not touch the inventory). */
export function rollCrateReward(region: Region, inv: Inventory, rng: Rng): CrateReward {
  const cfg = ECONOMY.crates[region];
  const ammo: [number, number] = [0, 0];
  for (const slot of [0, 1] as const) {
    const w = inv.slots[slot];
    if (!w) continue;
    ammo[slot] = Math.max(1, Math.round(w.ammo.magSize * rng.range(cfg.mags[0], cfg.mags[1])));
  }
  return {
    cash: Math.round(rng.range(cfg.cash[0], cfg.cash[1]) / 10) * 10,
    ammo,
    plates: rng.chance(cfg.plateChance) ? 1 : 0,
    grenades: rng.chance(cfg.grenadeChance) ? 1 : 0,
  };
}

/** Apply a reward to the inventory, clamping to capacity; returns what was really granted. */
export function applyCrateReward(inv: Inventory, r: CrateReward): AppliedReward {
  addCash(inv, r.cash);
  const ammo: [number, number] = [0, 0];
  for (const slot of [0, 1] as const) {
    const w = inv.slots[slot];
    if (!w || r.ammo[slot] <= 0) continue;
    ammo[slot] = addReserve(w.ammo, r.ammo[slot]);
    inv.ammoCollected += ammo[slot];
  }
  const plates = Math.min(r.plates, PLAYER.maxPlates - inv.plates);
  inv.plates += Math.max(0, plates);
  inv.platesCollected += Math.max(0, plates);
  const grenades = Math.min(r.grenades, GRENADE.max - inv.grenades);
  inv.grenades += Math.max(0, grenades);
  return { cash: r.cash, ammo, plates: Math.max(0, plates), grenades: Math.max(0, grenades) };
}

export interface ContractReward {
  cash: number;
  plates: number;
  grenades: number;
}

export function applyContractReward(inv: Inventory, r: ContractReward): AppliedReward {
  addCash(inv, r.cash);
  const plates = Math.max(0, Math.min(r.plates, PLAYER.maxPlates - inv.plates));
  inv.plates += plates;
  inv.platesCollected += plates;
  const grenades = Math.max(0, Math.min(r.grenades, GRENADE.max - inv.grenades));
  inv.grenades += grenades;
  return { cash: r.cash, ammo: [0, 0], plates, grenades };
}
