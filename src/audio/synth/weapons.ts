/**
 * Weapon, reload and explosive sound recipes.
 * A gunshot = razor transient "crack" + supersonic "snap" + mid blast body + low thump + decaying tail + slap-back echoes.
 */
import { type Ctx, alloc, crackles, echoTaps, finalize, jit, noiseLayer, rr, sat, toneLayer } from './dsp';
import { click, clack, ring, rip, rustle, scrape, thud, whoosh } from './foley';

type GunKind = 'rifle' | 'pistol' | 'shotgun';

interface GunParams {
  dur: number;
  crack: { g: number; tau: number; hp: number };
  snap: { g: number; tau: number; hp: number };
  body: { g: number; tau: number; f: number; f2: number; q: number; dur: number; lp: boolean; color: 'white' | 'pink' };
  thump: { g: number; f0: number; f1: number; tau: number; dur: number; drive: number };
  mid: { g: number; f0: number; f1: number; tau: number; dur: number };
  tail: { g: number; f0: number; f1: number; dur: number; tau: number };
  boom2?: { at: number; g: number; f0: number; f1: number; tau: number };
  echo: { t: number; g: number; lp: number }[];
  peak: number;
  clip: number;
}

const GUNS: Record<GunKind, GunParams> = {
  rifle: {
    dur: 0.62,
    crack: { g: 1.0, tau: 0.0042, hp: 1900 },
    snap: { g: 0.55, tau: 0.0014, hp: 5200 },
    body: { g: 1.0, tau: 0.045, f: 2600, f2: 480, q: 0.8, dur: 0.24, lp: false, color: 'white' },
    thump: { g: 0.62, f0: 175, f1: 62, tau: 0.045, dur: 0.24, drive: 1.6 },
    mid: { g: 0.5, f0: 380, f1: 170, tau: 0.035, dur: 0.12 },
    tail: { g: 0.36, f0: 3800, f1: 380, dur: 0.52, tau: 0.16 },
    echo: [
      { t: 0.085, g: 0.16, lp: 1800 },
      { t: 0.19, g: 0.08, lp: 1200 },
    ],
    peak: 0.86,
    clip: 1.5,
  },
  pistol: {
    dur: 0.42,
    crack: { g: 1.0, tau: 0.0028, hp: 2600 },
    snap: { g: 0.7, tau: 0.0012, hp: 6000 },
    body: { g: 0.9, tau: 0.016, f: 3200, f2: 900, q: 0.8, dur: 0.09, lp: false, color: 'white' },
    thump: { g: 0.42, f0: 240, f1: 95, tau: 0.028, dur: 0.12, drive: 1.4 },
    mid: { g: 0.25, f0: 520, f1: 230, tau: 0.016, dur: 0.07 },
    tail: { g: 0.2, f0: 5000, f1: 500, dur: 0.3, tau: 0.09 },
    echo: [{ t: 0.07, g: 0.12, lp: 2200 }],
    peak: 0.73,
    clip: 1.3,
  },
  shotgun: {
    dur: 1.15,
    crack: { g: 0.85, tau: 0.012, hp: 700 },
    snap: { g: 0.6, tau: 0.003, hp: 3000 },
    body: { g: 1.0, tau: 0.12, f: 4200, f2: 450, q: 0.7, dur: 0.55, lp: true, color: 'white' },
    thump: { g: 0.8, f0: 115, f1: 34, tau: 0.2, dur: 0.62, drive: 2.4 },
    mid: { g: 0.7, f0: 210, f1: 95, tau: 0.06, dur: 0.2 },
    tail: { g: 0.5, f0: 3000, f1: 220, dur: 0.98, tau: 0.33 },
    boom2: { at: 0.09, g: 0.35, f0: 85, f1: 30, tau: 0.25 },
    echo: [
      { t: 0.11, g: 0.22, lp: 1500 },
      { t: 0.24, g: 0.13, lp: 1000 },
      { t: 0.4, g: 0.07, lp: 700 },
    ],
    peak: 0.93,
    clip: 1.8,
  },
};

