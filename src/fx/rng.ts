/** Tiny seeded PRNG (xorshift32) for visual effects: cheap, allocation-free and repeatable. */
export class Rng {
  private s: number;

  constructor(seed = 0x2f6e2b1) {
    this.s = (seed | 0) || 1;
  }

  /** Uniform in [0, 1). */
  next(): number {
    let x = this.s;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.s = x | 0;
    return (x >>> 0) / 4294967296;
  }

  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }

  /** Uniform in [-1, 1). */
  signed(): number {
    return this.next() * 2 - 1;
  }

  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }
}

/** Scratch orthonormal basis about a unit normal (no allocation): results in `bt*`/`bb*`. */
export const basis = { tx: 1, ty: 0, tz: 0, bx: 0, by: 0, bz: 1 };

export function makeBasis(nx: number, ny: number, nz: number): void {
  // pick the world axis least aligned with n
  let ux = 0;
  let uy = 1;
  let uz = 0;
  if (Math.abs(ny) > 0.95) {
    ux = 1;
    uy = 0;
  }
  // t = normalize(u x n)
  let tx = uy * nz - uz * ny;
  let ty = uz * nx - ux * nz;
  let tz = ux * ny - uy * nx;
  const tl = Math.hypot(tx, ty, tz) || 1;
  tx /= tl;
  ty /= tl;
  tz /= tl;
  // b = n x t
  basis.tx = tx;
  basis.ty = ty;
  basis.tz = tz;
  basis.bx = ny * tz - nz * ty;
  basis.by = nz * tx - nx * tz;
  basis.bz = nx * ty - ny * tx;
}

export const tmpDir = { x: 0, y: 1, z: 0 };

/** Random unit direction inside a cone of half-angle `angle` (radians) about unit normal n -> written to `tmpDir`. */
export function coneDir(rng: Rng, nx: number, ny: number, nz: number, angle: number): void {
  makeBasis(nx, ny, nz);
  const cosT = 1 - rng.next() * (1 - Math.cos(angle));
  const sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT));
  const phi = rng.next() * Math.PI * 2;
  const cx = Math.cos(phi) * sinT;
  const cy = Math.sin(phi) * sinT;
  tmpDir.x = nx * cosT + basis.tx * cx + basis.bx * cy;
  tmpDir.y = ny * cosT + basis.ty * cx + basis.by * cy;
  tmpDir.z = nz * cosT + basis.tz * cx + basis.bz * cy;
}
