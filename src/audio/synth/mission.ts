/**
 * Mission, extraction and hazard cues: stingers, radio, flare, countdown, helicopter one-shots, siren and klaxon.
 * Stingers are deliberately short and military: brass-like saw stacks, taiko hits, bells, no melodies.
 */
import {
  type Ctx,
  SVF,
  TAU,
  alloc,
  crackles,
  echoTaps,
  filterInPlace,
  finalize,
  jit,
  noiseLayer,
  quantizeLoopFrequency,
  rr,
  sawBL,
  toneLayer,
} from './dsp';
import { clack, click, rustle, scrape, thud, whoosh } from './foley';
import { bell, brass, midi, taiko } from './notes';

export function contractNew(c: Ctx): Float32Array {
  const { sr, r } = c;
  const out = alloc(sr, 1.6);
  taiko(out, sr, r, 0, 0.8);
  const stab = (m: number, gain: number) =>
    brass(out, sr, r, { start: 0, dur: 0.4, release: 0.5, f: midi(m), gain, attack: 0.04, cutoff0: 380, cutoff1: 2300, sub: 0.35 });
  stab(45, 0.9);
  stab(52, 0.8);
  stab(57, 0.7);
  // radio "objective received" ping
  toneLayer(out, sr, r, { start: 0.55, dur: 0.3, gain: 0.32, f0: 1700, tau: 0.12, attack: 0.002 });
  toneLayer(out, sr, r, { start: 0.55, dur: 0.3, gain: 0.18, f0: 2550, tau: 0.09, attack: 0.002 });
  echoTaps(out, sr, [
    { t: 0.14, g: 0.22, lp: 2400 },
    { t: 0.3, g: 0.12, lp: 1600 },
  ]);
  return finalize(out, sr, { peak: 0.6, fadeOut: 0.2 });
}

export function contractComplete(c: Ctx): Float32Array {
  const { sr, r } = c;
  const out = alloc(sr, 2.2);
  [69, 73, 76, 81].forEach((m, i) => bell(out, sr, r, i * 0.11, midi(m), 0.85 - i * 0.05, 0.9));
  [45, 52, 57, 61].forEach((m, i) =>
    brass(out, sr, r, { start: 0.32, dur: 0.85, release: 0.7, f: midi(m), gain: 0.55 - i * 0.05, attack: 0.3, cutoff0: 300, cutoff1: 2600, sub: 0.3 }),
  );
  taiko(out, sr, r, 0.33, 0.6, 0.95);
  toneLayer(out, sr, r, { start: 0.33, dur: 0.9, gain: 0.5, f0: 55, f1: 46, tau: 0.5, attack: 0.01, drive: 1.3 });
  echoTaps(out, sr, [
    { t: 0.15, g: 0.24, lp: 3000 },
    { t: 0.31, g: 0.16, lp: 2200 },
    { t: 0.52, g: 0.1, lp: 1600 },
  ]);
  return finalize(out, sr, { peak: 0.65, fadeOut: 0.3 });
}

export function objectivePing(c: Ctx): Float32Array {
  const { sr, r } = c;
  const out = alloc(sr, 0.95);
  toneLayer(out, sr, r, { dur: 0.6, gain: 1, f0: 1320, tau: 0.28, attack: 0.002, harmonics: [0.22] });
  toneLayer(out, sr, r, { dur: 0.4, gain: 0.35, f0: 1980, tau: 0.18, attack: 0.002 });
  echoTaps(out, sr, [
    { t: 0.19, g: 0.32, lp: 3000 },
    { t: 0.38, g: 0.15, lp: 2200 },
  ]);
  return finalize(out, sr, { peak: 0.4, fadeOut: 0.12 });
}

export function defenseStart(c: Ctx): Float32Array {
  const { sr, r } = c;
  const out = alloc(sr, 2.0);
  toneLayer(out, sr, r, { dur: 1.3, gain: 0.5, f0: 55, f1: 220, tau: 1.2, attack: 0.15, harmonics: [0.5, 0.3, 0.15] });
  noiseLayer(out, sr, r, { dur: 1.25, gain: 0.3, attack: 0.4, tau: 0.8, filters: [{ type: 'bp', f: 400, f2: 2500, q: 3 }] });
  for (const t of [0.1, 0.45, 0.8]) {
    thud(out, sr, r, t, { f0: 150, f1: 75, tau: 0.03, gain: 0.5 });
    click(out, sr, r, t, { f: 2200, q: 2, tau: 0.004, gain: 0.5 });
  }
  for (let i = 0; i < 7; i++) {
    const f = [1200, 1800, 2400, 3200][Math.floor(r() * 4)]!;
    toneLayer(out, sr, r, { start: 0.85 + i * 0.09 + r() * 0.03, dur: 0.05, gain: 0.16, wave: 'square', f0: f, tau: 0.03, attack: 0.001 });
  }
  toneLayer(out, sr, r, { start: 1.25, dur: 0.6, gain: 0.7, f0: 82, f1: 50, tau: 0.13, attack: 0.004, drive: 1.5 });
  crackles(out, sr, r, { start: 1.2, dur: 0.6, rate: 120, rateTau: 0.3, gain: 0.18, tau: 0.001, filters: [{ type: 'hp', f: 4000 }] });
  return finalize(out, sr, { peak: 0.6, fadeOut: 0.2 });
}

