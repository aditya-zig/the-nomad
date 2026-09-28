/**
 * Ambience and looping sounds.
 *
 * Seamless-loop strategy:
 *  - random textures (wind, hiss, rumble) are rendered N + X samples long and equal-power crossfaded into the head
 *    (`crossfadeLoop`), so the last sample flows straight into the first;
 *  - periodic components (mains hum, rotor pulses, tones) use frequencies that complete an exact integer number of cycles
 *    in the loop length, or are written with circular indexing, so they need no crossfade at all.
 */
import {
  type Ctx,
  NoiseSrc,
  SVF,
  TAU,
  alloc,
  circularEcho,
  clamp,
  crackles,
  crossfadeLoop,
  echoTaps,
  filterInPlace,
  finalize,
  finalizeLoop,
  jit,
  modalLayer,
  noiseLayer,
  rr,
  sawBL,
  toneLayer,
} from './dsp';
import { thud } from './foley';
import { sirenBuffer } from './mission';

// -------------------------------------------------------------------------------------------------
// Ambience bed layers (mixed live by the engine into the composite 'ambience' loop)
// -------------------------------------------------------------------------------------------------

/** Wind with slow gusts and a faint whistle (11.3 s loop). */
export function ambWind(c: Ctx): Float32Array {
  const { sr, r } = c;
  const n = Math.round(sr * 11.3);
  const x = Math.round(sr * 1.6);
  const long = new Float32Array(n + x);
  const src = new NoiseSrc('pink', r);
  const lp = new SVF();
  const lp2 = new SVF();
  const whistle = new SVF();
  const r1 = 0.09 + r() * 0.05;
  const r2 = 0.23 + r() * 0.08;
  const r3 = 0.041 + r() * 0.02;
  const p1 = r() * TAU;
  const p2 = r() * TAU;
  const p3 = r() * TAU;
  for (let i = 0; i < n + x; i++) {
    const t = i / sr;
    if ((i & 63) === 0) {
      const gust = clamp(0.5 + 0.32 * Math.sin(TAU * r1 * t + p1) + 0.18 * Math.sin(TAU * r2 * t + p2), 0, 1);
      const slow = 0.5 + 0.5 * Math.sin(TAU * r3 * t + p3);
      lp.set(220 + 900 * Math.pow(gust, 1.6), 0.8, sr);
      lp2.set(600 + 1800 * gust, 0.6, sr);
      whistle.set(620 + 420 * slow, 14, sr);
    }
    const w = src.next();
    lp.run(w);
    lp2.run(w);
    whistle.run(w);
    const gust = clamp(0.5 + 0.32 * Math.sin(TAU * r1 * t + p1) + 0.18 * Math.sin(TAU * r2 * t + p2), 0, 1);
    const amp = 0.22 + 0.78 * Math.pow(gust, 1.3);
    long[i] = (lp.lp * 0.8 + lp2.lp * 0.25 * gust) * amp + whistle.bp * 0.05 * gust * gust;
  }
  return finalizeLoop(crossfadeLoop(long, n), 0.5);
}

/** Mains transformer hum: 60 Hz + harmonics, beating partial and buzz (4 s loop, exact cycles). */
export function ambHum(c: Ctx): Float32Array {
  const { sr, r } = c;
  const T = 4;
  const n = Math.round(sr * T);
  const out = new Float32Array(n);
  const partials: [number, number][] = [
    [60, 1],
    [120, 0.72],
    [180, 0.36],
    [240, 0.22],
    [300, 0.12],
    [420, 0.07],
    [120.25, 0.3],
  ];
  const ph = partials.map(() => r() * TAU);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const wob = 0.85 + 0.15 * Math.sin(TAU * 0.25 * t);
    let v = 0;
    for (let k = 0; k < partials.length; k++) v += partials[k]![1] * Math.sin(TAU * partials[k]![0] * t + ph[k]!);
    out[i] = v * wob;
  }
  // transformer buzz: narrow noise around 120 Hz, crossfaded for a seamless seam
  const x = Math.round(sr * 0.5);
  const buzz = new Float32Array(n + x);
  const src = new NoiseSrc('white', r);
  const bp = new SVF();
  bp.set(120, 9, sr);
  for (let i = 0; i < n + x; i++) {
    bp.run(src.next());
    buzz[i] = bp.bp;
  }
  const loopBuzz = crossfadeLoop(buzz, n);
  let bp1 = 1e-9;
  for (let i = 0; i < n; i++) bp1 = Math.max(bp1, Math.abs(loopBuzz[i]!));
  let op = 1e-9;
  for (let i = 0; i < n; i++) op = Math.max(op, Math.abs(out[i]!));
  for (let i = 0; i < n; i++) out[i] = out[i]! / op + (loopBuzz[i]! / bp1) * 0.18;
  return finalizeLoop(out, 0.3);
}

