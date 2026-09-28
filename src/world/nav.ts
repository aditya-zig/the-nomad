/**
 * Enemy navigation: a 0.5 m grid rasterised from the collision world (colliders inflated by an agent radius) and a
 * single-target flow field (Dijkstra by Dial's bucket queue) computed from the player's cell. Every chasing zombie reads
 * the same field (O(1) per query), so hordes route through doorways and around buildings without per-zombie A*.
 * Steering funnels along the descent path (string-pulling with grid line of sight) for smooth, non-grid-aligned motion.
 */
import type { CollisionWorld, WorldBoundsXZ } from './collision';

export const NAV_CELL = 0.5;
const COST_ORTH = 10;
const COST_DIAG = 14;
const BUCKETS = COST_DIAG + 1;
export const UNREACHABLE = 0x7fffffff;

const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DZ = [0, 0, 1, -1, 1, -1, 1, -1];
const DW = [COST_ORTH, COST_ORTH, COST_ORTH, COST_ORTH, COST_DIAG, COST_DIAG, COST_DIAG, COST_DIAG];

export class NavGrid {
  readonly cell = NAV_CELL;
  readonly minX: number;
  readonly minZ: number;
  readonly cols: number;
  readonly rows: number;
  readonly count: number;
  /** 1 = an agent's centre cannot be here. */
  readonly blocked: Uint8Array;

  constructor(bounds: WorldBoundsXZ, world: CollisionWorld, inflate = 0.42) {
    this.minX = bounds.minX;
    this.minZ = bounds.minZ;
    this.cols = Math.ceil((bounds.maxX - bounds.minX) / NAV_CELL);
    this.rows = Math.ceil((bounds.maxZ - bounds.minZ) / NAV_CELL);
    this.count = this.cols * this.rows;
    this.blocked = new Uint8Array(this.count);
    const infl2 = inflate * inflate;

    for (const c of world.colliders) {
      if (!c.blocksMove) continue;
      if (c.y1 <= 0.5 || c.y0 >= 1.7) continue;
      const i0 = Math.max(0, Math.floor((c.minX - inflate - this.minX) / NAV_CELL));
      const i1 = Math.min(this.cols - 1, Math.floor((c.maxX + inflate - this.minX) / NAV_CELL));
      const j0 = Math.max(0, Math.floor((c.minZ - inflate - this.minZ) / NAV_CELL));
      const j1 = Math.min(this.rows - 1, Math.floor((c.maxZ + inflate - this.minZ) / NAV_CELL));
      for (let j = j0; j <= j1; j++) {
        const z = this.minZ + (j + 0.5) * NAV_CELL;
        for (let i = i0; i <= i1; i++) {
          const x = this.minX + (i + 0.5) * NAV_CELL;
          const dx = x - c.cx;
          const dz = z - c.cz;
          const lx = Math.abs(c.cos * dx - c.sin * dz);
          const lz = Math.abs(c.sin * dx + c.cos * dz);
          const qx = Math.max(lx - c.hx, 0);
          const qz = Math.max(lz - c.hz, 0);
          if (qx * qx + qz * qz <= infl2) this.blocked[j * this.cols + i] = 1;
        }
      }
    }
    // keep a margin from the map edge
    const m = 0.6;
    for (let j = 0; j < this.rows; j++) {
      const z = this.minZ + (j + 0.5) * NAV_CELL;
      for (let i = 0; i < this.cols; i++) {
        const x = this.minX + (i + 0.5) * NAV_CELL;
        if (x < bounds.minX + m || x > bounds.maxX - m || z < bounds.minZ + m || z > bounds.maxZ - m) {
          this.blocked[j * this.cols + i] = 1;
        }
      }
    }
  }

  index(x: number, z: number): number {
    const i = Math.floor((x - this.minX) / NAV_CELL);
    const j = Math.floor((z - this.minZ) / NAV_CELL);
    if (i < 0 || j < 0 || i >= this.cols || j >= this.rows) return -1;
    return j * this.cols + i;
  }

