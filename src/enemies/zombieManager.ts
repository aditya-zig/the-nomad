/**
 * Owns every infected: rig pooling, ambient population, the spawn director, LOD (dormant far zombies), spatial hash for
 * separation, noise / alert propagation, hit detection (head sphere + body cylinder), explosions and corpse cleanup.
 */
import * as THREE from 'three';
import { MISSION, SPAWN, ZOMBIES, ZOMBIE_AI } from '../config';
import { activeCap, pickSpawnType, spawnInterval, type SpawnType } from '../logic/director';
import type { Rng } from '../logic/rng';
import type { QualityLevel, Region, ZombieType } from '../types';
import type { Level } from '../world/level';
import type { SpawnGroup } from '../world/layout/data';
import { Zombie, type ZombieEnv, type ZombieState } from './zombie';
import type { ZombieFactory, ZombieRig } from './zombieRigTypes';

export interface ZombieHit {
  zombie: Zombie;
  t: number;
  head: boolean;
  x: number;
  y: number;
  z: number;
}

class SpatialGrid {
  private readonly cell = 1.6;
  private readonly cols: number;
  private readonly rows: number;
  private readonly cells: Zombie[][];
  private readonly touched: number[] = [];
  constructor(private readonly minX: number, private readonly minZ: number, w: number, d: number) {
    this.cols = Math.ceil(w / this.cell) + 2;
    this.rows = Math.ceil(d / this.cell) + 2;
    this.cells = Array.from({ length: this.cols * this.rows }, () => []);
  }
  clear(): void {
    for (const i of this.touched) this.cells[i]!.length = 0;
    this.touched.length = 0;
  }
  private idx(x: number, z: number): number {
    const i = Math.min(this.cols - 1, Math.max(0, Math.floor((x - this.minX) / this.cell)));
    const j = Math.min(this.rows - 1, Math.max(0, Math.floor((z - this.minZ) / this.cell)));
    return j * this.cols + i;
  }
  insert(z: Zombie): void {
    const i = this.idx(z.x, z.z);
    const c = this.cells[i]!;
    if (c.length === 0) this.touched.push(i);
    c.push(z);
  }
  query(x: number, z: number, out: Zombie[]): void {
    out.length = 0;
    const ci = Math.floor((x - this.minX) / this.cell);
    const cj = Math.floor((z - this.minZ) / this.cell);
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const i = ci + di;
        const j = cj + dj;
        if (i < 0 || j < 0 || i >= this.cols || j >= this.rows) continue;
        const c = this.cells[j * this.cols + i]!;
        for (let k = 0; k < c.length; k++) out.push(c[k]!);
      }
    }
  }
}

export interface DirectorContext {
  elapsed: number;
  playerX: number;
  playerZ: number;
  playerYaw: number;
  playerEyeY: number;
  region: Region;
  phase: number;
  quality: QualityLevel;
  /** Defense contract running: burst spawns around the relay. */
  defenseActive: boolean;
  /** Extraction called: seconds since the call (null when not running). */
  extractionElapsed: number | null;
  /** Freeze all spawning (cinematics). */
  paused: boolean;
}

interface PendingSpawn {
  type: SpawnType;
  at: number;
  group: SpawnGroup;
}

export class ZombieManager {
  readonly root = new THREE.Group();
  readonly zombies: Zombie[] = [];
  boss: Zombie | null = null;
  private readonly pools = new Map<ZombieType, ZombieRig[]>();
  private nextId = 1;
  private readonly grid: SpatialGrid;
  private readonly nearby: Zombie[] = [];
  private lodTimer = 0;
  private spawnTimer = 6;
  private burstTimer = 4;
  private nextWave = 0;
  private pending: PendingSpawn[] = [];
  private simTime = 0;
  /** Counters for the results screen / tests. */
  totalSpawned = 0;
  readonly tmpV = new THREE.Vector3();
  private readonly tmpHead = new THREE.Vector3();

  onKill: (z: Zombie, head: boolean) => void = () => {};

  constructor(
    private readonly factory: ZombieFactory,
    private readonly level: Level,
  ) {
    this.root.name = 'Zombies';
    const b = level.data.bounds;
    this.grid = new SpatialGrid(b.minX - 2, b.minZ - 2, b.maxX - b.minX + 4, b.maxZ - b.minZ + 4);
  }

  // ---------------------------------------------------------------------------------------------
  // pooling / population
  // ---------------------------------------------------------------------------------------------

