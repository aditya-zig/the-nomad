/**
 * Musical building blocks for stingers and mission cues: brass-like saw stacks, bells, taiko drums, pads.
 * Layers use the shared scratch buffer, so these never nest.
 */
import { type Rand, SVF, TAU, getScratch, modalLayer, noiseLayer, sawBL, squareBL, toneLayer } from './dsp';

/** MIDI note number to Hz. */
export const midi = (n: number): number => 440 * Math.pow(2, (n - 69) / 12);

export interface BrassOpts {
  start: number;
  dur: number;
  f: number;
  gain: number;
  attack: number;
  release: number;
  cutoff0: number;
  cutoff1: number;
  /** Detune spread as a fraction (default 0.007). */
  detune?: number;
  vibrato?: { rate: number; depth: number; delay?: number };
  /** Adds a square sub-octave layer of this relative level. */
  sub?: number;
  /** Optional linear pitch drift (semitone ratio at the end, e.g. 0.94 = falls a semitone). */
  glide?: number;
}

/** Brass / synth-pad note: three detuned band-limited saws through a swept low-pass. */
export function brass(out: Float32Array, sr: number, r: Rand, o: BrassOpts): void {
  const i0 = Math.max(0, Math.round(o.start * sr));
  const n = Math.min(out.length - i0, Math.round((o.dur + o.release) * sr));
  if (n <= 2) return;
  const s = getScratch(n);
  const det = o.detune ?? 0.007;
  const phases = [r(), r(), r(), r()];
  const mults = [1, 1 + det, 1 - det * 0.8, 0.5];
  const svf = new SVF();
  const atk = Math.max(1, Math.round(o.attack * sr));
  const rel = Math.max(1, Math.round(o.release * sr));
  const dn = Math.round(o.dur * sr);
  let peak = 1e-9;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    if ((i & 15) === 0) {
      const u = Math.min(1, i / atk);
      svf.set(o.cutoff0 + (o.cutoff1 - o.cutoff0) * u * u, 0.9, sr);
    }
    let f = o.f * (o.glide ? 1 + (o.glide - 1) * (i / n) : 1);
    if (o.vibrato) {
      const vd = o.vibrato.delay ?? 0;
      const k = Math.min(1, Math.max(0, (t - vd) / 0.4));
      f *= 1 + o.vibrato.depth * k * Math.sin(TAU * o.vibrato.rate * t);
    }
    let x = 0;
    for (let k = 0; k < 3; k++) {
      const dt = (f * mults[k]!) / sr;
      phases[k] = phases[k]! + dt;
      if (phases[k]! >= 1) phases[k] = phases[k]! - 1;
      x += sawBL(phases[k]!, dt);
    }
    if (o.sub) {
      const dt = (f * mults[3]!) / sr;
      phases[3] = phases[3]! + dt;
      if (phases[3]! >= 1) phases[3] = phases[3]! - 1;
      x += squareBL(phases[3]!, dt) * o.sub * 3;
    }
    svf.run(x);
    let a = i < atk ? i / atk : 1;
    if (i > dn) a *= Math.max(0, 1 - (i - dn) / rel);
    const y = svf.lp * a;
    s[i] = y;
    const ay = y < 0 ? -y : y;
    if (ay > peak) peak = ay;
  }
  const g = o.gain / peak;
  for (let i = 0; i < n; i++) out[i0 + i] += s[i]! * g;
}

/** Struck bell / glockenspiel-like tone. */
export function bell(out: Float32Array, sr: number, r: Rand, t: number, f: number, gain: number, decay = 1): void {
  modalLayer(out, sr, r, {
    start: t,
    f0: f,
    gain,
    partials: [
      [1, 1, 1.3 * decay],
      [2.0, 0.5, 0.8 * decay],
      [2.76, 0.6, 0.6 * decay],
      [4.07, 0.3, 0.35 * decay],
      [5.4, 0.2, 0.22 * decay],
    ],
    excite: 'noise',
    detune: 0.003,
  });
}

/** Deep orchestral drum hit. */
export function taiko(out: Float32Array, sr: number, r: Rand, t: number, gain: number, pitch = 1): void {
  toneLayer(out, sr, r, { start: t, dur: 0.9, gain, f0: 104 * pitch, f1: 46 * pitch, tau: 0.17, attack: 0.002, drive: 1.6 });
  noiseLayer(out, sr, r, {
    start: t,
    dur: 0.3,
    gain: gain * 0.5,
    attack: 0.001,
    tau: 0.06,
    color: 'pink',
    filters: [{ type: 'lp', f: 650 }],
  });
  noiseLayer(out, sr, r, {
    start: t,
    dur: 0.06,
    gain: gain * 0.35,
    attack: 0.0004,
    tau: 0.012,
    filters: [{ type: 'bp', f: 1700, q: 1 }],
  });
}