  cellCenterX(idx: number): number {
    return this.minX + ((idx % this.cols) + 0.5) * NAV_CELL;
  }

  cellCenterZ(idx: number): number {
    return this.minZ + (Math.floor(idx / this.cols) + 0.5) * NAV_CELL;
  }

  isBlockedAt(x: number, z: number): boolean {
    const i = this.index(x, z);
    return i < 0 || this.blocked[i] === 1;
  }

  /** Nearest unblocked cell index within `maxCells` (ring search), or -1. */
  nearestFree(x: number, z: number, maxCells = 16): number {
    const c = this.index(x, z);
    if (c >= 0 && this.blocked[c] === 0) return c;
    const ci = Math.floor((x - this.minX) / NAV_CELL);
    const cj = Math.floor((z - this.minZ) / NAV_CELL);
    for (let r = 1; r <= maxCells; r++) {
      let best = -1;
      let bestD = Infinity;
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          const i = ci + di;
          const j = cj + dj;
          if (i < 0 || j < 0 || i >= this.cols || j >= this.rows) continue;
          const idx = j * this.cols + i;
          if (this.blocked[idx] === 1) continue;
          const d = di * di + dj * dj;
          if (d < bestD) {
            bestD = d;
            best = idx;
          }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  /** True if the straight segment crosses no blocked cell. */
  los(x0: number, z0: number, x1: number, z1: number): boolean {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(len / 0.25));
    const sx = dx / steps;
    const sz = dz / steps;
    let x = x0;
    let z = z0;
    for (let s = 0; s <= steps; s++) {
      const i = Math.floor((x - this.minX) / NAV_CELL);
      const j = Math.floor((z - this.minZ) / NAV_CELL);
      if (i < 0 || j < 0 || i >= this.cols || j >= this.rows) return false;
      if (this.blocked[j * this.cols + i] === 1) return false;
      x += sx;
      z += sz;
    }
    return true;
  }

  /** Random unblocked point near (x, z), or null. */
  randomFreeNear(x: number, z: number, radius: number, rand: () => number): { x: number; z: number } | null {
    for (let k = 0; k < 12; k++) {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * radius;
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      if (!this.isBlockedAt(px, pz)) return { x: px, z: pz };
    }
    return null;
  }

  /** Paint the blocked cells (and optionally a flow field) to a canvas for debugging. */
  drawDebug(ctx: CanvasRenderingContext2D, scale = 3, field?: FlowField): void {
    const w = this.cols;
    const h = this.rows;
    ctx.canvas.width = w * scale;
    ctx.canvas.height = h * scale;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const idx = j * w + i;
        if (this.blocked[idx]) ctx.fillStyle = '#933';
        else if (field && field.dist[idx] === UNREACHABLE) ctx.fillStyle = '#c0c';
        else if (field) {
          const d = Math.min(255, field.dist[idx]! / 8);
          ctx.fillStyle = `rgb(${d}, ${255 - d}, 80)`;
        } else ctx.fillStyle = '#243';
        ctx.fillRect(i * scale, j * scale, scale, scale);
      }
    }
  }
}

export class FlowField {
  /** Path cost to the goal in cost units (10 per orthogonal cell). UNREACHABLE when cut off. */
  readonly dist: Int32Array;
  goalIndex = -1;
  version = 0;
  private readonly buckets: number[][] = Array.from({ length: BUCKETS }, () => []);

  constructor(private readonly grid: NavGrid) {
    this.dist = new Int32Array(grid.count).fill(UNREACHABLE);
  }

