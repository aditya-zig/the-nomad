/**
 * World sound recipes: bullet impacts, footsteps, pickups, containers, stations, feedback ticks and UI.
 */
import {
  type Ctx,
  alloc,
  crackles,
  echoTaps,
  finalize,
  jit,
  modalLayer,
  noiseLayer,
  rr,
  toneLayer,
} from './dsp';
import { clack, click, ring, rip, thud } from './foley';

// -------------------------------------------------------------------------------------------------
// Impacts
// -------------------------------------------------------------------------------------------------

export function impactConcrete(c: Ctx): Float32Array {
  const { sr, r } = c;
  const out = alloc(sr, 0.3);
  noiseLayer(out, sr, r, { dur: 0.04, gain: 1, attack: 0.0002, tau: 0.008, filters: [{ type: 'hp', f: jit(r, 2200, 0.15), q: 0.7 }] });
  noiseLayer(out, sr, r, {
    dur: 0.12,
    gain: 0.7,
    attack: 0.0008,
    tau: 0.03,
    color: 'pink',
    filters: [{ type: 'bp', f: jit(r, 650, 0.2), f2: 320, q: 0.9 }],
  });
  toneLayer(out, sr, r, { dur: 0.1, gain: 0.35, f0: jit(r, 190, 0.1), f1: 90, tau: 0.02, attack: 0.001 });
  crackles(out, sr, r, { start: 0.015, dur: 0.14, rate: 240, rateTau: 0.05, gain: 0.32, tau: 0.0015, filters: [{ type: 'bp', f: 2600, q: 0.7 }] });
  return finalize(out, sr, { peak: 0.42, fadeOut: 0.06 });
}

export function impactMetal(c: Ctx): Float32Array {
  const { sr, r } = c;
  const out = alloc(sr, 0.6);
  const f0 = jit(r, 1080, 0.28);
  click(out, sr, r, 0, { f: 3600, q: 1, tau: 0.0025, gain: 0.7 });
  modalLayer(out, sr, r, {
    f0,
    gain: 0.8,
    partials: [
      [1, 1, 0.17],
      [2.32, 0.7, 0.1],
      [4.25, 0.42, 0.06],
      [6.63, 0.25, 0.035],
    ],
    excite: 'noise',
    detune: 0.01,
  });
  toneLayer(out, sr, r, { dur: 0.08, gain: 0.25, f0: 320, f1: 210, tau: 0.02, attack: 0.001 });
  return finalize(out, sr, { peak: 0.44, fadeOut: 0.09 });
}

export function impactDirt(c: Ctx): Float32Array {
  const { sr, r } = c;
  const out = alloc(sr, 0.28);
  toneLayer(out, sr, r, { dur: 0.16, gain: 0.7, f0: jit(r, 92, 0.1), f1: 50, tau: 0.03, attack: 0.001 });
  noiseLayer(out, sr, r, { dur: 0.16, gain: 0.85, attack: 0.001, tau: 0.04, color: 'pink', filters: [{ type: 'lp', f: 950, f2: 400 }] });
  crackles(out, sr, r, { start: 0.01, dur: 0.12, rate: 140, rateTau: 0.05, gain: 0.16, tau: 0.002, filters: [{ type: 'bp', f: 1500, q: 0.8 }] });
  return finalize(out, sr, { peak: 0.36, fadeOut: 0.07 });
}

export function impactWood(c: Ctx): Float32Array {
  const { sr, r } = c;
  const out = alloc(sr, 0.32);
  noiseLayer(out, sr, r, { dur: 0.05, gain: 0.8, attack: 0.0003, tau: 0.01, filters: [{ type: 'bp', f: jit(r, 1500, 0.2), q: 0.7 }] });
  toneLayer(out, sr, r, { dur: 0.1, gain: 0.5, f0: jit(r, 300, 0.15), f1: 220, tau: 0.03, attack: 0.001 });
  modalLayer(out, sr, r, {
    f0: jit(r, 380, 0.15),
    gain: 0.42,
    partials: [
      [1, 1, 0.045],
      [1.7, 0.7, 0.028],
      [2.4, 0.5, 0.018],
    ],
    excite: 'noise',
    detune: 0.02,
  });
  crackles(out, sr, r, { start: 0.01, dur: 0.1, rate: 170, rateTau: 0.05, gain: 0.2, tau: 0.001, filters: [{ type: 'hp', f: 3000 }] });
  return finalize(out, sr, { peak: 0.4, fadeOut: 0.07 });
}