  private acquireRig(type: ZombieType): ZombieRig {
    const pool = this.pools.get(type);
    const rig = pool?.pop();
    if (rig) return rig;
    const created = this.factory.create(type, this.nextId * 131);
    this.root.add(created.root);
    return created;
  }

  private releaseZombie(z: Zombie): void {
    z.rig.setVisible(false);
    let pool = this.pools.get(z.type);
    if (!pool) {
      pool = [];
      this.pools.set(z.type, pool);
    }
    pool.push(z.rig);
    if (this.boss === z) this.boss = null;
    const i = this.zombies.indexOf(z);
    if (i >= 0) this.zombies.splice(i, 1);
  }

  spawn(type: ZombieType, x: number, z: number, rng: Rng, opts: { state?: ZombieState; ambient?: boolean; boss?: boolean; hpScale?: number; yaw?: number } = {}): Zombie {
    const rig = this.acquireRig(type);
    const zz = new Zombie(this.nextId++, type, rig);
    zz.init(x, z, opts.yaw ?? rng.f() * Math.PI * 2, rng, opts);
    this.zombies.push(zz);
    this.totalSpawned++;
    return zz;
  }

  /** Remove everything (restart). Rigs go back to the pools. */
  clearAll(): void {
    for (const z of [...this.zombies]) this.releaseZombie(z);
    this.boss = null;
    this.pending.length = 0;
    this.nextWave = 0;
    this.spawnTimer = 6;
    this.burstTimer = 4;
  }

  /** Seed the level with its ambient (idle) population and the Warden. */
  populate(rng: Rng): void {
    for (const a of this.level.data.ambient) {
      this.spawn(a.type, a.x, a.z, rng, { ambient: true });
    }
    const h = this.level.data.hunt;
    this.boss = this.spawn('warden', h.wardenX, h.wardenZ, rng, { boss: true, ambient: true, yaw: Math.PI });
  }

  get aliveCount(): number {
    let n = 0;
    for (const z of this.zombies) if (z.alive) n++;
    return n;
  }

  /** Active (awake, alive) enemy count used against the director cap. */
  get activeCount(): number {
    let n = 0;
    for (const z of this.zombies) if (z.alive && !z.dormant && !z.isBoss) n++;
    return n;
  }

  // ---------------------------------------------------------------------------------------------
  // per-frame update
  // ---------------------------------------------------------------------------------------------

  update(dt: number, env: ZombieEnv, aiEnabled: boolean): void {
    this.simTime += dt;
    const p = env.player;
    // spatial hash of living zombies
    this.grid.clear();
    for (const z of this.zombies) if (z.alive && !z.dormant) this.grid.insert(z);

    // LOD every 0.4 s
    this.lodTimer -= dt;
    if (this.lodTimer <= 0) {
      this.lodTimer = 0.4;
      for (const z of this.zombies) {
        const d2 = (z.x - p.x) * (z.x - p.x) + (z.z - p.z) * (z.z - p.z);
        if (z.dormant && d2 < 78 * 78) {
          z.dormant = false;
          z.rig.setVisible(true);
        } else if (!z.dormant && d2 > 88 * 88 && !z.chasing && !z.isBoss) {
          z.dormant = true;
          z.rig.setVisible(false);
        }
      }
    }

    for (let i = this.zombies.length - 1; i >= 0; i--) {
      const z = this.zombies[i]!;
      if (z.dormant) continue;
      const dxp = z.x - p.x;
      const dzp = z.z - p.z;
      const d2p = dxp * dxp + dzp * dzp;
      z.setShadowLod(z.isBoss ? d2p < 40 * 40 : z.shadowOn ? d2p < 30 * 30 : d2p < 26 * 26);
      if (!aiEnabled && z.alive) {
        // title screen: idle animation only
        z.update(dt, { ...env, player: { ...env.player, alive: false } }, this.nearby);
        continue;
      }
      if (z.alive) this.grid.query(z.x, z.z, this.nearby);
      else this.nearby.length = 0;
      z.update(dt, env, this.nearby);
    }

    // corpse cleanup
    let corpses = 0;
    for (let i = this.zombies.length - 1; i >= 0; i--) {
      const z = this.zombies[i]!;
      if (z.alive) continue;
      corpses++;
      if (z.deathT > ZOMBIE_AI.corpseLifetime || z.dormant) {
        this.releaseZombie(z);
        corpses--;
      }
    }
    if (corpses > ZOMBIE_AI.maxCorpses) {
      const dead = this.zombies.filter((z) => !z.alive).sort((a, b) => a.diedAt - b.diedAt);
      for (let i = 0; i < corpses - ZOMBIE_AI.maxCorpses; i++) this.releaseZombie(dead[i]!);
    }
  }

