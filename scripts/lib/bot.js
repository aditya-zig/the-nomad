/*
 * QA bot: plays DEAD SIGNAL through the same input state a human produces (held keys, look angles, one-shot presses),
 * using the game's own navigation grid to walk between objectives. It is intentionally imperfect (aim error, reaction delay,
 * no dodging of slams) so results resemble a middling player. Injected into the page by scripts/qa-bot.mjs (dev server only).
 */
(() => {
  const api = window.__dead;
  const g = api.game;
  const rnd = (() => { let a = 12345; return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; }; })();
  const gauss = () => (rnd() + rnd() + rnd() + rnd() - 2) * 1.7;
  const V = g.renderer.camera.position.constructor;
  const tmpHead = new V();
  const tmpChest = new V();
  const out = { x: 0, z: 0 };

  const bot = {
    skill: { aimSigma: 0.14, aimDist: 0.02, reaction: 0.28, headBias: 0.45 },
    log: [],
    trace: [],
    traceT: 0,
    stats: { deaths: 0, maxKillsPerMin: 0, plateUses: 0, grenades: 0, stuckEvents: 0, upgrades: 0, purchases: 0, cratesOpened: 0 },
    phase: 'start',
    goalFlow: null,
    goalKey: '',
    goalX: 0,
    goalZ: 0,
    goalTimer: 0,
    reacted: new Map(),
    lastPos: { x: 0, z: 0, t: 0 },
    stuckT: 0,
    t: 0,
    holdE: 0,
    lookYaw: 0,
    lookPitch: 0,
    note(msg) { this.log.push(`[${g.session.elapsed.toFixed(0)}s] ${msg}`); },
  };

  const world = () => g.level.world;
  const nav = () => g.level.nav;
  const P = () => g.player;
  const alive = () => g.playerAlive();
  const hp = () => g.session.vitals.health;

  function zombiesNear(r) {
    const p = P();
    const res = [];
    for (const z of g.zombies.zombies) {
      if (!z.alive || z.dormant) continue;
      const d = Math.hypot(z.x - p.x, z.z - p.z);
      if (d < r) res.push({ z, d });
    }
    res.sort((a, b) => a.d - b.d);
    return res;
  }

  function hasLOS(z) {
    const p = P();
    return !world().segmentBlocked(p.x, p.eyeY(), p.z, z.x, 1.3, z.z, 'shots');
  }

  function setGoal(key, x, z) {
    if (bot.goalKey === key && Math.hypot(bot.goalX - x, bot.goalZ - z) < 0.5) return;
    bot.goalKey = key; bot.goalX = x; bot.goalZ = z; bot.goalTimer = 0;
    if (!bot.goalFlow) bot.goalFlow = new g.flow.constructor(nav());
    bot.goalFlow.compute(x, z);
  }

  /** Steer toward the current goal: returns distance to goal (m) and a desired world direction. */
  function navDir() {
    const p = P();
    const dist = Math.hypot(bot.goalX - p.x, bot.goalZ - p.z);
    if (dist < 0.6) return { dist, dx: 0, dz: 0 };
    if (bot.goalFlow && bot.goalFlow.follow(p.x, p.z, out, 12)) {
      const dx = out.x - p.x, dz = out.z - p.z, l = Math.hypot(dx, dz) || 1;
      return { dist, dx: dx / l, dz: dz / l };
    }
    const dx = bot.goalX - p.x, dz = bot.goalZ - p.z, l = Math.hypot(dx, dz) || 1;
    return { dist, dx: dx / l, dz: dz / l };
  }

  /** Convert a desired world direction into forward/strafe key states relative to the current yaw. */
  function moveWorld(dx, dz, sprint) {
    const p = P();
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
    const f = dx * fx + dz * fz;
    const s = dx * rx + dz * rz;
    api.hold({ forward: f > 0.35 ? 1 : f < -0.35 ? -1 : 0, strafe: s > 0.35 ? 1 : s < -0.35 ? -1 : 0, sprint });
  }

  function lookToward(x, z, y, rate = 12, dt = 1 / 30) {
    const p = P();
    const dx = x - p.x, dz = z - p.z;
    const ty = Math.atan2(-dx, -dz);
    const tp = Math.atan2(y - p.eyeY(), Math.hypot(dx, dz));
    let dy = ty - p.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    const k = Math.min(1, rate * dt);
    p.yaw += dy * k;
    p.pitch += (tp - p.pitch) * k;
  }

  function ensureWeapon() {
    const inv = g.session.inv;
    const cur = inv.slots[inv.activeSlot];
    if (!cur || (cur.ammo.mag === 0 && cur.ammo.reserve === 0)) {
      const other = inv.activeSlot === 0 ? 1 : 0;
      const o = inv.slots[other];
      if (o && (o.ammo.mag > 0 || o.ammo.reserve > 0)) api.press(other === 0 ? 'slot1' : 'slot2');
    }
  }

  function fight(dt, near) {
    const p = P();
    // target selection with reaction delay
    let tgt = null;
    for (const { z, d } of near) {
      if (d > 45) break;
      if (!hasLOS(z)) continue;
      const seen = bot.reacted.get(z.id) ?? bot.t;
      bot.reacted.set(z.id, seen);
      if (bot.t - seen < bot.skill.reaction) continue;
      if (z.chasing || d < 22 || z.isBoss) { tgt = { z, d }; break; }
    }
    const inv = g.session.inv;
    const cur = inv.slots[inv.activeSlot];
    const closest = near[0];
    if (!tgt) {
      api.hold({ fire: false, ads: false });
      // only chasing enemies that can actually reach us keep the bot standing still (not idle ones behind walls)
      return !!closest && closest.d < 9 && closest.z.chasing && hasLOS(closest.z);
    }
    const { z, d } = tgt;
    z.rig.getHeadWorld(tmpHead);
    z.rig.getChestWorld(tmpChest);
    const useHead = rnd() < bot.skill.headBias;
    const base = useHead ? tmpHead : tmpChest;
    const sigma = bot.skill.aimSigma + bot.skill.aimDist * d;
    const ax = base.x + gauss() * sigma, ay = base.y + gauss() * sigma * 0.8, az = base.z + gauss() * sigma;
    lookToward(ax, az, ay, z.isBoss ? 14 : 16, dt);
    const ads = d > 13 && cur && cur.id !== 'shotgun';
    const inRange = cur && (cur.id === 'shotgun' ? d < 16 : cur.id === 'pistol' ? d < 28 : d < 42);
    api.hold({ ads: !!ads, fire: !!inRange });
    // grenade the boss / big clusters
    if (inv.grenades > 0 && ((z.isBoss && d > 6 && d < 16 && z.hp > 900) || near.filter((n) => n.d < 6).length >= 5)) {
      if (rnd() < 0.05) { api.press('grenade'); bot.stats.grenades++; }
    }
    return true;
  }

  function kite(near) {
    // retreat from the nearest melee threat while it is close; strafe when cornered
    const p = P();
    const c = near[0];
    if (!c || c.d > 4.2) return false;
    let dx = p.x - c.z.x, dz = p.z - c.z.z;
    // add pressure from other close zombies
    for (const n of near.slice(1, 5)) { if (n.d < 5) { dx += (p.x - n.z.x) * 0.5; dz += (p.z - n.z.z) * 0.5; } }
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    // check free space behind
    const tx = p.x + dx * 1.5, tz = p.z + dz * 1.5;
    if (nav().isBlockedAt(tx, tz)) { // try perpendicular
      const px = -dz, pz = dx;
      if (!nav().isBlockedAt(p.x + px * 1.5, p.z + pz * 1.5)) { moveWorld(px, pz, false); return true; }
      if (!nav().isBlockedAt(p.x - px * 1.5, p.z - pz * 1.5)) { moveWorld(-px, -pz, false); return true; }
      api.hold({ forward: 0, strafe: 0, sprint: false });
      return true;
    }
    moveWorld(dx, dz, c.d < 2.2);
    return true;
  }

  function usePlate(near) {
    const s = g.session;
    if (s.vitals.armor < 35 && s.inv.plates > 0 && !g.weapons.applyingPlate && (near.length === 0 || near[0].d > 6)) {
      api.press('plate'); bot.stats.plateUses++;
    }
  }

  function maybeReload(near) {
    const inv = g.session.inv;
    const cur = inv.slots[inv.activeSlot];
    if (!cur) return;
    const a = cur.ammo;
    if (a.reload) return;
    const calm = near.length === 0 || near[0].d > 14;
    if ((a.mag === 0 && a.reserve > 0) || (calm && a.mag < a.magSize * 0.5 && a.reserve > 0)) api.press('reload');
  }

  // -- objective logic ------------------------------------------------------------------------------------------

  function crateTarget() {
    const p = P();
    let best = null, bd = 1e9;
    for (const c of g.entities.crates) {
      if (c.opened) continue;
      const d = Math.hypot(c.def.x - p.x, c.def.z - p.z);
      if (d < bd) { bd = d; best = c; }
    }
    return best && bd < (bot.crateRange || 40) ? best : null;
  }

  function goToAndUse(kind, id, x, z, yaw, approach, tag) {
    // walk to a point in front of the object, then look at it
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const ax = x + fx * approach, az = z + fz * approach;
    setGoal(`${kind}:${id}`, ax, az);
    const n = navDir();
    if (n.dist > 1.0) { moveWorld(n.dx, n.dz, n.dist > 6); lookToward(ax + n.dx * 4, az + n.dz * 4, 1.5, 6, 1 / 30); return false; }
    api.hold({ forward: 0, strafe: 0, sprint: false });
    lookToward(x, z, tag === 'crate' ? 0.5 : 1.3, 14, 1 / 30);
    return true;
  }

  function objectiveStep(dt) {
    const s = g.session;
    const p = P();
    const ex = s.extraction;
    const d = g.level.data;
    const inv = s.inv;
    api.hold({ fire: false, ads: false });

    // A. extraction sequence
    if (ex.phase === 'landed') {
      const door = g.mission.heliDoorPos();
      if (door) {
        setGoal('door', door.x + 0.6, door.z + 0.4);
        const n = navDir();
        moveWorld(n.dx, n.dz, true);
        lookToward(door.x, door.z, 1.3, 10, dt);
        if (Math.hypot(door.x - p.x, door.z - p.z) < 3.4) { api.press('interact'); }
        bot.phase = 'boarding';
        return;
      }
    }
    if (ex.phase === 'available') {
      bot.phase = 'callExtraction';
      const ready = goToAndUse('terminal', 'x', d.extraction.terminalX, d.extraction.terminalZ, d.extraction.terminalYaw, 1.6, 'terminal');
      api.hold({ interact: ready });
      return;
    }
    if (ex.phase === 'called' || ex.phase === 'inbound' || ex.phase === 'landing') {
      // hold the LZ: stay near the terminal / pad with cover behind the terminal
      bot.phase = 'holdLZ';
      setGoal('lz-hold', d.extraction.lzX + 5, d.extraction.lzZ - 3);
      const n = navDir();
      if (n.dist > 2.5) moveWorld(n.dx, n.dz, n.dist > 8); else api.hold({ forward: 0, strafe: 0, sprint: false });
      api.hold({ interact: false });
      return;
    }
    api.hold({ interact: false });

    // B. contracts
    const defDone = s.defense.status === 'complete';
    const huntDone = s.hunt.status === 'complete';
    const cash = inv.cash;

    // shopping when flush: upgrades at the armory, plates at cages
    const needPlates = inv.plates < 2 && cash >= 350;
    const wantUpgrade = (inv.slots[0] && inv.slots[0].tier < 2 && cash >= inv.slots[0].ammo.magSize * 0 + (inv.slots[0].tier === 0 ? 1500 : 3200));

    // buy/upgrade stations nearby (already here?)
    for (const st of g.entities.stations) {
      const dd = Math.hypot(st.def.x - p.x, st.def.z - p.z);
      if (dd < 3.3 && ((st.def.kind === 'buy' && (needPlates || cash >= 600)) || (st.def.kind === 'upgrade' && wantUpgrade))) {
        if (!g.interaction.panelOpen) { api.press('interact'); return; }
      }
    }
    if (g.interaction.panelOpen) {
      // act on the open panel
      const near = g.interaction.panelStation;
      if (near && near.def.kind === 'upgrade') {
        if (inv.slots[0] && inv.slots[0].tier < 2 && cash >= (inv.slots[0].tier === 0 ? 1500 : 3200)) { api.digit(1); bot.stats.upgrades++; return; }
        if (inv.slots[1] && inv.slots[1].tier < 2 && cash >= (inv.slots[1].tier === 0 ? 900 : 2000)) { api.digit(2); bot.stats.upgrades++; return; }
      } else if (near) {
        if (inv.plates < 3 && cash >= 350) { api.digit(3); bot.stats.purchases++; return; }
        const a0 = inv.slots[0];
        if (a0 && a0.ammo.reserve < a0.ammo.reserveMax * 0.5 && cash >= 250) { api.digit(1); bot.stats.purchases++; return; }
        if (inv.grenades < 2 && cash >= 200) { api.digit(4); bot.stats.purchases++; return; }
      }
      api.press('interact'); // close
      return;
    }

    // crates on the way (cheap value)
    bot.crateRange = bot.phase === 'start' ? 60 : 24;
    const crate = crateTarget();
    if (crate && !(defDone && huntDone)) {
      bot.phase = 'loot';
      const ready = goToAndUse('crate', crate.def.id, crate.def.x, crate.def.z, crate.def.yaw, 1.3, 'crate');
      api.hold({ interact: ready });
      return;
    }
    // go shopping at the closest station if rich enough
    if (wantUpgrade || needPlates) {
      const wantKind = wantUpgrade ? 'upgrade' : 'buy';
      let best = null, bd = 1e9;
      for (const st of g.entities.stations) {
        if (st.def.kind !== wantKind) continue;
        const dd = Math.hypot(st.def.x - p.x, st.def.z - p.z);
        if (dd < bd) { bd = dd; best = st; }
      }
      if (best && bd < 90) {
        bot.phase = 'shop';
        const ready = goToAndUse('station', best.def.id, best.def.x, best.def.z, best.def.yaw, 2.0, 'station');
        if (ready && !g.interaction.panelOpen) api.press('interact');
        return;
      }
    }
    if (!defDone) {
      if (s.defense.status === 'available') {
        bot.phase = 'goRelay';
        const c = g.level.transmitter.console;
        const ready = goToAndUse('relay', 'c', c.x, c.z, g.level.transmitter.consoleYaw + Math.PI, 1.4, 'console');
        api.hold({ interact: ready });
        return;
      }
      // active: hold the circle centre
      bot.phase = 'holdRelay';
      setGoal('relay-hold', d.defense.x + 2, d.defense.z + 3);
      const n = navDir();
      if (n.dist > 2) moveWorld(n.dx, n.dz, false); else api.hold({ forward: 0, strafe: 0, sprint: false });
      return;
    }
    if (!huntDone) {
      bot.phase = 'hunt';
      const boss = g.zombies.boss;
      const tx = boss && boss.alive ? boss.x : d.hunt.wardenX;
      const tz = boss && boss.alive ? boss.z : d.hunt.wardenZ;
      setGoal('hunt', tx, tz);
      const n = navDir();
      if (boss && boss.alive && n.dist < 12) { api.hold({ forward: 0, strafe: 0, sprint: false }); lookToward(tx, tz, 1.5, 10, dt); }
      else { moveWorld(n.dx, n.dz, n.dist > 10); }
      return;
    }
    bot.phase = 'toLZ';
    setGoal('lz', d.extraction.terminalX - 1.6, d.extraction.terminalZ);
    const n = navDir();
    moveWorld(n.dx, n.dz, n.dist > 6);
  }

  bot.tick = function tick(dt) {
    bot.t += dt;
    const s = g.session;
    if (!alive() || g.state !== 'playing') return false;
    const near = zombiesNear(40);
    bot.traceT += dt;
    if (bot.traceT >= 2) {
      bot.traceT = 0;
      const cur = g.session.inv.slots[g.session.inv.activeSlot];
      bot.trace.push(`t=${s.elapsed.toFixed(0)} hp=${s.vitals.health.toFixed(0)}/${s.vitals.armor.toFixed(0)} near6=${near.filter((n) => n.d < 6).length} near15=${near.filter((n) => n.d < 15).length} chasing=${near.filter((n) => n.z.chasing).length} ammo=${cur ? cur.ammo.mag + '/' + cur.ammo.reserve : '-'} phase=${bot.phase} pos=${P().x.toFixed(0)},${P().z.toFixed(0)}`);
    }
    ensureWeapon();
    usePlate(near);
    maybeReload(near);
    const fighting = fight(dt, near);
    const kiting = kite(near);
    if (!kiting) {
      if (!fighting || (near[0] && near[0].d > 9)) {
        objectiveStep(dt);
        // keep shooting while walking if a target is visible
        if (fighting) { /* fight() already set fire/ads/look; movement comes from objectiveStep */ }
      } else {
        // stationary shooting when enemies are at mid range
        api.hold({ forward: 0, strafe: 0, sprint: false });
      }
    }
    // keep interaction hold only when objectiveStep asked for it
    // stuck detection
    const p = P();
    bot.lastPos.t += dt;
    if (bot.lastPos.t > 2.5) {
      const moved = Math.hypot(p.x - bot.lastPos.x, p.z - bot.lastPos.z);
      const wantMove = bot.phase !== 'holdRelay' && bot.phase !== 'holdLZ' && bot.phase !== 'boarding' && !fighting && !g.interaction.panelOpen;
      bot.idleT = (bot.idleT || 0) + (moved < 0.6 && wantMove ? 2.5 : -(bot.idleT || 0));
      if (moved < 0.6 && wantMove && bot.idleT >= 5) { bot.stats.stuckEvents++; bot.note(`stuck ${bot.idleT.toFixed(0)}s at (${p.x.toFixed(1)},${p.z.toFixed(1)}) phase=${bot.phase} goal=${bot.goalKey}@(${bot.goalX.toFixed(1)},${bot.goalZ.toFixed(1)}) near=${near.length}`); api.press('jump'); api.hold({ strafe: rnd() < 0.5 ? 1 : -1 }); }
      bot.lastPos.x = p.x; bot.lastPos.z = p.z; bot.lastPos.t = 0;
    }
    return true;
  };

  /** Run the bot for `seconds` of game time (30 Hz decisions, 60 Hz simulation). Returns a summary. */
  bot.run = function run(seconds) {
    const start = g.session.elapsed;
    let steps = 0;
    while (g.session.elapsed - start < seconds) {
      if (g.state !== 'playing') break;
      if (!bot.tick(1 / 30)) break;
      api.advance(1 / 30);
      steps++;
      if (g.session.ended) break;
    }
    return bot.summary();
  };

  bot.summary = function summary() {
    const s = g.session;
    return {
      state: g.state,
      elapsed: +s.elapsed.toFixed(1),
      hp: +s.vitals.health.toFixed(0),
      armor: +s.vitals.armor.toFixed(0),
      cash: s.inv.cash,
      cashEarned: s.inv.cashEarned,
      kills: s.stats.kills,
      headshots: s.stats.headshots,
      accuracy: s.stats.shotsFired ? +(s.stats.shotsHit / s.stats.shotsFired).toFixed(2) : 0,
      crates: s.stats.cratesOpened,
      defense: s.defense.status + ':' + s.defense.progress.toFixed(2),
      hunt: s.hunt.status,
      extraction: s.extraction.phase,
      ended: s.ended,
      phase: bot.phase,
      plates: s.inv.plates,
      tiers: s.inv.slots.map((c) => (c ? `${c.id}:${c.tier}` : '-')),
      region: g.playerRegion(),
      pos: [+P().x.toFixed(1), +P().z.toFixed(1)],
      botStats: bot.stats,
    };
  };

  window.__bot = bot;
})();