export function radioChirp(c: Ctx): Float32Array {
  const { sr, r } = c;
  const out = alloc(sr, 0.62);
  noiseLayer(out, sr, r, { dur: 0.05, gain: 0.5, attack: 0.001, tau: 0.03, filters: [{ type: 'bp', f: 1800, q: 0.6 }] });
  toneLayer(out, sr, r, { start: 0.06, dur: 0.075, gain: 0.35, f0: 1400, tau: 0.5, attack: 0.003, drive: 1.3 });
  toneLayer(out, sr, r, { start: 0.15, dur: 0.1, gain: 0.35, f0: 1000, tau: 0.5, attack: 0.003, drive: 1.3 });
  noiseLayer(out, sr, r, { start: 0.28, dur: 0.06, gain: 0.35, attack: 0.001, tau: 0.03, filters: [{ type: 'bp', f: 2200, q: 0.6 }] });
  filterInPlace(out, sr, [
    { type: 'hp', f: 420 },
    { type: 'lp', f: 3400 },
  ]);
  return finalize(out, sr, { peak: 0.4, fadeOut: 0.05 });
}

export function flareIgnite(c: Ctx): Float32Array {
  const { sr, r } = c;
  const out = alloc(sr, 1.15);
  scrape(out, sr, r, 0, 0.14, { f0: 2500, f1: 4200, gain: 0.35, grit: 0.7, flutter: 80 });
  noiseLayer(out, sr, r, { start: 0.14, dur: 0.05, gain: 0.7, attack: 0.0004, tau: 0.012, filters: [{ type: 'hp', f: 900 }] });
  thud(out, sr, r, 0.14, { f0: 210, f1: 100, tau: 0.03, gain: 0.45 });
  whoosh(out, sr, r, 0.15, 0.55, { f0: 800, f1: 3000, f2: 1800, gain: 0.6 });
  crackles(out, sr, r, { start: 0.2, dur: 0.85, rate: 140, rateTau: 0.5, gain: 0.32, tau: 0.0018, filters: [{ type: 'hp', f: 2500 }] });
  noiseLayer(out, sr, r, { start: 0.2, dur: 0.9, gain: 0.25, attack: 0.15, tau: 0.5, color: 'pink', filters: [{ type: 'bp', f: 4000, q: 0.5 }] });
  return finalize(out, sr, { peak: 0.6, fadeOut: 0.2 });
}

export function countdownTick(c: Ctx): Float32Array {
  const { sr, r } = c;
  const out = alloc(sr, 0.14);
  toneLayer(out, sr, r, { dur: 0.09, gain: 0.8, f0: 1000, tau: 0.014, attack: 0.0008 });
  click(out, sr, r, 0, { f: 3000, q: 1.5, tau: 0.002, gain: 0.4 });
  return finalize(out, sr, { peak: 0.35, fadeOut: 0.03 });
}

export function countdownFinal(c: Ctx): Float32Array {
  const { sr, r } = c;
  const out = alloc(sr, 0.42);
  toneLayer(out, sr, r, { dur: 0.32, gain: 0.85, f0: 1600, tau: 0.16, attack: 0.003, harmonics: [0.2, 0.1] });
  toneLayer(out, sr, r, { dur: 0.32, gain: 0.3, f0: 800, tau: 0.16, attack: 0.003 });
  click(out, sr, r, 0, { f: 3500, q: 1.5, tau: 0.002, gain: 0.35 });
  return finalize(out, sr, { peak: 0.5, fadeOut: 0.08 });
}

export function heliLand(c: Ctx): Float32Array {
  const { sr, r } = c;
  const out = alloc(sr, 1.7);
  thud(out, sr, r, 0.05, { f0: 112, f1: 55, tau: 0.09, gain: 1.0, body: 0.6 });
  clack(out, sr, r, 0.05, { f: 1200, ring: 260, gain: 0.6, ringTau: 0.2 });
  scrape(out, sr, r, 0.06, 0.5, { f0: 900, f1: 500, gain: 0.4, grit: 0.7, flutter: 30 });
  toneLayer(out, sr, r, { start: 0.15, dur: 0.6, gain: 0.28, wave: 'saw', f0: 185, f1: 130, tau: 0.5, attack: 0.05, jitter: 0.4, drive: 1.2 });
  thud(out, sr, r, 0.32, { f0: 100, f1: 50, tau: 0.08, gain: 0.7, body: 0.6 });
  noiseLayer(out, sr, r, { dur: 1.6, gain: 0.35, attack: 0.05, tau: 0.6, color: 'pink', filters: [{ type: 'bp', f: 420, q: 0.5 }] });
  return finalize(out, sr, { peak: 0.65, fadeOut: 0.3 });
}