export function gunshot(c: Ctx, kind: GunKind, upgraded: boolean): Float32Array {
  const { sr, r } = c;
  const P = GUNS[kind];
  const out = alloc(sr, P.dur);
  const j = (v: number, f = 0.07) => jit(r, v, f);
  noiseLayer(out, sr, r, {
    dur: 0.05,
    gain: P.crack.g,
    attack: 0.0003,
    tau: j(P.crack.tau),
    filters: [{ type: 'hp', f: j(P.crack.hp), q: 0.7 }],
  });
  noiseLayer(out, sr, r, {
    dur: 0.02,
    gain: P.snap.g,
    attack: 0.0002,
    tau: P.snap.tau,
    filters: [{ type: 'hp', f: j(P.snap.hp), q: 0.8 }],
  });
  noiseLayer(out, sr, r, {
    start: 0.0012,
    dur: P.body.dur,
    gain: P.body.g,
    attack: 0.001,
    tau: j(P.body.tau),
    color: P.body.color,
    filters: [{ type: P.body.lp ? 'lp' : 'bp', f: j(P.body.f), f2: P.body.f2, q: P.body.q }],
  });
  toneLayer(out, sr, r, {
    dur: P.thump.dur,
    gain: P.thump.g,
    f0: j(P.thump.f0),
    f1: P.thump.f1,
    tau: j(P.thump.tau),
    attack: 0.0012,
    drive: P.thump.drive,
  });
  toneLayer(out, sr, r, { dur: P.mid.dur, gain: P.mid.g, f0: j(P.mid.f0), f1: P.mid.f1, tau: P.mid.tau, attack: 0.001 });
  if (P.boom2) {
    toneLayer(out, sr, r, {
      start: P.boom2.at,
      dur: 0.5,
      gain: P.boom2.g,
      f0: P.boom2.f0,
      f1: P.boom2.f1,
      tau: P.boom2.tau,
      attack: 0.006,
      drive: 1.6,
    });
  }
  noiseLayer(out, sr, r, {
    start: 0.012,
    dur: P.tail.dur,
    gain: P.tail.g,
    attack: 0.006,
    tau: j(P.tail.tau, 0.1),
    color: 'pink',
    filters: [{ type: 'lp', f: P.tail.f0, f2: P.tail.f1, q: 0.7 }],
  });
  if (upgraded) {
    const hiScale = kind === 'pistol' ? 1.25 : kind === 'shotgun' ? 0.85 : 1;
    // energetic crackle + rising whine + ring: an "overcharged" signature layer
    crackles(out, sr, r, {
      start: 0.004,
      dur: kind === 'shotgun' ? 0.24 : 0.16,
      rate: 620,
      rateTau: 0.07,
      gain: 0.3,
      tau: 0.0012,
      filters: [{ type: 'hp', f: 4200 * hiScale }],
    });
    toneLayer(out, sr, r, {
      start: 0.002,
      dur: 0.18,
      gain: 0.24,
      f0: 700 * hiScale,
      f1: 3400 * hiScale,
      tau: 0.06,
      attack: 0.004,
      harmonics: [0.35, 0.15],
      fm: { ratio: 2.01, depth: 1.4 },
    });
    ring(out, sr, r, 0.003, 2350 * hiScale, 0.09, 0.22, [1, 1.51, 2.76]);
    toneLayer(out, sr, r, {
      dur: 0.3,
      gain: 0.35,
      f0: kind === 'pistol' ? 110 : 80,
      f1: 38,
      tau: 0.09,
      attack: 0.002,
      drive: 2,
    });
  }
  echoTaps(out, sr, P.echo);
  // gentle saturation glues the layers and adds punch
  const k = P.clip;
  for (let i = 0; i < out.length; i++) out[i] = sat(out[i]! * k);
  return finalize(out, sr, { peak: upgraded ? Math.min(0.95, P.peak + 0.02) : P.peak, fadeOut: 0.05 });
}

// -------------------------------------------------------------------------------------------------
// Mechanical foley
// -------------------------------------------------------------------------------------------------

export function dryFire(c: Ctx): Float32Array {
  const { sr, r } = c;
  const out = alloc(sr, 0.16);
  click(out, sr, r, 0, { f: jit(r, 2400, 0.1), q: 4, tau: 0.004, gain: 0.9 });
  thud(out, sr, r, 0, { f0: 320, f1: 190, tau: 0.012, gain: 0.5, body: 0.3, bodyF: 900 });
  click(out, sr, r, 0.055, { f: 1700, q: 3, tau: 0.003, gain: 0.25 });
  return finalize(out, sr, { peak: 0.5, fadeOut: 0.03 });
}

