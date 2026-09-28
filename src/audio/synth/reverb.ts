/**
 * Synthetic room impulse responses for the two convolution reverbs: a wide sparse outdoor tail (echoing off buildings)
 * and a short dense indoor room.
 */
import { NoiseSrc, TAU, mulberry32 } from './dsp';

export interface ImpulseSpec {
  seconds: number;
  /** Time (s) for the tail to decay by 60 dB. */
  rt60: number;
  /** One-pole low-pass cutoff at the start / end of the tail: the tail darkens as it decays. */
  lpStart: number;
  lpEnd: number;
  /** Fraction of samples carrying energy at the start and end (low = sparse, grainy tail). */
  densityStart: number;
  densityEnd: number;
  /** Time over which density moves from start to end. */
  densityTime: number;
  /** Early reflections: [time (s), gain]. */
  early: [number, number][];
  seed: number;
}

export const OUTDOOR_IR: ImpulseSpec = {
  seconds: 2.8,
  rt60: 2.4,
  lpStart: 6500,
  lpEnd: 700,
  densityStart: 0.1,
  densityEnd: 0.65,
  densityTime: 1.4,
  early: [
    [0.038, 0.5],
    [0.071, 0.38],
    [0.109, 0.3],
    [0.163, 0.22],
    [0.24, 0.15],
    [0.34, 0.1],
  ],
  seed: 0x0a11ce,
};

export const INDOOR_IR: ImpulseSpec = {
  seconds: 0.9,
  rt60: 0.55,
  lpStart: 9000,
  lpEnd: 2000,
  densityStart: 0.55,
  densityEnd: 1,
  densityTime: 0.2,
  early: [
    [0.004, 0.6],
    [0.007, 0.5],
    [0.011, 0.45],
    [0.017, 0.35],
    [0.023, 0.3],
    [0.031, 0.22],
  ],
  seed: 0x1d0075,
};

/** Returns [left, right] channels. */
export function makeImpulse(sr: number, spec: ImpulseSpec): [Float32Array, Float32Array] {
  const n = Math.round(spec.seconds * sr);
  const chans: Float32Array[] = [];
  for (let ch = 0; ch < 2; ch++) {
    const r = mulberry32(spec.seed + ch * 7919);
    const src = new NoiseSrc('white', r);
    const ir = new Float32Array(n);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const env = Math.exp((-6.9078 * t) / spec.rt60);
      const dens = spec.densityStart + (spec.densityEnd - spec.densityStart) * Math.min(1, t / spec.densityTime);
      const x = r() < dens ? src.next() / Math.sqrt(dens) : 0;
      const cutoff = spec.lpStart * Math.pow(spec.lpEnd / spec.lpStart, Math.min(1, t / spec.seconds));
      const a = 1 - Math.exp((-TAU * cutoff) / sr);
      lp += (x - lp) * a;
      ir[i] = lp * env;
    }
    // early reflections (slightly different times per channel for width)
    for (const [t, g] of spec.early) {
      const idx = Math.round((t * (ch === 0 ? 1 : 1.07) + (r() - 0.5) * 0.004) * sr);
      if (idx > 0 && idx < n) ir[idx] += g * (r() < 0.5 ? -1 : 1) * 2;
    }
    const fade = Math.round(0.05 * n);
    for (let i = 0; i < fade; i++) ir[n - 1 - i] = ir[n - 1 - i]! * (i / fade);
    const fin = Math.round(0.001 * sr);
    for (let i = 0; i < fin; i++) ir[i] = ir[i]! * (i / fin);
    chans.push(ir);
  }
  return [chans[0]!, chans[1]!];
}
