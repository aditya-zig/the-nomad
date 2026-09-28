/**
 * A single infected: behaviour state machine (idle, alert, chase, attack, stagger, dead), steering along the shared
 * flow field, telegraphed melee attacks with wall-checked hit tests, Warden specials (slam, charge) and animation state.
 */
import { WARDEN, ZOMBIES, ZOMBIE_AI, type ZombieDef } from '../config';
import type { AudioEngineApi } from '../audio/ids';
import type { FxApi } from '../fx/fxTypes';
import type { Rng } from '../logic/rng';
import type { ZombieType } from '../types';
import type { CollisionWorld } from '../world/collision';
import type { FlowField, NavGrid } from '../world/nav';
import type { ZombieAnimState, ZombieRig } from './zombieRigTypes';

export type ZombieState = 'idle' | 'alert' | 'chase' | 'attack' | 'stagger' | 'dead';
export type AttackKind = 'melee' | 'slam' | 'charge';

export interface PlayerRef {
  x: number;
  y: number;
  z: number;
  eyeY: number;
  alive: boolean;
  sprinting: boolean;
}

export interface ZombieEnv {
  time: number;
  world: CollisionWorld;
  nav: NavGrid;
  field: FlowField;
  player: PlayerRef;
  rng: Rng;
  audio: AudioEngineApi;
  fx: FxApi;
  /** Damage the player: `kind` selects hit feedback; `knock` is an impulse away from the source (m/s). */
  hurtPlayer(amount: number, srcX: number, srcZ: number, kind: AttackKind, knock: number): void;
  /** Alert other zombies near a point (chain reaction). */
  alertNear(x: number, z: number, radius: number, srcId: number): void;
  /** Shake the camera (slams, explosions). */
  shake(strength: number): void;
}

const wrap = (a: number): number => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

export class Zombie {
  readonly id: number;
  type: ZombieType;
  def: ZombieDef;
  rig: ZombieRig;
  x = 0;
  z = 0;
  yaw = 0;
  vx = 0;
  vz = 0;
  hp = 100;
  maxHp = 100;
  state: ZombieState = 'idle';
  stateTime = 0;
  dormant = false;
  isBoss = false;
  isAmbient = false;
  homeX = 0;
  homeZ = 0;
  speedScale = 1;
  enraged = false;

  // ---- awareness ----
  private seesPlayer = false;
  private memory = 99;
  private lastKnownX = 0;
  private lastKnownZ = 0;
  private senseTimer = 0;
  private alertTimer = 0;
  private alertDelay = -1;
  private alertNoticed = false;
  // ---- steering ----
  private steerX = 0;
  private steerZ = 0;
  private steerTimer = 0;
  private hasSteer = false;
  private directUntil = 0;
  private wanderX = 0;
  private wanderZ = 0;
  private wanderWait = 1;
  private stuckTimer = 0;
  // ---- combat ----
  attackKind: AttackKind = 'melee';
  private attackTime = 0;
  private attackDidHit = false;
  private attackDir = 0;
  private cooldown = 0;
  private slamCd = 3;
  private chargeCd = 6;
  private chargeLock = false;
  private chargeBlocked = 0;
  private poise = 0;
  private staggerT = 0;
  private staggerDur = 0.5;
  private hitKick = 0;
  // ---- death ----
  deathT = 0;
  private deathStyle: 0 | 1 | 2 = 0;
  private headshotDeath = false;
  // ---- audio ----
  private voiceTimer = 3;
  private readonly anim: ZombieAnimState = {
    mode: 'idle',
    speed: 0,
    time: 0,
    actionT: 0,
    staggerT: 0,
    deathT: 0,
    aggro: 0,
    hitKick: 0,
    deathStyle: 0,
    headshotDeath: false,
    enraged: false,
  };
  private readonly tmp = { x: 0, z: 0 };
  private shadowMeshes: import('three').Mesh[] | null = null;
  shadowOn = true;
  /** Simulation time of death (for corpse ordering). */
  diedAt = 0;
  /** Nav field distance to the player (metres); refreshed periodically. */
  pathDist = Infinity;

  constructor(id: number, type: ZombieType, rig: ZombieRig) {
    this.id = id;
    this.type = type;
    this.def = ZOMBIES[type];
    this.rig = rig;
  }

