/** Local persistence for settings and the best successful run. Every access is guarded: storage failure never blocks play. */
import { DEFAULT_SETTINGS } from './config';
import type { BestRun, QualityLevel, Settings } from './types';

const KEY_SETTINGS = 'nomad.ashfall.settings.v1';
const KEY_BEST = 'nomad.ashfall.best.v1';

const clamp = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return Math.min(hi, Math.max(lo, n));
};

export function sanitizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const q = r.quality;
  const quality: QualityLevel = q === 'low' || q === 'medium' || q === 'high' ? q : DEFAULT_SETTINGS.quality;
  return {
    sensitivity: clamp(r.sensitivity, 0.1, 4, DEFAULT_SETTINGS.sensitivity),
    fov: clamp(r.fov, 70, 110, DEFAULT_SETTINGS.fov),
    masterVolume: clamp(r.masterVolume, 0, 1, DEFAULT_SETTINGS.masterVolume),
    quality,
    reducedMotion: typeof r.reducedMotion === 'boolean' ? r.reducedMotion : DEFAULT_SETTINGS.reducedMotion,
    invertY: typeof r.invertY === 'boolean' ? r.invertY : DEFAULT_SETTINGS.invertY,
    showFps: typeof r.showFps === 'boolean' ? r.showFps : DEFAULT_SETTINGS.showFps,
  };
}

export function loadSettings(): Settings {
  let s = { ...DEFAULT_SETTINGS };
  try {
    const txt = window.localStorage.getItem(KEY_SETTINGS);
    if (txt) s = sanitizeSettings(JSON.parse(txt));
  } catch {
    /* storage unavailable or corrupt: defaults */
  }
  // honour the OS reduced-motion preference on first run
  try {
    if (window.localStorage.getItem(KEY_SETTINGS) === null && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) s.reducedMotion = true;
  } catch {
    /* ignore */
  }
  return s;
}

export function saveSettings(s: Settings): void {
  try {
    window.localStorage.setItem(KEY_SETTINGS, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export function loadBest(): BestRun | null {
  try {
    const txt = window.localStorage.getItem(KEY_BEST);
    if (!txt) return null;
    const r = JSON.parse(txt) as Partial<BestRun>;
    if (typeof r.time !== 'number' || !Number.isFinite(r.time)) return null;
    return {
      time: r.time,
      kills: typeof r.kills === 'number' ? r.kills : 0,
      headshots: typeof r.headshots === 'number' ? r.headshots : 0,
      cash: typeof r.cash === 'number' ? r.cash : 0,
      date: typeof r.date === 'string' ? r.date : '',
    };
  } catch {
    return null;
  }
}

export function saveBest(b: BestRun): void {
  try {
    window.localStorage.setItem(KEY_BEST, JSON.stringify(b));
  } catch {
    /* ignore */
  }
}

/** Is `candidate` a better successful run than `best`? Faster time wins; ties broken by kills. */
export function isBetterRun(candidate: BestRun, best: BestRun | null): boolean {
  if (!best) return true;
  if (candidate.time < best.time - 0.5) return true;
  return Math.abs(candidate.time - best.time) <= 0.5 && candidate.kills > best.kills;
}
