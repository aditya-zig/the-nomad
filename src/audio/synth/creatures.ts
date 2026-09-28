/**
 * Creature and human vocal recipes: zombies, the Warden, and the player's grunts, gasps and coughs.
 * Built with the formant `voice()` synthesiser (saw source -> parallel resonant band-passes) plus growl, breath and rasp.
 */
import {
  type Ctx,
  type Vowel,
  alloc,
  crackles,
  echoTaps,
  finalize,
  jit,
  modalLayer,
  noiseLayer,
  rr,
  sat,
  toneLayer,
  voice,
} from './dsp';
import { click, rustle, thud, whoosh } from './foley';

const GROAN_VOWELS: Vowel[][] = [
  ['o', 'a', 'u'],
  ['u', 'o', 'a'],
  ['uh', 'a', 'o'],
  ['o', 'uh', 'u'],
  ['a', 'o', 'u'],
];

/** Shambler moan: low, drawn-out, wavering, wet. */
export function zombieGroan(c: Ctx): Float32Array {
  const { sr, r, v } = c;
  const dur = 1.25 + r() * 0.75;
  const out = alloc(sr, dur + 0.06);
  const base = rr(r, 82, 108);
  const seq = GROAN_VOWELS[v % GROAN_VOWELS.length]!;
  voice(out, sr, r, {
    dur,
    f0: [
      [0, base * 0.96],
      [dur * 0.22, base * 1.1],
      [dur * 0.62, base * 0.94],
      [dur, base * 0.7],
    ],
    vowels: [
      [0, seq[0]!],
      [dur * 0.35, seq[1]!],
      [dur * 0.72, seq[2]!],
      [dur, seq[0]!],
    ],
    formantScale: rr(r, 0.9, 1.0),
    bw: [110, 140, 200],
    env: [
      [0, 0],
      [dur * 0.2, 1],
      [dur * 0.62, 0.86],
      [dur * 0.9, 0.3],
      [dur, 0],
    ],
    vibrato: { rate: rr(r, 4.2, 5.8), depth: 0.03 },
    jitter: 0.045,
    shimmer: 0.18,
    breath: 0.28,
    fry: { rate: rr(r, 24, 34), depth: 0.42, irregular: 0.5 },
    sub: 0.35,
    drive: 1.7,
    rasp: { f: 2100, q: 1.3, gain: 0.14 },
  });
  return finalize(out, sr, { peak: 0.62, fadeIn: 0.01, fadeOut: 0.06 });
}

/** Growl when a zombie notices the player. */
export function zombieAlert(c: Ctx): Float32Array {
  const { sr, r } = c;
  const dur = 0.8 + r() * 0.25;
  const out = alloc(sr, dur + 0.05);
  const base = rr(r, 80, 96);
  voice(out, sr, r, {
    dur,
    f0: [
      [0, base],
      [0.1, base * 1.6],
      [dur * 0.5, base * 1.25],
      [dur, base * 0.8],
    ],
    vowels: [
      [0, 'uh'],
      [0.15, 'a'],
      [dur * 0.65, 'a'],
      [dur, 'o'],
    ],
    formantScale: 0.95,
    bw: [120, 150, 210],
    env: [
      [0, 0],
      [0.035, 1],
      [dur * 0.55, 0.85],
      [dur, 0],
    ],
    vibrato: { rate: 6, depth: 0.02 },
    jitter: 0.06,
    shimmer: 0.25,
    breath: 0.32,
    fry: { rate: rr(r, 40, 52), depth: 0.6, irregular: 0.6 },
    sub: 0.4,
    drive: 3.2,
    rasp: { f: 2800, q: 1.0, gain: 0.26 },
  });
  return finalize(out, sr, { peak: 0.65, fadeIn: 0.004, fadeOut: 0.06 });
}

/** Runner snarl: higher, harsher, staccato. */
export function zombieSnarl(c: Ctx): Float32Array {
  const { sr, r } = c;
  const dur = 0.55 + r() * 0.2;
  const out = alloc(sr, dur + 0.05);
  const base = rr(r, 150, 215);
  voice(out, sr, r, {
    dur,
    f0: [
      [0, base],
      [dur * 0.3, base * 1.25],
      [dur, base * 0.78],
    ],
    vowels: [
      [0, 'ae'],
      [dur * 0.5, 'e'],
      [dur, 'uh'],
    ],
    formantScale: 1.05,
    bw: [130, 170, 240],
    env: [
      [0, 0],
      [0.03, 1],
      [dur * 0.28, 0.65],
      [dur * 0.33, 0.12],
      [dur * 0.4, 1],
      [dur * 0.7, 0.6],
      [dur * 0.78, 0.1],
      [dur * 0.84, 0.75],
      [dur, 0],
    ],
    jitter: 0.07,
    shimmer: 0.3,
    breath: 0.36,
    fry: { rate: rr(r, 50, 64), depth: 0.6, irregular: 0.5 },
    sub: 0.25,
    drive: 4,
    rasp: { f: 3200, q: 0.9, gain: 0.32 },
  });
  return finalize(out, sr, { peak: 0.6, fadeIn: 0.003, fadeOut: 0.05 });
}