export function impactFlesh(c: Ctx): Float32Array {
  const { sr, r } = c;
  const out = alloc(sr, 0.28);
  toneLayer(out, sr, r, { dur: 0.16, gain: 0.8, f0: jit(r, 112, 0.1), f1: 62, tau: 0.04, attack: 0.001, drive: 1.3 });
  noiseLayer(out, sr, r, { dur: 0.1, gain: 0.75, attack: 0.0008, tau: 0.03, color: 'pink', filters: [{ type: 'lp', f: 1100 }] });
  noiseLayer(out, sr, r, { dur: 0.05, gain: 0.6, attack: 0.0004, tau: 0.007, filters: [{ type: 'bp', f: 1250, q: 1.3 }] });
  noiseLayer(out, sr, r, { start: 0.015, dur: 0.14, gain: 0.2, attack: 0.02, tau: 0.06, filters: [{ type: 'bp', f: 520, f2: 300, q: 1.6 }] });
  return finalize(out, sr, { peak: 0.42, fadeOut: 0.07 });
}

export function ricochet(c: Ctx): Float32Array {
  const { sr, r } = c;
  const out = alloc(sr, 0.62);
  const f0 = jit(r, 4200, 0.15);
  noiseLayer(out, sr, r, { dur: 0.004 + 0.02, gain: 0.5, attack: 0.0002, tau: 0.004, filters: [{ type: 'hp', f: 2500 }] });
  noiseLayer(out, sr, r, {
    start: 0.004,
    dur: 0.5,
    gain: 0.8,
    attack: 0.004,
    tau: 0.22,
    filters: [{ type: 'bp', f: f0, f2: 850, q: 22 }],
  });
  toneLayer(out, sr, r, { start: 0.004, dur: 0.4, gain: 0.2, f0: f0 * 0.75, f1: 1100, tau: 0.14, attack: 0.004 });
  return finalize(out, sr, { peak: 0.38, fadeOut: 0.1 });
}

// -------------------------------------------------------------------------------------------------
// Footsteps and player movement
// -------------------------------------------------------------------------------------------------

/** Damp street concrete. */
export function stepConcrete(c: Ctx): Float32Array {
  const { sr, r } = c;
  const out = alloc(sr, 0.3);
  const toe = 0.065 + rr(r, -0.01, 0.015);
  // heel strike: crisp click + scuff carry most of the audible mid content; the thump gives weight
  noiseLayer(out, sr, r, { dur: 0.04, gain: 0.9, attack: 0.0003, tau: 0.005, filters: [{ type: 'bp', f: jit(r, 1700, 0.12), q: 1.2 }] });
  noiseLayer(out, sr, r, { start: 0.004, dur: 0.1, gain: 0.45, attack: 0.002, tau: 0.022, color: 'pink', filters: [{ type: 'bp', f: jit(r, 1100, 0.15), q: 0.8 }] });
  toneLayer(out, sr, r, { dur: 0.14, gain: 0.5, f0: jit(r, 120, 0.1), f1: 64, tau: 0.026, attack: 0.001, drive: 1.2 });
  noiseLayer(out, sr, r, { dur: 0.14, gain: 0.28, attack: 0.001, tau: 0.025, color: 'pink', filters: [{ type: 'lp', f: 320 }] });
  noiseLayer(out, sr, r, { start: toe, dur: 0.03, gain: 0.5, attack: 0.0003, tau: 0.004, filters: [{ type: 'bp', f: 1500, q: 1.2 }] });
  toneLayer(out, sr, r, { start: toe, dur: 0.1, gain: 0.25, f0: jit(r, 150, 0.1), f1: 85, tau: 0.02, attack: 0.001 });
  noiseLayer(out, sr, r, { start: 0.01, dur: 0.14, gain: 0.16, attack: 0.012, tau: 0.045, color: 'pink', filters: [{ type: 'bp', f: jit(r, 800, 0.15), q: 1 }] });
  return finalize(out, sr, { peak: 0.5, fadeOut: 0.05 });
}

