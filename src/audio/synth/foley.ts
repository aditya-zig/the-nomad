/**
 * Small foley building blocks (clicks, clacks, thuds, scrapes, cloth, velcro, rings) shared by the sound recipes.
 * Each writes into `out` starting at time `t` (seconds).
 */
import { type Rand, crackles, modalLayer, noiseLayer, toneLayer } from './dsp';

/** Short dry click: latch, button, hammer fall. */
export function click(
  out: Float32Array,
  sr: number,
  r: Rand,
  t: number,
  o: { f?: number; q?: number; tau?: number; gain?: number } = {},
): void {
  const tau = o.tau ?? 0.004;
  noiseLayer(out, sr, r, {
    start: t,
    dur: Math.max(0.012, tau * 7),
    gain: o.gain ?? 0.8,
    attack: 0.0002,
    tau,
    filters: [{ type: 'bp', f: o.f ?? 2500, q: o.q ?? 2 }],
  });
}

/** Metallic clack: a click plus a short inharmonic ring. */
export function clack(
  out: Float32Array,
  sr: number,
  r: Rand,
  t: number,
  o: { f?: number; ring?: number; ringTau?: number; gain?: number; ringGain?: number } = {},
): void {
  const g = o.gain ?? 0.9;
  const rt = o.ringTau ?? 0.05;
  click(out, sr, r, t, { f: o.f ?? 1800, q: 1.4, tau: 0.005, gain: g });
  modalLayer(out, sr, r, {
    start: t,
    f0: o.ring ?? 800,
    gain: g * (o.ringGain ?? 0.45),
    partials: [
      [1, 1, rt],
      [2.71, 0.55, rt * 0.6],
      [5.13, 0.28, rt * 0.35],
    ],
    excite: 'noise',
    detune: 0.012,
  });
}

/** Low thump: pitch-dropping sine plus soft noise body. */
export function thud(
  out: Float32Array,
  sr: number,
  r: Rand,
  t: number,
  o: { f0?: number; f1?: number; tau?: number; gain?: number; body?: number; bodyF?: number } = {},
): void {
  const tau = o.tau ?? 0.035;
  const g = o.gain ?? 0.9;
  toneLayer(out, sr, r, {
    start: t,
    dur: tau * 7,
    gain: g,
    f0: o.f0 ?? 160,
    f1: o.f1 ?? 65,
    tau,
    attack: 0.0015,
    drive: 1.3,
  });
  noiseLayer(out, sr, r, {
    start: t,
    dur: tau * 6,
    gain: g * (o.body ?? 0.45),
    attack: 0.001,
    tau: tau * 0.8,
    color: 'pink',
    filters: [{ type: 'lp', f: o.bodyF ?? 500 }],
  });
}

/** Friction scrape: swept band-limited noise with rough amplitude flutter. */
export function scrape(
  out: Float32Array,
  sr: number,
  r: Rand,
  t: number,
  dur: number,
  o: { f0: number; f1: number; gain?: number; grit?: number; q?: number; flutter?: number },
): void {
  noiseLayer(out, sr, r, {
    start: t,
    dur,
    gain: o.gain ?? 0.4,
    attack: dur * 0.2,
    tau: dur * 1.1,
    color: 'pink',
    filters: [{ type: 'bp', f: o.f0, f2: o.f1, q: o.q ?? 1.4 }],
    am: { rate: o.flutter ?? 48, depth: o.grit ?? 0.55 },
  });
}

/** Cloth / gear rustle. */
export function rustle(
  out: Float32Array,
  sr: number,
  r: Rand,
  t: number,
  dur: number,
  o: { gain?: number; lo?: number; hi?: number } = {},
): void {
  const lo = o.lo ?? 700;
  const hi = o.hi ?? 3600;
  noiseLayer(out, sr, r, {
    start: t,
    dur,
    gain: o.gain ?? 0.3,
    attack: dur * 0.25,
    tau: dur * 0.7,
    color: 'pink',
    filters: [
      { type: 'hp', f: lo, q: 0.7 },
      { type: 'lp', f: hi, q: 0.7 },
    ],
    am: { rate: 9 + r() * 7, depth: 0.75 },
  });
  noiseLayer(out, sr, r, {
    start: t + dur * 0.05,
    dur: dur * 0.9,
    gain: (o.gain ?? 0.3) * 0.6,
    attack: dur * 0.3,
    tau: dur * 0.5,
    color: 'white',
    filters: [{ type: 'bp', f: (lo + hi) * 0.5, q: 0.8 }],
    am: { rate: 18 + r() * 9, depth: 0.85 },
  });
}

/** Velcro rip: dense hook-and-loop crackle with a bright noise bed. */
export function rip(out: Float32Array, sr: number, r: Rand, t: number, dur: number, o: { gain?: number } = {}): void {
  const g = o.gain ?? 0.5;
  crackles(out, sr, r, {
    start: t,
    dur,
    rate: 950,
    gain: g,
    tau: 0.0006,
    filters: [{ type: 'hp', f: 1400, q: 0.7 }],
  });
  noiseLayer(out, sr, r, {
    start: t,
    dur,
    gain: g * 0.35,
    attack: dur * 0.15,
    tau: dur * 0.9,
    filters: [{ type: 'hp', f: 2200 }],
    am: { rate: 140, depth: 0.6 },
  });
}

/** Ringing metal object (pin, coin, brass, tool). */
export function ring(
  out: Float32Array,
  sr: number,
  r: Rand,
  t: number,
  f0: number,
  tau: number,
  gain: number,
  ratios: number[] = [1, 2.32, 4.25, 6.63],
): void {
  modalLayer(out, sr, r, {
    start: t,
    f0,
    gain,
    partials: ratios.map((ra, i) => [ra, 1 / (1 + i * 0.55), tau / (1 + i * 0.7)] as [number, number, number]),
    excite: 'noise',
    detune: 0.008,
  });
}

/** Low-pass air whoosh with a bell-shaped level. */
export function whoosh(
  out: Float32Array,
  sr: number,
  r: Rand,
  t: number,
  dur: number,
  o: { f0: number; f1: number; f2?: number; gain?: number; q?: number },
): void {
  // rising then falling band centre approximated with two layers so the sweep has a peak
  const mid = o.f1;
  const gain = o.gain ?? 0.5;
  noiseLayer(out, sr, r, {
    start: t,
    dur: dur * 0.55,
    gain,
    attack: dur * 0.3,
    tau: dur * 0.6,
    color: 'pink',
    filters: [{ type: 'bp', f: o.f0, f2: mid, q: o.q ?? 0.8 }],
  });
  noiseLayer(out, sr, r, {
    start: t + dur * 0.45,
    dur: dur * 0.55,
    gain: gain * 0.9,
    attack: 0.002,
    tau: dur * 0.35,
    color: 'pink',
    filters: [{ type: 'bp', f: mid, f2: o.f2 ?? o.f0 * 1.6, q: o.q ?? 0.8 }],
  });
}
