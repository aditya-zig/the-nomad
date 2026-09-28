/**
 * DSP toolkit for procedural sound synthesis.
 *
 * Everything here is plain typed-array code with no Web Audio dependency, so recipes run identically in the browser
 * (engine init) and in Node (analysis / tests). All randomness comes from a seeded PRNG, so a given (id, variant) always
 * produces exactly the same samples.
 *
 * Layer functions (`noiseLayer`, `toneLayer`, `modalLayer`, `crackles`, `voice`, ...) render into a shared scratch buffer,
 * peak-normalise the layer, then add it to the destination scaled by `gain` - so a layer's `gain` is its peak
 * amplitude inside the mix, which makes recipes easy to balance.
 */

export const TAU = Math.PI * 2;

export type Rand = () => number;

/** Synthesis context handed to every recipe. */
export interface Ctx {
  /** Sample rate of the buffer being rendered. */
  sr: number;
  /** Seeded random source, uniform [0, 1). */
  r: Rand;
  /** Variant index 0..n-1. */
  v: number;
}

export function mulberry32(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable seed from a string id and variant number (FNV-1a). */
export function seedFor(id: string, variant: number): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= Math.imul(variant + 1, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  return (h ^ (h >>> 13)) >>> 0;
}

export const rr = (r: Rand, a: number, b: number): number => a + (b - a) * r();
/** Jitter `v` by +-`frac` (fractional). */
export const jit = (r: Rand, v: number, frac: number): number => v * (1 + (r() * 2 - 1) * frac);
export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const dbToGain = (db: number): number => Math.pow(10, db / 20);

/** Allocate `seconds` of silence at `sr`. */
export function alloc(sr: number, seconds: number): Float32Array {
  return new Float32Array(Math.max(8, Math.round(sr * seconds)));
}

/** Pade-style tanh approximation, good to about 1e-3 for |x| < 3 and saturating cleanly beyond. */
export function sat(x: number): number {
  if (x > 3) return 1;
  if (x < -3) return -1;
  const x2 = x * x;
  return (x * (27 + x2)) / (27 + 9 * x2);
}

// -------------------------------------------------------------------------------------------------
// Scratch buffer shared by layer renderers (layers never nest)
// -------------------------------------------------------------------------------------------------

let scratch = new Float32Array(1 << 16);
export function getScratch(n: number): Float32Array {
  if (scratch.length < n) scratch = new Float32Array(Math.max(n, scratch.length * 2));
  return scratch;
}

/** Add `s[0..n)` into `out` at `i0`, scaled so the layer's peak equals `gain`. */
function mixNormalized(out: Float32Array, s: Float32Array, i0: number, n: number, gain: number, peak: number): void {
  const g = peak > 1e-9 ? gain / peak : 0;
  for (let i = 0; i < n; i++) out[i0 + i] += s[i]! * g;
}

// -------------------------------------------------------------------------------------------------
// Filters
// -------------------------------------------------------------------------------------------------

/** RBJ biquad (transposed direct form II). */
export class Biquad {
  b0 = 1;
  b1 = 0;
  b2 = 0;
  a1 = 0;
  a2 = 0;
  z1 = 0;
  z2 = 0;

  reset(): void {
    this.z1 = 0;
    this.z2 = 0;
  }

  process(x: number): number {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }

  private set(b0: number, b1: number, b2: number, a0: number, a1: number, a2: number): this {
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
    return this;
  }

  lowpass(sr: number, f: number, q = 0.7071): this {
    const w = (TAU * clamp(f, 5, sr * 0.49)) / sr;
    const c = Math.cos(w);
    const al = Math.sin(w) / (2 * q);
    return this.set((1 - c) / 2, 1 - c, (1 - c) / 2, 1 + al, -2 * c, 1 - al);
  }

  highpass(sr: number, f: number, q = 0.7071): this {
    const w = (TAU * clamp(f, 5, sr * 0.49)) / sr;
    const c = Math.cos(w);
    const al = Math.sin(w) / (2 * q);
    return this.set((1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + al, -2 * c, 1 - al);
  }

  /** Band-pass with constant 0 dB peak gain. */
  bandpass(sr: number, f: number, q = 1): this {
    const w = (TAU * clamp(f, 5, sr * 0.49)) / sr;
    const c = Math.cos(w);
    const al = Math.sin(w) / (2 * q);
    return this.set(al, 0, -al, 1 + al, -2 * c, 1 - al);
  }

  notch(sr: number, f: number, q = 1): this {
    const w = (TAU * clamp(f, 5, sr * 0.49)) / sr;
    const c = Math.cos(w);
    const al = Math.sin(w) / (2 * q);
    return this.set(1, -2 * c, 1, 1 + al, -2 * c, 1 - al);
  }

  peaking(sr: number, f: number, q: number, gainDb: number): this {
    const A = Math.pow(10, gainDb / 40);
    const w = (TAU * clamp(f, 5, sr * 0.49)) / sr;
    const c = Math.cos(w);
    const al = Math.sin(w) / (2 * q);
    return this.set(1 + al * A, -2 * c, 1 - al * A, 1 + al / A, -2 * c, 1 - al / A);
  }
}

/** Topology-preserving-transform state-variable filter: stable under fast cutoff modulation. */
export class SVF {
  private ic1 = 0;
  private ic2 = 0;
  private a1 = 0;
  private a2 = 0;
  private a3 = 0;
  private k = 1;
  lp = 0;
  bp = 0;
  hp = 0;

  set(f: number, q: number, sr: number): void {
    const fc = f < 8 ? 8 : f > sr * 0.49 ? sr * 0.49 : f;
    const g = Math.tan((Math.PI * fc) / sr);
    const k = 1 / (q < 0.05 ? 0.05 : q);
    this.k = k;
    this.a1 = 1 / (1 + g * (g + k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
  }

  reset(): void {
    this.ic1 = 0;
    this.ic2 = 0;
  }

  /** Run one sample through; results in `lp`, `bp` (0 dB peak), `hp`. */
  run(x: number): void {
    const v3 = x - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    this.lp = v2;
    this.bp = v1 * this.k;
    this.hp = x - this.k * v1 - v2;
  }

  /** mode 0 = lowpass, 1 = bandpass, 2 = highpass, 3 = notch. */
  tick(x: number, mode: number): number {
    this.run(x);
    return mode === 0 ? this.lp : mode === 1 ? this.bp : mode === 2 ? this.hp : this.lp + this.hp;
  }
}

export interface FilterSpec {
  type: 'lp' | 'hp' | 'bp' | 'notch';
  f: number;
  /** End frequency: the cutoff sweeps exponentially from f to f2 across the layer. */
  f2?: number;
  q?: number;
}

const MODE = { lp: 0, bp: 1, hp: 2, notch: 3 } as const;

/** Cascade of sweeping state-variable filters. */
export class FilterChain {
  private readonly svf: SVF[] = [];
  private readonly mode: number[] = [];
  private readonly f0: number[] = [];
  private readonly ratio: number[] = [];
  private readonly q: number[] = [];
  private readonly sr: number;

  constructor(specs: FilterSpec[] | undefined, sr: number) {
    this.sr = sr;
    if (specs) {
      for (const s of specs) {
        this.svf.push(new SVF());
        this.mode.push(MODE[s.type]);
        this.f0.push(s.f);
        this.ratio.push(s.f2 !== undefined && s.f > 0 ? s.f2 / s.f : 1);
        this.q.push(s.q ?? (s.type === 'bp' ? 1 : 0.7071));
      }
    }
  }

  get length(): number {
    return this.svf.length;
  }

  /** Set cutoffs for progress `p` in 0..1. */
  update(p: number): void {
    for (let k = 0; k < this.svf.length; k++) {
      const ratio = this.ratio[k]!;
      const f = ratio === 1 ? this.f0[k]! : this.f0[k]! * Math.pow(ratio, p);
      this.svf[k]!.set(f, this.q[k]!, this.sr);
    }
  }

  process(x: number): number {
    for (let k = 0; k < this.svf.length; k++) x = this.svf[k]!.tick(x, this.mode[k]!);
    return x;
  }
}

/** Filter a region of a buffer in place with a sweeping chain. */
export function filterInPlace(buf: Float32Array, sr: number, specs: FilterSpec[], from = 0, to = buf.length): void {
  const chain = new FilterChain(specs, sr);
  const n = to - from;
  for (let i = 0; i < n; i++) {
    if ((i & 15) === 0) chain.update(i / n);
    buf[from + i] = chain.process(buf[from + i]!);
  }
}

// -------------------------------------------------------------------------------------------------
// Noise sources and oscillators
// -------------------------------------------------------------------------------------------------

export type NoiseColor = 'white' | 'pink' | 'brown';

export class NoiseSrc {
  private b0 = 0;
  private b1 = 0;
  private b2 = 0;
  private b3 = 0;
  private b4 = 0;
  private b5 = 0;
  private b6 = 0;
  private brown = 0;
  private readonly kind: number;

  constructor(
    color: NoiseColor,
    private readonly r: Rand,
  ) {
    this.kind = color === 'white' ? 0 : color === 'pink' ? 1 : 2;
  }

  next(): number {
    const w = this.r() * 2 - 1;
    if (this.kind === 0) return w;
    if (this.kind === 1) {
      this.b0 = 0.99886 * this.b0 + w * 0.0555179;
      this.b1 = 0.99332 * this.b1 + w * 0.0750759;
      this.b2 = 0.969 * this.b2 + w * 0.153852;
      this.b3 = 0.8665 * this.b3 + w * 0.3104856;
      this.b4 = 0.55 * this.b4 + w * 0.5329522;
      this.b5 = -0.7616 * this.b5 - w * 0.016898;
      const p = this.b0 + this.b1 + this.b2 + this.b3 + this.b4 + this.b5 + this.b6 + w * 0.5362;
      this.b6 = w * 0.115926;
      return p * 0.2;
    }
    this.brown = (this.brown + 0.02 * w) / 1.02;
    return this.brown * 6;
  }
}

/** PolyBLEP band-limited sawtooth from normalised phase (0..1) and phase increment. */
export function sawBL(ph: number, dt: number): number {
  let y = 2 * ph - 1;
  if (ph < dt) {
    const t = ph / dt;
    y -= t + t - t * t - 1;
  } else if (ph > 1 - dt) {
    const t = (ph - 1) / dt;
    y -= t * t + t + t + 1;
  }
  return y;
}

/** PolyBLEP band-limited square (50% duty) from normalised phase. */
export function squareBL(ph: number, dt: number): number {
  let y = ph < 0.5 ? 1 : -1;
  // discontinuities at 0 and 0.5
  let t = ph / dt;
  if (ph < dt) y += t + t - t * t - 1;
  else if (ph > 1 - dt) {
    t = (ph - 1) / dt;
    y += t * t + t + t + 1;
  }
  const p2 = ph - 0.5 < 0 ? ph + 0.5 : ph - 0.5;
  if (p2 < dt) {
    t = p2 / dt;
    y -= t + t - t * t - 1;
  } else if (p2 > 1 - dt) {
    t = (p2 - 1) / dt;
    y -= t * t + t + t + 1;
  }
  return y;
}

// -------------------------------------------------------------------------------------------------
// Curves (piecewise-linear keyframes with a monotone cursor)
// -------------------------------------------------------------------------------------------------

export type Keyframes = [number, number][];

/** Returns f(t) interpolating keyframes linearly (or geometrically when `geo`, for frequencies). Cursor makes sequential lookups O(1). */
export function curve(points: Keyframes, geo = false): (t: number) => number {
  let idx = 0;
  const n = points.length;
  return (t: number): number => {
    if (t <= points[0]![0]) return points[0]![1];
    if (t >= points[n - 1]![0]) return points[n - 1]![1];
    if (t < points[idx]![0]) idx = 0;
    while (idx < n - 2 && t >= points[idx + 1]![0]) idx++;
    const a = points[idx]!;
    const b = points[idx + 1]!;
    const u = (t - a[0]) / Math.max(1e-9, b[0] - a[0]);
    if (geo && a[1] > 0 && b[1] > 0) return a[1] * Math.pow(b[1] / a[1], u);
    return a[1] + (b[1] - a[1]) * u;
  };
}

/** Multiply a buffer region by an envelope defined by keyframes (time relative to `start`). */
export function applyEnv(buf: Float32Array, sr: number, points: Keyframes, start = 0): void {
  const f = curve(points);
  const i0 = Math.round(start * sr);
  for (let i = i0; i < buf.length; i++) buf[i] = buf[i]! * f((i - i0) / sr);
}

// -------------------------------------------------------------------------------------------------
// Layers
// -------------------------------------------------------------------------------------------------

export interface NoiseOpts {
  start?: number;
  dur: number;
  gain?: number;
  /** Linear attack in seconds (default 0.6 ms). */
  attack?: number;
  /** Exponential decay time constant in seconds. */
  tau: number;
  color?: NoiseColor;
  filters?: FilterSpec[];
  /** Amplitude modulation: (1 - depth) + depth * (0.5 + 0.5 sin). */
  am?: { rate: number; depth: number };
  drive?: number;
}

/** Enveloped, filtered noise burst. */
export function noiseLayer(out: Float32Array, sr: number, r: Rand, o: NoiseOpts): void {
  const i0 = Math.max(0, Math.round((o.start ?? 0) * sr));
  const n = Math.min(out.length - i0, Math.max(1, Math.round(o.dur * sr)));
  if (n <= 1) return;
  const s = getScratch(n);
  const atk = Math.max(1, Math.round((o.attack ?? 0.0006) * sr));
  const dec = Math.exp(-1 / (Math.max(1e-4, o.tau) * sr));
  const chain = new FilterChain(o.filters, sr);
  const src = new NoiseSrc(o.color ?? 'white', r);
  const fadeN = Math.max(1, Math.min(n >> 1, Math.round(0.004 * sr)));
  const drive = o.drive ?? 0;
  const am = o.am;
  const amW = am ? (TAU * am.rate) / sr : 0;
  let env = 1;
  let peak = 1e-9;
  for (let i = 0; i < n; i++) {
    if ((i & 15) === 0) chain.update(i / n);
    let x = chain.process(src.next());
    if (drive > 0) x = sat(x * drive);
    let a = i < atk ? i / atk : 1;
    if (i >= n - fadeN) a *= (n - i) / fadeN;
    if (am) a *= 1 - am.depth + am.depth * (0.5 + 0.5 * Math.sin(amW * i));
    x *= env * a;
    env *= dec;
    s[i] = x;
    const ax = x < 0 ? -x : x;
    if (ax > peak) peak = ax;
  }
  mixNormalized(out, s, i0, n, o.gain ?? 1, peak);
}

export interface ToneOpts {
  start?: number;
  dur: number;
  gain?: number;
  wave?: 'sine' | 'tri' | 'saw' | 'square';
  f0: number;
  /** End frequency (exponential sweep unless `linear`). */
  f1?: number;
  linear?: boolean;
  attack?: number;
  tau: number;
  drive?: number;
  /** FM: modulator = carrier * ratio, `depth` = modulation index in radians. */
  fm?: { ratio: number; depth: number };
  /** Extra sine harmonics (amplitudes for harmonic 2, 3, ...). */
  harmonics?: number[];
  vib?: { rate: number; depth: number };
  /** Noise mixed into the phase (breathy / unstable tone), 0..1. */
  jitter?: number;
}

/** Enveloped oscillator with optional frequency sweep, FM, harmonics, saturation. */
export function toneLayer(out: Float32Array, sr: number, r: Rand, o: ToneOpts): void {
  const i0 = Math.max(0, Math.round((o.start ?? 0) * sr));
  const n = Math.min(out.length - i0, Math.max(1, Math.round(o.dur * sr)));
  if (n <= 1) return;
  const s = getScratch(n);
  const atk = Math.max(1, Math.round((o.attack ?? 0.001) * sr));
  const dec = Math.exp(-1 / (Math.max(1e-4, o.tau) * sr));
  const f1 = o.f1 ?? o.f0;
  const ratio = Math.pow(Math.max(1e-3, f1) / Math.max(1e-3, o.f0), 1 / n);
  const wave = o.wave ?? 'sine';
  const drive = o.drive ?? 0;
  const harm = o.harmonics;
  const fadeN = Math.max(1, Math.min(n >> 1, Math.round(0.004 * sr)));
  const jitterAmt = o.jitter ?? 0;
  let f = o.f0;
  let ph = 0;
  let mph = 0;
  let env = 1;
  let peak = 1e-9;
  let jn = 0;
  for (let i = 0; i < n; i++) {
    let fi = o.linear ? o.f0 + ((f1 - o.f0) * i) / n : f;
    if (o.vib) fi *= 1 + o.vib.depth * Math.sin((TAU * o.vib.rate * i) / sr);
    if (jitterAmt > 0) {
      jn += (r() * 2 - 1 - jn) * 0.02;
      fi *= 1 + jitterAmt * jn;
    }
    const dph = fi / sr;
    ph += dph;
    if (ph >= 1) ph -= 1;
    let x: number;
    if (wave === 'sine') {
      let arg = TAU * ph;
      if (o.fm) {
        mph += (dph * o.fm.ratio) % 1;
        arg += o.fm.depth * Math.sin(TAU * mph);
      }
      x = Math.sin(arg);
      if (harm) {
        for (let h = 0; h < harm.length; h++) x += harm[h]! * Math.sin(arg * (h + 2));
      }
    } else if (wave === 'saw') x = sawBL(ph, dph);
    else if (wave === 'square') x = squareBL(ph, dph);
    else x = 4 * Math.abs(ph - 0.5) - 1;
    if (drive > 0) x = sat(x * drive);
    let a = i < atk ? i / atk : 1;
    if (i >= n - fadeN) a *= (n - i) / fadeN;
    x *= env * a;
    env *= dec;
    f *= ratio;
    s[i] = x;
    const ax = x < 0 ? -x : x;
    if (ax > peak) peak = ax;
  }
  mixNormalized(out, s, i0, n, o.gain ?? 1, peak);
}

export interface ModalOpts {
  start?: number;
  gain?: number;
  f0: number;
  /** [frequency ratio, amplitude, decay time constant (s)] */
  partials: [number, number, number][];
  /** 'impulse' = ideal strike; 'noise' = short noise burst excitation (softer, more realistic). */
  excite?: 'impulse' | 'noise';
  /** Random detune fraction per partial. */
  detune?: number;
  dur?: number;
}

/** Bank of damped resonators: metal rings, bells, glass, wood knocks. Cheap (no per-sample trig). */
export function modalLayer(out: Float32Array, sr: number, r: Rand, o: ModalOpts): void {
  const i0 = Math.max(0, Math.round((o.start ?? 0) * sr));
  let maxTau = 0.01;
  for (const p of o.partials) if (p[2] > maxTau) maxTau = p[2];
  const dur = o.dur ?? maxTau * 5.5;
  const n = Math.min(out.length - i0, Math.max(2, Math.round(dur * sr)));
  if (n <= 2) return;
  const s = getScratch(n);
  s.fill(0, 0, n);
  const excN = Math.max(2, Math.round(0.0025 * sr));
  const noiseExc = o.excite === 'noise';
  for (const [ratio, amp, tau] of o.partials) {
    const f = o.f0 * ratio * (1 + (o.detune ?? 0) * (r() * 2 - 1));
    if (f >= sr * 0.46 || f < 20) continue;
    const rd = Math.exp(-1 / (tau * sr));
    const w = (TAU * f) / sr;
    const a1 = 2 * rd * Math.cos(w);
    const a2 = -rd * rd;
    const inAmp = amp * Math.sin(w);
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < n; i++) {
      let x = 0;
      if (noiseExc) {
        if (i < excN) x = inAmp * (r() * 2 - 1) * (1 - i / excN) * 1.6;
      } else if (i === 0) x = inAmp;
      const y = a1 * y1 + a2 * y2 + x;
      y2 = y1;
      y1 = y;
      s[i] += y;
    }
  }
  let peak = 1e-9;
  const fadeN = Math.max(1, Math.min(n >> 1, Math.round(0.006 * sr)));
  for (let i = 0; i < n; i++) {
    if (i >= n - fadeN) s[i] *= (n - i) / fadeN;
    const ax = Math.abs(s[i]!);
    if (ax > peak) peak = ax;
  }
  mixNormalized(out, s, i0, n, o.gain ?? 1, peak);
}

export interface CrackleOpts {
  start?: number;
  dur: number;
  /** Events per second at the start. */
  rate: number;
  /** Exponential decay time constant of the event rate (s); omit for constant rate. */
  rateTau?: number;
  gain?: number;
  /** Duration constant of each click (s). */
  tau?: number;
  filters?: FilterSpec[];
}

/** Poisson-distributed clicks (fire crackle, debris, static, sizzle). */
export function crackles(out: Float32Array, sr: number, r: Rand, o: CrackleOpts): void {
  const i0 = Math.max(0, Math.round((o.start ?? 0) * sr));
  const n = Math.min(out.length - i0, Math.max(2, Math.round(o.dur * sr)));
  if (n <= 2) return;
  const s = getScratch(n);
  s.fill(0, 0, n);
  const clickLen = Math.max(4, Math.round((o.tau ?? 0.0025) * 6 * sr));
  const clickDec = Math.exp(-1 / (Math.max(1e-4, o.tau ?? 0.0025) * sr));
  let t = 0;
  for (;;) {
    const rate = o.rateTau ? o.rate * Math.exp(-t / o.rateTau) : o.rate;
    t += -Math.log(1 - r()) / Math.max(1, rate);
    const idx = Math.round(t * sr);
    if (idx >= n) break;
    const a = 0.15 + 0.85 * r() * r();
    const sign = r() < 0.5 ? -1 : 1;
    let e = a;
    for (let k = 0; k < clickLen && idx + k < n; k++) {
      s[idx + k] += (r() * 2 - 1) * e + sign * e * 0.5;
      e *= clickDec;
    }
  }
  if (o.filters && o.filters.length) {
    const chain = new FilterChain(o.filters, sr);
    for (let i = 0; i < n; i++) {
      if ((i & 15) === 0) chain.update(i / n);
      s[i] = chain.process(s[i]!);
    }
  }
  let peak = 1e-9;
  for (let i = 0; i < n; i++) {
    const ax = Math.abs(s[i]!);
    if (ax > peak) peak = ax;
  }
  mixNormalized(out, s, i0, n, o.gain ?? 1, peak);
}

// -------------------------------------------------------------------------------------------------
// Voices (formant synthesis)
// -------------------------------------------------------------------------------------------------

export type Vowel = 'a' | 'o' | 'u' | 'e' | 'i' | 'ae' | 'uh';

/** Approximate male formant frequencies F1..F3 in Hz. */
export const VOWELS: Record<Vowel, [number, number, number]> = {
  a: [730, 1090, 2440],
  o: [570, 840, 2410],
  u: [300, 870, 2240],
  e: [530, 1840, 2480],
  i: [270, 2290, 3010],
  ae: [660, 1720, 2410],
  uh: [640, 1190, 2390],
};

export interface VoiceOpts {
  start?: number;
  dur: number;
  gain?: number;
  /** Fundamental keyframes (seconds, Hz), interpolated geometrically. */
  f0: Keyframes;
  /** Vowel keyframes (seconds, vowel) - formants interpolate between them. */
  vowels: [number, Vowel][];
  /** Multiplies formant frequencies (larger = smaller vocal tract). */
  formantScale?: number;
  /** Formant bandwidths in Hz (F1..F3). */
  bw?: [number, number, number];
  formantGain?: [number, number, number];
  /** Amplitude envelope keyframes (seconds, 0..1). */
  env: Keyframes;
  vibrato?: { rate: number; depth: number };
  /** Random fundamental wobble (fraction). */
  jitter?: number;
  /** Random amplitude wobble (fraction). */
  shimmer?: number;
  /** Aspiration noise mixed into the excitation, 0..1. */
  breath?: number;
  /** Growl: amplitude modulation pulses. */
  fry?: { rate: number; depth: number; irregular?: number };
  /** Alternate-cycle amplitude reduction producing a subharmonic (growl / vocal fry). */
  sub?: number;
  drive?: number;
  /** Extra wet rasp band of noise gated by the fry pulses. */
  rasp?: { f: number; q: number; gain: number };
}

/**
 * Formant voice: PolyBLEP source -> parallel resonant band-passes, with growl, breath and saturation.
 * Slow parameters (f0 contour, vibrato, envelope, formants) are evaluated at control rate (every 8 samples) and linearly
 * interpolated per sample, which keeps the per-sample cost low.
 */
export function voice(out: Float32Array, sr: number, r: Rand, o: VoiceOpts): void {
  const i0 = Math.max(0, Math.round((o.start ?? 0) * sr));
  const n = Math.min(out.length - i0, Math.max(2, Math.round(o.dur * sr)));
  if (n <= 2) return;
  const s = getScratch(n);
  const f0c = curve(o.f0, true);
  const envc = curve(o.env);
  const fs = o.formantScale ?? 1;
  const bw = o.bw ?? [90, 120, 180];
  const fg = o.formantGain ?? [1, 0.6, 0.32];
  const vk = o.vowels;
  const svf0 = new SVF();
  const svf1 = new SVF();
  const svf2 = new SVF();
  const raspSvf = o.rasp ? new SVF() : null;
  const raspGain = o.rasp ? o.rasp.gain : 0;
  const vib = o.vibrato;
  const vibW = vib ? TAU * vib.rate : 0;
  const jitter = o.jitter ?? 0;
  const shimmer = o.shimmer ?? 0;
  const breath = o.breath ?? 0;
  const drive = o.drive ?? 0;
  const sub = o.sub ?? 0;
  const fry = o.fry;
  const fryInc = fry ? fry.rate / sr : 0;
  const fryIrr = fry?.irregular ?? 0;
  const fryDepth = fry ? fry.depth : 0;
  const g0 = fg[0];
  const g1 = fg[1];
  const g2 = fg[2];
  const CTRL = 8;
  let phase = r();
  let parity = 0;
  let jn = 0;
  let sn = 0;
  let fryPh = r();
  let vi = 0;
  let peak = 1e-9;
  let lpState = 0;
  let f0Cur = 0;
  let f0Step = 0;
  let envCur = 0;
  let envStep = 0;
  for (let i = 0; i < n; i++) {
    if ((i & 7) === 0) {
      const t = i / sr;
      // formant targets
      while (vi < vk.length - 2 && t >= vk[vi + 1]![0]) vi++;
      const a = vk[vi]!;
      const b = vk[Math.min(vk.length - 1, vi + 1)]!;
      const u = a === b ? 0 : clamp((t - a[0]) / Math.max(1e-6, b[0] - a[0]), 0, 1);
      const va = VOWELS[a[1]];
      const vb = VOWELS[b[1]];
      const F0 = (va[0] + (vb[0] - va[0]) * u) * fs;
      const F1 = (va[1] + (vb[1] - va[1]) * u) * fs;
      const F2 = (va[2] + (vb[2] - va[2]) * u) * fs;
      svf0.set(F0, F0 / bw[0], sr);
      svf1.set(F1, F1 / bw[1], sr);
      svf2.set(F2, F2 / bw[2], sr);
      if (raspSvf && o.rasp) raspSvf.set(o.rasp.f, o.rasp.q, sr);
      jn += (r() * 2 - 1 - jn) * 0.25;
      sn += (r() * 2 - 1 - sn) * 0.25;
      // control-rate targets for f0 and level
      const tn = (i + CTRL) / sr;
      let fNext = f0c(tn);
      if (vib) fNext *= 1 + vib.depth * Math.sin(vibW * tn);
      fNext *= 1 + jitter * jn;
      const eNext = envc(tn) * (1 + shimmer * sn);
      if (i === 0) {
        f0Cur = f0c(0) * (1 + jitter * jn);
        envCur = envc(0);
      }
      f0Step = (fNext - f0Cur) / CTRL;
      envStep = (eNext - envCur) / CTRL;
    }
    f0Cur += f0Step;
    envCur += envStep;
    const dt = f0Cur / sr;
    phase += dt;
    if (phase >= 1) {
      phase -= 1;
      parity ^= 1;
    }
    let src = sawBL(phase, dt);
    if (sub > 0 && parity) src *= 1 - sub;
    // gentle glottal tilt
    lpState += (src - lpState) * 0.35;
    const exc = lpState * (1 - breath * 0.55) + (r() * 2 - 1) * breath * 0.6;
    let gate = 1;
    if (fry) {
      fryPh += fryInc * (1 + fryIrr * jn);
      if (fryPh >= 1) fryPh -= 1;
      const pulse = Math.sin(Math.PI * fryPh);
      gate = 1 - fryDepth + fryDepth * pulse * pulse;
    }
    svf0.run(exc);
    svf1.run(exc);
    svf2.run(exc);
    let y = svf0.bp * g0 + svf1.bp * g1 + svf2.bp * g2;
    if (raspSvf) {
      raspSvf.run(r() * 2 - 1);
      y += raspSvf.bp * raspGain * (0.35 + 0.65 * gate);
    }
    if (drive > 0) y = sat(y * drive);
    y *= envCur * gate;
    s[i] = y;
    const ay = y < 0 ? -y : y;
    if (ay > peak) peak = ay;
  }
  const fadeN = Math.min(n >> 2, Math.round(0.006 * sr));
  for (let i = 0; i < fadeN; i++) {
    s[i] *= i / fadeN;
    s[n - 1 - i] *= i / fadeN;
  }
  mixNormalized(out, s, i0, n, o.gain ?? 1, peak);
}

// -------------------------------------------------------------------------------------------------
// Post-processing
// -------------------------------------------------------------------------------------------------

export interface EchoTap {
  /** Delay in seconds. */
  t: number;
  g: number;
  /** One-pole low-pass cutoff applied to the tap (Hz). */
  lp?: number;
}

/** Add delayed, darkened copies of the buffer (slap-back / reflections). */
export function echoTaps(buf: Float32Array, sr: number, taps: EchoTap[]): void {
  const src = buf.slice();
  const n = buf.length;
  for (const tap of taps) {
    const d = Math.round(tap.t * sr);
    const a = tap.lp ? 1 - Math.exp((-TAU * tap.lp) / sr) : 1;
    let y = 0;
    for (let i = 0; i + d < n; i++) {
      y += (src[i]! - y) * a;
      buf[i + d] += y * tap.g;
    }
  }
}

/** Circular version of `echoTaps` for loops: reflections wrap around the seam. */
export function circularEcho(buf: Float32Array, sr: number, taps: EchoTap[]): void {
  const src = buf.slice();
  const n = buf.length;
  for (const tap of taps) {
    const d = Math.round(tap.t * sr) % n;
    const a = tap.lp ? 1 - Math.exp((-TAU * tap.lp) / sr) : 1;
    let y = 0;
    // run two passes so the filter state has settled at the wrap
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < n; i++) {
        y += (src[i]! - y) * a;
        if (pass === 1) buf[(i + d) % n] += y * tap.g;
      }
    }
  }
}

export interface FinalizeOpts {
  /** Target peak (0..1). */
  peak: number;
  fadeIn?: number;
  fadeOut?: number;
  /** DC-blocking high-pass (Hz); 0 disables. Default 22. */
  hp?: number;
  /** Also remove the mean before high-passing (default true). */
  removeMean?: boolean;
}

/** Sanitise, DC-block, fade the edges and normalise to `peak`. Returns the same buffer. */
export function finalize(buf: Float32Array, sr: number, o: FinalizeOpts): Float32Array {
  const n = buf.length;
  let mean = 0;
  for (let i = 0; i < n; i++) {
    const v = buf[i]!;
    if (!Number.isFinite(v)) buf[i] = 0;
    else mean += v;
  }
  mean /= n;
  if (o.removeMean !== false) for (let i = 0; i < n; i++) buf[i] = buf[i]! - mean;
  const hp = o.hp ?? 22;
  if (hp > 0) {
    const a = Math.exp((-TAU * hp) / sr);
    let x1 = 0;
    let y1 = 0;
    for (let i = 0; i < n; i++) {
      const x = buf[i]!;
      const y = a * (y1 + x - x1);
      x1 = x;
      y1 = y;
      buf[i] = y;
    }
  }
  const fin = Math.min(n >> 1, Math.round((o.fadeIn ?? 0.0004) * sr));
  const fout = Math.min(n >> 1, Math.round((o.fadeOut ?? 0.012) * sr));
  for (let i = 0; i < fin; i++) buf[i] = buf[i]! * (i / fin);
  for (let i = 0; i < fout; i++) buf[n - 1 - i] = buf[n - 1 - i]! * (i / fout);
  let peak = 1e-9;
  for (let i = 0; i < n; i++) {
    const a = buf[i]! < 0 ? -buf[i]! : buf[i]!;
    if (a > peak) peak = a;
  }
  const g = o.peak / peak;
  for (let i = 0; i < n; i++) buf[i] = buf[i]! * g;
  return buf;
}

/**
 * Finish a LOOP buffer: remove the mean (no high-pass, so the seam stays continuous), normalise, no edge fades.
 */
export function finalizeLoop(buf: Float32Array, peak: number): Float32Array {
  const n = buf.length;
  let mean = 0;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(buf[i]!)) buf[i] = 0;
    mean += buf[i]!;
  }
  mean /= n;
  let p = 1e-9;
  for (let i = 0; i < n; i++) {
    buf[i] = buf[i]! - mean;
    const a = buf[i]! < 0 ? -buf[i]! : buf[i]!;
    if (a > p) p = a;
  }
  const g = peak / p;
  for (let i = 0; i < n; i++) buf[i] = buf[i]! * g;
  return buf;
}