  /** Mutual push between the player and nearby zombies (player yields less). Returns the displacement to apply to the player. */
  pushPlayer(px: number, pz: number, out: { x: number; z: number }): void {
    out.x = 0;
    out.z = 0;
    this.grid.query(px, pz, this.nearby);
    for (const z of this.nearby) {
      if (!z.alive) continue;
      const dx = px - z.x;
      const dz = pz - z.z;
      const d = Math.hypot(dx, dz);
      const min = z.def.radius + 0.34;
      if (d < min && d > 1e-4) {
        const o = min - d;
        out.x += (dx / d) * o * 0.4;
        out.z += (dz / d) * o * 0.4;
        z.x -= (dx / d) * o * 0.6;
        z.z -= (dz / d) * o * 0.6;
      }
    }
  }

  // ---------------------------------------------------------------------------------------------
  // noise & alerts
  // ---------------------------------------------------------------------------------------------

  emitNoise(x: number, z: number, radius: number): void {
    const r2 = radius * radius;
    for (const zz of this.zombies) {
      if (!zz.alive || zz.state !== 'idle') continue;
      const dx = zz.x - x;
      const dz = zz.z - z;
      const d2 = dx * dx + dz * dz;
      if (d2 > r2) continue;
      zz.hear(x, z, 0.1 + (Math.sqrt(d2) / radius) * 1.4);
      if (zz.dormant && d2 < 78 * 78) {
        zz.dormant = false;
        zz.rig.setVisible(true);
      }
    }
  }