/** Distant industrial rumble and drone (9.7 s loop, very low frequency). */
export function ambRumble(c: Ctx): Float32Array {
  const { sr, r } = c;
  const n = Math.round(sr * 9.7);
  const x = Math.round(sr * 1.5);
  const long = new Float32Array(n + x);
  const src = new NoiseSrc('brown', r);
  const lp = new SVF();
  lp.set(95, 0.8, sr);
  const p1 = r() * TAU;
  const p2 = r() * TAU;
  for (let i = 0; i < n + x; i++) {
    const t = i / sr;
    lp.run(src.next());
    const swell = 0.6 + 0.4 * Math.sin(TAU * 0.083 * t + p1);
    const drone = Math.sin(TAU * 41.5 * t) * 0.35 + Math.sin(TAU * 62.3 * t + p2) * 0.2;
    long[i] = lp.lp * 1.2 * swell + drone * (0.5 + 0.5 * Math.sin(TAU * 0.05 * t + p2));
  }
  return finalizeLoop(crossfadeLoop(long, n), 0.4);
}

// -------------------------------------------------------------------------------------------------
// Ambience one-shots
// -------------------------------------------------------------------------------------------------

/** Far-off thunder: crack, then long rolling rumble. */
export function ambThunder(c: Ctx): Float32Array {
  const { sr, r } = c;
  const D = 6.5 + r();
  const out = alloc(sr, D);
  const n = out.length;
  const src = new NoiseSrc('brown', r);
  const lp = new SVF();
  const bumps: { t: number; w: number; a: number }[] = [{ t: 0.25, w: 0.32, a: 1 }];
  const count = 3 + Math.floor(r() * 3);
  for (let k = 0; k < count; k++) bumps.push({ t: rr(r, 0.7, 3.8), w: rr(r, 0.3, 0.8), a: rr(r, 0.35, 0.8) });
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    if ((i & 63) === 0) lp.set(420 * Math.pow(60 / 420, Math.min(1, t / 5.5)), 0.9, sr);
    lp.run(src.next());
    let env = 0;
    for (const b of bumps) env += b.a * Math.exp(-((t - b.t) * (t - b.t)) / (2 * b.w * b.w));
    out[i] = lp.lp * env * Math.exp(-t / 2.4);
  }
  crackles(out, sr, r, { start: 0.05, dur: 0.6, rate: 120, rateTau: 0.25, gain: 0.25, tau: 0.003, filters: [{ type: 'bp', f: 800, q: 0.6 }] });
  return finalize(out, sr, { peak: 0.7, fadeIn: 0.05, fadeOut: 1.0, hp: 18 });
}

/** Structural metal creak with slip-stick texture. */
export function ambCreak(c: Ctx): Float32Array {
  const { sr, r } = c;
  const D = 1.8 + r() * 0.8;
  const out = alloc(sr, D);
  const n = out.length;
  const f0 = rr(r, 170, 250);
  const res = new SVF();
  const resNoise = new SVF();
  const src = new NoiseSrc('white', r);
  let ph = 0;
  let slip = r();
  let slipRate = rr(r, 13, 22);
  const nsy = new NoiseSrc('white', r);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    if ((i & 31) === 0) {
      res.set(rr(r, 820, 1000) + 250 * Math.sin(TAU * 0.6 * t), 6, sr);
      resNoise.set(1250, 3, sr);
      slipRate = clamp(slipRate + (r() - 0.5) * 1.5, 11, 26);
    }
    slip += slipRate / sr;
    if (slip >= 1) slip -= 1;
    const am = 0.15 + 0.85 * slip * slip;
    const f = f0 * (1 + 0.12 * Math.sin(TAU * 0.7 * t) + 0.2 * (t / D));
    const dt = f / sr;
    ph += dt;
    if (ph >= 1) ph -= 1;
    res.run(sawBL(ph, dt));
    resNoise.run(nsy.next());
    const env = Math.min(1, t / 0.4) * Math.max(0, 1 - Math.max(0, t - D * 0.55) / (D * 0.45));
    out[i] = (res.bp * 0.8 + resNoise.bp * 0.25 * src.next() * 0.4 + resNoise.bp * 0.15) * am * env;
  }
  return finalize(out, sr, { peak: 0.36, fadeIn: 0.2, fadeOut: 0.3 });
}

