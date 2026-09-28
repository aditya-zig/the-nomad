import { describe, expect, it } from 'vitest';
import { MISSION } from '../src/config';
import {
  activateDefense,
  allContractsComplete,
  claimDefenseReward,
  claimHuntReward,
  completeHunt,
  contractsCompleted,
  createDefense,
  createHunt,
  updateDefense,
  updateHunt,
} from '../src/logic/contracts';
import { activeCap, compositionWeights, pickSpawnType, spawnInterval } from '../src/logic/director';
import {
  boardHelicopter,
  callExtraction,
  canBoard,
  createExtraction,
  extractionInProgress,
  failExtraction,
  unlockExtraction,
  updateExtraction,
} from '../src/logic/extraction';
import { deadlineRemaining, escalationPhase, hazardRadius, isInsideHazard, surgeActive, surgeStartTime } from '../src/logic/mission';
import { Rng } from '../src/logic/rng';

describe('defense contract', () => {
  it('cannot progress before activation and cannot be activated twice', () => {
    const c = createDefense();
    updateDefense(c, 10, true, true);
    expect(c.progress).toBe(0);
    expect(activateDefense(c)).toBe(true);
    expect(activateDefense(c)).toBe(false);
  });

  it('progress accumulates only while the living player is inside and decays outside', () => {
    const c = createDefense();
    activateDefense(c);
    for (let i = 0; i < 60 * 10; i++) updateDefense(c, 1 / 60, true, true);
    const atTen = c.progress;
    expect(atTen).toBeCloseTo(10 / MISSION.defense.duration, 2);
    for (let i = 0; i < 60 * 5; i++) updateDefense(c, 1 / 60, false, true);
    expect(c.progress).toBeLessThan(atTen);
    const dropped = c.progress;
    for (let i = 0; i < 60 * 5; i++) updateDefense(c, 1 / 60, true, false); // dead player does not count as inside
    expect(c.progress).toBeLessThanOrEqual(dropped);
  });

  it('completes exactly once and the reward is claimable exactly once', () => {
    const c = createDefense();
    activateDefense(c);
    let completions = 0;
    for (let i = 0; i < 60 * 120; i++) if (updateDefense(c, 1 / 60, true, true)) completions++;
    expect(completions).toBe(1);
    expect(c.status).toBe('complete');
    expect(c.progress).toBe(1);
    const first = claimDefenseReward(c);
    expect(first).not.toBeNull();
    expect(first!.cash).toBe(MISSION.defense.reward.cash);
    expect(claimDefenseReward(c)).toBeNull();
    // further updates keep it complete and claim stays null
    updateDefense(c, 5, false, true);
    expect(c.status).toBe('complete');
    expect(claimDefenseReward(c)).toBeNull();
  });

  it('reward is not claimable before completion', () => {
    const c = createDefense();
    expect(claimDefenseReward(c)).toBeNull();
    activateDefense(c);
    expect(claimDefenseReward(c)).toBeNull();
  });
});

describe('hunt contract', () => {
  it('identifies the target within range and completes once on kill', () => {
    const h = createHunt();
    expect(updateHunt(h, MISSION.hunt.revealRange + 5, true)).toBe(false);
    expect(h.identified).toBe(false);
    expect(updateHunt(h, MISSION.hunt.revealRange - 1, true)).toBe(true);
    expect(updateHunt(h, 5, true)).toBe(false); // already identified
    expect(claimHuntReward(h)).toBeNull();
    expect(completeHunt(h)).toBe(true);
    expect(completeHunt(h)).toBe(false);
    expect(claimHuntReward(h)).not.toBeNull();
    expect(claimHuntReward(h)).toBeNull();
  });

  it('summarises contract completion', () => {
    const d = createDefense();
    const h = createHunt();
    expect(contractsCompleted(d, h)).toBe(0);
    completeHunt(h);
    expect(contractsCompleted(d, h)).toBe(1);
    expect(allContractsComplete(d, h)).toBe(false);
    activateDefense(d);
    updateDefense(d, 1000, true, true);
    expect(allContractsComplete(d, h)).toBe(true);
  });
});

