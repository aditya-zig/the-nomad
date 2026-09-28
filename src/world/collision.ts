/**
 * Static world collision: oriented boxes (rotated about Y) with a vertical extent, stored in a uniform
 * spatial grid. Supports circle push-out (player / enemies), sphere bounce (grenades) and grid-DDA raycasts
 * (bullets, line of sight, melee wall checks).
 *
 * Conventions: +Y up, ground plane at y = 0, rotation `rot` is the same angle as THREE `object.rotation.y`, so a mesh
 * and its collider created with the same angle line up: world = centre + M * local with
 * x = cos * lx + sin * lz and z = -sin * lx + cos * lz.
 */
import type { SurfaceKind } from '../types';

export type MapKind = 'building' | 'wall' | 'container' | 'vehicle' | 'prop' | 'fence' | 'tank' | 'none';

export interface ColliderSpec {
  /** Centre of the box in the XZ plane. */
  x: number;
  z: number;
  /** Half extents in local X / Z. */
  hx: number;
  hz: number;
  rot?: number;
  /** Bottom / top of the box. Defaults: y0 = 0. */
  y0?: number;
  y1: number;
  /** Blocks movement of players / enemies (default true). */
  blocksMove?: boolean;
  /** Blocks bullets, sight and explosions (default true). Chain-link fences set this false. */
  blocksShots?: boolean;
  surface?: SurfaceKind;
  /** How the collider is drawn on the tactical map ('none' = hidden). */
  mapKind?: MapKind;
  tag?: string;
}

export interface BoxCollider {
  id: number;
  cx: number;
  cz: number;
  hx: number;
  hz: number;
  rot: number;
  cos: number;
  sin: number;
  y0: number;
  y1: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  blocksMove: boolean;
  blocksShots: boolean;
  surface: SurfaceKind;
  mapKind: MapKind;
  tag: string;
}

export type RayFilter = 'shots' | 'move';

export interface RayHit {
  t: number;
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  /** The collider that was hit, or null when the ground plane was hit. */
  collider: BoxCollider | null;
  surface: SurfaceKind;
}

export function makeRayHit(): RayHit {
  return { t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, collider: null, surface: 'concrete' };
}

export interface WorldBoundsXZ {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

const EPS = 1e-6;

export class CollisionWorld {
  readonly colliders: BoxCollider[] = [];
  readonly bounds: WorldBoundsXZ;
  private readonly cell = 4;
  private readonly cols: number;
  private readonly rows: number;
  private readonly grid: number[][];
  private stamp: number[] = [];
  private stampCounter = 1;
  /** Surface material of the ground plane at a location (defaults to concrete). */
  groundSurface: (x: number, z: number) => SurfaceKind = () => 'concrete';

  constructor(bounds: WorldBoundsXZ) {
    // pad so colliders slightly outside the playable bounds (perimeter walls) are still indexed
    this.bounds = { minX: bounds.minX - 12, maxX: bounds.maxX + 12, minZ: bounds.minZ - 12, maxZ: bounds.maxZ + 12 };
    this.cols = Math.ceil((this.bounds.maxX - this.bounds.minX) / this.cell);
    this.rows = Math.ceil((this.bounds.maxZ - this.bounds.minZ) / this.cell);
    this.grid = Array.from({ length: this.cols * this.rows }, () => []);
  }

