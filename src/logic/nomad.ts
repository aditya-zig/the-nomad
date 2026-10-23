/** Nomad's expedition rules. No rendering, timers or browser state: reset with each run. */
import type { Region } from '../types';

export type Clan = 'ember' | 'iron';
export const CLANS: Record<Clan, string> = { ember: 'Ember Union', iron: 'Iron Vultures' };
export const NOMAD = {
  relayCells: 2,
  cargoCells: 3,
  trustRequired: 60,
  donationTrust: 20,
  refillCost: 100,
  cellYield: { low: 1, medium: 2, high: 3 } as Record<Region, number>,
} as const;

export interface NomadState {
  cells: number;
  cellsFound: number;
  cellsShared: number;
  relayPowered: boolean;
  cargoLoaded: boolean;
  water: number;
  food: number;
  trust: Record<Clan, number>;
}

export function createNomad(): NomadState {
  return {
    cells: 0, cellsFound: 0, cellsShared: 0, relayPowered: false, cargoLoaded: false,
    water: 100, food: 100, trust: { ember: 20, iron: 20 },
  };
}

export function salvageCache(s: NomadState, region: Region): number {
  const cells = NOMAD.cellYield[region];
  s.cells += cells;
  s.cellsFound += cells;
  s.water = Math.min(100, s.water + 18);
  s.food = Math.min(100, s.food + 14);
  return cells;
}

/** Returns starvation damage; callers apply it after regeneration and only while alive / playing. */
export function advanceSurvival(s: NomadState, dt: number, sprinting: boolean): number {
  if (!Number.isFinite(dt) || dt <= 0) return 0;
  s.water = Math.max(0, s.water - dt * (sprinting ? 0.2 : 0.12));
  s.food = Math.max(0, s.food - dt * 0.085);
  return ((s.water <= 0 ? 1.2 : 0) + (s.food <= 0 ? 0.6 : 0)) * dt;
}

/** A real allocation choice: a cell cannot also power the relay or leave with the convoy. */
export function shareCell(s: NomadState, clan: Clan): boolean {
  if (s.cells < 1 || s.trust[clan] >= 100) return false;
  s.cells--;
  s.cellsShared++;
  s.trust[clan] = Math.min(100, s.trust[clan] + NOMAD.donationTrust);
  if (clan === 'ember') {
    s.water = Math.min(100, s.water + 40);
    s.food = Math.min(100, s.food + 35);
  }
  return true;
}

export function powerRelay(s: NomadState): boolean {
  if (s.relayPowered || s.cells < NOMAD.relayCells) return false;
  s.cells -= NOMAD.relayCells;
  s.relayPowered = true;
  return true;
}

export function alliedClan(s: NomadState): Clan | null {
  const best: Clan = s.trust.ember >= s.trust.iron ? 'ember' : 'iron';
  return s.trust[best] >= NOMAD.trustRequired ? best : null;
}

export function convoyReady(s: NomadState): boolean {
  return s.cells >= NOMAD.cargoCells && alliedClan(s) !== null && !s.cargoLoaded;
}

export function loadConvoy(s: NomadState): boolean {
  if (!convoyReady(s)) return false;
  s.cells -= NOMAD.cargoCells;
  s.cargoLoaded = true;
  return true;
}

export function refillSupplies(s: NomadState): void {
  s.water = 100;
  s.food = 100;
}