/** Runner screech on noticing the player: shrill, wide-band, distorted. */
export function zombieScreech(c: Ctx): Float32Array {
  const { sr, r } = c;
  const dur = 0.85 + r() * 0.25;
  const out = alloc(sr, dur + 0.05);
  const base = rr(r, 330, 400);
  voice(out, sr, r, {
    dur,
    f0: [
      [0, base],
      [dur * 0.15, base * 1.55],
      [dur * 0.55, base * 1.75],
      [dur, base * 0.95],
    ],
    vowels: [
      [0, 'ae'],
      [dur * 0.3, 'i'],
      [dur, 'e'],
    ],
    formantScale: 1.05,
    bw: [180, 240, 320],
    env: [
      [0, 0],
      [0.05, 1],
      [dur * 0.6, 0.9],
      [dur, 0],
    ],
    vibrato: { rate: rr(r, 7.5, 9.5), depth: 0.045 },
    jitter: 0.06,
    shimmer: 0.25,
    breath: 0.3,
    fry: { rate: 58, depth: 0.35, irregular: 0.6 },
    drive: 5.5,
    rasp: { f: 4500, q: 0.8, gain: 0.3 },
  });
  return finalize(out, sr, { peak: 0.4, fadeIn: 0.004, fadeOut: 0.07 });
}

/** Armoured infected bellow: deep, resonant, with armour rattle. */
export function zombieBellow(c: Ctx): Float32Array {
  const { sr, r } = c;
  const dur = 1.35 + r() * 0.3;
  const out = alloc(sr, dur + 0.1);
  const base = rr(r, 54, 68);
  voice(out, sr, r, {
    dur,
    f0: [
      [0, base],
      [dur * 0.2, base * 1.15],
      [dur * 0.7, base * 1.02],
      [dur, base * 0.75],
    ],
    vowels: [
      [0, 'o'],
      [dur * 0.4, 'u'],
      [dur * 0.8, 'o'],
      [dur, 'u'],
    ],
    formantScale: 0.85,
    bw: [80, 100, 150],
    env: [
      [0, 0],
      [0.08, 1],
      [dur * 0.6, 0.85],
      [dur, 0],
    ],
    vibrato: { rate: 4.5, depth: 0.025 },
    jitter: 0.04,
    shimmer: 0.2,
    breath: 0.15,
    fry: { rate: 20, depth: 0.4, irregular: 0.4 },
    sub: 0.5,
    drive: 2.4,
    rasp: { f: 1600, q: 1, gain: 0.1 },
  });
  // armour plate rattle
  modalLayer(out, sr, r, {
    start: 0.03,
    f0: jit(r, 210, 0.15),
    gain: 0.4,
    partials: [
      [1, 1, 0.3],
      [2.4, 0.7, 0.16],
      [3.9, 0.5, 0.1],
      [5.7, 0.3, 0.06],
    ],
    excite: 'noise',
    detune: 0.02,
  });
  crackles(out, sr, r, { start: 0.04, dur: 0.22, rate: 110, rateTau: 0.1, gain: 0.16, tau: 0.002, filters: [{ type: 'bp', f: 1800, q: 0.8 }] });
  return finalize(out, sr, { peak: 0.72, fadeIn: 0.006, fadeOut: 0.08 });
}