/** Hollow metal grating / container floor. */
export function stepMetal(c: Ctx): Float32Array {
  const { sr, r } = c;
  const out = alloc(sr, 0.4);
  toneLayer(out, sr, r, { dur: 0.12, gain: 0.4, f0: jit(r, 165, 0.08), f1: 90, tau: 0.02, attack: 0.001 });
  click(out, sr, r, 0, { f: jit(r, 2600, 0.1), q: 1.2, tau: 0.004, gain: 0.95 });
  modalLayer(out, sr, r, {
    f0: jit(r, 430, 0.1),
    gain: 0.55,
    partials: [
      [1, 1, 0.1],
      [2.62, 0.6, 0.065],
      [5.0, 0.35, 0.04],
    ],
    excite: 'noise',
    detune: 0.015,
  });
  toneLayer(out, sr, r, { dur: 0.3, gain: 0.16, f0: 182, f1: 176, tau: 0.15, attack: 0.004 });
  return finalize(out, sr, { peak: 0.55, fadeOut: 0.07 });
}

/** Soft dirt / gravel crunch. */
export function stepDirt(c: Ctx): Float32Array {
  const { sr, r } = c;
  const out = alloc(sr, 0.28);
  noiseLayer(out, sr, r, { dur: 0.13, gain: 0.7, attack: 0.002, tau: 0.04, color: 'pink', filters: [{ type: 'lp', f: 2200 }] });
  toneLayer(out, sr, r, { dur: 0.12, gain: 0.32, f0: jit(r, 100, 0.1), f1: 55, tau: 0.025, attack: 0.001 });
  crackles(out, sr, r, { start: 0.005, dur: 0.11, rate: 150, rateTau: 0.05, gain: 0.55, tau: 0.002, filters: [{ type: 'bp', f: 2100, q: 0.8 }] });
  return finalize(out, sr, { peak: 0.45, fadeOut: 0.06 });
}

/** Tile / linoleum indoors. */
export function stepIndoor(c: Ctx): Float32Array {
  const { sr, r } = c;
  const out = alloc(sr, 0.28);
  click(out, sr, r, 0, { f: jit(r, 3000, 0.1), q: 1.5, tau: 0.003, gain: 0.95 });
  toneLayer(out, sr, r, { dur: 0.1, gain: 0.45, f0: jit(r, 225, 0.08), f1: 115, tau: 0.016, attack: 0.001 });
  noiseLayer(out, sr, r, { dur: 0.16, gain: 0.2, attack: 0.004, tau: 0.06, color: 'pink', filters: [{ type: 'bp', f: 520, q: 4 }] });
  click(out, sr, r, 0.07 + rr(r, -0.008, 0.01), { f: 2600, q: 1.5, tau: 0.002, gain: 0.3 });
  return finalize(out, sr, { peak: 0.5, fadeOut: 0.05 });
}

// -------------------------------------------------------------------------------------------------
// Feedback ticks
// -------------------------------------------------------------------------------------------------

export function hitBody(c: Ctx): Float32Array {
  const { sr, r } = c;
  const out = alloc(sr, 0.09);
  toneLayer(out, sr, r, { dur: 0.06, gain: 0.8, f0: 1900, tau: 0.012, attack: 0.0006, harmonics: [0.35] });
  click(out, sr, r, 0, { f: 4200, q: 1, tau: 0.0018, gain: 0.5 });
  return finalize(out, sr, { peak: 0.36, fadeOut: 0.02 });
}