/** Distant metal clang. */
export function ambClang(c: Ctx): Float32Array {
  const { sr, r } = c;
  const out = alloc(sr, 2.1);
  const f0 = rr(r, 400, 720);
  noiseLayer(out, sr, r, { dur: 0.03, gain: 0.5, attack: 0.0003, tau: 0.006, filters: [{ type: 'bp', f: 1500, q: 0.8 }] });
  const parts: [number, number, number][] = [
    [1, 1, 0.9],
    [2.4, 0.7, 0.6],
    [3.9, 0.5, 0.4],
    [5.7, 0.35, 0.25],
    [8.2, 0.2, 0.15],
  ];
  modalLayer(out, sr, r, { f0, gain: 1, partials: parts, excite: 'noise', detune: 0.01 });
  modalLayer(out, sr, r, { f0: f0 * 1.006, gain: 0.55, partials: parts, excite: 'noise', detune: 0.01 });
  filterInPlace(out, sr, [{ type: 'lp', f: 4200 }]);
  return finalize(out, sr, { peak: 0.4, fadeOut: 0.3 });
}

/** Muffled gunfire far away: bursts and single shots. */
export function ambGunfireFar(c: Ctx): Float32Array {
  const { sr, r, v } = c;
  const out = alloc(sr, 2.9);
  const times: number[] = [];
  if (v % 3 === 0) {
    for (let k = 0; k < 5; k++) times.push(0.1 + k * rr(r, 0.095, 0.125));
  } else if (v % 3 === 1) {
    times.push(0.1, 0.75 + r() * 0.2, 1.7 + r() * 0.3);
  } else {
    for (let k = 0; k < 3; k++) times.push(0.1 + k * 0.11);
    for (let k = 0; k < 4; k++) times.push(1.5 + k * 0.1);
  }
  for (const t of times) {
    const g = rr(r, 0.6, 1);
    noiseLayer(out, sr, r, { start: t, dur: 0.1, gain: g, attack: 0.0006, tau: 0.03, filters: [{ type: 'lp', f: jit(r, 1300, 0.2) }] });
    toneLayer(out, sr, r, { start: t, dur: 0.16, gain: g * 0.7, f0: jit(r, 100, 0.1), f1: 55, tau: 0.06, attack: 0.002 });
    noiseLayer(out, sr, r, { start: t + 0.01, dur: 0.5, gain: g * 0.3, attack: 0.01, tau: 0.22, color: 'pink', filters: [{ type: 'lp', f: 600 }] });
  }
  filterInPlace(out, sr, [{ type: 'lp', f: 1700 }]);
  echoTaps(out, sr, [
    { t: 0.19, g: 0.25, lp: 900 },
    { t: 0.42, g: 0.13, lp: 700 },
  ]);
  return finalize(out, sr, { peak: 0.35, fadeIn: 0.005, fadeOut: 0.4 });
}

/** Rubble shifting and settling. */
export function ambDebris(c: Ctx): Float32Array {
  const { sr, r } = c;
  const out = alloc(sr, 1.6);
  thud(out, sr, r, 0.05, { f0: 125, f1: 70, tau: 0.04, gain: 0.5, body: 0.9, bodyF: 800 });
  for (let i = 0; i < 26; i++) {
    const t = 0.08 + 1.2 * Math.pow(r(), 1.7);
    const g = 0.4 * Math.exp(-t * 1.3) + 0.06;
    if (r() < 0.75) {
      noiseLayer(out, sr, r, {
        start: t,
        dur: 0.05,
        gain: g,
        attack: 0.0003,
        tau: rr(r, 0.003, 0.012),
        filters: [{ type: 'bp', f: rr(r, 900, 3500), q: 1.2 }],
      });
    } else {
      thud(out, sr, r, t, { f0: rr(r, 130, 260), f1: 80, tau: 0.02, gain: g * 0.8, body: 0.8, bodyF: 900 });
    }
  }
  return finalize(out, sr, { peak: 0.35, fadeOut: 0.3 });
}

// -------------------------------------------------------------------------------------------------
// Loops
// -------------------------------------------------------------------------------------------------

/**
 * Helicopter: 13 Hz blade-pass slap (4-blade rotor at 3.25 Hz), rotor wash, turbine whine, gearbox growl.
 * Loop length 4.0 s = exactly 52 blade passes = 13 rotor revolutions; every periodic part completes an integer number of cycles.
 */