/** The Warden's roar: colossal, layered, distorted. Also used for slam / charge wind-ups. */
export function wardenRoar(c: Ctx): Float32Array {
  const { sr, r } = c;
  const D = 2.4 + r() * 0.2;
  const out = alloc(sr, D + 0.3);
  const layer = (mul: number, gain: number, drive: number, vow: [Vowel, Vowel, Vowel]) => {
    voice(out, sr, r, {
      dur: D,
      gain,
      f0: [
        [0, 50 * mul],
        [0.3, 74 * mul],
        [1.5, 66 * mul],
        [D, 36 * mul],
      ],
      vowels: [
        [0, vow[0]],
        [0.7, vow[1]],
        [1.6, vow[2]],
        [D, vow[1]],
      ],
      formantScale: 0.85,
      bw: [100, 130, 190],
      env: [
        [0, 0],
        [0.14, 1],
        [D * 0.7, 0.9],
        [D, 0],
      ],
      jitter: 0.05,
      shimmer: 0.2,
      breath: 0.2,
      fry: { rate: rr(r, 15, 20), depth: 0.5, irregular: 0.4 },
      sub: 0.6,
      drive,
      rasp: { f: 1500, q: 0.8, gain: 0.25 },
    });
  };
  layer(1, 1.0, 5, ['a', 'o', 'u']);
  layer(1.49, 0.7, 4, ['uh', 'a', 'o']);
  layer(2.03, 0.42, 3.5, ['e', 'a', 'uh']);
  noiseLayer(out, sr, r, {
    start: 0.05,
    dur: D - 0.1,
    gain: 0.5,
    attack: 0.15,
    tau: 1.4,
    color: 'pink',
    filters: [{ type: 'bp', f: 900, f2: 1400, q: 0.5 }],
    am: { rate: 21, depth: 0.5 },
  });
  toneLayer(out, sr, r, { dur: D - 0.1, gain: 0.7, f0: 46, f1: 30, tau: 1.2, attack: 0.1, drive: 1.5 });
  echoTaps(out, sr, [
    { t: 0.18, g: 0.25, lp: 900 },
    { t: 0.4, g: 0.15, lp: 700 },
  ]);
  for (let i = 0; i < out.length; i++) out[i] = sat(out[i]! * 1.5);
  return finalize(out, sr, { peak: 0.74, fadeIn: 0.01, fadeOut: 0.15 });
}

/** Warden ground slam: sub boom, debris, metal rattle. */
export function wardenSlam(c: Ctx): Float32Array {
  const { sr, r } = c;
  const out = alloc(sr, 1.3);
  toneLayer(out, sr, r, { dur: 1.0, gain: 0.75, f0: 78, f1: 28, tau: 0.28, attack: 0.003, drive: 2.5 });
  noiseLayer(out, sr, r, {
    dur: 0.6,
    gain: 1.0,
    attack: 0.001,
    tau: 0.16,
    color: 'white',
    filters: [{ type: 'lp', f: 1800, f2: 200 }],
  });
  noiseLayer(out, sr, r, { dur: 0.06, gain: 0.5, attack: 0.0004, tau: 0.02, filters: [{ type: 'hp', f: 800 }] });
  noiseLayer(out, sr, r, { start: 0.02, dur: 1.1, gain: 0.4, attack: 0.02, tau: 0.5, color: 'brown', filters: [{ type: 'lp', f: 130 }] });
  crackles(out, sr, r, { start: 0.1, dur: 0.9, rate: 70, rateTau: 0.35, gain: 0.25, tau: 0.004, filters: [{ type: 'bp', f: 1500, q: 0.6 }] });
  modalLayer(out, sr, r, {
    start: 0.02,
    f0: 160,
    gain: 0.3,
    partials: [
      [1, 1, 0.35],
      [2.3, 0.6, 0.2],
      [4.1, 0.4, 0.12],
    ],
    excite: 'noise',
    detune: 0.02,
  });
  for (let i = 0; i < 5; i++) thud(out, sr, r, 0.15 + r() * 0.7, { f0: rr(r, 90, 150), f1: 55, tau: 0.03, gain: 0.12, body: 0.8 });
  for (let i = 0; i < out.length; i++) out[i] = sat(out[i]! * 1.4);
  return finalize(out, sr, { peak: 0.92, fadeOut: 0.2 });
}

/** Swipe: whoosh plus a short guttural grunt. */
export function zombieAttack(c: Ctx): Float32Array {
  const { sr, r } = c;
  const out = alloc(sr, 0.45);
  whoosh(out, sr, r, 0.0, 0.26, { f0: 420, f1: 2200, f2: 800, gain: 0.5 });
  rustle(out, sr, r, 0.0, 0.16, { gain: 0.16, lo: 600, hi: 2400 });
  const base = rr(r, 100, 130);
  voice(out, sr, r, {
    start: 0.04,
    dur: 0.22,
    gain: 0.75,
    f0: [
      [0, base],
      [0.22, base * 0.75],
    ],
    vowels: [
      [0, 'a'],
      [0.22, 'o'],
    ],
    bw: [120, 150, 200],
    env: [
      [0, 0],
      [0.03, 1],
      [0.22, 0],
    ],
    breath: 0.4,
    jitter: 0.05,
    fry: { rate: 45, depth: 0.5 },
    drive: 2.5,
    rasp: { f: 2400, q: 1, gain: 0.2 },
  });
  return finalize(out, sr, { peak: 0.5, fadeIn: 0.004, fadeOut: 0.06 });
}