export function hitHead(c: Ctx): Float32Array {
  const { sr, r } = c;
  const out = alloc(sr, 0.22);
  toneLayer(out, sr, r, { dur: 0.16, gain: 0.7, f0: 2600, f1: 2750, tau: 0.03, attack: 0.0006, harmonics: [0.25] });
  toneLayer(out, sr, r, { start: 0.028, dur: 0.16, gain: 0.55, f0: 3900, f1: 4100, tau: 0.035, attack: 0.0006 });
  click(out, sr, r, 0, { f: 5200, q: 1, tau: 0.002, gain: 0.55 });
  noiseLayer(out, sr, r, { dur: 0.05, gain: 0.25, attack: 0.001, tau: 0.012, filters: [{ type: 'bp', f: 1400, q: 1 }] });
  return finalize(out, sr, { peak: 0.46, fadeOut: 0.05 });
}

export function killConfirm(c: Ctx): Float32Array {
  const { sr, r } = c;
  const out = alloc(sr, 0.2);
  toneLayer(out, sr, r, { dur: 0.14, gain: 0.9, f0: 215, f1: 120, tau: 0.07, attack: 0.002, drive: 1.4 });
  noiseLayer(out, sr, r, { dur: 0.06, gain: 0.3, attack: 0.001, tau: 0.02, color: 'pink', filters: [{ type: 'lp', f: 800 }] });
  toneLayer(out, sr, r, { start: 0.02, dur: 0.08, gain: 0.2, f0: 1400, tau: 0.02, attack: 0.001 });
  return finalize(out, sr, { peak: 0.34, fadeOut: 0.05 });
}

// -------------------------------------------------------------------------------------------------
// Pickups, containers, stations
// -------------------------------------------------------------------------------------------------

export function pickupAmmo(c: Ctx): Float32Array {
  const { sr, r } = c;
  const out = alloc(sr, 0.36);
  thud(out, sr, r, 0, { f0: 230, f1: 130, tau: 0.02, gain: 0.5, body: 0.4, bodyF: 800 });
  for (let i = 0; i < 4; i++) click(out, sr, r, 0.03 + i * 0.03 + rr(r, 0, 0.012), { f: rr(r, 3000, 5200), q: 2, tau: 0.003, gain: 0.4 - i * 0.07 });
  ring(out, sr, r, 0.05, jit(r, 3400, 0.08), 0.05, 0.22, [1, 1.6]);
  return finalize(out, sr, { peak: 0.45, fadeOut: 0.06 });
}

export function pickupCash(c: Ctx): Float32Array {
  const { sr, r } = c;
  const out = alloc(sr, 0.46);
  noiseLayer(out, sr, r, {
    dur: 0.2,
    gain: 0.5,
    attack: 0.012,
    tau: 0.09,
    filters: [{ type: 'hp', f: 3000 }],
    am: { rate: 65, depth: 0.85 },
  });
  crackles(out, sr, r, { dur: 0.18, rate: 110, gain: 0.3, tau: 0.001, filters: [{ type: 'hp', f: 3500 }] });
  modalLayer(out, sr, r, {
    start: 0.1,
    f0: 1900,
    gain: 0.34,
    partials: [
      [1, 1, 0.14],
      [2.7, 0.5, 0.08],
    ],
    excite: 'noise',
  });
  return finalize(out, sr, { peak: 0.4, fadeOut: 0.08 });
}

export function pickupPlate(c: Ctx): Float32Array {
  const { sr, r } = c;
  const out = alloc(sr, 0.4);
  thud(out, sr, r, 0, { f0: 260, f1: 140, tau: 0.03, gain: 0.75 });
  click(out, sr, r, 0, { f: 3000, q: 1.5, tau: 0.003, gain: 0.5 });
  ring(out, sr, r, 0.005, 1200, 0.06, 0.3, [1, 2.2, 3.6]);
  rip(out, sr, r, 0.1, 0.08, { gain: 0.22 });
  return finalize(out, sr, { peak: 0.45, fadeOut: 0.07 });
}

