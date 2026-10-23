import { describe, expect, it } from 'vitest';
import {
  advanceSurvival, alliedClan, convoyReady, createNomad, loadConvoy, NOMAD,
  powerRelay, refillSupplies, salvageCache, shareCell,
} from '../src/logic/nomad';
import { buildStats, newSession } from '../src/game/session';

describe('Nomad expedition', () => {
  it('starts independently on every run', () => {
    const a = newSession();
    a.nomad.trust.ember = 100;
    a.nomad.cells = 99;
    const b = newSession();
    expect(b.nomad).toEqual(createNomad());
    expect(b.nomad.trust).not.toBe(a.nomad.trust);
  });

  it.each([['low', 1], ['medium', 2], ['high', 3]] as const)('salvages %s caches with capped supplies', (region, count) => {
    const n = createNomad();
    n.water = 95;
    n.food = 98;
    expect(salvageCache(n, region)).toBe(count);
    expect(n.cells).toBe(count);
    expect(n.cellsFound).toBe(count);
    expect(n.water).toBe(100);
    expect(n.food).toBe(100);
  });

  it('never spends relay cells twice or goes into debt', () => {
    const n = createNomad();
    expect(powerRelay(n)).toBe(false);
    salvageCache(n, 'medium');
    expect(powerRelay(n)).toBe(true);
    expect(n.cells).toBe(0);
    salvageCache(n, 'high');
    expect(powerRelay(n)).toBe(false);
    expect(n.cells).toBe(3);
  });

  it('requires two donations to one clan, with real resource costs', () => {
    const n = createNomad();
    n.water = 10;
    n.food = 10;
    expect(shareCell(n, 'ember')).toBe(false);
    salvageCache(n, 'high');
    expect(shareCell(n, 'ember')).toBe(true);
    expect(alliedClan(n)).toBeNull();
    expect(shareCell(n, 'ember')).toBe(true);
    expect(alliedClan(n)).toBe('ember');
    expect(n.cells).toBe(1);
    expect(n.cellsShared).toBe(2);
    expect(n.trust.iron).toBe(20);
    expect(n.water).toBe(100);
    expect(n.food).toBe(94);
  });

  it('Iron earns loyalty but does not restore food or water', () => {
    const n = createNomad();
    n.cells = 2;
    n.water = 30;
    n.food = 40;
    shareCell(n, 'iron');
    shareCell(n, 'iron');
    expect(alliedClan(n)).toBe('iron');
    expect(n.water).toBe(30);
    expect(n.food).toBe(40);
  });

  it('will not consume cells after a clan reaches maximum trust', () => {
    const n = createNomad();
    n.cells = 5;
    for (let i = 0; i < 4; i++) expect(shareCell(n, 'ember')).toBe(true);
    expect(n.trust.ember).toBe(100);
    expect(shareCell(n, 'ember')).toBe(false);
    expect(n.cells).toBe(1);
  });

  it('needs both an alliance and cargo, and charges the convoy exactly once', () => {
    const n = createNomad();
    n.cells = 3;
    expect(loadConvoy(n)).toBe(false);
    n.trust.iron = 60;
    expect(convoyReady(n)).toBe(true);
    expect(loadConvoy(n)).toBe(true);
    expect(n.cells).toBe(0);
    n.cells = 3;
    expect(loadConvoy(n)).toBe(false);
    expect(n.cells).toBe(3);
  });

  it('has an attainable seven-cell route without granting free cargo', () => {
    const n = createNomad();
    salvageCache(n, 'low');
    salvageCache(n, 'low');
    expect(powerRelay(n)).toBe(true);
    salvageCache(n, 'medium');
    shareCell(n, 'iron');
    shareCell(n, 'iron');
    expect(convoyReady(n)).toBe(false);
    salvageCache(n, 'high');
    expect(loadConvoy(n)).toBe(true);
    expect(n.cellsFound).toBe(7);
    expect(n.cellsFound).toBe(NOMAD.relayCells + n.cellsShared + NOMAD.cargoCells + n.cells);
  });

  it('drains water faster during sprinting and caps depleted supplies', () => {
    const n = createNomad();
    const sprint = createNomad();
    advanceSurvival(n, 100, false);
    advanceSurvival(sprint, 100, true);
    expect(sprint.water).toBeLessThan(n.water);
    expect(sprint.food).toBe(n.food);
    expect(advanceSurvival(n, 2000, false)).toBeGreaterThan(0);
    expect(n.water).toBe(0);
    expect(n.food).toBe(0);
  });

  it('ignores invalid time and refills depleted supplies', () => {
    const n = createNomad();
    for (const dt of [0, -1, NaN, Infinity]) expect(advanceSurvival(n, dt, true)).toBe(0);
    expect(n.water).toBe(100);
    n.water = 0;
    n.food = 0;
    refillSupplies(n);
    expect(n.water).toBe(100);
    expect(n.food).toBe(100);
  });

  it('captures immutable clan and cargo results before restart', () => {
    const s = newSession();
    s.nomad.cellsFound = 8;
    s.nomad.trust.iron = 80;
    const stats = buildStats(s, 'victory', 'Extracted', 2);
    s.nomad.trust.iron = 20;
    expect(stats.nomad?.cellsFound).toBe(8);
    expect(stats.nomad?.trust.iron).toBe(80);
  });
});
