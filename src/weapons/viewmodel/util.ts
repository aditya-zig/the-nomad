/** Small numeric helpers shared by all viewmodel rigs (no allocations in the hot ones). */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smooth = (t: number): number => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};
export const smoother = (t: number): number => {
  const x = clamp01(t);
  return x * x * x * (x * (x * 6 - 15) + 10);
};
export const easeOut = (t: number): number => {
  const x = 1 - clamp01(t);
  return 1 - x * x * x;
};
export const easeIn = (t: number): number => {
  const x = clamp01(t);
  return x * x * x;
};
/** Remap `t` from [a, b] to 0..1 (clamped). */
export const seg = (t: number, a: number, b: number): number => clamp01((t - a) / (b - a));
/** Bump: 0 -> 1 -> 0 across [a, b] with smooth shoulders. */
export const bump = (t: number, a: number, b: number): number => {
  const x = seg(t, a, b);
  return Math.sin(x * Math.PI);
};

/** Exponential damping factor for frame-rate independent smoothing. */
export const damp = (rate: number, dt: number): number => 1 - Math.exp(-rate * dt);

/**
 * Second-order spring (semi-implicit Euler, sub-stepped) that returns to 0.
 * `freq` in Hz (natural frequency), `zeta` damping ratio (1 = critical).
 */
export class Spring {
  x = 0;
  v = 0;
  constructor(
    public freq: number,
    public zeta: number,
  ) {}

  kick(impulse: number): void {
    this.v += impulse;
  }

  step(dt: number): number {
    const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / steps;
    const w = this.freq * Math.PI * 2;
    for (let i = 0; i < steps; i++) {
      const a = -w * w * this.x - 2 * this.zeta * w * this.v;
      this.v += a * h;
      this.x += this.v * h;
    }
    return this.x;
  }

  reset(): void {
    this.x = 0;
    this.v = 0;
  }
}

/** Piecewise-smooth keyframe evaluation: `keys` = [t0, v0, t1, v1, ...] sorted by t. Uses smoothstep between keys. */
export function keys(t: number, k: readonly number[]): number {
  const n = k.length;
  if (t <= k[0]!) return k[1]!;
  if (t >= k[n - 2]!) return k[n - 1]!;
  for (let i = 0; i < n - 2; i += 2) {
    const t0 = k[i]!;
    const t1 = k[i + 2]!;
    if (t <= t1) {
      const u = smooth((t - t0) / (t1 - t0));
      return k[i + 1]! + (k[i + 3]! - k[i + 1]!) * u;
    }
  }
  return k[n - 1]!;
}
