/**
 * Contract state machines (pure). A contract's reward can be claimed exactly once.
 *  - Defense: activate the transmitter, then progress accumulates only while the player is inside the area.
 *  - Hunt: locate and eliminate the elite target.
 */
import { MISSION } from '../config';
import type { ContractReward } from './economy';

export type ContractStatus = 'available' | 'active' | 'complete';

export interface DefenseContract {
  status: ContractStatus;
  /** 0..1 uplink progress. */
  progress: number;
  rewardClaimed: boolean;
  /** Seconds the player has spent inside the area while active (stat). */
  timeInside: number;
  insideNow: boolean;
}

export function createDefense(): DefenseContract {
  return { status: 'available', progress: 0, rewardClaimed: false, timeInside: 0, insideNow: false };
}

/** Start the uplink. Only possible from `available`. */
export function activateDefense(c: DefenseContract): boolean {
  if (c.status !== 'available') return false;
  c.status = 'active';
  c.progress = 0;
  return true;
}

/** Returns true on the frame the contract completes. Progress only advances while the living player is inside the area. */
export function updateDefense(c: DefenseContract, dt: number, playerInside: boolean, playerAlive: boolean): boolean {
  c.insideNow = false;
  if (c.status !== 'active') return false;
  const inside = playerInside && playerAlive;
  c.insideNow = inside;
  if (inside) {
    c.timeInside += dt;
    c.progress = Math.min(1, c.progress + (dt * MISSION.defense.rate) / MISSION.defense.duration);
  } else {
    c.progress = Math.max(0, c.progress - (dt * MISSION.defense.decayPerSecond) / 100);
  }
  if (c.progress >= 1) {
    c.status = 'complete';
    c.progress = 1;
    return true;
  }
  return false;
}

/** Claim the reward once. Returns null when already claimed or not complete. */
export function claimDefenseReward(c: DefenseContract): ContractReward | null {
  if (c.status !== 'complete' || c.rewardClaimed) return null;
  c.rewardClaimed = true;
  return { ...MISSION.defense.reward };
}

export interface HuntContract {
  status: ContractStatus;
  /** The Warden has been identified (player within reveal range). */
  identified: boolean;
  rewardClaimed: boolean;
}

export function createHunt(): HuntContract {
  return { status: 'active', identified: false, rewardClaimed: false };
}

/** Update identification: true on the frame the target becomes identified. */
export function updateHunt(c: HuntContract, distanceToTarget: number, targetAlive: boolean): boolean {
  if (c.status !== 'active' || !targetAlive || c.identified) return false;
  if (distanceToTarget <= MISSION.hunt.revealRange) {
    c.identified = true;
    return true;
  }
  return false;
}

/** The Warden died: complete the contract (idempotent). */
export function completeHunt(c: HuntContract): boolean {
  if (c.status === 'complete') return false;
  c.status = 'complete';
  c.identified = true;
  return true;
}

export function claimHuntReward(c: HuntContract): ContractReward | null {
  if (c.status !== 'complete' || c.rewardClaimed) return null;
  c.rewardClaimed = true;
  return { ...MISSION.hunt.reward };
}

export function contractsCompleted(d: DefenseContract, h: HuntContract): number {
  return (d.status === 'complete' ? 1 : 0) + (h.status === 'complete' ? 1 : 0);
}

export function allContractsComplete(d: DefenseContract, h: HuntContract): boolean {
  return d.status === 'complete' && h.status === 'complete';
}