export function crateOpen(c: Ctx): Float32Array {
  const { sr, r } = c;
  const out = alloc(sr, 0.95);
  clack(out, sr, r, 0, { f: 1800, ring: 900, gain: 0.65 });
  clack(out, sr, r, 0.09, { f: 2200, ring: 1100, gain: 0.5 });
  // hinge creak
  toneLayer(out, sr, r, { start: 0.14, dur: 0.4, gain: 0.3, wave: 'saw', f0: 240, f1: 340, tau: 0.5, attack: 0.05, jitter: 0.4, drive: 1.3 });
  noiseLayer(out, sr, r, { start: 0.14, dur: 0.4, gain: 0.16, attack: 0.05, tau: 0.4, filters: [{ type: 'bp', f: 1100, q: 6 }], am: { rate: 24, depth: 0.7 } });
  // lid stop and contents
  thud(out, sr, r, 0.52, { f0: 140, f1: 70, tau: 0.05, gain: 0.65 });
  clack(out, sr, r, 0.52, { f: 1300, ring: 450, gain: 0.4 });
  crackles(out, sr, r, { start: 0.53, dur: 0.22, rate: 80, rateTau: 0.1, gain: 0.2, tau: 0.002, filters: [{ type: 'bp', f: 2500, q: 0.8 }] });
  return finalize(out, sr, { peak: 0.55, fadeOut: 0.1 });
}

export function buyOk(c: Ctx): Float32Array {
  const { sr, r } = c;
  const out = alloc(sr, 0.8);
  toneLayer(out, sr, r, { dur: 0.09, gain: 0.5, wave: 'square', f0: 990, tau: 0.08, attack: 0.002, drive: 1.1 });
  toneLayer(out, sr, r, { start: 0.1, dur: 0.14, gain: 0.5, wave: 'square', f0: 1480, tau: 0.12, attack: 0.002, drive: 1.1 });
  thud(out, sr, r, 0.22, { f0: 180, f1: 90, tau: 0.04, gain: 0.8 });
  clack(out, sr, r, 0.22, { f: 1400, ring: 520, gain: 0.7 });
  ring(out, sr, r, 0.27, 2400, 0.2, 0.28, [1, 2.76, 5.4]);
  return finalize(out, sr, { peak: 0.55, fadeOut: 0.1 });
}

export function buyDenied(c: Ctx): Float32Array {
  const { sr, r } = c;
  const out = alloc(sr, 0.42);
  for (const t of [0, 0.17]) {
    toneLayer(out, sr, r, { start: t, dur: 0.12, gain: 0.7, wave: 'saw', f0: 132, tau: 0.3, attack: 0.004, drive: 3 });
    toneLayer(out, sr, r, { start: t, dur: 0.12, gain: 0.5, wave: 'square', f0: 133.5, tau: 0.3, attack: 0.004, drive: 3 });
  }
  click(out, sr, r, 0, { f: 900, q: 1, tau: 0.006, gain: 0.3 });
  return finalize(out, sr, { peak: 0.48, fadeOut: 0.04 });
}

export function upgradeOk(c: Ctx): Float32Array {
  const { sr, r } = c;
  const out = alloc(sr, 1.7);
  noiseLayer(out, sr, r, { dur: 0.95, gain: 0.45, attack: 0.3, tau: 0.6, filters: [{ type: 'bp', f: 300, f2: 3600, q: 6 }] });
  toneLayer(out, sr, r, { dur: 1.0, gain: 0.4, f0: 180, f1: 1150, tau: 0.5, attack: 0.05, harmonics: [0.4, 0.2], fm: { ratio: 2, depth: 0.8 } });
  // anvil-like strike at the end of the build-up
  modalLayer(out, sr, r, {
    start: 0.95,
    f0: 640,
    gain: 0.8,
    partials: [
      [1, 1, 0.6],
      [2.3, 0.7, 0.4],
      [3.7, 0.5, 0.25],
      [5.4, 0.3, 0.15],
    ],
    excite: 'noise',
    detune: 0.008,
  });
  click(out, sr, r, 0.95, { f: 2400, q: 1, tau: 0.004, gain: 0.7 });
  toneLayer(out, sr, r, { start: 0.95, dur: 0.5, gain: 0.7, f0: 90, f1: 48, tau: 0.15, attack: 0.002, drive: 1.6 });
  crackles(out, sr, r, { start: 1.0, dur: 0.55, rate: 170, rateTau: 0.3, gain: 0.26, tau: 0.001, filters: [{ type: 'hp', f: 5000 }] });
  return finalize(out, sr, { peak: 0.7, fadeOut: 0.2 });
}