/** Claw landing on the player: cloth slap, thump and a small tear. */
export function zombieClawHit(c: Ctx): Float32Array {
  const { sr, r } = c;
  const out = alloc(sr, 0.3);
  thud(out, sr, r, 0, { f0: jit(r, 150, 0.1), f1: 85, tau: 0.035, gain: 0.9, body: 0.6 });
  noiseLayer(out, sr, r, { dur: 0.09, gain: 0.7, attack: 0.0005, tau: 0.018, filters: [{ type: 'bp', f: 1200, q: 0.8 }] });
  noiseLayer(out, sr, r, { start: 0.008, dur: 0.1, gain: 0.25, tau: 0.03, filters: [{ type: 'hp', f: 3000 }] });
  click(out, sr, r, 0.02, { f: 1800, q: 1, tau: 0.008, gain: 0.25 });
  return finalize(out, sr, { peak: 0.56, fadeOut: 0.06 });
}

export function zombieHurt(c: Ctx): Float32Array {
  const { sr, r } = c;
  const dur = 0.32 + r() * 0.1;
  const out = alloc(sr, dur + 0.04);
  const base = rr(r, 108, 148);
  voice(out, sr, r, {
    dur,
    f0: [
      [0, base * 1.1],
      [dur, base * 0.7],
    ],
    vowels: [
      [0, 'o'],
      [dur * 0.5, 'a'],
      [dur, 'uh'],
    ],
    bw: [110, 140, 200],
    env: [
      [0, 0],
      [0.02, 1],
      [dur * 0.6, 0.7],
      [dur, 0],
    ],
    breath: 0.22,
    jitter: 0.05,
    shimmer: 0.2,
    fry: { rate: rr(r, 30, 42), depth: 0.35 },
    sub: 0.3,
    drive: 2.2,
    rasp: { f: 2000, q: 1.2, gain: 0.16 },
  });
  return finalize(out, sr, { peak: 0.5, fadeIn: 0.004, fadeOut: 0.05 });
}

/** Death rattle: falling gargle, wet crackle, body collapse. */
export function zombieDeath(c: Ctx): Float32Array {
  const { sr, r } = c;
  const out = alloc(sr, 1.75);
  const base = rr(r, 105, 130);
  voice(out, sr, r, {
    dur: 1.1,
    f0: [
      [0, base],
      [0.5, base * 0.72],
      [1.1, base * 0.36],
    ],
    vowels: [
      [0, 'a'],
      [0.5, 'o'],
      [1.1, 'u'],
    ],
    bw: [110, 140, 200],
    env: [
      [0, 0],
      [0.05, 1],
      [0.7, 0.75],
      [1.1, 0],
    ],
    breath: 0.35,
    jitter: 0.07,
    shimmer: 0.3,
    fry: { rate: 20, depth: 0.85, irregular: 0.7 },
    sub: 0.4,
    drive: 2,
    rasp: { f: 1800, q: 1, gain: 0.3 },
  });
  crackles(out, sr, r, { start: 0.1, dur: 1.0, rate: 90, rateTau: 0.7, gain: 0.18, tau: 0.002, filters: [{ type: 'bp', f: 800, q: 1 }] });
  rustle(out, sr, r, 1.0, 0.35, { gain: 0.3, lo: 300, hi: 2200 });
  thud(out, sr, r, 1.08 + rr(r, -0.02, 0.03), { f0: 105, f1: 48, tau: 0.07, gain: 0.7, body: 0.7, bodyF: 600 });
  return finalize(out, sr, { peak: 0.56, fadeIn: 0.005, fadeOut: 0.12 });
}

// -------------------------------------------------------------------------------------------------
// Player
// -------------------------------------------------------------------------------------------------

export function playerHurt(c: Ctx): Float32Array {
  const { sr, r } = c;
  const dur = 0.3 + r() * 0.06;
  const out = alloc(sr, dur + 0.05);
  const base = rr(r, 112, 135);
  voice(out, sr, r, {
    dur,
    gain: 1,
    f0: [
      [0, base * 1.12],
      [dur, base * 0.8],
    ],
    vowels: [
      [0, 'uh'],
      [dur, 'o'],
    ],
    bw: [90, 120, 180],
    env: [
      [0, 0],
      [0.015, 1],
      [dur * 0.5, 0.8],
      [dur, 0],
    ],
    breath: 0.25,
    jitter: 0.03,
    shimmer: 0.12,
    drive: 1.8,
  });
  thud(out, sr, r, 0, { f0: 125, f1: 70, tau: 0.03, gain: 0.4, body: 0.6 });
  return finalize(out, sr, { peak: 0.55, fadeIn: 0.004, fadeOut: 0.05 });
}