/**
 * Turn a random (non-periodic) texture of length N + X into a seamless loop of length N by equal-power crossfading the
 * surplus tail into the head. out[N-1] -> out[0] then continues the source signal exactly.
 */
export function crossfadeLoop(long: Float32Array, n: number): Float32Array {
  const x = long.length - n;
  const out = long.slice(0, n);
  for (let i = 0; i < x; i++) {
    const u = (Math.PI / 2) * (i / x);
    out[i] = long[i]! * Math.sin(u) + long[n + i]! * Math.cos(u);
  }
  return out;
}

/** Quantise a phase-accumulated tone so its total phase is an exact integer number of cycles (seamless loop). */
export function quantizeLoopFrequency(baseScale: number, totalCycles: number): number {
  const target = Math.max(1, Math.round(totalCycles));
  return (baseScale * target) / totalCycles;
}

// -------------------------------------------------------------------------------------------------
// Analysis (used by the harness and tests)
// -------------------------------------------------------------------------------------------------

export interface BufferStats {
  seconds: number;
  peak: number;
  rms: number;
  hasNaN: boolean;
  /** Approximate spectral centroid in Hz (energy-weighted mean frequency of the whole buffer). */
  centroid: number;
  /** Ratio of energy below 200 Hz to total energy. */
  lowRatio: number;
  /** Ratio of energy above 4 kHz to total energy. */
  highRatio: number;
  /** Time (s) at which the running energy has decayed to -40 dB of the total (effective length). */
  t40: number;
  /** DC offset (mean). */
  dc: number;
}

