/** Small deterministic PRNG (mulberry32) used wherever results must be repeatable. */
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

export class Rng {
  private next: () => number;
  constructor(seed = 1) {
    this.next = mulberry32(seed);
  }
  /** Uniform in [0, 1). */
  f(): number {
    return this.next();
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  /** Integer in [a, b] inclusive. */
  int(a: number, b: number): number {
    return a + Math.floor(this.next() * (b - a + 1));
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)] as T;
  }
  /** Standard-normal-ish value (sum of uniforms). */
  gauss(): number {
    return (this.next() + this.next() + this.next() + this.next() - 2) * 1.7320508;
  }
}

/** Hash two numbers to a stable seed. */
export function hash2(x: number, z: number): number {
  let h = Math.imul(Math.floor(x * 73.7) ^ 0x9e3779b9, 0x85ebca6b);
  h ^= Math.imul(Math.floor(z * 91.3) ^ 0xc2b2ae35, 0x27d4eb2f);
  h ^= h >>> 15;
  return h >>> 0;
}
