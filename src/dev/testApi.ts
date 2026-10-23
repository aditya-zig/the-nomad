/**
 * Development-only test hooks (`window.__dead`), installed only when the Vite dev server is running
 * (`import.meta.env.DEV`); the production build contains none of this. Every hook drives the REAL game code paths
 * (same input state, same simulate() step, same purchase / interaction / weapon logic) - there are no shortcuts that
 * bypass game rules except explicitly named teleport / spawn / time helpers.
 */
import { WEAPONS } from '../config';
import type { Game } from '../game/game';
import type { Edges } from '../player/input';
import type { WeaponId, ZombieType } from '../types';

function emptyEdges(): Edges {
  return {
    jump: false, reload: false, interactPressed: false, interactReleased: false, grenade: false, plate: false, map: false,
    slot1: false, slot2: false, crouch: false, digits: [], wheel: 0, firePressed: false, adsPressed: false, mouseDX: 0, mouseDY: 0,
  };
}

export function installTestApi(game: Game): void {
  const held = { forward: 0, strafe: 0, sprint: false, fire: false, ads: false, interact: false };
  let pending: Edges = emptyEdges();

  const applyHeld = (): void => {
    const inp = game.inputState;
    inp.enabled = true;
    // drive the same key state the keyboard handler would set
    const setKey = (code: string, on: boolean): void => {
      const keys = (inp as unknown as { keys: Set<string> }).keys;
      if (on) keys.add(code);
      else keys.delete(code);
    };
    setKey('KeyW', held.forward > 0);
    setKey('KeyS', held.forward < 0);
    setKey('KeyD', held.strafe > 0);
    setKey('KeyA', held.strafe < 0);
    setKey('ShiftLeft', held.sprint);
    inp.fireHeld = held.fire;
    inp.adsHeld = held.ads;
    inp.interactHeld = held.interact;
  };

  /** Advance the real simulation by `seconds` in fixed 1/60 s steps (no rendering). */
  const advance = (seconds: number): void => {
    const steps = Math.max(1, Math.round(seconds * 60));
    for (let i = 0; i < steps; i++) {
      applyHeld();
      const edges = pending;
      pending = emptyEdges();
      if (game.state === 'playing') game.simulate(1 / 60, edges);
      else if (game.state === 'ending') game.frameOnce(1 / 60);
    }
  };

  const snapshot = () => {
    const s = game.session;
    const p = game.player;
    const w = game.weapons.carried;
    return {
      state: game.state,
      elapsed: +s.elapsed.toFixed(2),
      player: { x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2), yaw: +p.yaw.toFixed(3), pitch: +p.pitch.toFixed(3), onGround: p.onGround, crouching: p.crouching, sprinting: p.sprinting, stamina: +p.stamina.toFixed(1), speed: +p.horizontalSpeed.toFixed(2) },
      health: +s.vitals.health.toFixed(1),
      armor: +s.vitals.armor.toFixed(1),
      plates: s.inv.plates,
      grenades: s.inv.grenades,
      cash: s.inv.cash,
      weapon: w ? { id: w.id, tier: w.tier, mag: w.ammo.mag, reserve: w.ammo.reserve, reloading: w.ammo.reload ? w.ammo.reload.kind : null } : null,
      slots: s.inv.slots.map((c) => (c ? { id: c.id, tier: c.tier, mag: c.ammo.mag, reserve: c.ammo.reserve } : null)),
      region: game.playerRegion(),
      kills: s.stats.kills,
      headshots: s.stats.headshots,
      shots: [s.stats.shotsFired, s.stats.shotsHit],
      cratesOpened: s.stats.cratesOpened,
      nomad: { ...s.nomad, trust: { ...s.nomad.trust } },
      defense: { status: s.defense.status, progress: +s.defense.progress.toFixed(3), claimed: s.defense.rewardClaimed },
      hunt: { status: s.hunt.status, identified: s.hunt.identified, claimed: s.hunt.rewardClaimed },
      extraction: { phase: s.extraction.phase, countdown: +s.extraction.countdown.toFixed(1), window: +s.extraction.windowLeft.toFixed(1), calledAt: s.extraction.calledAt },
      hazardRadius: +game.mission.hazardRadiusNow.toFixed(1),
      zombies: {
        total: game.zombies.zombies.length,
        alive: game.zombies.aliveCount,
        active: game.zombies.activeCount,
        chasing: game.zombies.zombies.filter((z) => z.alive && z.chasing).length,
        boss: game.zombies.boss ? { x: +game.zombies.boss.x.toFixed(1), z: +game.zombies.boss.z.toFixed(1), hp: Math.round(game.zombies.boss.hp), state: game.zombies.boss.state } : null,
      },
      ended: s.ended,
      fps: +game.devFps.toFixed(1),
      frameMs: +game.devFrameMs.toFixed(2),
      cpuSimMs: +game.perf.sim.toFixed(2),
      cpuRenderMs: +game.perf.render.toFixed(2),
      draws: game.renderInfo.render.calls,
      triangles: game.renderInfo.render.triangles,
      lights: game.renderer.scene.children.filter((c) => (c as { isLight?: boolean }).isLight).length,
    };
  };

  const api = {
    game,
    snapshot,
    advance,
    /** Start playing without needing pointer lock. */
    start(): void {
      game.devStartWithoutLock();
      applyHeld();
    },
    /** Resume a paused run (no reset). */
    resume(): void {
      game.devStartWithoutLock(false);
      applyHeld();
    },
    // ---- input (the same state keyboard / mouse events produce) ----
    hold(k: Partial<typeof held>): void {
      Object.assign(held, k);
    },
    releaseAll(): void {
      held.forward = held.strafe = 0;
      held.sprint = held.fire = held.ads = held.interact = false;
      game.inputState.clear();
    },
    press(what: 'jump' | 'reload' | 'interact' | 'grenade' | 'plate' | 'map' | 'slot1' | 'slot2' | 'crouch' | 'wheel', digit?: number): void {
      switch (what) {
        case 'jump': pending.jump = true; break;
        case 'reload': pending.reload = true; break;
        case 'interact': pending.interactPressed = true; break;
        case 'grenade': pending.grenade = true; break;
        case 'plate': pending.plate = true; break;
        case 'map': pending.map = true; break;
        case 'slot1': pending.slot1 = true; pending.digits.push(1); break;
        case 'slot2': pending.slot2 = true; pending.digits.push(2); break;
        case 'crouch': pending.crouch = true; break;
        case 'wheel': pending.wheel = 1; break;
      }
      if (digit !== undefined) pending.digits.push(digit);
    },
    digit(n: number): void {
      pending.digits.push(n);
    },
    /** Click the trigger once (works for semi-auto and auto). */
    click(): void {
      pending.firePressed = true;
      held.fire = true;
      advance(1 / 60);
      held.fire = false;
    },
    look(yaw: number, pitch: number): void {
      game.player.yaw = yaw;
      game.player.pitch = pitch;
    },
    lookAt(x: number, z: number, y = 1.4): void {
      const p = game.player;
      const dx = x - p.x;
      const dz = z - p.z;
      p.yaw = Math.atan2(-dx, -dz);
      p.pitch = Math.atan2(y - p.eyeY(), Math.hypot(dx, dz));
    },
    // ---- scenario helpers (explicitly not gameplay) ----
    teleport(x: number, z: number, yaw?: number): void {
      game.player.teleport(x, z, yaw);
    },
    setElapsed(seconds: number): void {
      game.session.elapsed = seconds;
    },
    setHealth(h: number, armor?: number): void {
      game.session.vitals.health = h;
      if (armor !== undefined) game.session.vitals.armor = armor;
    },
    give(what: { cash?: number; plates?: number; grenades?: number; ammo?: boolean }): void {
      const inv = game.session.inv;
      if (what.cash) inv.cash += what.cash;
      if (what.plates !== undefined) inv.plates = what.plates;
      if (what.grenades !== undefined) inv.grenades = what.grenades;
      if (what.ammo) for (const w of inv.slots) if (w) w.ammo.reserve = w.ammo.reserveMax;
    },
    spawnZombie(type: ZombieType, x: number, z: number, chase = true) {
      const z0 = game.zombies.spawn(type, x, z, game.rng, {});
      if (chase) z0.aggro(game.player.x, game.player.z);
      return z0.id;
    },
    clearZombies(): void {
      for (const z of [...game.zombies.zombies]) if (z !== game.zombies.boss) (z as unknown as { hp: number }).hp = 0;
      game.zombies.clearAll();
    },
    /** Deterministically damage a zombie through the real damage path. */
    damageZombie(id: number, amount: number, head = false): boolean {
      const z = game.zombies.zombies.find((q) => q.id === id);
      if (!z) return false;
      return game.zombies.damage(z, amount, head, (game as unknown as { zenv: never }).zenv, 0);
    },
    equip(id: WeaponId): void {
      const inv = game.session.inv;
      const slot = inv.slots.findIndex((c) => c?.id === id);
      if (slot >= 0) inv.activeSlot = slot as 0 | 1;
    },
    weaponDefs: WEAPONS,
    closePanel(): void {
      game.interaction.closePanel(false);
    },
    freeze(v: boolean): void {
      game.devFrozen = v;
    },
    timeScale(v: number): void {
      game.timeScale = v;
    },
    validateLevel(): { unreachable: string[]; blocked: string[]; counts: Record<string, number> } {
      const lv = game.level;
      const nav = lv.nav;
      const f = game.flow;
      const st = lv.data.playerStart;
      f.compute(st.x, st.z);
      const bad: string[] = [];
      const blocked: string[] = [];
      const check = (name: string, x: number, z: number): void => {
        if (nav.isBlockedAt(x, z)) blocked.push(`${name} (${x.toFixed(1)}, ${z.toFixed(1)})`);
        else if (!f.isReachable(x, z)) bad.push(`${name} (${x.toFixed(1)}, ${z.toFixed(1)})`);
      };
      lv.data.spawnPoints.forEach((s, i) => check(`spawn${i}[${s.group}]`, s.x, s.z));
      lv.data.ambient.forEach((s, i) => check(`ambient${i}[${s.type}]`, s.x, s.z));
      lv.data.crates.forEach((c) => {
        const fx = -Math.sin(c.yaw);
        const fz = -Math.cos(c.yaw);
        check(c.id, c.x + fx * 1.4, c.z + fz * 1.4);
      });
      lv.data.stations.forEach((s) => {
        const fx = -Math.sin(s.yaw);
        const fz = -Math.cos(s.yaw);
        check(s.id, s.x + fx * 2.0, s.z + fz * 2.0);
      });
      const d = lv.data;
      check('warden', d.hunt.wardenX, d.hunt.wardenZ);
      check('lz', d.extraction.lzX, d.extraction.lzZ);
      check('terminal', d.extraction.terminalX - 1.2, d.extraction.terminalZ);
      const tc = lv.transmitter.console;
      check('transmitter console', tc.x, tc.z + 1.2);
      return { unreachable: bad, blocked, counts: { spawn: lv.data.spawnPoints.length, ambient: lv.data.ambient.length, crates: lv.data.crates.length, stations: lv.data.stations.length } };
    },
  };
  (window as unknown as { __dead: typeof api }).__dead = api;
}