  alertNear(x: number, z: number, radius: number, srcId: number): void {
    const r2 = radius * radius;
    for (const zz of this.zombies) {
      if (zz.id === srcId || !zz.alive || zz.state !== 'idle' || zz.dormant) continue;
      const dx = zz.x - x;
      const dz = zz.z - z;
      if (dx * dx + dz * dz < r2) zz.hear(x, z, 0.3 + Math.random() * 0.9);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // hit detection
  // ---------------------------------------------------------------------------------------------

  /** Nearest zombie hit by a ray (head sphere or body cylinder), before `maxT`. */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): ZombieHit | null {
    let best: ZombieHit | null = null;
    let bestT = maxT;
    for (const z of this.zombies) {
      if (!z.alive || z.dormant) continue;
      // cheap reject: distance from the ray to the zombie's column
      const cx = z.x - ox;
      const cz = z.z - oz;
      const along = cx * dx + cz * dz;
      if (along < -2) continue;
      const hrad = Math.hypot(dx, dz);
      if (hrad > 1e-6) {
        const perp = Math.abs(cx * dz - cz * dx) / hrad;
        if (perp > z.def.radius + 1.6) continue;
      }
      z.rig.getHeadWorld(this.tmpHead);
      const headT = raySphere(ox, oy, oz, dx, dy, dz, this.tmpHead.x, this.tmpHead.y, this.tmpHead.z, z.def.headRadius * 1.08);
      const bodyTop = Math.max(0.6, z.def.height - z.def.headRadius * 1.6);
      const bodyT = rayCylinder(ox, oy, oz, dx, dy, dz, z.x, z.z, z.def.radius * 0.88, 0.05, bodyTop);
      let t = -1;
      let head = false;
      if (headT >= 0 && (bodyT < 0 || headT <= bodyT + 0.03)) {
        t = headT;
        head = true;
      } else if (bodyT >= 0) {
        t = bodyT;
      }
      if (t >= 0 && t < bestT) {
        bestT = t;
        best = { zombie: z, t, head, x: ox + dx * t, y: oy + dy * t, z: oz + dz * t };
      }
    }
    return best;
  }

  /** Radial explosion damage with cover checks. Returns the number of kills. */
  explode(cx: number, cy: number, cz: number, radius: number, centerDamage: number, edgeDamage: number, coverMul: number, env: ZombieEnv, knock: number): number {
    let kills = 0;
    for (const z of this.zombies) {
      if (!z.alive || z.dormant) continue;
      const dx = z.x - cx;
      const dz = z.z - cz;
      const d = Math.hypot(dx, dz);
      if (d > radius + z.def.radius) continue;
      const covered = env.world.segmentBlocked(cx, cy + 0.3, cz, z.x, 1.0, z.z, 'shots');
      if (covered && coverMul <= 0) continue;
      let dmg = centerDamage + (edgeDamage - centerDamage) * Math.min(1, d / radius);
      if (covered) dmg *= coverMul;
      const ang = Math.atan2(-dx, -dz);
      const killed = z.takeDamage(dmg, false, env, ang + Math.PI, 3);
      if (killed) {
        kills++;
        z.diedAt = this.simTime;
        this.onKill(z, false);
      } else if (!z.isBoss) {
        z.vx += (dx / Math.max(d, 0.3)) * knock;
        z.vz += (dz / Math.max(d, 0.3)) * knock;
        if (dmg > 40 && z.type !== 'armored') z.stagger(0.7, env);
      }
    }
    return kills;
  }

  /** Apply damage from a bullet. Returns true when the zombie died. */
  damage(z: Zombie, amount: number, head: boolean, env: ZombieEnv, shotYaw: number): boolean {
    const killed = z.takeDamage(amount, head, env, shotYaw, 1);
    if (killed) {
      z.diedAt = this.simTime;
      this.onKill(z, head);
    }
    return killed;
  }

  // ---------------------------------------------------------------------------------------------
  // director
  // ---------------------------------------------------------------------------------------------

  /** Continuous spawning by threat region and phase, plus defense bursts and extraction waves. */
  director(dt: number, ctx: DirectorContext, env: ZombieEnv, rng: Rng): void {
    if (ctx.paused) return;
    const active = this.activeCount;
    let nearAlerted = 0;
    const r2 = SPAWN.nearbyRadius * SPAWN.nearbyRadius;
    for (const z of this.zombies) {
      if (!z.alive || z.dormant || !z.chasing) continue;
      const dx = z.x - ctx.playerX;
      const dz = z.z - ctx.playerZ;
      if (dx * dx + dz * dz < r2) nearAlerted++;
    }

    // ---- extraction final horde: scripted waves ----
    if (ctx.extractionElapsed !== null) {
      const waves = MISSION.extraction.waves;
      while (this.nextWave < waves.length && ctx.extractionElapsed >= waves[this.nextWave]!.at) {
        const w = waves[this.nextWave]!;
        for (let i = 0; i < w.count; i++) {
          const type: SpawnType = i < w.armored ? 'armored' : rng.chance(MISSION.extraction.runnerFraction) ? 'runner' : 'shambler';
          this.pending.push({ type, at: this.simTime + i * 0.45 + rng.f() * 0.3, group: 'lz' });
        }
        this.nextWave++;
      }
    }
    if (this.pending.length > 0) {
      const cap = ctx.extractionElapsed !== null ? MISSION.extraction.activeCap : 40;
      let awake = active;
      for (let i = 0; i < this.pending.length; i++) {
        const s = this.pending[i]!;
        if (s.at > this.simTime) continue;
        if (awake >= cap) break;
        if (this.spawnFrom(s.type, s.group, ctx, env, rng, 0)) {
          awake++;
          this.pending.splice(i, 1);
          i--;
        } else if (s.at + 6 < this.simTime) {
          // could not find a valid point for a while: drop it rather than pile up
          this.pending.splice(i, 1);
          i--;
        }
      }
    }

    // ---- defense bursts ----
    if (ctx.defenseActive) {
      this.burstTimer -= dt;
      if (this.burstTimer <= 0 && active < MISSION.defense.activeCap) {
        this.burstTimer = MISSION.defense.burstEvery * (0.85 + rng.f() * 0.3);
        for (let i = 0; i < MISSION.defense.burstSize; i++) {
          const type = pickSpawnType('medium', ctx.phase, rng);
          this.pending.push({ type, at: this.simTime + i * 0.6, group: 'defense' });
        }
      }
    }

    // ---- continuous ambient pressure by region ----
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      let interval = spawnInterval(ctx.region, ctx.phase);
      if (ctx.defenseActive) interval = Math.min(interval, MISSION.defense.spawnInterval);
      this.spawnTimer = interval * (0.8 + rng.f() * 0.4);
      let cap = activeCap(ctx.region, ctx.phase, ctx.quality);
      if (ctx.defenseActive) cap = Math.max(cap, MISSION.defense.activeCap);
      if (ctx.extractionElapsed !== null) cap = Math.min(cap, MISSION.extraction.activeCap);
      if (active < cap && nearAlerted < SPAWN.nearbyLimit) {
        const type = pickSpawnType(ctx.region, ctx.phase, rng);
        this.spawnFrom(type, ctx.defenseActive ? 'defense' : 'general', ctx, env, rng, ctx.phase);
      }
    }
  }

