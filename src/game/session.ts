/** Per-run mission state (everything that resets on restart). */
import { MISSION } from '../config';
import { createNomad, type NomadState } from '../logic/nomad';
import { createDefense, createHunt, type DefenseContract, type HuntContract } from '../logic/contracts';
import { createInventory, type Inventory } from '../logic/economy';
import { createExtraction, type ExtractionState } from '../logic/extraction';
import type { Vitals } from '../logic/damage';
import type { MissionStats, Region } from '../types';

export interface Session {
  /** Seconds of simulated mission time (only advances while playing). */
  elapsed: number;
  inv: Inventory;
  nomad: NomadState;
  vitals: Vitals;
  /** Seconds since the player last took damage (health regeneration delay). */
  sinceDamage: number;
  defense: DefenseContract;
  hunt: HuntContract;
  extraction: ExtractionState;
  stats: {
    kills: number;
    headshots: number;
    cratesOpened: number;
    shotsFired: number;
    shotsHit: number;
    highestRegion: Region;
  };
  /** Which optional radio lines / banners already fired (each fires once). */
  flags: Set<string>;
  ended: null | { outcome: 'victory' | 'defeat'; reason: string; at: number };
}

export function newSession(): Session {
  return {
    elapsed: 0,
    inv: createInventory(),
    nomad: createNomad(),
    vitals: { health: 100, armor: 50 },
    sinceDamage: 99,
    defense: createDefense(),
    hunt: createHunt(),
    extraction: createExtraction(),
    stats: { kills: 0, headshots: 0, cratesOpened: 0, shotsFired: 0, shotsHit: 0, highestRegion: 'low' },
    flags: new Set(),
    ended: null,
  };
}

const RANK: Record<Region, number> = { low: 0, medium: 1, high: 2 };
export function bumpRegion(s: Session, r: Region): void {
  if (RANK[r] > RANK[s.stats.highestRegion]) s.stats.highestRegion = r;
}

export function buildStats(s: Session, outcome: 'victory' | 'defeat', reason: string, contractsDone: number): MissionStats {
  return {
    outcome,
    reason,
    nomad: { ...s.nomad, trust: { ...s.nomad.trust } },
    kills: s.stats.kills,
    headshots: s.stats.headshots,
    contractsCompleted: contractsDone,
    contractsTotal: 2,
    cratesOpened: s.stats.cratesOpened,
    cashEarned: s.inv.cashEarned,
    cashSpent: s.inv.cashSpent,
    ammoCollected: s.inv.ammoCollected,
    platesCollected: s.inv.platesCollected,
    timeSurvived: Math.min(s.elapsed, MISSION.deadline * 2),
    shotsFired: s.stats.shotsFired,
    shotsHit: s.stats.shotsHit,
    highestRegion: s.stats.highestRegion,
  };
}