export function loopHeli(c: Ctx): Float32Array {
  const { sr, r } = c;
  const T = 4;
  const n = Math.round(sr * T);
  const out = new Float32Array(n);
  const bpf = 13;
  // slap kernel: low thump + sharp blade "crack"
  const L = Math.round(sr * 0.11);
  const slap = new Float32Array(L);
  toneLayer(slap, sr, r, { dur: 0.1, gain: 1, f0: 66, f1: 44, tau: 0.03, attack: 0.002, drive: 1.6 });
  noiseLayer(slap, sr, r, { dur: 0.06, gain: 0.55, attack: 0.001, tau: 0.012, filters: [{ type: 'bp', f: 820, q: 1.1 }] });
  noiseLayer(slap, sr, r, { dur: 0.04, gain: 0.25, attack: 0.0006, tau: 0.008, filters: [{ type: 'hp', f: 2200 }] });
  const pulses = bpf * T;
  const blade = [1, 0.84, 0.94, 0.78];
  for (let k = 0; k < pulses; k++) {
    const start = Math.round((k / bpf) * sr);
    const amp = blade[k % 4]! * (1 + 0.16 * Math.cos((TAU * k) / 4 / 3.25 / 0.999));
    for (let j = 0; j < L; j++) out[(start + j) % n] += slap[j]! * amp;
  }
  // rotor wash: modulated noise (crossfaded texture, then periodic amplitude modulation)
  const x = Math.round(sr * 0.8);
  const wash = new Float32Array(n + x);
  const src = new NoiseSrc('pink', r);
  const lp = new SVF();
  lp.set(950, 0.8, sr);
  for (let i = 0; i < n + x; i++) {
    lp.run(src.next());
    wash[i] = lp.lp;
  }
  const washLoop = crossfadeLoop(wash, n);
  let wp = 1e-9;
  for (let i = 0; i < n; i++) wp = Math.max(wp, Math.abs(washLoop[i]!));
  let op = 1e-9;
  for (let i = 0; i < n; i++) op = Math.max(op, Math.abs(out[i]!));
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const pulse = 0.5 + 0.5 * Math.cos(TAU * bpf * t);
    const am = (0.35 + 0.65 * pulse * pulse) * (0.85 + 0.15 * Math.cos(TAU * 3.25 * t));
    out[i] = out[i]! / op + (washLoop[i]! / wp) * 0.55 * am;
  }
  // turbine whine and gearbox (integer cycles in 4 s)
  const ph = [r() * TAU, r() * TAU, r() * TAU, r() * TAU];
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    // phase-modulated tones (periodic in T, so the seam is continuous): slow +-3 Hz wander on the whine
    const wander = 6 * Math.cos(TAU * 0.5 * t);
    const whine =
      Math.sin(TAU * 1240 * t + ph[0]! + wander) * 0.16 +
      Math.sin(TAU * 2480 * t + ph[1]! + wander * 2) * 0.07 +
      Math.sin(TAU * 620 * t + ph[2]!) * 0.08;
    const gear = (Math.sin(TAU * 92 * t + ph[3]!) * 0.2 + Math.sin(TAU * 184 * t) * 0.08) * (0.8 + 0.2 * Math.cos(TAU * bpf * t));
    out[i] += whine + gear;
  }
  return finalizeLoop(out, 0.8);
}

/** Siren loop: 8 s = two wail cycles, phase-quantised so it repeats seamlessly. */
export function loopSiren(c: Ctx): Float32Array {
  const { sr, r } = c;
  const out = sirenBuffer(sr, 8, 2, 400, 700 + rr(r, -10, 10), true);
  circularEcho(out, sr, [
    { t: 0.24, g: 0.28, lp: 1800 },
    { t: 0.5, g: 0.14, lp: 1200 },
  ]);
  return finalizeLoop(out, 0.5);
}

/** Signal-flare hiss and crackle (4 s crossfaded loop). */
export function loopFlare(c: Ctx): Float32Array {
  const { sr, r } = c;
  const n = Math.round(sr * 4);
  const x = Math.round(sr * 0.7);
  const long = new Float32Array(n + x);
  const src = new NoiseSrc('white', r);
  const bp = new SVF();
  const hp = new SVF();
  const low = new SVF();
  const pink = new NoiseSrc('pink', r);
  let flutter = 0;
  for (let i = 0; i < n + x; i++) {
    if ((i & 15) === 0) {
      bp.set(3600, 0.5, sr);
      hp.set(1500, 0.7, sr);
      low.set(380, 0.7, sr);
      flutter += (r() * 2 - 1 - flutter) * 0.02;
    }
    bp.run(src.next());
    hp.run(bp.bp);
    low.run(pink.next());
    long[i] = hp.hp * (0.8 + 0.3 * flutter) + low.lp * 0.35 * (0.9 + 0.5 * flutter);
  }
  crackles(long, sr, r, { dur: (n + x) / sr - 0.01, rate: 46, gain: 0.55, tau: 0.0015, filters: [{ type: 'hp', f: 2000 }] });
  return finalizeLoop(crossfadeLoop(long, n), 0.45);
}

