/** Thrown frag grenades: visible ballistic travel, world collision with bounce, fuse, distance-based blast with cover checks. */
import * as THREE from 'three';
import type { AudioEngineApi } from '../audio/ids';
import { GRENADE } from '../config';
import type { ZombieEnv } from '../enemies/zombie';
import type { ZombieManager } from '../enemies/zombieManager';
import type { FxApi } from '../fx/fxTypes';
import type { CollisionWorld } from '../world/collision';

interface Live {
  obj: THREE.Object3D;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  fuse: number;
  spin: THREE.Vector3;
  lastBounce: number;
}

export interface GrenadeHost {
  world: CollisionWorld;
  zombies: ZombieManager;
  zombieEnv(): ZombieEnv;
  fx: FxApi;
  audio: AudioEngineApi;
  /** Player position for self damage. */
  playerPos(): { x: number; y: number; z: number };
  hurtPlayerExplosion(amount: number, x: number, z: number): void;
  onExplosion(x: number, y: number, z: number): void;
  playerVelocity(): { x: number; z: number };
}

const MAX_LIVE = 4;

export class GrenadeSystem {
  private readonly live: Live[] = [];
  private readonly free: THREE.Object3D[] = [];
  readonly root = new THREE.Group();

  constructor(
    private readonly host: GrenadeHost,
    private readonly makeModel: () => THREE.Object3D,
  ) {
    this.root.name = 'Grenades';
  }

  get count(): number {
    return this.live.length;
  }

  throw(origin: THREE.Vector3, dir: THREE.Vector3): void {
    if (this.live.length >= MAX_LIVE) {
      // oldest detonates immediately to stay bounded
      this.explode(this.live[0]!, 0);
    }
    const obj = this.free.pop() ?? this.makeModel();
    obj.visible = true;
    this.root.add(obj);
    const pv = this.host.playerVelocity();
    const vel = new THREE.Vector3(dir.x, dir.y + GRENADE.throwUp, dir.z).normalize().multiplyScalar(GRENADE.throwSpeed);
    vel.x += pv.x * 0.5;
    vel.z += pv.z * 0.5;
    this.live.push({ obj, pos: origin.clone(), vel, fuse: GRENADE.fuse, spin: new THREE.Vector3(6 + Math.random() * 4, 3, 5 + Math.random() * 3), lastBounce: -1 });
  }

  update(dt: number): void {
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const g = this.live[i]!;
      g.fuse -= dt;
      for (let s = 0; s < steps; s++) {
        g.vel.y -= GRENADE.gravity * h;
        g.pos.x += g.vel.x * h;
        g.pos.y += g.vel.y * h;
        g.pos.z += g.vel.z * h;
        if (this.host.world.collideSphere(g.pos, g.vel, GRENADE.radius, GRENADE.restitution, GRENADE.friction)) {
          const speed = Math.hypot(g.vel.x, g.vel.y, g.vel.z);
          if (speed > 2.2 && g.fuse > 0 && g.lastBounce < 0) {
            this.host.audio.play('grenade_bounce', { pos: g.pos, volume: Math.min(1, speed / 8), priority: 1 });
            g.lastBounce = 0.15;
          }
        }
      }
      g.lastBounce = g.lastBounce > 0 ? g.lastBounce - dt : -1;
      g.obj.position.copy(g.pos);
      g.obj.rotation.x += g.spin.x * dt * Math.min(1, Math.hypot(g.vel.x, g.vel.y, g.vel.z) / 4);
      g.obj.rotation.z += g.spin.z * dt * Math.min(1, Math.hypot(g.vel.x, g.vel.y, g.vel.z) / 4);
      if (g.fuse <= 0) this.explode(g, i);
    }
  }

  private explode(g: Live, index: number): void {
    const idx = this.live.indexOf(g);
    if (idx >= 0) this.live.splice(idx, 1);
    void index;
    g.obj.visible = false;
    g.obj.removeFromParent();
    this.free.push(g.obj);
    const { x, y, z } = g.pos;
    const host = this.host;
    host.fx.explosion({ x, y: Math.max(0.2, y), z }, GRENADE.blastRadius);
    host.audio.play('grenade_explosion', { pos: { x, y, z }, priority: 3, volume: 1.2 });
    host.zombies.explode(x, y, z, GRENADE.blastRadius, GRENADE.centerDamage, GRENADE.edgeDamage, GRENADE.coverMul, host.zombieEnv(), GRENADE.knockback);
    // self damage with cover check
    const p = host.playerPos();
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < GRENADE.blastRadius) {
      const covered = host.world.segmentBlocked(x, y + 0.3, z, p.x, p.y - 0.3, p.z, 'shots');
      if (!covered) {
        const dmg = (GRENADE.centerDamage + (GRENADE.edgeDamage - GRENADE.centerDamage) * (d / GRENADE.blastRadius)) * GRENADE.selfMul;
        host.hurtPlayerExplosion(dmg, x, z);
      }
    }
    host.onExplosion(x, y, z);
  }

  clear(): void {
    for (const g of this.live) {
      g.obj.removeFromParent();
      this.free.push(g.obj);
    }
    this.live.length = 0;
  }

  dispose(): void {
    this.clear();
    this.root.removeFromParent();
  }
}
