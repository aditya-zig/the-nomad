/** Crates, stations and ground pickups: models, state and per-frame animation. */
import * as THREE from 'three';
import { ECONOMY, GRENADE, PLAYER, REGIONS, WEAPONS } from '../config';
import { addReserve, isFull } from '../logic/ammo';
import { applyCrateReward, rollCrateReward } from '../logic/economy';
import { NOMAD, salvageCache } from '../logic/nomad';
import { PowerCellModels } from '../world/powerCells';
import type { Region } from '../types';
import type { CrateDef, StationDef } from '../world/layout/data';
import { createLootCrate, createPickupModel, createStationModel, type CrateModel, type PickupKind, type StationModel } from '../world/models';
import type { GameCtx } from './ctx';

export class CrateRuntime {
  opened = false;
  openT = 0;
  discovered = false;
  constructor(
    readonly def: CrateDef,
    readonly model: CrateModel,
  ) {}
}

export class StationRuntime {
  constructor(
    readonly def: StationDef,
    readonly model: StationModel,
  ) {}
}

interface Pickup {
  kind: PickupKind;
  obj: THREE.Object3D;
  x: number;
  z: number;
  age: number;
}

export class Entities {
  readonly crates: CrateRuntime[] = [];
  readonly stations: StationRuntime[] = [];
  private readonly pickups: Pickup[] = [];
  private readonly pickupFree: Record<PickupKind, THREE.Object3D[]> = { ammo: [], plate: [], grenade: [] };
  readonly root = new THREE.Group();
  private readonly cellModels = new PowerCellModels();

  constructor(private readonly ctx: GameCtx) {
    this.root.name = 'Entities';
    ctx.worldRoot.add(this.root);
    for (const def of ctx.level.data.crates) {
      const model = createLootCrate(def.region, ctx.mats);
      model.root.add(this.cellModels.create(NOMAD.cellYield[def.region]));
      model.root.position.set(def.x, 0, def.z);
      model.root.rotation.y = def.yaw;
      this.root.add(model.root);
      this.crates.push(new CrateRuntime(def, model));
    }
    for (const def of ctx.level.data.stations) {
      const model = createStationModel(def.kind, ctx.mats);
      model.root.position.set(def.x, 0, def.z);
      model.root.rotation.y = def.yaw;
      this.root.add(model.root);
      this.stations.push(new StationRuntime(def, model));
    }
  }

  reset(): void {
    for (const c of this.crates) {
      c.opened = false;
      c.openT = 0;
      c.discovered = false;
      c.model.setOpen(0);
      c.model.setLooted(false);
      c.model.root.getObjectByName('NomadPowerCells')!.visible = true;
    }
    for (const s of this.stations) s.model.setState('idle');
    this.clearPickups();
  }

  clearPickups(): void {
    for (const p of this.pickups) {
      p.obj.removeFromParent();
      this.pickupFree[p.kind].push(p.obj);
    }
    this.pickups.length = 0;
  }