export function boarding(c: Ctx): Float32Array {
  const { sr, r } = c;
  const out = alloc(sr, 2.1);
  // sliding door on a rail
  noiseLayer(out, sr, r, {
    dur: 0.58,
    gain: 0.42,
    attack: 0.08,
    tau: 0.5,
    color: 'pink',
    filters: [{ type: 'bp', f: 700, f2: 900, q: 0.9 }],
    am: { rate: 34, depth: 0.55 },
  });
  clack(out, sr, r, 0.6, { f: 1500, ring: 420, gain: 0.85, ringGain: 0.6 });
  // boots on the metal floor
  [0.78, 1.02, 1.27].forEach((t, i) => {
    thud(out, sr, r, t, { f0: 150 - i * 6, f1: 80, tau: 0.03, gain: 0.55, body: 0.5 });
    click(out, sr, r, t, { f: 2300, q: 1.5, tau: 0.003, gain: 0.35 });
    noiseLayer(out, sr, r, { start: t, dur: 0.2, gain: 0.1, attack: 0.002, tau: 0.09, filters: [{ type: 'bp', f: 420, q: 5 }] });
  });
  // harness buckles
  click(out, sr, r, 1.52, { f: 3000, q: 3, tau: 0.003, gain: 0.4 });
  click(out, sr, r, 1.62, { f: 2600, q: 3, tau: 0.003, gain: 0.35 });
  rustle(out, sr, r, 1.4, 0.3, { gain: 0.16 });
  // door closes
  thud(out, sr, r, 1.78, { f0: 110, f1: 60, tau: 0.06, gain: 0.7 });
  clack(out, sr, r, 1.78, { f: 1300, ring: 380, gain: 0.7 });
  return finalize(out, sr, { peak: 0.56, fadeOut: 0.2 });
}

export function victorySting(c: Ctx): Float32Array {
  const { sr, r } = c;
  const out = alloc(sr, 4.4);
  const chord = (start: number, dur: number, rel: number, notes: number[], gain: number, attack: number, c1: number) => {
    notes.forEach((m, i) =>
      brass(out, sr, r, { start, dur, release: rel, f: midi(m), gain: gain - i * 0.03, attack, cutoff0: 320, cutoff1: c1, sub: i === 0 ? 0.4 : 0.1, vibrato: { rate: 5, depth: 0.004, delay: 0.3 } }),
    );
  };
  chord(0, 1.0, 0.6, [38, 45, 50, 53, 64], 0.7, 0.5, 2000); // Dm add9 - tension
  chord(1.1, 0.9, 0.5, [34, 41, 46, 50], 0.75, 0.3, 2300); // Bb - lift
  chord(2.1, 1.4, 1.1, [38, 45, 50, 54, 57, 62], 0.85, 0.22, 3200); // D major - resolve
  taiko(out, sr, r, 0, 0.9, 0.95);
  taiko(out, sr, r, 1.1, 0.6, 0.85);
  taiko(out, sr, r, 2.1, 1.0, 1.0);
  bell(out, sr, r, 2.15, midi(74), 0.5, 1.4);
  bell(out, sr, r, 2.25, midi(81), 0.35, 1.2);
  echoTaps(out, sr, [
    { t: 0.16, g: 0.25, lp: 2500 },
    { t: 0.34, g: 0.18, lp: 1800 },
    { t: 0.6, g: 0.12, lp: 1400 },
    { t: 0.95, g: 0.08, lp: 1000 },
  ]);
  return finalize(out, sr, { peak: 0.72, fadeOut: 0.6 });
}