  /** (Re)initialise for a fresh life. */
  init(x: number, z: number, yaw: number, rng: Rng, opts: { state?: ZombieState; ambient?: boolean; boss?: boolean; hpScale?: number } = {}): void {
    this.x = this.homeX = x;
    this.z = this.homeZ = z;
    this.yaw = yaw;
    this.vx = this.vz = 0;
    this.maxHp = this.def.hp * (opts.hpScale ?? 1);
    this.hp = this.maxHp;
    this.state = opts.state ?? 'idle';
    this.stateTime = 0;
    this.dormant = false;
    this.isBoss = opts.boss ?? false;
    this.isAmbient = opts.ambient ?? false;
    this.enraged = false;
    this.speedScale = 1 + (rng.f() * 2 - 1) * this.def.speedVariance;
    this.seesPlayer = false;
    this.memory = 99;
    this.senseTimer = rng.f() * 0.3;
    this.alertTimer = 0;
    this.alertDelay = -1;
    this.alertNoticed = false;
    this.hasSteer = false;
    this.steerTimer = rng.f() * 0.2;
    this.directUntil = 0;
    this.wanderWait = 0.5 + rng.f() * 3;
    this.wanderX = x;
    this.wanderZ = z;
    this.stuckTimer = 0;
    this.attackTime = 0;
    this.attackDidHit = false;
    this.cooldown = 0.4 + rng.f() * 0.5;
    this.slamCd = 3 + rng.f() * 3;
    this.chargeCd = 5 + rng.f() * 3;
    this.chargeLock = false;
    this.poise = 0;
    this.staggerT = 0;
    this.hitKick = 0;
    this.deathT = 0;
    this.headshotDeath = false;
    this.voiceTimer = 1 + rng.f() * 6;
    this.pathDist = Infinity;
    this.rig.reset(this.id * 7919 + Math.floor(x * 31 + z * 17));
    this.rig.setVisible(true);
    this.syncRoot();
  }

  get alive(): boolean {
    return this.state !== 'dead';
  }

  get chasing(): boolean {
    return this.state === 'chase' || this.state === 'attack' || this.state === 'alert';
  }

  /** Only zombies near the player cast shadows (the shadow pass is the most expensive part of a horde). */
  setShadowLod(near: boolean): void {
    if (near === this.shadowOn) return;
    if (!this.shadowMeshes) {
      const list: import('three').Mesh[] = [];
      this.rig.root.traverse((o) => {
        const m = o as import('three').Mesh;
        if (m.isMesh && m.castShadow) list.push(m);
      });
      this.shadowMeshes = list;
    }
    this.shadowOn = near;
    for (const m of this.shadowMeshes) m.castShadow = near;
  }

  private syncRoot(): void {
    this.rig.root.position.set(this.x, 0, this.z);
    this.rig.root.rotation.y = this.yaw;
  }

  /** Called by noise events (gunshots, sprinting) and by alerted neighbours. */
  hear(x: number, z: number, delay: number): void {
    if (this.state !== 'idle') return;
    this.lastKnownX = x;
    this.lastKnownZ = z;
    this.memory = 0;
    if (this.alertDelay < 0) this.alertDelay = delay;
  }

  /** Force this zombie to hunt the player (director spawns). */
  aggro(px: number, pz: number): void {
    if (this.state === 'dead') return;
    this.lastKnownX = px;
    this.lastKnownZ = pz;
    this.memory = 0;
    this.enterState('chase');
  }

  private enterState(s: ZombieState): void {
    this.state = s;
    this.stateTime = 0;
  }

  // ---------------------------------------------------------------------------------------------
  // damage
  // ---------------------------------------------------------------------------------------------