/** Toxic gas hiss (5 s crossfaded loop). */
export function loopGas(c: Ctx): Float32Array {
  const { sr, r } = c;
  const n = Math.round(sr * 5);
  const x = Math.round(sr * 0.9);
  const long = new Float32Array(n + x);
  const src = new NoiseSrc('white', r);
  const bp = new SVF();
  const lp = new SVF();
  const pink = new NoiseSrc('pink', r);
  const ph = r() * TAU;
  for (let i = 0; i < n + x; i++) {
    const t = i / sr;
    if ((i & 31) === 0) {
      bp.set(1800 + 500 * Math.sin(TAU * 0.31 * t + ph), 0.45, sr);
      lp.set(300, 0.7, sr);
    }
    bp.run(src.next());
    lp.run(pink.next());
    const slow = 0.7 + 0.3 * Math.sin(TAU * 0.7 * t + ph);
    long[i] = bp.bp * slow + lp.lp * 0.5 * (1.1 - slow * 0.3);
  }
  return finalizeLoop(crossfadeLoop(long, n), 0.4);
}

/** Beating heart, one lub-dub cycle at 72 bpm. Loop length is one full cycle. */
export function loopHeartbeat(c: Ctx): Float32Array {
  const { sr, r } = c;
  const out = alloc(sr, 60 / 72);
  toneLayer(out, sr, r, { start: 0.02, dur: 0.28, gain: 1, f0: 58, f1: 42, tau: 0.05, attack: 0.004, drive: 1.4 });
  noiseLayer(out, sr, r, { start: 0.02, dur: 0.15, gain: 0.35, attack: 0.003, tau: 0.04, color: 'pink', filters: [{ type: 'lp', f: 190 }] });
  toneLayer(out, sr, r, { start: 0.3, dur: 0.24, gain: 0.75, f0: 68, f1: 50, tau: 0.045, attack: 0.004, drive: 1.3 });
  noiseLayer(out, sr, r, { start: 0.3, dur: 0.12, gain: 0.25, attack: 0.003, tau: 0.035, color: 'pink', filters: [{ type: 'lp', f: 200 }] });
  return finalizeLoop(out, 0.8);
}

/** Transmitter: mains hum, data chatter blips and relay ticks (6 s loop). */
export function loopTransmitter(c: Ctx): Float32Array {
  const { sr, r } = c;
  const T = 6;
  const n = Math.round(sr * T);
  const out = new Float32Array(n);
  const ph = [r() * TAU, r() * TAU, r() * TAU];
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    out[i] =
      Math.sin(TAU * 60 * t + ph[0]!) * 0.5 * (0.85 + 0.15 * Math.sin(TAU * (1 / 6) * t)) +
      Math.sin(TAU * 120 * t + ph[1]!) * 0.32 +
      Math.sin(TAU * 180 * t + ph[2]!) * 0.14;
  }
  // noise floor (crossfaded)
  const x = Math.round(sr * 0.6);
  const nz = new Float32Array(n + x);
  const src = new NoiseSrc('white', r);
  const bp = new SVF();
  bp.set(4200, 0.6, sr);
  for (let i = 0; i < n + x; i++) {
    bp.run(src.next());
    nz[i] = bp.bp;
  }
  const nl = crossfadeLoop(nz, n);
  for (let i = 0; i < n; i++) out[i] += nl[i]! * 0.06;
  // data blips and relay ticks placed well inside the loop so nothing crosses the seam
  const freqs = [1200, 1800, 2400, 3000, 3600];
  let t = 0.25;
  while (t < T - 0.5) {
    const burst = 2 + Math.floor(r() * 4);
    for (let b = 0; b < burst; b++) {
      const dur = rr(r, 0.018, 0.05);
      toneLayer(out, sr, r, { start: t, dur, gain: 0.16, wave: r() < 0.5 ? 'square' : 'sine', f0: freqs[Math.floor(r() * freqs.length)]!, tau: dur * 0.6, attack: 0.001 });
      t += dur + rr(r, 0.012, 0.04);
    }
    t += rr(r, 0.35, 1.0);
  }
  for (let k = 0; k < 4; k++) {
    const tt = 0.6 + k * 1.4 + r() * 0.5;
    if (tt < T - 0.3) {
      noiseLayer(out, sr, r, { start: tt, dur: 0.04, gain: 0.3, attack: 0.0003, tau: 0.004, filters: [{ type: 'bp', f: 2400, q: 1.5 }] });
    }
  }
  return finalizeLoop(out, 0.4);
}
