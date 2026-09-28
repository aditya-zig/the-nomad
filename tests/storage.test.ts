import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/config';
import { mulberry32, Rng, hash2 } from '../src/logic/rng';

// storage.ts touches `window`; provide a minimal stand-in so the module can be exercised in node
const store = new Map<string, string>();
vi.stubGlobal('window', {
  localStorage: {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
  },
  matchMedia: () => ({ matches: false }),
});

const { sanitizeSettings, loadSettings, saveSettings, loadBest, saveBest, isBetterRun } = await import('../src/storage');

describe('settings persistence', () => {
  it('sanitises garbage into safe, clamped settings', () => {
    const s = sanitizeSettings({ sensitivity: 999, fov: -5, masterVolume: 'loud', quality: 'ultra', reducedMotion: 'yes', invertY: true, showFps: 1 });
    expect(s.sensitivity).toBe(4);
    expect(s.fov).toBe(70);
    expect(s.masterVolume).toBe(DEFAULT_SETTINGS.masterVolume);
    expect(s.quality).toBe(DEFAULT_SETTINGS.quality);
    expect(s.reducedMotion).toBe(DEFAULT_SETTINGS.reducedMotion);
    expect(s.invertY).toBe(true);
    expect(s.showFps).toBe(DEFAULT_SETTINGS.showFps);
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('round-trips through storage and survives corrupt data', () => {
    const s = { ...DEFAULT_SETTINGS, sensitivity: 1.7, quality: 'high' as const };
    saveSettings(s);
    expect(loadSettings()).toEqual(s);
    store.set('deadsignal.settings.v1', '{not json');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('a throwing storage never breaks loading or saving', () => {
    const win = (globalThis as unknown as { window: { localStorage: Record<string, unknown> } }).window;
    const orig = win.localStorage;
    win.localStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(() => saveSettings(DEFAULT_SETTINGS)).not.toThrow();
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(loadBest()).toBeNull();
    expect(() => saveBest({ time: 1, kills: 1, headshots: 1, cash: 1, date: 'x' })).not.toThrow();
    win.localStorage = orig;
  });
});

describe('best run', () => {
  it('stores and loads, ranking faster runs first and using kills as the tie-break', () => {
    expect(loadBest()).toBeNull();
    const a = { time: 600, kills: 80, headshots: 30, cash: 5000, date: '2026-09-28' };
    expect(isBetterRun(a, null)).toBe(true);
    saveBest(a);
    expect(loadBest()).toEqual(a);
    expect(isBetterRun({ ...a, time: 590 }, a)).toBe(true);
    expect(isBetterRun({ ...a, time: 640 }, a)).toBe(false);
    expect(isBetterRun({ ...a, kills: 95 }, a)).toBe(true);
    expect(isBetterRun({ ...a, kills: 60 }, a)).toBe(false);
  });
});

describe('rng', () => {
  it('is deterministic per seed and well distributed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seq = Array.from({ length: 5 }, () => a());
    expect(seq).toEqual(Array.from({ length: 5 }, () => b()));
    const r = new Rng(9);
    let sum = 0;
    for (let i = 0; i < 4000; i++) sum += r.f();
    expect(sum / 4000).toBeGreaterThan(0.47);
    expect(sum / 4000).toBeLessThan(0.53);
    expect(new Rng(1).int(3, 3)).toBe(3);
    expect(hash2(1, 2)).toBe(hash2(1, 2));
    expect(hash2(1, 2)).not.toBe(hash2(2, 1));
  });
});