function fftInPlace(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]!;
      re[i] = re[j]!;
      re[j] = tr;
      const ti = im[i]!;
      im[i] = im[j]!;
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-TAU) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k]!;
        const ui = im[i + k]!;
        const vr = re[i + k + len / 2]! * cr - im[i + k + len / 2]! * ci;
        const vi = re[i + k + len / 2]! * ci + im[i + k + len / 2]! * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/** Magnitude spectrogram (frames x bins) with a Hann window. `size` must be a power of two. */
export function spectrogram(buf: Float32Array, size = 512, hop = 256): { frames: Float32Array[]; bins: number } {
  const frames: Float32Array[] = [];
  const re = new Float32Array(size);
  const im = new Float32Array(size);
  const win = new Float32Array(size);
  for (let i = 0; i < size; i++) win[i] = 0.5 - 0.5 * Math.cos((TAU * i) / (size - 1));
  for (let start = 0; start + size <= buf.length + hop; start += hop) {
    for (let i = 0; i < size; i++) {
      const v = start + i < buf.length ? buf[start + i]! : 0;
      re[i] = v * win[i]!;
      im[i] = 0;
    }
    fftInPlace(re, im);
    const mags = new Float32Array(size / 2);
    for (let k = 0; k < size / 2; k++) mags[k] = Math.hypot(re[k]!, im[k]!);
    frames.push(mags);
  }
  return { frames, bins: size / 2 };
}