describe('extraction state machine', () => {
  const tick = (s: ReturnType<typeof createExtraction>, seconds: number) => {
    const events: string[] = [];
    for (let t = 0; t < seconds; t += 0.05) events.push(...updateExtraction(s, 0.05));
    return events;
  };

  it('is locked until contracts are done and cannot be called from elsewhere', () => {
    const s = createExtraction();
    expect(callExtraction(s, 100, true, true)).toBe(false);
    expect(unlockExtraction(s, false)).toBe(false);
    expect(unlockExtraction(s, true)).toBe(true);
    expect(callExtraction(s, 100, false, true)).toBe(false); // not at the LZ
    expect(callExtraction(s, 100, true, false)).toBe(false); // dead
    expect(callExtraction(s, 100, true, true)).toBe(true);
    expect(s.phase).toBe('called');
    expect(callExtraction(s, 101, true, true)).toBe(false); // cannot re-call
  });

  it('runs called -> inbound -> landing -> landed in order', () => {
    const s = createExtraction();
    unlockExtraction(s, true);
    callExtraction(s, 200, true, true);
    const events = tick(s, MISSION.extraction.countdown + 1);
    expect(events).toEqual(['heliVisible', 'landingStart', 'touchdown']);
    expect(s.phase).toBe('landed');
    expect(s.windowLeft).toBeGreaterThan(MISSION.extraction.boardingWindow - 2);
  });

  it('boarding requires the helicopter to be landed AND the living player at the door', () => {
    const s = createExtraction();
    unlockExtraction(s, true);
    callExtraction(s, 200, true, true);
    tick(s, 20); // still inbound
    expect(canBoard(s, 1, true)).toBe(false);
    expect(boardHelicopter(s, 1, true)).toBe(false);
    tick(s, 60);
    expect(s.phase).toBe('landed');
    expect(boardHelicopter(s, MISSION.extraction.boardRadius + 5, true)).toBe(false);
    expect(boardHelicopter(s, 1, false)).toBe(false);
    expect(s.phase).toBe('landed');
    expect(boardHelicopter(s, 1, true)).toBe(true);
    expect(s.phase).toBe('boarding');
    const events = tick(s, MISSION.extraction.boardingCinematic + 1);
    expect(events).toContain('extracted');
    expect(s.phase).toBe('extracted');
  });

  it('a player standing elsewhere cannot win when the timers expire', () => {
    const s = createExtraction();
    unlockExtraction(s, true);
    callExtraction(s, 200, true, true);
    const events = tick(s, MISSION.extraction.countdown + MISSION.extraction.boardingWindow + 5);
    expect(events).toContain('departed');
    expect(events).not.toContain('extracted');
    expect(s.phase).toBe('failed');
    expect(extractionInProgress(s)).toBe(false);
  });

  it('failExtraction is terminal and never overrides extracted', () => {
    const s = createExtraction();
    unlockExtraction(s, true);
    callExtraction(s, 1, true, true);
    tick(s, 70);
    boardHelicopter(s, 0, true);
    tick(s, 10);
    expect(s.phase).toBe('extracted');
    failExtraction(s, 'late');
    expect(s.phase).toBe('extracted');
    const t = createExtraction();
    failExtraction(t, 'dead');
    expect(t.phase).toBe('failed');
    expect(t.failReason).toBe('dead');
  });
});

describe('mission clock and contamination', () => {
  it('escalation phases advance at their thresholds', () => {
    expect(escalationPhase(0)).toBe(0);
    expect(escalationPhase(MISSION.phases[0]!)).toBe(1);
    expect(escalationPhase(MISSION.phases[2]! + 1)).toBe(3);
  });

  it('the surge starts at the configured time or when extraction is called, whichever is first', () => {
    expect(surgeStartTime(null)).toBe(MISSION.surgeStart);
    expect(surgeStartTime(100)).toBe(100);
    expect(surgeStartTime(MISSION.surgeStart + 50)).toBe(MISSION.surgeStart);
    expect(surgeActive(MISSION.surgeStart - 1, null)).toBe(false);
    expect(surgeActive(MISSION.surgeStart, null)).toBe(true);
  });

  it('the front is inactive before the surge, grows monotonically, and reaches the LZ at the deadline', () => {
    const lz = 90;
    expect(hazardRadius(MISSION.surgeStart - 1, null, false, lz)).toBe(0);
    let last = 0;
    for (let t = MISSION.surgeStart; t <= MISSION.deadline; t += 5) {
      const r = hazardRadius(t, null, false, lz);
      expect(r).toBeGreaterThanOrEqual(last);
      last = r;
    }
    expect(hazardRadius(MISSION.deadline, null, false, lz)).toBeGreaterThanOrEqual(lz);
  });

  it('while an extraction is underway the front stalls short of the LZ', () => {
    const lz = 90;
    const r = hazardRadius(MISSION.deadline, 300, true, lz);
    expect(r).toBeLessThanOrEqual(lz - MISSION.hazard.lzStandoff + 1e-6);
    expect(isInsideHazard(lz, 0, 0, 0, r)).toBe(false);
  });

  it('deadline countdown never goes negative', () => {
    expect(deadlineRemaining(0)).toBe(MISSION.deadline);
    expect(deadlineRemaining(MISSION.deadline + 100)).toBe(0);
  });
});

describe('spawn director', () => {
  it('caps and intervals scale with threat and phase, respecting the quality cap', () => {
    expect(activeCap('high', 0, 'high')).toBeGreaterThan(activeCap('low', 0, 'high'));
    expect(spawnInterval('high', 0)).toBeLessThan(spawnInterval('low', 0));
    expect(spawnInterval('medium', 3)).toBeLessThan(spawnInterval('medium', 0));
    expect(activeCap('high', 3, 'low')).toBeLessThanOrEqual(24);
  });

  it('low threat never spawns armoured infected; high threat does', () => {
    const rng = new Rng(3);
    const low = { shambler: 0, runner: 0, armored: 0 };
    const high = { shambler: 0, runner: 0, armored: 0 };
    for (let i = 0; i < 1000; i++) {
      low[pickSpawnType('low', 2, rng)]++;
      high[pickSpawnType('high', 0, rng)]++;
    }
    expect(low.armored).toBe(0);
    expect(low.shambler).toBeGreaterThan(low.runner);
    expect(high.armored).toBeGreaterThan(100);
    expect(high.runner).toBeGreaterThan(200);
    expect(compositionWeights('medium', 3).runner).toBeGreaterThan(compositionWeights('medium', 0).runner);
  });
});