export function playerDeath(c: Ctx): Float32Array {
  const { sr, r } = c;
  const out = alloc(sr, 1.9);
  // sharp inhale
  noiseLayer(out, sr, r, {
    dur: 0.35,
    gain: 0.35,
    attack: 0.12,
    tau: 0.3,
    color: 'pink',
    filters: [{ type: 'bp', f: 900, f2: 2100, q: 0.8 }],
  });
  voice(out, sr, r, {
    start: 0.32,
    dur: 0.95,
    f0: [
      [0, 135],
      [0.9, 62],
    ],
    vowels: [
      [0, 'a'],
      [0.9, 'o'],
    ],
    bw: [100, 130, 190],
    env: [
      [0, 0],
      [0.06, 1],
      [0.5, 0.7],
      [0.95, 0],
    ],
    breath: 0.35,
    jitter: 0.05,
    shimmer: 0.2,
    fry: { rate: 18, depth: 0.5 },
    drive: 1.6,
  });
  rustle(out, sr, r, 1.15, 0.4, { gain: 0.3 });
  thud(out, sr, r, 1.25, { f0: 95, f1: 45, tau: 0.08, gain: 0.9, body: 0.6 });
  click(out, sr, r, 1.3, { f: 2400, q: 1.5, tau: 0.01, gain: 0.2 });
  return finalize(out, sr, { peak: 0.56, fadeIn: 0.01, fadeOut: 0.15 });
}

/** Choking cough from toxin exposure: a burst of three. */
export function cough(c: Ctx): Float32Array {
  const { sr, r } = c;
  const out = alloc(sr, 0.85);
  const times = [0, 0.17 + rr(r, -0.02, 0.03), 0.35 + rr(r, -0.02, 0.04)];
  times.forEach((t, k) => {
    const base = rr(r, 135, 170) * (1 - k * 0.06);
    voice(out, sr, r, {
      start: t,
      dur: 0.14,
      gain: 1 - k * 0.15,
      f0: [
        [0, base * 1.1],
        [0.14, base * 0.75],
      ],
      vowels: [
        [0, 'a'],
        [0.14, 'uh'],
      ],
      bw: [130, 170, 230],
      env: [
        [0, 0],
        [0.008, 1],
        [0.06, 0.45],
        [0.14, 0],
      ],
      breath: 0.75,
      jitter: 0.06,
      drive: 2,
    });
    noiseLayer(out, sr, r, {
      start: t,
      dur: 0.12,
      gain: 0.5,
      attack: 0.004,
      tau: 0.04,
      filters: [{ type: 'bp', f: 1500, q: 0.8 }],
    });
  });
  rustle(out, sr, r, 0.5, 0.25, { gain: 0.15 });
  return finalize(out, sr, { peak: 0.5, fadeOut: 0.08 });
}

export function playerJump(c: Ctx): Float32Array {
  const { sr, r } = c;
  const out = alloc(sr, 0.32);
  noiseLayer(out, sr, r, {
    dur: 0.22,
    gain: 0.4,
    attack: 0.04,
    tau: 0.08,
    color: 'pink',
    filters: [{ type: 'bp', f: 1500, f2: 1900, q: 0.7 }],
  });
  rustle(out, sr, r, 0, 0.2, { gain: 0.3 });
  return finalize(out, sr, { peak: 0.3, fadeOut: 0.08 });
}

export function playerLand(c: Ctx): Float32Array {
  const { sr, r } = c;
  const out = alloc(sr, 0.4);
  toneLayer(out, sr, r, { dur: 0.3, gain: 1.0, f0: 96, f1: 46, tau: 0.07, attack: 0.002, drive: 1.5 });
  noiseLayer(out, sr, r, { dur: 0.2, gain: 0.6, attack: 0.001, tau: 0.05, color: 'pink', filters: [{ type: 'lp', f: 520 }] });
  rustle(out, sr, r, 0.01, 0.22, { gain: 0.32, lo: 800, hi: 4500 });
  crackles(out, sr, r, { start: 0.02, dur: 0.16, rate: 80, rateTau: 0.06, gain: 0.16, tau: 0.002, filters: [{ type: 'bp', f: 3200, q: 1 }] });
  return finalize(out, sr, { peak: 0.5, fadeOut: 0.08 });
}