export function analyze(buf: Float32Array, sr: number): BufferStats {
  const n = buf.length;
  let peak = 0;
  let sum2 = 0;
  let mean = 0;
  let hasNaN = false;
  for (let i = 0; i < n; i++) {
    const v = buf[i]!;
    if (!Number.isFinite(v)) {
      hasNaN = true;
      continue;
    }
    mean += v;
    sum2 += v * v;
    const a = v < 0 ? -v : v;
    if (a > peak) peak = a;
  }
  const size = 1024;
  const { frames, bins } = spectrogram(buf, size, 512);
  const energy = new Float64Array(bins);
  for (const f of frames) for (let k = 0; k < bins; k++) energy[k] += f[k]! * f[k]!;
  let tot = 1e-20;
  let cen = 0;
  let low = 0;
  let high = 0;
  const binHz = sr / size;
  for (let k = 1; k < bins; k++) {
    const e = energy[k]!;
    tot += e;
    cen += e * k * binHz;
    if (k * binHz < 200) low += e;
    if (k * binHz > 4000) high += e;
  }
  // effective length: last time cumulative energy reaches 99.99% of total
  let acc = 0;
  let t40 = 0;
  const total = sum2 + 1e-20;
  for (let i = 0; i < n; i++) {
    acc += buf[i]! * buf[i]!;
    if (acc >= total * 0.9999) {
      t40 = i / sr;
      break;
    }
  }
  return {
    seconds: n / sr,
    peak,
    rms: Math.sqrt(sum2 / n),
    hasNaN,
    centroid: cen / tot,
    lowRatio: low / tot,
    highRatio: high / tot,
    t40,
    dc: mean / n,
  };
}

/** Seam quality of a loop: |x[0] - x[N-1]| relative to the typical (RMS) sample-to-sample step. ~1 = perfectly continuous. */
export function loopSeamRatio(buf: Float32Array): number {
  const n = buf.length;
  let d2 = 0;
  for (let i = 1; i < n; i++) {
    const d = buf[i]! - buf[i - 1]!;
    d2 += d * d;
  }
  const rmsStep = Math.sqrt(d2 / (n - 1)) + 1e-12;
  return Math.abs(buf[0]! - buf[n - 1]!) / rmsStep;
}