  /** Apply already-computed damage. Returns true if this killed the zombie. */
  takeDamage(amount: number, head: boolean, env: ZombieEnv, hitDirYaw: number, impulse = 1): boolean {
    if (this.state === 'dead' || amount <= 0) return false;
    this.hp -= amount;
    this.hitKick = 1;
    if (this.state === 'idle') {
      this.lastKnownX = env.player.x;
      this.lastKnownZ = env.player.z;
      this.memory = 0;
      this.alertDelay = 0.05;
    }
    if (this.hp <= 0) {
      this.die(head, env, hitDirYaw);
      return true;
    }
    if (this.isBoss && !this.enraged && this.hp / this.maxHp < WARDEN.rageAt) {
      this.enraged = true;
      env.audio.play('warden_roar', { pos: { x: this.x, y: 1.5, z: this.z }, volume: 1.2, priority: 3 });
    }
    // poise: enough damage in a short window staggers (the Warden is poise-immune except when charging into a wall)
    this.poise += amount * impulse;
    if (this.poise >= this.def.poise && this.state !== 'stagger') {
      this.poise = 0;
      if (!this.isBoss) this.stagger(this.def.staggerTime, env);
    }
    return false;
  }

  stagger(duration: number, env: ZombieEnv): void {
    if (this.state === 'dead') return;
    this.enterState('stagger');
    this.staggerT = 0;
    this.staggerDur = duration;
    this.vx = this.vz = 0;
    this.chargeLock = false;
    env.audio.play('zombie_hurt', { pos: { x: this.x, y: 1.4, z: this.z }, volume: 0.8, priority: 1 });
  }

  private die(head: boolean, env: ZombieEnv, hitDirYaw: number): void {
    this.enterState('dead');
    this.hp = 0;
    this.deathT = 0;
    this.headshotDeath = head;
    this.vx = this.vz = 0;
    // fall away from the shot direction relative to facing: shot from the front -> fall backwards
    const rel = Math.abs(wrap(hitDirYaw - this.yaw));
    this.deathStyle = rel > Math.PI * 0.6 ? 0 : rel < Math.PI * 0.3 ? 1 : 2;
    if (env.rng.chance(0.25)) this.deathStyle = 2;
    env.audio.play('zombie_death', { pos: { x: this.x, y: 1.2, z: this.z }, volume: this.isBoss ? 1.3 : 1, priority: 2 });
  }

  // ---------------------------------------------------------------------------------------------
  // update
  // ---------------------------------------------------------------------------------------------