  add(spec: ColliderSpec): BoxCollider {
    const rot = spec.rot ?? 0;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const ex = Math.abs(cos) * spec.hx + Math.abs(sin) * spec.hz;
    const ez = Math.abs(sin) * spec.hx + Math.abs(cos) * spec.hz;
    const c: BoxCollider = {
      id: this.colliders.length,
      cx: spec.x,
      cz: spec.z,
      hx: spec.hx,
      hz: spec.hz,
      rot,
      cos,
      sin,
      y0: spec.y0 ?? 0,
      y1: spec.y1,
      minX: spec.x - ex,
      maxX: spec.x + ex,
      minZ: spec.z - ez,
      maxZ: spec.z + ez,
      blocksMove: spec.blocksMove ?? true,
      blocksShots: spec.blocksShots ?? true,
      surface: spec.surface ?? 'concrete',
      mapKind: spec.mapKind ?? 'prop',
      tag: spec.tag ?? '',
    };
    this.colliders.push(c);
    this.stamp.push(0);
    const [i0, j0] = this.cellOf(c.minX, c.minZ);
    const [i1, j1] = this.cellOf(c.maxX, c.maxZ);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        this.grid[j * this.cols + i]!.push(c.id);
      }
    }
    return c;
  }

  private cellOf(x: number, z: number): [number, number] {
    const i = Math.min(this.cols - 1, Math.max(0, Math.floor((x - this.bounds.minX) / this.cell)));
    const j = Math.min(this.rows - 1, Math.max(0, Math.floor((z - this.bounds.minZ) / this.cell)));
    return [i, j];
  }

  /** Calls `fn` for each collider whose AABB overlaps the circle's AABB (deduplicated). */
  forEachNear(x: number, z: number, r: number, fn: (c: BoxCollider) => void): void {
    const [i0, j0] = this.cellOf(x - r, z - r);
    const [i1, j1] = this.cellOf(x + r, z + r);
    const s = ++this.stampCounter;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const cellList = this.grid[j * this.cols + i]!;
        for (let k = 0; k < cellList.length; k++) {
          const id = cellList[k]!;
          if (this.stamp[id] === s) continue;
          this.stamp[id] = s;
          const c = this.colliders[id]!;
          if (c.maxX < x - r || c.minX > x + r || c.maxZ < z - r || c.minZ > z + r) continue;
          fn(c);
        }
      }
    }
  }

  /** Push a circle (position `p`, radius `r`, occupying [yMin, yMax]) out of all blocking colliders. Returns true if moved. */
  resolveCircle(p: { x: number; z: number }, r: number, yMin: number, yMax: number, iterations = 3): boolean {
    let moved = false;
    for (let it = 0; it < iterations; it++) {
      let pushed = false;
      this.forEachNear(p.x, p.z, r, (c) => {
        if (!c.blocksMove) return;
        if (c.y1 <= yMin || c.y0 >= yMax) return;
        if (pushOutCircle(c, p, r)) pushed = true;
      });
      if (!pushed) break;
      moved = true;
    }
    return moved;
  }

  /** Whether a circle overlaps any blocking collider inside the vertical range. */
  circleBlocked(x: number, z: number, r: number, yMin: number, yMax: number): boolean {
    let hit = false;
    this.forEachNear(x, z, r, (c) => {
      if (hit || !c.blocksMove) return;
      if (c.y1 <= yMin || c.y0 >= yMax) return;
      if (circleOverlapsBox(c, x, z, r)) hit = true;
    });
    return hit;
  }

  /** Top surface height under a circle footprint: highest collider top <= maxTop (else 0). */
  groundHeight(x: number, z: number, r: number, maxTop: number): number {
    let h = 0;
    this.forEachNear(x, z, r, (c) => {
      if (!c.blocksMove) return;
      if (c.y1 > maxTop || c.y1 <= h) return;
      if (circleOverlapsBox(c, x, z, r)) h = c.y1;
    });
    return h;
  }

  /** Lowest underside above `headY` inside the footprint (Infinity when clear). */
  ceilingHeight(x: number, z: number, r: number, headY: number): number {
    let h = Infinity;
    this.forEachNear(x, z, r, (c) => {
      if (!c.blocksMove) return;
      if (c.y0 < headY - 0.02 || c.y0 >= h) return;
      if (circleOverlapsBox(c, x, z, r)) h = c.y0;
    });
    return h;
  }

  /** Is the point inside any blocking collider (used for spawn validation etc.). */
  pointInSolid(x: number, y: number, z: number): boolean {
    let inside = false;
    this.forEachNear(x, z, 0.01, (c) => {
      if (inside || !c.blocksMove) return;
      if (y < c.y0 || y > c.y1) return;
      const dx = x - c.cx;
      const dz = z - c.cz;
      const lx = c.cos * dx - c.sin * dz;
      const lz = c.sin * dx + c.cos * dz;
      if (Math.abs(lx) <= c.hx && Math.abs(lz) <= c.hz) inside = true;
    });
    return inside;
  }

  /**
   * Cast a ray. `dir` must be normalised. Returns the nearest hit (colliders passing `filter`, plus the ground
   * plane for 'shots') within `maxT`, or null.
   */
  raycast(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    maxT: number,
    filter: RayFilter = 'shots',
    out: RayHit = makeRayHit(),
  ): RayHit | null {
    let bestT = maxT;
    let best: BoxCollider | null = null;
    let bnx = 0;
    let bny = 0;
    let bnz = 0;
    let groundHit = false;

    if (filter === 'shots' && dy < -EPS && oy > 0) {
      const tg = -oy / dy;
      if (tg < bestT) {
        bestT = tg;
        groundHit = true;
      }
    }

    // --- grid DDA in XZ ---
    const cs = this.cell;
    const gx = ox - this.bounds.minX;
    const gz = oz - this.bounds.minZ;
    let ix = Math.floor(gx / cs);
    let iz = Math.floor(gz / cs);
    const stepX = dx > 0 ? 1 : -1;
    const stepZ = dz > 0 ? 1 : -1;
    const tDeltaX = Math.abs(dx) > EPS ? Math.abs(cs / dx) : Infinity;
    const tDeltaZ = Math.abs(dz) > EPS ? Math.abs(cs / dz) : Infinity;
    let tMaxX = Infinity;
    let tMaxZ = Infinity;
    if (Math.abs(dx) > EPS) {
      const nextX = (dx > 0 ? ix + 1 : ix) * cs;
      tMaxX = (nextX - gx) / dx;
    }
    if (Math.abs(dz) > EPS) {
      const nextZ = (dz > 0 ? iz + 1 : iz) * cs;
      tMaxZ = (nextZ - gz) / dz;
    }
    const s = ++this.stampCounter;
    let guard = 0;
    while (guard++ < 512) {
      if (ix >= 0 && ix < this.cols && iz >= 0 && iz < this.rows) {
        const list = this.grid[iz * this.cols + ix]!;
        for (let k = 0; k < list.length; k++) {
          const id = list[k]!;
          if (this.stamp[id] === s) continue;
          this.stamp[id] = s;
          const c = this.colliders[id]!;
          if (filter === 'shots' ? !c.blocksShots : !c.blocksMove) continue;
          // slab test in local space
          const rx = ox - c.cx;
          const rz = oz - c.cz;
          const lox = c.cos * rx - c.sin * rz;
          const loz = c.sin * rx + c.cos * rz;
          const ldx = c.cos * dx - c.sin * dz;
          const ldz = c.sin * dx + c.cos * dz;
          let tmin = 0;
          let tmax = bestT;
          let axis = -1; // 0 = x, 1 = y, 2 = z
          let sign = 0;
          let miss = false;
          // X
          if (Math.abs(ldx) < EPS) {
            if (Math.abs(lox) > c.hx) miss = true;
          } else {
            let t1 = (-c.hx - lox) / ldx;
            let t2 = (c.hx - lox) / ldx;
            let sg = -1;
            if (t1 > t2) {
              const tmp = t1;
              t1 = t2;
              t2 = tmp;
              sg = 1;
            }
            if (t1 > tmin) {
              tmin = t1;
              axis = 0;
              sign = sg;
            }
            if (t2 < tmax) tmax = t2;
            if (tmin > tmax) miss = true;
          }
          // Y
          if (!miss) {
            if (Math.abs(dy) < EPS) {
              if (oy < c.y0 || oy > c.y1) miss = true;
            } else {
              let t1 = (c.y0 - oy) / dy;
              let t2 = (c.y1 - oy) / dy;
              let sg = -1;
              if (t1 > t2) {
                const tmp = t1;
                t1 = t2;
                t2 = tmp;
                sg = 1;
              }
              if (t1 > tmin) {
                tmin = t1;
                axis = 1;
                sign = sg;
              }
              if (t2 < tmax) tmax = t2;
              if (tmin > tmax) miss = true;
            }
          }
          // Z
          if (!miss) {
            if (Math.abs(ldz) < EPS) {
              if (Math.abs(loz) > c.hz) miss = true;
            } else {
              let t1 = (-c.hz - loz) / ldz;
              let t2 = (c.hz - loz) / ldz;
              let sg = -1;
              if (t1 > t2) {
                const tmp = t1;
                t1 = t2;
                t2 = tmp;
                sg = 1;
              }
              if (t1 > tmin) {
                tmin = t1;
                axis = 2;
                sign = sg;
              }
              if (t2 < tmax) tmax = t2;
              if (tmin > tmax) miss = true;
            }
          }
          if (miss || axis < 0 || tmin >= bestT || tmin < 0) continue;
          bestT = tmin;
          best = c;
          groundHit = false;
          if (axis === 0) {
            bnx = c.cos * sign;
            bny = 0;
            bnz = -c.sin * sign;
          } else if (axis === 1) {
            bnx = 0;
            bny = sign;
            bnz = 0;
          } else {
            bnx = c.sin * sign;
            bny = 0;
            bnz = c.cos * sign;
          }
        }
      } else if (guard > 2 && (ix < -1 || ix > this.cols || iz < -1 || iz > this.rows)) {
        break;
      }
      const tNext = Math.min(tMaxX, tMaxZ);
      if (tNext > bestT || tNext === Infinity) break;
      if (tMaxX < tMaxZ) {
        ix += stepX;
        tMaxX += tDeltaX;
      } else {
        iz += stepZ;
        tMaxZ += tDeltaZ;
      }
    }

    if (best) {
      out.t = bestT;
      out.x = ox + dx * bestT;
      out.y = oy + dy * bestT;
      out.z = oz + dz * bestT;
      out.nx = bnx;
      out.ny = bny;
      out.nz = bnz;
      out.collider = best;
      out.surface = best.surface;
      return out;
    }
    if (groundHit) {
      out.t = bestT;
      out.x = ox + dx * bestT;
      out.y = 0;
      out.z = oz + dz * bestT;
      out.nx = 0;
      out.ny = 1;
      out.nz = 0;
      out.collider = null;
      out.surface = this.groundSurface(out.x, out.z);
      return out;
    }
    return null;
  }

  /** True if the straight segment between two points is blocked (uses the given filter). */
  segmentBlocked(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    filter: RayFilter = 'shots',
  ): boolean {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return false;
    const inv = 1 / len;
    return this.raycast(ax, ay, az, dx * inv, dy * inv, dz * inv, len - 0.02, filter, SCRATCH_HIT) !== null;
  }

  /**
   * Move a bouncing sphere through the world. Mutates `pos` and `vel`. Returns true if it collided this step.
   */
  collideSphere(
    pos: { x: number; y: number; z: number },
    vel: { x: number; y: number; z: number },
    r: number,
    restitution: number,
    friction: number,
  ): boolean {
    let hit = false;
    // floor
    if (pos.y < r) {
      pos.y = r;
      if (vel.y < 0) {
        vel.y = -vel.y * restitution;
        if (Math.abs(vel.y) < 0.6) vel.y = 0;
        vel.x *= friction;
        vel.z *= friction;
      }
      hit = true;
    }
    this.forEachNear(pos.x, pos.z, r + 0.05, (c) => {
      if (!c.blocksMove && !c.blocksShots) return;
      if (pos.y + r < c.y0 || pos.y - r > c.y1) return;
      const dx = pos.x - c.cx;
      const dz = pos.z - c.cz;
      const lx = c.cos * dx - c.sin * dz;
      const lz = c.sin * dx + c.cos * dz;
      const cxl = Math.max(-c.hx, Math.min(c.hx, lx));
      const cyw = Math.max(c.y0, Math.min(c.y1, pos.y));
      const czl = Math.max(-c.hz, Math.min(c.hz, lz));
      let ox = lx - cxl;
      let oy = pos.y - cyw;
      let oz = lz - czl;
      let d2 = ox * ox + oy * oy + oz * oz;
      if (d2 >= r * r) return;
      let nxl: number;
      let nyw: number;
      let nzl: number;
      let pen: number;
      if (d2 < 1e-10) {
        // centre inside the box: push out through the nearest face
        const px = c.hx - Math.abs(lx);
        const pz = c.hz - Math.abs(lz);
        const py = Math.min(c.y1 - pos.y, pos.y - c.y0);
        if (py <= px && py <= pz) {
          nxl = 0;
          nzl = 0;
          nyw = c.y1 - pos.y < pos.y - c.y0 ? 1 : -1;
          pen = py + r;
        } else if (px < pz) {
          nxl = lx >= 0 ? 1 : -1;
          nyw = 0;
          nzl = 0;
          pen = px + r;
        } else {
          nxl = 0;
          nyw = 0;
          nzl = lz >= 0 ? 1 : -1;
          pen = pz + r;
        }
      } else {
        const d = Math.sqrt(d2);
        nxl = ox / d;
        nyw = oy / d;
        nzl = oz / d;
        pen = r - d;
        ox = oy = oz = 0;
        d2 = 0;
      }
      // local normal -> world
      const nx = c.cos * nxl + c.sin * nzl;
      const nz = -c.sin * nxl + c.cos * nzl;
      pos.x += nx * pen;
      pos.y += nyw * pen;
      pos.z += nz * pen;
      const vn = vel.x * nx + vel.y * nyw + vel.z * nz;
      if (vn < 0) {
        // reflect the normal component, damp the tangential component
        const tx = vel.x - vn * nx;
        const ty = vel.y - vn * nyw;
        const tz = vel.z - vn * nz;
        vel.x = tx * friction - nx * vn * restitution;
        vel.y = ty * friction - nyw * vn * restitution;
        vel.z = tz * friction - nz * vn * restitution;
      }
      hit = true;
    });
    return hit;
  }
}