export function rifleMagOut(c: Ctx): Float32Array {
  const { sr, r } = c;
  const out = alloc(sr, 0.5);
  click(out, sr, r, 0, { f: 3000, q: 2.5, tau: 0.003, gain: 0.5 });
  scrape(out, sr, r, 0.03, 0.13, { f0: 1800, f1: 900, gain: 0.32, grit: 0.6 });
  clack(out, sr, r, 0.17 + rr(r, -0.01, 0.01), { f: 1500, ring: 620, gain: 0.55 });
  thud(out, sr, r, 0.19, { f0: 200, f1: 110, tau: 0.02, gain: 0.3 });
  // rounds rattling in the magazine
  crackles(out, sr, r, { start: 0.2, dur: 0.16, rate: 90, rateTau: 0.06, gain: 0.14, tau: 0.002, filters: [{ type: 'bp', f: 3400, q: 1 }] });
  return finalize(out, sr, { peak: 0.5, fadeOut: 0.04 });
}

export function rifleMagIn(c: Ctx): Float32Array {
  const { sr, r } = c;
  const out = alloc(sr, 0.5);
  scrape(out, sr, r, 0, 0.15, { f0: 900, f1: 2300, gain: 0.28, grit: 0.5 });
  thud(out, sr, r, 0.155, { f0: 220, f1: 105, tau: 0.04, gain: 0.85 });
  clack(out, sr, r, 0.155, { f: 2200, ring: 950, gain: 0.7 });
  click(out, sr, r, 0.245 + rr(r, 0, 0.02), { f: 3200, q: 3, tau: 0.003, gain: 0.4 });
  return finalize(out, sr, { peak: 0.6, fadeOut: 0.05 });
}

export function rifleBolt(c: Ctx): Float32Array {
  const { sr, r } = c;
  const out = alloc(sr, 0.5);
  scrape(out, sr, r, 0, 0.14, { f0: 1300, f1: 1000, gain: 0.34, grit: 0.85, flutter: 62 });
  click(out, sr, r, 0.15, { f: 2600, q: 3, tau: 0.003, gain: 0.3 });
  clack(out, sr, r, 0.19, { f: 1800, ring: 700, gain: 1.0, ringGain: 0.55 });
  thud(out, sr, r, 0.19, { f0: 150, f1: 80, tau: 0.03, gain: 0.6 });
  ring(out, sr, r, 0.2, 1900, 0.06, 0.16, [1, 2.4]);
  return finalize(out, sr, { peak: 0.66, fadeOut: 0.06 });
}

export function pistolMagOut(c: Ctx): Float32Array {
  const { sr, r } = c;
  const out = alloc(sr, 0.36);
  click(out, sr, r, 0, { f: 3500, q: 2.5, tau: 0.003, gain: 0.5 });
  scrape(out, sr, r, 0.025, 0.09, { f0: 2600, f1: 1500, gain: 0.26, grit: 0.55 });
  clack(out, sr, r, 0.12, { f: 2600, ring: 900, gain: 0.5 });
  thud(out, sr, r, 0.135, { f0: 260, f1: 140, tau: 0.018, gain: 0.25 });
  return finalize(out, sr, { peak: 0.45, fadeOut: 0.04 });
}

export function pistolMagIn(c: Ctx): Float32Array {
  const { sr, r } = c;
  const out = alloc(sr, 0.34);
  scrape(out, sr, r, 0, 0.08, { f0: 1500, f1: 2800, gain: 0.24, grit: 0.5 });
  thud(out, sr, r, 0.09, { f0: 260, f1: 130, tau: 0.03, gain: 0.7 });
  clack(out, sr, r, 0.09, { f: 3000, ring: 1250, gain: 0.65 });
  click(out, sr, r, 0.16, { f: 3600, q: 3, tau: 0.003, gain: 0.3 });
  return finalize(out, sr, { peak: 0.5, fadeOut: 0.05 });
}