export function stationOpen(c: Ctx): Float32Array {
  const { sr, r } = c;
  const out = alloc(sr, 0.34);
  toneLayer(out, sr, r, { dur: 0.16, gain: 0.35, f0: 700, f1: 1100, tau: 0.05, attack: 0.003 });
  noiseLayer(out, sr, r, { start: 0.02, dur: 0.14, gain: 0.25, attack: 0.03, tau: 0.08, filters: [{ type: 'bp', f: 600, f2: 1200, q: 2 }] });
  click(out, sr, r, 0.16, { f: 2400, q: 2, tau: 0.003, gain: 0.3 });
  return finalize(out, sr, { peak: 0.35, fadeOut: 0.06 });
}

export function stationClose(c: Ctx): Float32Array {
  const { sr, r } = c;
  const out = alloc(sr, 0.28);
  toneLayer(out, sr, r, { dur: 0.13, gain: 0.32, f0: 1000, f1: 600, tau: 0.04, attack: 0.003 });
  click(out, sr, r, 0.11, { f: 1800, q: 2, tau: 0.004, gain: 0.3 });
  return finalize(out, sr, { peak: 0.3, fadeOut: 0.06 });
}

// -------------------------------------------------------------------------------------------------
// UI
// -------------------------------------------------------------------------------------------------

export function uiClick(c: Ctx): Float32Array {
  const { sr, r } = c;
  const out = alloc(sr, 0.07);
  click(out, sr, r, 0, { f: 2400, q: 2, tau: 0.004, gain: 0.8 });
  toneLayer(out, sr, r, { dur: 0.04, gain: 0.3, f0: 1400, tau: 0.01, attack: 0.0005 });
  return finalize(out, sr, { peak: 0.4, fadeOut: 0.02 });
}

export function uiHover(c: Ctx): Float32Array {
  const { sr, r } = c;
  const out = alloc(sr, 0.04);
  toneLayer(out, sr, r, { dur: 0.03, gain: 0.7, f0: 2200, tau: 0.006, attack: 0.0004 });
  return finalize(out, sr, { peak: 0.16, fadeOut: 0.01 });
}

export function uiDeploy(c: Ctx): Float32Array {
  const { sr, r } = c;
  const out = alloc(sr, 1.1);
  thud(out, sr, r, 0, { f0: 120, f1: 55, tau: 0.09, gain: 0.9, body: 0.5 });
  clack(out, sr, r, 0.02, { f: 1600, ring: 600, gain: 0.8, ringGain: 0.5 });
  const notes = [800, 1000, 1250];
  notes.forEach((f, i) => {
    toneLayer(out, sr, r, { start: 0.32 + i * 0.1, dur: 0.09, gain: 0.32, wave: 'square', f0: f, tau: 0.06, attack: 0.002, drive: 1.1 });
  });
  noiseLayer(out, sr, r, { start: 0.2, dur: 0.7, gain: 0.25, attack: 0.3, tau: 0.5, color: 'pink', filters: [{ type: 'lp', f: 500, f2: 260 }] });
  echoTaps(out, sr, [
    { t: 0.11, g: 0.2, lp: 1600 },
    { t: 0.26, g: 0.1, lp: 1000 },
  ]);
  return finalize(out, sr, { peak: 0.6, fadeOut: 0.2 });
}

export function uiPause(c: Ctx): Float32Array {
  const { sr, r } = c;
  const out = alloc(sr, 0.22);
  toneLayer(out, sr, r, { dur: 0.16, gain: 0.5, f0: 900, f1: 500, tau: 0.04, attack: 0.002 });
  click(out, sr, r, 0, { f: 2000, q: 2, tau: 0.004, gain: 0.4 });
  return finalize(out, sr, { peak: 0.33, fadeOut: 0.05 });
}