  /** Try to place a zombie at a valid, reachable, concealed spawn point. */
  private spawnFrom(type: SpawnType, group: SpawnGroup, ctx: DirectorContext, env: ZombieEnv, rng: Rng, phase: number): boolean {
    const pts = this.level.data.spawnPoints;
    const fx = -Math.sin(ctx.playerYaw);
    const fz = -Math.cos(ctx.playerYaw);
    const relaxed = group !== 'general';
    let chosen = -1;
    let bestScore = -1;
    for (let attempt = 0; attempt < 28; attempt++) {
      const i = Math.floor(rng.f() * pts.length);
      const sp = pts[i]!;
      if (sp.group !== group && !(group === 'defense' && sp.group === 'general')) continue;
      const dx = sp.x - ctx.playerX;
      const dz = sp.z - ctx.playerZ;
      const dist = Math.hypot(dx, dz);
      if (dist < (group === 'lz' ? 26 : relaxed ? 18 : SPAWN.minDistance) || dist > (relaxed ? 90 : SPAWN.maxDistance)) continue;
      if (!env.field.isReachable(sp.x, sp.z)) continue;
      if (SPAWN.hiddenFromPlayer && !relaxed) {
        const front = (dx * fx + dz * fz) / dist > 0.25;
        const blocked = env.world.segmentBlocked(ctx.playerX, ctx.playerEyeY, ctx.playerZ, sp.x, 1.4, sp.z, 'shots');
        if (front && !blocked && dist < 60) continue;
      }
      // avoid stacking on another zombie
      let crowded = false;
      for (const z of this.zombies) {
        if (z.alive && Math.abs(z.x - sp.x) < 1.6 && Math.abs(z.z - sp.z) < 1.6) {
          crowded = true;
          break;
        }
      }
      if (crowded) continue;
      // prefer mid-range, concealed points
      const score = sp.weight * (0.5 + rng.f()) * (1 - Math.abs(dist - 40) / 80);
      if (score > bestScore) {
        bestScore = score;
        chosen = i;
      }
    }
    if (chosen < 0) return false;
    const sp = pts[chosen]!;
    const z = this.spawn(type, sp.x, sp.z, rng, { hpScale: 1 + 0.08 * phase, yaw: Math.atan2(-(ctx.playerX - sp.x), -(ctx.playerZ - sp.z)) });
    z.aggro(ctx.playerX, ctx.playerZ);
    return true;
  }
}

// ---------------------------------------------------------------------------------------------
// ray helpers
// ---------------------------------------------------------------------------------------------

function raySphere(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, cx: number, cy: number, cz: number, r: number): number {
  const lx = ox - cx;
  const ly = oy - cy;
  const lz = oz - cz;
  const b = lx * dx + ly * dy + lz * dz;
  const c = lx * lx + ly * ly + lz * lz - r * r;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const s = Math.sqrt(disc);
  const t = -b - s;
  if (t >= 0) return t;
  const t2 = -b + s;
  return t2 >= 0 ? t2 : -1;
}

/** Vertical cylinder (axis through (cx, cz)) with end caps; returns the entry distance or -1. */
function rayCylinder(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, cx: number, cz: number, r: number, y0: number, y1: number): number {
  const lx = ox - cx;
  const lz = oz - cz;
  let best = Infinity;
  const a = dx * dx + dz * dz;
  if (a > 1e-9) {
    const b = 2 * (lx * dx + lz * dz);
    const c = lx * lx + lz * lz - r * r;
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      for (const t of [(-b - s) / (2 * a), (-b + s) / (2 * a)]) {
        if (t < 0) continue;
        const y = oy + dy * t;
        if (y >= y0 && y <= y1 && t < best) best = t;
      }
    }
  }
  if (Math.abs(dy) > 1e-9) {
    for (const yc of [y0, y1]) {
      const t = (yc - oy) / dy;
      if (t < 0 || t >= best) continue;
      const px = lx + dx * t;
      const pz = lz + dz * t;
      if (px * px + pz * pz <= r * r) best = t;
    }
  }
  return best === Infinity ? -1 : best;
}

export { ZOMBIES };