export function pistolSlide(c: Ctx): Float32Array {
  const { sr, r } = c;
  const out = alloc(sr, 0.34);
  scrape(out, sr, r, 0, 0.09, { f0: 2000, f1: 3500, gain: 0.3, grit: 0.7, flutter: 70 });
  clack(out, sr, r, 0.13, { f: 2600, ring: 1500, gain: 0.95, ringGain: 0.5, ringTau: 0.05 });
  thud(out, sr, r, 0.13, { f0: 300, f1: 160, tau: 0.02, gain: 0.35 });
  return finalize(out, sr, { peak: 0.55, fadeOut: 0.05 });
}

export function shotgunShellIn(c: Ctx): Float32Array {
  const { sr, r } = c;
  const out = alloc(sr, 0.24);
  click(out, sr, r, 0, { f: 2000, q: 1.8, tau: 0.006, gain: 0.5 });
  thud(out, sr, r, 0.03, { f0: jit(r, 300, 0.05), f1: 190, tau: 0.03, gain: 0.55 });
  ring(out, sr, r, 0.03, 650, 0.08, 0.35, [1, 2.2, 3.9]);
  click(out, sr, r, 0.11, { f: 1500, q: 2, tau: 0.004, gain: 0.25 });
  return finalize(out, sr, { peak: 0.45, fadeOut: 0.04 });
}

export function shotgunPump(c: Ctx): Float32Array {
  const { sr, r } = c;
  const out = alloc(sr, 0.62);
  // back stroke
  scrape(out, sr, r, 0, 0.14, { f0: 900, f1: 620, gain: 0.34, grit: 0.8, flutter: 40 });
  click(out, sr, r, 0.15, { f: 1600, q: 2, tau: 0.004, gain: 0.35 });
  // forward stroke and lock
  scrape(out, sr, r, 0.24, 0.09, { f0: 700, f1: 1100, gain: 0.42, grit: 0.6, flutter: 55 });
  clack(out, sr, r, 0.34, { f: 1400, ring: 550, gain: 1.0, ringGain: 0.7, ringTau: 0.09 });
  thud(out, sr, r, 0.34, { f0: 130, f1: 70, tau: 0.04, gain: 0.7 });
  ring(out, sr, r, 0.37, 3200, 0.05, 0.16, [1, 1.9]);
  return finalize(out, sr, { peak: 0.76, fadeOut: 0.07 });
}

export function weaponDraw(c: Ctx): Float32Array {
  const { sr, r } = c;
  const out = alloc(sr, 0.32);
  rustle(out, sr, r, 0, 0.22, { gain: 0.42, lo: 900, hi: 3800 });
  clack(out, sr, r, 0.15 + rr(r, 0, 0.03), { f: 2800, ring: 1800, gain: 0.3, ringGain: 0.4, ringTau: 0.04 });
  thud(out, sr, r, 0.16, { f0: 200, f1: 120, tau: 0.02, gain: 0.18 });
  return finalize(out, sr, { peak: 0.36, fadeOut: 0.06 });
}

// -------------------------------------------------------------------------------------------------
// Grenades and armour
// -------------------------------------------------------------------------------------------------

export function grenadePin(c: Ctx): Float32Array {
  const { sr, r } = c;
  const out = alloc(sr, 0.4);
  click(out, sr, r, 0, { f: 2200, q: 2, tau: 0.004, gain: 0.55 });
  scrape(out, sr, r, 0.01, 0.06, { f0: 2500, f1: 3500, gain: 0.2, grit: 0.7 });
  ring(out, sr, r, 0.03, 2100, 0.17, 0.6, [1, 2.3, 4.1]);
  ring(out, sr, r, 0.14, 3100, 0.12, 0.3, [1, 2.7]);
  return finalize(out, sr, { peak: 0.45, fadeOut: 0.06 });
}

export function grenadeThrow(c: Ctx): Float32Array {
  const { sr, r } = c;
  const out = alloc(sr, 0.5);
  ring(out, sr, r, 0.005, 2800, 0.1, 0.24, [1, 2.5]);
  rustle(out, sr, r, 0, 0.14, { gain: 0.3, lo: 700, hi: 3000 });
  whoosh(out, sr, r, 0.04, 0.36, { f0: 420, f1: 2400, f2: 800, gain: 0.55 });
  return finalize(out, sr, { peak: 0.45, fadeOut: 0.08 });
}