const SCRATCH_HIT = makeRayHit();

/** Circle vs oriented box overlap test (XZ only). */
export function circleOverlapsBox(c: BoxCollider, x: number, z: number, r: number): boolean {
  const dx = x - c.cx;
  const dz = z - c.cz;
  const lx = c.cos * dx - c.sin * dz;
  const lz = c.sin * dx + c.cos * dz;
  const qx = Math.max(-c.hx, Math.min(c.hx, lx));
  const qz = Math.max(-c.hz, Math.min(c.hz, lz));
  const ox = lx - qx;
  const oz = lz - qz;
  return ox * ox + oz * oz < r * r;
}

/** Push circle `p` out of box `c` if overlapping. Returns true when moved. */
function pushOutCircle(c: BoxCollider, p: { x: number; z: number }, r: number): boolean {
  const dx = p.x - c.cx;
  const dz = p.z - c.cz;
  const lx = c.cos * dx - c.sin * dz;
  const lz = c.sin * dx + c.cos * dz;
  const qx = Math.max(-c.hx, Math.min(c.hx, lx));
  const qz = Math.max(-c.hz, Math.min(c.hz, lz));
  let ox = lx - qx;
  let oz = lz - qz;
  const d2 = ox * ox + oz * oz;
  if (d2 >= r * r) return false;
  let pushX: number;
  let pushZ: number;
  if (d2 > 1e-10) {
    const d = Math.sqrt(d2);
    const k = (r - d) / d;
    pushX = ox * k;
    pushZ = oz * k;
  } else {
    // centre inside the box: exit through the nearest face
    const px = c.hx - Math.abs(lx);
    const pz = c.hz - Math.abs(lz);
    if (px < pz) {
      pushX = (lx >= 0 ? 1 : -1) * (px + r);
      pushZ = 0;
    } else {
      pushX = 0;
      pushZ = (lz >= 0 ? 1 : -1) * (pz + r);
    }
    ox = 0;
    oz = 0;
  }
  p.x += c.cos * pushX + c.sin * pushZ;
  p.z += -c.sin * pushX + c.cos * pushZ;
  return true;
}