  /** Recompute distances from the cell nearest to (goalX, goalZ). Returns false if the goal has no free cell. */
  compute(goalX: number, goalZ: number): boolean {
    const g = this.grid;
    const start = g.nearestFree(goalX, goalZ, 20);
    if (start < 0) return false;
    const dist = this.dist;
    dist.fill(UNREACHABLE);
    const buckets = this.buckets;
    for (const b of buckets) b.length = 0;
    dist[start] = 0;
    buckets[0]!.push(start);
    let pending = 1;
    const cols = g.cols;
    const rows = g.rows;
    const blocked = g.blocked;
    let d = 0;
    while (pending > 0) {
      const bucket = buckets[d % BUCKETS]!;
      while (bucket.length > 0) {
        const idx = bucket.pop()!;
        pending--;
        if (dist[idx] !== d) continue; // stale entry
        const ix = idx % cols;
        const iz = (idx - ix) / cols;
        for (let k = 0; k < 8; k++) {
          const nx = ix + DX[k]!;
          const nz = iz + DZ[k]!;
          if (nx < 0 || nz < 0 || nx >= cols || nz >= rows) continue;
          const n = nz * cols + nx;
          if (blocked[n] === 1) continue;
          if (k >= 4) {
            // no corner cutting
            if (blocked[iz * cols + nx] === 1 || blocked[nz * cols + ix] === 1) continue;
          }
          const nd = d + DW[k]!;
          if (nd < dist[n]!) {
            dist[n] = nd;
            buckets[nd % BUCKETS]!.push(n);
            pending++;
          }
        }
      }
      d++;
    }
    this.goalIndex = start;
    this.version++;
    return true;
  }

  /** Path distance in metres from a world position to the goal (Infinity if unreachable / off-grid). */
  distanceMeters(x: number, z: number): number {
    let i = this.grid.index(x, z);
    if (i < 0) return Infinity;
    if (this.grid.blocked[i] === 1) {
      i = this.grid.nearestFree(x, z, 3);
      if (i < 0) return Infinity;
    }
    const d = this.dist[i]!;
    return d === UNREACHABLE ? Infinity : d * (NAV_CELL / COST_ORTH);
  }

  isReachable(x: number, z: number): boolean {
    return this.distanceMeters(x, z) !== Infinity;
  }

  /**
   * Next steering target for an agent at (x, z): follows the steepest descent for up to `look` cells and picks the
   * farthest waypoint that is still in a straight, unobstructed line (funnel). Returns false at the goal / no path.
   */
  follow(x: number, z: number, out: { x: number; z: number }, look = 10): boolean {
    const g = this.grid;
    const cols = g.cols;
    const rows = g.rows;
    const dist = this.dist;
    let cur = g.index(x, z);
    if (cur < 0) return false;
    if (g.blocked[cur] === 1) {
      cur = g.nearestFree(x, z, 3);
      if (cur < 0) return false;
    }
    if (dist[cur] === UNREACHABLE) return false;
    let px0 = 0;
    // walk down the field
    let n = 0;
    const path = this.pathScratch;
    for (let s = 0; s < look; s++) {
      const ix = cur % cols;
      const iz = (cur - ix) / cols;
      let best = -1;
      let bestD = dist[cur]!;
      for (let k = 0; k < 8; k++) {
        const nx = ix + DX[k]!;
        const nz = iz + DZ[k]!;
        if (nx < 0 || nz < 0 || nx >= cols || nz >= rows) continue;
        const ni = nz * cols + nx;
        const nd = dist[ni]!;
        if (nd >= bestD) continue;
        if (k >= 4 && (g.blocked[iz * cols + nx] === 1 || g.blocked[nz * cols + ix] === 1)) continue;
        bestD = nd;
        best = ni;
      }
      if (best < 0) break;
      path[n++] = best;
      cur = best;
      if (bestD === 0) break;
    }
    if (n === 0) return false;
    // funnel: farthest visible waypoint
    let pick = path[0]!;
    for (let s = n - 1; s > 0; s--) {
      const c = path[s]!;
      if (g.los(x, z, g.cellCenterX(c), g.cellCenterZ(c))) {
        pick = c;
        break;
      }
    }
    px0 = pick;
    out.x = g.cellCenterX(px0);
    out.z = g.cellCenterZ(px0);
    return true;
  }

  private readonly pathScratch = new Int32Array(64);
}