  update(dt: number, env: ZombieEnv, neighbors: Zombie[]): void {
    const p = env.player;
    this.stateTime += dt;
    this.hitKick = Math.max(0, this.hitKick - dt * 5);
    this.poise = Math.max(0, this.poise - dt * 40);
    if (this.cooldown > 0) this.cooldown -= dt;
    if (this.slamCd > 0) this.slamCd -= dt;
    if (this.chargeCd > 0) this.chargeCd -= dt;

    if (this.state === 'dead') {
      this.deathT += dt;
      this.pose(env, 0);
      return;
    }

    const dx = p.x - this.x;
    const dz = p.z - this.z;
    const dist = Math.hypot(dx, dz);

    this.sense(dt, env, dist);
    this.voice(dt, env, dist);

    let moveSpeed = 0;
    switch (this.state) {
      case 'idle':
        moveSpeed = this.updateIdle(dt, env, dist);
        break;
      case 'alert':
        this.updateAlert(dt, env, dx, dz);
        break;
      case 'chase':
        moveSpeed = this.updateChase(dt, env, dx, dz, dist);
        break;
      case 'attack':
        moveSpeed = this.updateAttack(dt, env, dx, dz, dist);
        break;
      case 'stagger':
        this.staggerT += dt;
        // slide back a little
        this.vx *= Math.max(0, 1 - 6 * dt);
        this.vz *= Math.max(0, 1 - 6 * dt);
        if (this.staggerT >= this.staggerDur) {
          this.enterState(p.alive ? 'chase' : 'idle');
          this.cooldown = Math.max(this.cooldown, 0.25);
        }
        break;
      default:
        break;
    }

    // ---- separation from other zombies and the player ----
    let sx = 0;
    let sz = 0;
    const R = ZOMBIE_AI.separationRadius;
    for (let i = 0; i < neighbors.length; i++) {
      const o = neighbors[i]!;
      if (o === this || o.state === 'dead') continue;
      const ox = this.x - o.x;
      const oz = this.z - o.z;
      const d2 = ox * ox + oz * oz;
      const rr = (this.def.radius + o.def.radius) * 1.15 + (R - 0.6);
      if (d2 >= rr * rr || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      const k = (rr - d) / rr;
      // the heavier zombie pushes the lighter one
      const w = o.isBoss ? 1.6 : 1;
      sx += (ox / d) * k * w;
      sz += (oz / d) * k * w;
    }
    // keep off the player's body (mutual push is handled in the manager for the player side)
    if (p.alive && dist < this.def.radius + 0.34 + 0.05 && dist > 1e-4) {
      const k = (this.def.radius + 0.39 - dist) / 0.4;
      sx -= (dx / dist) * k * 1.5;
      sz -= (dz / dist) * k * 1.5;
    }

    // ---- integrate with wall collision ----
    const bx = this.x;
    const bz = this.z;
    const move = { x: this.x + (this.vx + sx * ZOMBIE_AI.separationStrength) * dt, z: this.z + (this.vz + sz * ZOMBIE_AI.separationStrength) * dt };
    // sub-step long moves so nothing tunnels through thin walls
    const stepLen = Math.hypot(move.x - bx, move.z - bz);
    if (stepLen > ZOMBIE_AI.maxStepDistance) {
      const n = Math.ceil(stepLen / ZOMBIE_AI.maxStepDistance);
      const p2 = { x: bx, z: bz };
      for (let i = 1; i <= n; i++) {
        p2.x = bx + ((move.x - bx) * i) / n;
        p2.z = bz + ((move.z - bz) * i) / n;
        env.world.resolveCircle(p2, this.def.radius, 0.5, 1.7, 2);
      }
      move.x = p2.x;
      move.z = p2.z;
    } else {
      env.world.resolveCircle(move, this.def.radius, 0.5, 1.7, 2);
    }
    this.x = move.x;
    this.z = move.z;
    const actual = Math.hypot(this.x - bx, this.z - bz) / Math.max(dt, 1e-4);

    // stuck detection while chasing: nudge sideways / re-path
    if (this.state === 'chase' && moveSpeed > 0.5 && actual < moveSpeed * 0.25) {
      this.stuckTimer += dt;
      if (this.stuckTimer > 0.6) {
        this.hasSteer = false;
        this.steerTimer = 0;
        this.stuckTimer = 0;
        this.directUntil = 0;
      }
    } else {
      this.stuckTimer = Math.max(0, this.stuckTimer - dt);
    }
    // charge ends when the Warden slams into something
    if (this.state === 'attack' && this.attackKind === 'charge' && this.chargeLock) {
      if (actual < WARDEN.chargeSpeed * 0.3) this.chargeBlocked += dt;
      else this.chargeBlocked = 0;
      if (this.chargeBlocked > 0.12) {
        this.chargeLock = false;
        this.chargeBlocked = 0;
        env.shake(0.5);
        env.fx.dust({ x: this.x, y: 1, z: this.z }, 1);
        env.audio.play('warden_slam', { pos: { x: this.x, y: 1, z: this.z }, volume: 1, priority: 3 });
        this.stagger(1.3, env);
      }
    }

    this.pose(env, actual);
  }

  // ---------------------------------------------------------------------------------------------
  // senses
  // ---------------------------------------------------------------------------------------------

  private sense(dt: number, env: ZombieEnv, dist: number): void {
    const p = env.player;
    this.senseTimer -= dt;
    if (this.senseTimer > 0) {
      this.memory += dt;
      return;
    }
    this.senseTimer = 0.18 + env.rng.f() * 0.08;
    let sees = false;
    if (p.alive) {
      let range = this.def.sightRange;
      if (this.state !== 'idle') range *= 1.8;
      if (p.sprinting) range = Math.max(range, ZOMBIE_AI.sprintHearing);
      if (dist < range) {
        // idle zombies have a limited field of view; awake ones see all around
        let inView = true;
        if (this.state === 'idle') {
          const facing = Math.atan2(-(p.x - this.x), -(p.z - this.z));
          inView = Math.abs(wrap(facing - this.yaw)) < 1.25 || dist < 6;
        }
        if (inView && !env.world.segmentBlocked(this.x, 1.5, this.z, p.x, p.eyeY - 0.15, p.z, 'shots')) sees = true;
      }
      // very close: they smell/hear you regardless
      if (dist < ZOMBIE_AI.footstepHearing * 0.5 && this.state === 'idle') sees = true;
    }
    this.seesPlayer = sees;
    if (sees) {
      this.memory = 0;
      this.lastKnownX = p.x;
      this.lastKnownZ = p.z;
    } else {
      this.memory += 0.2;
    }
  }

  private voice(dt: number, env: ZombieEnv, dist: number): void {
    this.voiceTimer -= dt;
    if (this.voiceTimer > 0 || dist > 38) return;
    const pos = { x: this.x, y: 1.5, z: this.z };
    if (this.state === 'chase' || this.state === 'attack') {
      const id = this.type === 'runner' ? 'zombie_snarl' : this.type === 'armored' ? 'zombie_bellow' : this.type === 'warden' ? 'warden_roar' : 'zombie_groan';
      env.audio.play(id, { pos, volume: this.type === 'warden' ? 0.9 : 0.8, priority: this.type === 'warden' ? 3 : 1, rate: 0.92 + env.rng.f() * 0.16 });
      this.voiceTimer = this.type === 'warden' ? 8 + env.rng.f() * 4 : 3.5 + env.rng.f() * 5;
    } else if (this.state === 'idle') {
      env.audio.play('zombie_groan', { pos, volume: 0.55, priority: 0, rate: 0.85 + env.rng.f() * 0.2 });
      this.voiceTimer = 6 + env.rng.f() * 8;
    } else {
      this.voiceTimer = 2;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // states
  // ---------------------------------------------------------------------------------------------

  private updateIdle(dt: number, env: ZombieEnv, dist: number): number {
    void dist;
    // notice -> alert
    if (this.seesPlayer || (this.alertDelay >= 0 && (this.alertDelay -= dt) <= 0 && this.memory < 5)) {
      this.alertDelay = -1;
      this.beginAlert(env);
      return 0;
    }
    if (this.alertDelay >= 0 && this.alertDelay <= 0) this.alertDelay = -1;
    // wander near home
    this.wanderWait -= dt;
    const dxw = this.wanderX - this.x;
    const dzw = this.wanderZ - this.z;
    const dw = Math.hypot(dxw, dzw);
    if (dw < 0.5 || this.wanderWait <= -8) {
      if (this.wanderWait <= 0) {
        const pt = env.nav.randomFreeNear(this.homeX, this.homeZ, ZOMBIE_AI.wanderRadius, () => env.rng.f());
        if (pt && env.world.segmentBlocked(this.x, 0.9, this.z, pt.x, 0.9, pt.z, 'move') === false) {
          this.wanderX = pt.x;
          this.wanderZ = pt.z;
        }
        this.wanderWait = 2 + env.rng.f() * 5;
      }
      this.vx *= Math.max(0, 1 - 8 * dt);
      this.vz *= Math.max(0, 1 - 8 * dt);
      return 0;
    }
    const sp = this.def.speedWalk * 0.55 * this.speedScale;
    this.turnToward(Math.atan2(-dxw, -dzw), this.def.turnRate * 0.5, dt);
    this.vx = (dxw / dw) * sp;
    this.vz = (dzw / dw) * sp;
    return sp;
  }

  private beginAlert(env: ZombieEnv): void {
    this.enterState('alert');
    this.alertTimer = (this.type === 'runner' ? 0.45 : this.type === 'warden' ? 1.5 : 0.8) + env.rng.f() * 0.4;
    this.vx = this.vz = 0;
    const pos = { x: this.x, y: 1.5, z: this.z };
    env.audio.play(this.type === 'runner' ? 'zombie_screech' : this.type === 'warden' ? 'warden_roar' : 'zombie_alert', {
      pos,
      volume: this.type === 'warden' ? 1.2 : 0.9,
      priority: this.type === 'warden' ? 3 : 2,
    });
    if (!this.alertNoticed) {
      this.alertNoticed = true;
      env.alertNear(this.x, this.z, 9, this.id);
    }
  }

  private updateAlert(dt: number, env: ZombieEnv, dx: number, dz: number): void {
    this.alertTimer -= dt;
    const tx = this.memory < 1 ? env.player.x - this.x : this.lastKnownX - this.x;
    const tz = this.memory < 1 ? env.player.z - this.z : this.lastKnownZ - this.z;
    void dx;
    void dz;
    this.turnToward(Math.atan2(-tx, -tz), 8, dt);
    this.vx *= Math.max(0, 1 - 10 * dt);
    this.vz *= Math.max(0, 1 - 10 * dt);
    if (this.alertTimer <= 0) this.enterState('chase');
  }

  private chaseSpeed(): number {
    let s = this.def.speedChase * this.speedScale;
    if (this.isBoss && this.enraged) s *= WARDEN.rageSpeedMul;
    return s;
  }

  private updateChase(dt: number, env: ZombieEnv, dx: number, dz: number, dist: number): number {
    const p = env.player;
    // lose interest
    if (!p.alive || (this.memory > ZOMBIE_AI.loseInterest && dist > 45)) {
      this.homeX = this.x;
      this.homeZ = this.z;
      this.enterState('idle');
      this.alertNoticed = false;
      return 0;
    }

    // ---- special attacks (Warden) ----
    if (this.isBoss && this.cooldown <= 0) {
      if (this.slamCd <= 0 && dist < WARDEN.slamRange) {
        this.beginAttack('slam', env);
        return 0;
      }
      if (this.chargeCd <= 0 && dist > WARDEN.chargeMinRange && dist < WARDEN.chargeMaxRange && this.seesPlayer) {
        this.beginAttack('charge', env);
        return 0;
      }
    }
    // ---- melee ----
    const reach = this.def.attackRange;
    if (this.cooldown <= 0 && dist < reach * 0.94 && Math.abs(p.y - 0) < ZOMBIE_AI.attackVerticalReach) {
      if (!env.world.segmentBlocked(this.x, 1.1, this.z, p.x, Math.max(0.6, p.eyeY - 0.5), p.z, 'move')) {
        this.beginAttack('melee', env);
        return 0;
      }
    }

    // ---- steering target ----
    this.steerTimer -= dt;
    if (this.steerTimer <= 0 || !this.hasSteer) {
      this.steerTimer = 0.12 + env.rng.f() * 0.06;
      const tx = this.memory < 0.6 ? p.x : this.lastKnownX;
      const tz = this.memory < 0.6 ? p.z : this.lastKnownZ;
      // direct line when clear (cheap grid LOS), otherwise follow the flow field around obstacles
      let direct = false;
      if (dist < 22 || env.time < this.directUntil) direct = env.nav.los(this.x, this.z, tx, tz);
      if (direct) {
        this.steerX = tx;
        this.steerZ = tz;
        this.hasSteer = true;
        this.directUntil = env.time + 0.5;
      } else if (env.field.follow(this.x, this.z, this.tmp, 10)) {
        this.steerX = this.tmp.x;
        this.steerZ = this.tmp.z;
        this.hasSteer = true;
        this.directUntil = 0;
      } else {
        this.steerX = tx;
        this.steerZ = tz;
        this.hasSteer = true;
      }
    }
    const sx = this.steerX - this.x;
    const sz = this.steerZ - this.z;
    const sd = Math.hypot(sx, sz);
    if (sd < 0.05) {
      this.vx *= 0.8;
      this.vz *= 0.8;
      return 0;
    }
    const desired = Math.atan2(-sx, -sz);
    this.turnToward(desired, this.def.turnRate * (this.isBoss && this.enraged ? 1.3 : 1), dt);
    // move along the current heading (not instantly along the desired direction) for weighty turning
    const align = Math.max(0.3, Math.cos(wrap(desired - this.yaw)));
    let speed = this.chaseSpeed() * align;
    // slow down when right on the player so they do not shove through
    if (dist < reach) speed *= 0.5;
    const hx = -Math.sin(this.yaw);
    const hz = -Math.cos(this.yaw);
    this.vx += (hx * speed - this.vx) * Math.min(1, dt * 10);
    this.vz += (hz * speed - this.vz) * Math.min(1, dt * 10);
    void dx;
    void dz;
    return speed;
  }

  private beginAttack(kind: AttackKind, env: ZombieEnv): void {
    this.enterState('attack');
    this.attackKind = kind;
    this.attackTime = 0;
    this.attackDidHit = false;
    this.chargeLock = false;
    this.chargeBlocked = 0;
    this.attackDir = this.yaw;
    const pos = { x: this.x, y: 1.4, z: this.z };
    if (kind === 'melee') {
      env.audio.play('zombie_attack', { pos, volume: 0.8, priority: 2, rate: 0.9 + env.rng.f() * 0.2 });
    } else {
      env.audio.play('warden_roar', { pos, volume: 1.2, priority: 3 });
    }
  }

  private attackTimes(): { windup: number; strike: number; recovery: number } {
    const d = this.def;
    switch (this.attackKind) {
      case 'slam':
        return { windup: WARDEN.slamWindup, strike: 0.25, recovery: WARDEN.slamRecovery };
      case 'charge':
        return { windup: WARDEN.chargeWindup, strike: WARDEN.chargeDuration, recovery: 0.9 };
      default:
        return { windup: d.attackWindup * (this.isBoss && this.enraged ? 0.75 : 1), strike: d.attackStrike, recovery: d.attackRecovery };
    }
  }

  private updateAttack(dt: number, env: ZombieEnv, dx: number, dz: number, dist: number): number {
    const p = env.player;
    this.attackTime += dt;
    const t = this.attackTimes();
    const total = t.windup + t.strike + t.recovery;
    const faceTarget = Math.atan2(-dx, -dz);

    if (this.attackKind === 'charge') {
      if (this.attackTime < t.windup) {
        // wind up, tracking the player until the last moment
        if (this.attackTime < t.windup * 0.7) this.turnToward(faceTarget, 5, dt);
        this.attackDir = this.yaw;
        this.vx *= Math.max(0, 1 - 8 * dt);
        this.vz *= Math.max(0, 1 - 8 * dt);
        return 0;
      }
      if (this.attackTime < t.windup + t.strike && this.chargeLock !== false) {
        // charging along the locked direction
        this.vx = -Math.sin(this.attackDir) * WARDEN.chargeSpeed;
        this.vz = -Math.cos(this.attackDir) * WARDEN.chargeSpeed;
        this.yaw = this.attackDir;
        if (!this.attackDidHit && p.alive && dist < this.def.radius + 0.34 + 0.9) {
          this.attackDidHit = true;
          env.hurtPlayer(WARDEN.chargeDamage, this.x, this.z, 'charge', 9);
          this.chargeLock = false;
        }
        return WARDEN.chargeSpeed;
      }
      if (this.attackTime >= t.windup && this.attackTime < t.windup + 0.02 && !this.chargeLock) {
        this.chargeLock = true;
        return WARDEN.chargeSpeed;
      }
      // recovery
      this.chargeLock = false;
      this.vx *= Math.max(0, 1 - 6 * dt);
      this.vz *= Math.max(0, 1 - 6 * dt);
      if (this.attackTime >= total || this.attackTime >= t.windup + t.strike + t.recovery) this.finishAttack(env);
      return 0;
    }

    // melee / slam: face the target through the windup
    if (this.attackTime < t.windup) {
      this.turnToward(faceTarget, this.attackKind === 'slam' ? 2 : this.def.turnRate * 0.8, dt);
      const creep = this.type === 'runner' ? 0.9 : this.type === 'shambler' ? 0.35 : 0;
      this.vx = -Math.sin(this.yaw) * creep;
      this.vz = -Math.cos(this.yaw) * creep;
    } else if (this.attackTime < t.windup + t.strike) {
      if (!this.attackDidHit) {
        this.attackDidHit = true;
        this.resolveStrike(env, dist);
      }
      const lunge = this.type === 'runner' ? 3.4 : 0.8;
      this.vx = -Math.sin(this.yaw) * lunge;
      this.vz = -Math.cos(this.yaw) * lunge;
    } else {
      this.vx *= Math.max(0, 1 - 9 * dt);
      this.vz *= Math.max(0, 1 - 9 * dt);
      if (this.attackTime >= total) this.finishAttack(env);
    }
    return 0;
  }

  private finishAttack(env: ZombieEnv): void {
    this.enterState(env.player.alive ? 'chase' : 'idle');
    this.cooldown = this.attackKind === 'melee' ? 0.15 : 0.9;
    if (this.attackKind === 'slam') this.slamCd = WARDEN.slamCooldown;
    if (this.attackKind === 'charge') this.chargeCd = WARDEN.chargeCooldown;
    this.chargeLock = false;
  }

  private resolveStrike(env: ZombieEnv, dist: number): void {
    const p = env.player;
    if (!p.alive) return;
    if (this.attackKind === 'slam') {
      const pos = { x: this.x - Math.sin(this.yaw) * 1.6, y: 0.1, z: this.z - Math.cos(this.yaw) * 1.6 };
      env.audio.play('warden_slam', { pos, volume: 1.2, priority: 3 });
      env.fx.dust(pos, 1);
      env.fx.explosion({ x: pos.x, y: 0.2, z: pos.z }, 1.5);
      env.shake(0.9);
      const d = Math.hypot(p.x - pos.x, p.z - pos.z);
      if (d < WARDEN.slamRadius && p.y < 1.4) {
        const fall = 1 - 0.6 * (d / WARDEN.slamRadius);
        env.hurtPlayer(WARDEN.slamDamage * fall, pos.x, pos.z, 'slam', 10);
      }
      return;
    }
    // melee: distance, cone, vertical reach and a wall check
    const reach = this.def.attackRange + 0.35;
    if (dist > reach) return;
    if (Math.abs(p.y) > ZOMBIE_AI.attackVerticalReach) return;
    const facing = Math.atan2(-(p.x - this.x), -(p.z - this.z));
    if (Math.abs(wrap(facing - this.yaw)) > (ZOMBIE_AI.attackCone * Math.PI) / 180) return;
    if (env.world.segmentBlocked(this.x, 1.1, this.z, p.x, Math.max(0.6, p.eyeY - 0.5), p.z, 'move')) return;
    env.hurtPlayer(this.def.damage, this.x, this.z, 'melee', this.type === 'armored' ? 3 : 1.5);
  }

  private turnToward(target: number, rate: number, dt: number): void {
    const d = wrap(target - this.yaw);
    const m = rate * dt;
    this.yaw += Math.max(-m, Math.min(m, d));
    this.yaw = wrap(this.yaw);
  }

  // ---------------------------------------------------------------------------------------------
  // animation
  // ---------------------------------------------------------------------------------------------

  private pose(env: ZombieEnv, speed: number): void {
    const a = this.anim;
    a.time = env.time;
    a.speed = speed;
    a.hitKick = this.hitKick;
    a.enraged = this.enraged;
    a.deathStyle = this.deathStyle;
    a.headshotDeath = this.headshotDeath;
    a.deathT = this.deathT;
    a.staggerT = this.state === 'stagger' ? Math.min(1, this.staggerT / Math.max(0.01, this.staggerDur)) : 0;
    a.actionT = 0;
    a.aggro = this.state === 'idle' ? 0.1 : this.state === 'alert' ? 0.7 : 1;
    switch (this.state) {
      case 'dead':
        a.mode = 'death';
        break;
      case 'stagger':
        a.mode = 'stagger';
        break;
      case 'alert':
        a.mode = this.type === 'warden' || this.type === 'runner' ? 'roar' : 'idle';
        a.actionT = Math.min(1, this.stateTime / Math.max(0.2, this.alertTimer + this.stateTime));
        break;
      case 'attack': {
        const t = this.attackTimes();
        const total = t.windup + t.strike + t.recovery;
        a.mode = this.attackKind === 'slam' ? 'slam' : this.attackKind === 'charge' ? (this.attackTime < t.windup ? 'roar' : this.attackTime < t.windup + t.strike ? 'charge' : 'idle') : 'attack';
        if (this.attackKind === 'charge') {
          a.actionT = Math.min(1, this.attackTime / Math.max(0.01, t.windup));
        } else {
          // windup -> [0, 0.55), strike -> [0.55, 0.72), recovery -> [0.72, 1]
          const at = this.attackTime;
          if (at < t.windup) a.actionT = (at / t.windup) * 0.55;
          else if (at < t.windup + t.strike) a.actionT = 0.55 + ((at - t.windup) / t.strike) * 0.17;
          else a.actionT = 0.72 + Math.min(1, (at - t.windup - t.strike) / Math.max(0.01, t.recovery)) * 0.28;
          void total;
        }
        break;
      }
      case 'chase':
        a.mode = speed > 3.0 ? 'run' : speed > 0.35 ? 'walk' : 'idle';
        break;
      default:
        a.mode = speed > 0.3 ? 'walk' : 'idle';
        break;
    }
    this.syncRoot();
    this.rig.update(a, 1 / 60);
  }
}
