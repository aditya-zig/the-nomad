/**
 * Background pre-synthesis. Rendering the essential sounds is pure typed-array work that needs no AudioContext, so it can
 * run BEFORE the user gesture that creates the context. `startPrewarm()` renders them in short time slices (a few ms each,
 * yielding between slices with setTimeout) into a module-level cache; `Engine.init()` then only has to copy them into
 * AudioBuffers. If the user is faster than the prewarm, `init()` synthesises whatever is still missing itself.
 * The chain of timeouts ends by itself when the queue is empty and can be cancelled with `stopPrewarm()`.
 */
import { SOUND_IDS, type SoundId } from '../ids';
import { INDOOR_IR, OUTDOOR_IR, makeImpulse } from './reverb';
import { AMBIENCE_LAYERS, SOUND_SPECS, synthAmbienceLayer, synthSound } from './registry';

export interface Cached {
  data: Float32Array;
  sampleRate: number;
}

export interface CachedImpulse {
  sampleRate: number;
  left: Float32Array;
  right: Float32Array;
}

const cache = new Map<string, Cached>();
const impulses = new Map<string, CachedImpulse>();

interface Job {
  key: string;
  run: () => void;
}

let jobs: Job[] = [];
let total = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let built = false;
const PREWARM_RATE = 48000;

export const soundKey = (id: string, v: number): string => `s:${id}:${v}`;
export const layerKey = (i: number): string => `a:${i}`;

export function getPrewarmed(key: string): Cached | undefined {
  return cache.get(key);
}

export function getPrewarmedImpulse(name: 'outdoor' | 'indoor', sampleRate: number): CachedImpulse | undefined {
  const ir = impulses.get(name);
  return ir && ir.sampleRate === sampleRate ? ir : undefined;
}

export function prewarmProgress(): { done: number; total: number; running: boolean } {
  return { done: Math.max(0, total - jobs.length), total, running: timer !== null };
}

function buildJobs(): Job[] {
  const list: Job[] = [];
  // most important first: things needed the instant gameplay starts
  const order: SoundId[] = [];
  const push = (pred: (id: SoundId) => boolean): void => {
    for (const id of SOUND_IDS) if (SOUND_SPECS[id].essential && pred(id) && !order.includes(id)) order.push(id);
  };
  push((id) => id.startsWith('ui_'));
  push((id) => /_shot(_up)?$/.test(id) || id === 'dry_fire');
  push((id) => id.startsWith('step_') || id === 'jump' || id === 'land');
  push((id) => id.startsWith('hit_') || id === 'kill_confirm' || id.startsWith('impact_') || id === 'ricochet');
  push((id) => id.startsWith('zombie_') || id === 'player_hurt');
  push(() => true);
  for (const id of order) {
    const spec = SOUND_SPECS[id];
    for (let v = 0; v < spec.variants; v++) {
      const key = soundKey(id, v);
      list.push({
        key,
        run: () => {
          const { data, sampleRate } = synthSound(id, v, PREWARM_RATE);
          cache.set(key, { data, sampleRate });
        },
      });
    }
  }
  AMBIENCE_LAYERS.forEach((_, i) => {
    list.push({
      key: layerKey(i),
      run: () => {
        const { data, sampleRate } = synthAmbienceLayer(i);
        cache.set(layerKey(i), { data, sampleRate });
      },
    });
  });
  for (const [name, spec] of [
    ['outdoor', OUTDOOR_IR],
    ['indoor', INDOOR_IR],
  ] as const) {
    list.push({
      key: `ir:${name}`,
      run: () => {
        const [left, right] = makeImpulse(PREWARM_RATE, spec);
        impulses.set(name, { sampleRate: PREWARM_RATE, left, right });
      },
    });
  }
  return list;
}


function slice(): void {
  timer = null;
  const t0 = performance.now();
  while (jobs.length > 0 && performance.now() - t0 < 6) {
    const job = jobs.shift()!;
    try {
      job.run();
    } catch (err) {
      console.warn('[audio] prewarm job failed', job.key, err);
    }
  }
  if (jobs.length > 0) timer = setTimeout(slice, 4);
}

/** Begin (or resume) background synthesis of the essential sounds. Idempotent. */
export function startPrewarm(): void {
  if (!built) {
    jobs = buildJobs();
    total = jobs.length;
    built = true;
  }
  if (jobs.length > 0 && timer === null) timer = setTimeout(slice, 60);
}

/** Cancel pending slices (safe to call repeatedly). Rendered data stays cached and `startPrewarm()` resumes the queue. */
export function stopPrewarm(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

/** Drop the cache and queue (tests / memory). */
export function clearPrewarmCache(): void {
  stopPrewarm();
  cache.clear();
  impulses.clear();
  jobs = [];
  total = 0;
  built = false;
}