export function defeatSting(c: Ctx): Float32Array {
  const { sr, r } = c;
  const out = alloc(sr, 3.6);
  brass(out, sr, r, { start: 0, dur: 2.2, release: 1.0, f: midi(38), gain: 1.0, attack: 0.5, cutoff0: 250, cutoff1: 900, sub: 0.5, glide: 0.94 });
  brass(out, sr, r, { start: 0.1, dur: 2.0, release: 1.0, f: midi(39), gain: 0.7, attack: 0.6, cutoff0: 250, cutoff1: 800, glide: 0.9 });
  brass(out, sr, r, { start: 0.4, dur: 1.6, release: 1.0, f: midi(57), gain: 0.45, attack: 0.8, cutoff0: 400, cutoff1: 1300, glide: 0.92 });
  brass(out, sr, r, { start: 0.4, dur: 1.6, release: 1.0, f: midi(58), gain: 0.4, attack: 0.8, cutoff0: 400, cutoff1: 1200, glide: 0.92 });
  const beat = (t: number, g: number) => toneLayer(out, sr, r, { start: t, dur: 0.3, gain: g, f0: 58, f1: 40, tau: 0.08, attack: 0.004, drive: 1.4 });
  beat(0.15, 0.9);
  beat(0.4, 0.7);
  beat(1.3, 0.6);
  beat(1.6, 0.4);
  taiko(out, sr, r, 0.9, 1.0, 0.7);
  noiseLayer(out, sr, r, { dur: 3.3, gain: 0.4, attack: 0.3, tau: 1.3, color: 'brown', filters: [{ type: 'lp', f: 100 }] });
  echoTaps(out, sr, [
    { t: 0.2, g: 0.25, lp: 1200 },
    { t: 0.45, g: 0.15, lp: 800 },
    { t: 0.8, g: 0.1, lp: 600 },
  ]);
  return finalize(out, sr, { peak: 0.7, fadeOut: 0.8 });
}

// -------------------------------------------------------------------------------------------------
// Hazard
// -------------------------------------------------------------------------------------------------

/**
 * Air-raid style siren buffer: frequency swings between `fLo` and `fHi` with `cycles` full up-down sweeps over `seconds`.
 * `loop` quantises the phase so the buffer repeats seamlessly.
 */
export function sirenBuffer(sr: number, seconds: number, cycles: number, fLo: number, fHi: number, loop: boolean): Float32Array {
  const n = Math.round(sr * seconds);
  const raw = new Float32Array(n);
  const f = (i: number): number => fLo + (fHi - fLo) * (0.5 - 0.5 * Math.cos((TAU * cycles * i) / n));
  let total = 0;
  for (let i = 0; i < n; i++) total += f(i) / sr;
  const scale = loop ? quantizeLoopFrequency(1, total) : 1;
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const fi = f(i) * scale;
    const dt = fi / sr;
    ph += dt;
    if (ph >= 1) ph -= 1;
    const saw = sawBL(ph, dt);
    const tri = 4 * Math.abs(ph - 0.5) - 1;
    raw[i] = saw * 0.55 + tri * 0.6 + Math.sin(TAU * ph * 2) * 0.2;
  }
  // horn-like band-limiting; two passes so the filter state is settled at the loop seam
  const svfHp = new SVF();
  const svfLp = new SVF();
  const out = new Float32Array(n);
  for (let pass = 0; pass < (loop ? 2 : 1); pass++) {
    for (let i = 0; i < n; i++) {
      if ((i & 15) === 0) {
        svfHp.set(260, 0.7, sr);
        svfLp.set(2600, 0.8, sr);
      }
      svfHp.run(raw[i]!);
      svfLp.run(svfHp.hp);
      out[i] = svfLp.lp;
    }
  }
  return out;
}

export function sirenWail(c: Ctx): Float32Array {
  const { sr, r } = c;
  const out = sirenBuffer(sr, 5.0, 1, 380, 720 + rr(r, -20, 20), false);
  const padded = new Float32Array(out.length + Math.round(sr * 0.6));
  padded.set(out);
  echoTaps(padded, sr, [
    { t: 0.22, g: 0.3, lp: 1800 },
    { t: 0.46, g: 0.15, lp: 1200 },
  ]);
  return finalize(padded, sr, { peak: 0.55, fadeIn: 0.15, fadeOut: 0.5 });
}

export function klaxon(c: Ctx): Float32Array {
  const { sr, r } = c;
  const out = alloc(sr, 1.15);
  for (const t of [0, 0.44]) {
    toneLayer(out, sr, r, { start: t, dur: 0.36, gain: 0.8, wave: 'saw', f0: 196, tau: 2, attack: 0.02, drive: 2.5 });
    toneLayer(out, sr, r, { start: t, dur: 0.36, gain: 0.7, wave: 'square', f0: 197.5, tau: 2, attack: 0.02, drive: 2.5 });
    toneLayer(out, sr, r, { start: t, dur: 0.36, gain: 0.3, wave: 'saw', f0: jit(r, 392, 0.002), tau: 2, attack: 0.02 });
  }
  filterInPlace(out, sr, [{ type: 'lp', f: 2800 }]);
  echoTaps(out, sr, [
    { t: 0.13, g: 0.25, lp: 1800 },
    { t: 0.29, g: 0.12, lp: 1200 },
  ]);
  return finalize(out, sr, { peak: 0.6, fadeIn: 0.01, fadeOut: 0.15 });
}