  update(dt: number, time: number): void {
    const ctx = this.ctx;
    const px = ctx.player.x;
    const pz = ctx.player.z;
    for (const c of this.crates) {
      const d2 = (c.def.x - px) ** 2 + (c.def.z - pz) ** 2;
      if (d2 < 30 * 30) c.discovered = true;
      if (d2 > 90 * 90) continue;
      if (c.opened && c.openT < 1) {
        c.openT = Math.min(1, c.openT + dt / 0.45);
        c.model.setOpen(c.openT);
      }
      c.model.update(dt, time);
    }
    for (const s of this.stations) {
      const d2 = (s.def.x - px) ** 2 + (s.def.z - pz) ** 2;
      if (d2 > 90 * 90) continue;
      s.model.update(dt, time);
    }
    // pickups: bob, spin, expire, collect
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i]!;
      p.age += dt;
      p.obj.rotation.y += dt * 1.6;
      p.obj.position.y = 0.12 + Math.sin(time * 2.4 + p.x) * 0.05;
      const expired = p.age > ECONOMY.pickupLifetime;
      let collected = false;
      if (!expired && ctx.playerAlive()) {
        const dx = p.x - px;
        const dz = p.z - pz;
        if (dx * dx + dz * dz < ECONOMY.pickupRadius * ECONOMY.pickupRadius) collected = this.collect(p);
      }
      if (expired || collected) {
        p.obj.removeFromParent();
        this.pickupFree[p.kind].push(p.obj);
        this.pickups.splice(i, 1);
      }
    }
  }

  spawnPickup(kind: PickupKind, x: number, z: number): void {
    if (this.pickups.length >= ECONOMY.maxPickups) {
      const old = this.pickups.shift()!;
      old.obj.removeFromParent();
      this.pickupFree[old.kind].push(old.obj);
    }
    const obj = this.pickupFree[kind].pop() ?? createPickupModel(kind, this.ctx.mats);
    obj.position.set(x, 0.12, z);
    this.root.add(obj);
    this.pickups.push({ kind, obj, x, z, age: 0 });
  }

  private collect(p: Pickup): boolean {
    const ctx = this.ctx;
    const inv = ctx.session.inv;
    switch (p.kind) {
      case 'ammo': {
        let total = 0;
        for (const slot of [0, 1] as const) {
          const w = inv.slots[slot];
          if (!w || isFull(w.ammo)) continue;
          total += addReserve(w.ammo, Math.round(w.ammo.magSize * ECONOMY.ammoPickupMags));
        }
        if (total <= 0) return false;
        inv.ammoCollected += total;
        ctx.audio.play('pickup_ammo', { priority: 2 });
        ctx.feed(`+${total} AMMO`, 'good');
        ctx.fx.sparkle({ x: p.x, y: 0.4, z: p.z }, 0x9be07a, 10);
        return true;
      }
      case 'plate':
        if (inv.plates >= PLAYER.maxPlates) return false;
        inv.plates++;
        inv.platesCollected++;
        ctx.audio.play('pickup_plate', { priority: 2 });
        ctx.feed('+1 ARMOR PLATE', 'good');
        ctx.fx.sparkle({ x: p.x, y: 0.4, z: p.z }, 0xffc85a, 10);
        return true;
      case 'grenade':
        if (inv.grenades >= GRENADE.max) return false;
        inv.grenades++;
        ctx.audio.play('pickup_ammo', { priority: 2 });
        ctx.feed('+1 FRAG GRENADE', 'good');
        ctx.fx.sparkle({ x: p.x, y: 0.4, z: p.z }, 0xff6a4a, 10);
        return true;
    }
  }

  /** Open a crate: grants its loot exactly once. Returns false if it was already opened. */
  openCrate(c: CrateRuntime): boolean {
    if (c.opened) return false;
    const ctx = this.ctx;
    c.opened = true;
    ctx.session.stats.cratesOpened++;
    const cells = salvageCache(ctx.session.nomad, c.def.region);
    c.model.root.getObjectByName('NomadPowerCells')!.visible = false;
    ctx.feed(`+${cells} POWER CELL${cells > 1 ? 'S' : ''}  /  SUPPLIES REPLENISHED`, 'good');
    const inv = ctx.session.inv;
    const reward = rollCrateReward(c.def.region, inv, ctx.rng);
    const applied = applyCrateReward(inv, reward);
    c.model.setLooted(true);
    ctx.audio.play('crate_open', { pos: { x: c.def.x, y: 0.6, z: c.def.z }, priority: 2 });
    ctx.audio.play('pickup_cash', { priority: 1, volume: 0.7 });
    ctx.fx.sparkle({ x: c.def.x, y: 0.9, z: c.def.z }, 0xffe08a, 16);
    ctx.hudEvent({ type: 'cash', amount: applied.cash });
    ctx.feed(`SUPPLY CACHE  +$${applied.cash}`, 'good');
    for (const slot of [0, 1] as const) {
      const w = inv.slots[slot];
      if (w && applied.ammo[slot] > 0) ctx.feed(`+${applied.ammo[slot]} ${WEAPONS[w.id].short} AMMO`, 'good');
    }
    if (applied.plates > 0) ctx.feed('+1 ARMOR PLATE', 'good');
    if (applied.grenades > 0) ctx.feed('+1 FRAG GRENADE', 'good');
    return true;
  }

  regionOf(c: CrateRuntime): Region {
    return c.def.region;
  }

  dropChance(region: Region): number {
    return REGIONS[region].dropMul;
  }

  dispose(): void {
    this.cellModels.dispose();
    this.root.removeFromParent();
  }
}