export function grenadeBounce(c: Ctx): Float32Array {
  const { sr, r } = c;
  const out = alloc(sr, 0.45);
  const f0 = jit(r, 900, 0.18);
  ring(out, sr, r, 0, f0, 0.13, 0.9, [1, 2.76, 5.4, 8.9]);
  thud(out, sr, r, 0, { f0: 320, f1: 140, tau: 0.015, gain: 0.5, body: 0.6, bodyF: 800 });
  click(out, sr, r, 0, { f: 3400, q: 1.2, tau: 0.002, gain: 0.4 });
  return finalize(out, sr, { peak: 0.55, fadeOut: 0.07 });
}

export function grenadeExplosion(c: Ctx): Float32Array {
  const { sr, r } = c;
  const out = alloc(sr, 2.7);
  const j = (v: number, f = 0.08) => jit(r, v, f);
  noiseLayer(out, sr, r, { dur: 0.08, gain: 0.6, attack: 0.0003, tau: 0.012, filters: [{ type: 'hp', f: 1500 }] });
  noiseLayer(out, sr, r, {
    start: 0.001,
    dur: 1.1,
    gain: 1.0,
    attack: 0.002,
    tau: j(0.28),
    color: 'white',
    filters: [{ type: 'lp', f: 5500, f2: 300, q: 0.7 }],
  });
  toneLayer(out, sr, r, { dur: 1.8, gain: 0.8, f0: j(82), f1: 26, tau: 0.42, attack: 0.004, drive: 2.3 });
  toneLayer(out, sr, r, { dur: 0.3, gain: 0.85, f0: j(210), f1: 70, tau: 0.09, attack: 0.002, drive: 1.5 });
  noiseLayer(out, sr, r, {
    start: 0.02,
    dur: 2.5,
    gain: 0.5,
    attack: 0.03,
    tau: 0.9,
    color: 'brown',
    filters: [{ type: 'lp', f: 170, f2: 55, q: 0.8 }],
  });
  // debris raining down
  crackles(out, sr, r, {
    start: 0.22,
    dur: 2.2,
    rate: 110,
    rateTau: 0.65,
    gain: 0.3,
    tau: 0.004,
    filters: [{ type: 'bp', f: 1900, q: 0.6 }],
  });
  for (let i = 0; i < 9; i++) {
    const t = 0.3 + r() * 1.7;
    thud(out, sr, r, t, { f0: rr(r, 90, 170), f1: 55, tau: 0.03, gain: 0.05 + 0.22 * Math.exp(-t * 1.2), body: 0.8, bodyF: 700 });
  }
  echoTaps(out, sr, [
    { t: 0.16, g: 0.3, lp: 1200 },
    { t: 0.33, g: 0.18, lp: 800 },
    { t: 0.61, g: 0.1, lp: 600 },
  ]);
  for (let i = 0; i < out.length; i++) out[i] = sat(out[i]! * 1.35);
  return finalize(out, sr, { peak: 0.95, fadeOut: 0.25 });
}

export function armorPlate(c: Ctx): Float32Array {
  const { sr, r } = c;
  const out = alloc(sr, 2.35);
  rip(out, sr, r, 0.0, 0.34, { gain: 0.6 });
  rustle(out, sr, r, 0.3, 0.2, { gain: 0.22 });
  scrape(out, sr, r, 0.5, 0.46, { f0: 700, f1: 1500, gain: 0.34, grit: 0.4, flutter: 22 });
  toneLayer(out, sr, r, { start: 0.5, dur: 0.5, gain: 0.1, f0: 90, f1: 120, tau: 0.3, attack: 0.1 });
  rustle(out, sr, r, 0.95, 0.5, { gain: 0.26, lo: 500, hi: 2600 });
  thud(out, sr, r, 1.5, { f0: 170, f1: 85, tau: 0.05, gain: 0.95 });
  click(out, sr, r, 1.5, { f: 2800, q: 2, tau: 0.003, gain: 0.5 });
  ring(out, sr, r, 1.5, 1300, 0.07, 0.18, [1, 2.4]);
  rip(out, sr, r, 1.78, 0.26, { gain: 0.5 });
  thud(out, sr, r, 2.12, { f0: 130, f1: 80, tau: 0.03, gain: 0.3 });
  return finalize(out, sr, { peak: 0.6, fadeOut: 0.12 });
}
