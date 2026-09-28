/**
 * Mission runtime: contracts, extraction sequence (flare, helicopter, boarding), contamination surge, clock and
 * deadline, radio / banner scripting, and the data the HUD and maps need (objectives, markers, timers).
 */
import * as THREE from 'three';
import { MISSION, ZOMBIES } from '../config';
import type { LoopHandle } from '../audio/ids';
import type { FlareHandle } from '../fx/fxTypes';
import {
  activateDefense,
  allContractsComplete,
  claimDefenseReward,
  claimHuntReward,
  completeHunt,
  contractsCompleted,
  updateDefense,
  updateHunt,
} from '../logic/contracts';
import { applyContractReward } from '../logic/economy';
import {
  boardHelicopter,
  callExtraction,
  canBoard,
  extractionInProgress,
  failExtraction,
  unlockExtraction,
  updateExtraction,
} from '../logic/extraction';
import { deadlineRemaining, escalationPhase, hazardRadius, isInsideHazard, surgeActive, surgeStartTime } from '../logic/mission';
import type { HudObjective, HudTimer, MapMarker } from '../ui/hudTypes';
import {
  createAreaMarker,
  createContaminationWall,
  createExtractionTerminal,
  createFlareModel,
  createHelicopter,
  createObjectiveBeam,
  type AreaMarker,
  type ContaminationWall,
  type HelicopterRig,
  type TerminalModel,
} from '../world/models';
import type { GameCtx } from './ctx';
import type { Entities } from './entities';
import type { MissionApi } from './interaction';
import { bumpRegion } from './session';

const ease = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

export class MissionRuntime implements MissionApi {
  readonly root = new THREE.Group();
  private readonly areaMarker: AreaMarker;
  private readonly wall: ContaminationWall;
  private readonly beam: THREE.Object3D;
  private readonly terminal: TerminalModel;
  private readonly flareModel: THREE.Object3D;
  private readonly heli: HelicopterRig;
  private readonly heliLight: THREE.PointLight;
  private flare: FlareHandle | null = null;
  private heliLoop: LoopHandle | null = null;
  private flareLoop: LoopHandle | null = null;
  private gasLoop: LoopHandle | null = null;
  private sirenLoop: LoopHandle | null = null;
  private transmitterLoop: LoopHandle | null = null;
  private heliVisible = false;
  private heliPos = new THREE.Vector3();
  private heliYaw = 0;
  private heliRotor = 0;
  private heliDoor = 0;
  private departT = -1;
  private hazardR = 0;
  private hazardWasInside = false;
  private coughTimer = 0;
  private wasInsideDefense = true;
  private lastRegion = 'low';
  private tmp = new THREE.Vector3();
  private readonly lz;
  private readonly toLzDist: number;

  constructor(
    private readonly ctx: GameCtx,
    private readonly entities: Entities,
  ) {
    void this.entities;
    const data = ctx.level.data;
    this.lz = data.extraction;
    this.toLzDist = Math.hypot(data.hazardCenter.x - this.lz.lzX, data.hazardCenter.z - this.lz.lzZ);
    ctx.worldRoot.add(this.root);
    this.root.name = 'Mission';

    this.areaMarker = createAreaMarker(data.defense.radius, 0x3ad0ff);
    this.areaMarker.root.position.set(data.defense.x, 0.06, data.defense.z);
    this.root.add(this.areaMarker.root);

    this.wall = createContaminationWall();
    this.wall.setCenter(data.hazardCenter.x, data.hazardCenter.z);
    this.wall.setIntensity(0);
    this.root.add(this.wall.root);

    this.beam = createObjectiveBeam(0xffc040);
    this.beam.position.set(this.lz.lzX, 0, this.lz.lzZ);
    this.beam.visible = false;
    this.root.add(this.beam);

    this.terminal = createExtractionTerminal(ctx.mats);
    this.terminal.root.position.set(this.lz.terminalX, 0, this.lz.terminalZ);
    this.terminal.root.rotation.y = this.lz.terminalYaw;
    this.root.add(this.terminal.root);

    this.flareModel = createFlareModel(ctx.mats);
    this.flareModel.visible = false;
    this.root.add(this.flareModel);

    this.heli = createHelicopter(ctx.mats);
    this.heli.root.visible = false;
    this.root.add(this.heli.root);
    this.heliLight = new THREE.PointLight(0xdfe9ff, 0, 42, 2);
    this.root.add(this.heliLight);
  }

  // ---------------------------------------------------------------------------------------------
  // MissionApi (interactions)
  // ---------------------------------------------------------------------------------------------

  transmitterPos(): { x: number; z: number } {
    const c = this.ctx.level.transmitter.console;
    return { x: c.x, z: c.z };
  }

  canActivateTransmitter(): boolean {
    return this.ctx.session.defense.status === 'available';
  }

  activateTransmitter(): void {
    const ctx = this.ctx;
    const s = ctx.session;
    if (!activateDefense(s.defense)) return;
    ctx.level.transmitter.setState('active');
    ctx.audio.play('defense_start', { priority: 3 });
    this.transmitterLoop = ctx.audio.startLoop('transmitter', { volume: 0.6, pos: { x: ctx.level.data.defense.x, y: 3, z: ctx.level.data.defense.z } });
    ctx.banner('UPLINK ACTIVE', 'Hold the marked area until the transmission completes', 'warn', 4.5);
    ctx.radio('COMMAND', 'Uplink initiated. Stay inside the marked area. They will come for the signal.');
    ctx.feed('TRANSMITTER ACTIVATED', 'warn');
  }

  terminalPos(): { x: number; z: number } {
    return { x: this.lz.terminalX, z: this.lz.terminalZ };
  }

  terminalState(): 'locked' | 'available' | 'busy' {
    const ph = this.ctx.session.extraction.phase;
    if (ph === 'locked') return 'locked';
    if (ph === 'available') return 'available';
    return 'busy';
  }

  callExtraction(): boolean {
    const ctx = this.ctx;
    const s = ctx.session;
    const p = ctx.player;
    const inLz = Math.hypot(p.x - this.lz.lzX, p.z - this.lz.lzZ) <= this.lz.lzRadius;
    if (!callExtraction(s.extraction, s.elapsed, inLz, ctx.playerAlive())) return false;
    this.terminal.setState('called');
    const f = this.terminal.flareLocal.clone();
    this.terminal.root.localToWorld(f);
    this.flare = ctx.fx.flare({ x: f.x, y: f.y, z: f.z });
    this.flareModel.position.copy(f);
    this.flareModel.visible = true;
    this.flareLoop = ctx.audio.startLoop('flare', { volume: 0.7, pos: { x: f.x, y: 0.5, z: f.z } });
    ctx.audio.play('flare_ignite', { pos: { x: f.x, y: 0.5, z: f.z }, priority: 3 });
    ctx.audio.play('radio_chirp', { priority: 3 });
    ctx.banner('EXTRACTION CALLED', 'Hold the landing zone - helicopter ETA 1:00', 'danger', 5);
    ctx.radio('COMMAND', "Bird is inbound. Hold the perimeter - everything nearby is heading your way.");
    ctx.feed('EXTRACTION REQUESTED', 'danger');
    this.beam.visible = true;
    return true;
  }

  heliDoorPos(): { x: number; z: number } | null {
    if (!this.heliVisible) return null;
    const d = this.heli.doorLocal.clone();
    this.heli.root.localToWorld(d);
    return { x: d.x, z: d.z };
  }

  canBoard(): boolean {
    const door = this.heliDoorPos();
    if (!door) return false;
    const p = this.ctx.player;
    return canBoard(this.ctx.session.extraction, Math.hypot(door.x - p.x, door.z - p.z), this.ctx.playerAlive());
  }

  board(): boolean {
    const door = this.heliDoorPos();
    if (!door) return false;
    const p = this.ctx.player;
    if (!boardHelicopter(this.ctx.session.extraction, Math.hypot(door.x - p.x, door.z - p.z), this.ctx.playerAlive())) return false;
    this.ctx.audio.play('boarding', { priority: 3 });
    this.ctx.beginBoarding();
    return true;
  }

  /** World position of the helicopter cabin (cinematic camera target). */
  heliCabinWorld(out: THREE.Vector3): THREE.Vector3 {
    out.set(0.4, 1.3, 0.2);
    this.heli.root.localToWorld(out);
    return out;
  }

  get heliRoot(): THREE.Object3D {
    return this.heli.root;
  }

  // ---------------------------------------------------------------------------------------------
  // lifecycle
  // ---------------------------------------------------------------------------------------------

  reset(): void {
    const ctx = this.ctx;
    this.areaMarker.root.visible = true;
    this.areaMarker.setProgress(0);
    this.areaMarker.setActive(false);
    this.wall.setIntensity(0);
    this.wall.setRadius(0);
    this.beam.visible = false;
    this.terminal.setState('idle');
    this.flareModel.visible = false;
    this.heli.root.visible = false;
    this.heliVisible = false;
    this.heliRotor = 0;
    this.heliDoor = 0;
    this.departT = -1;
    this.heliLight.intensity = 0;
    this.stopLoops();
    this.flare?.stop();
    this.flare = null;
    ctx.renderer.flareLight.intensity = 0;
    ctx.level.transmitter.setState('ready');
    ctx.level.transmitter.setProgress(0);
    ctx.level.spire.setSurge(false);
    this.hazardR = 0;
    this.hazardWasInside = false;
    this.coughTimer = 0;
    this.wasInsideDefense = true;
    this.lastRegion = 'low';
  }

  private stopLoops(): void {
    for (const l of [this.heliLoop, this.flareLoop, this.gasLoop, this.sirenLoop, this.transmitterLoop]) l?.stop(0.3);
    this.heliLoop = this.flareLoop = this.gasLoop = this.sirenLoop = this.transmitterLoop = null;
  }

  /** Stop mission audio loops but keep visuals (results screen). */
  endAudio(): void {
    this.stopLoops();
  }

  // ---------------------------------------------------------------------------------------------
  // per-frame update
  // ---------------------------------------------------------------------------------------------

  update(dt: number, camera: THREE.Camera, time: number): void {
    const ctx = this.ctx;
    const s = ctx.session;
    const alive = ctx.playerAlive();
    const p = ctx.player;
    const ex = s.extraction;
    const data = ctx.level.data;

    s.elapsed += dt;
    const region = ctx.playerRegion();
    bumpRegion(s, region);
    if (region !== this.lastRegion) {
      this.lastRegion = region;
      if (region === 'medium') ctx.banner('MEDIUM THREAT', 'Industrial depot - armored infected sighted', 'warn', 3);
      else if (region === 'high') ctx.banner('HIGH THREAT', 'Contaminated research compound', 'danger', 3.5);
      else ctx.banner('LOW THREAT', 'Outer streets', 'info', 2.2);
    }

    // ---- defense contract ----
    const d = data.defense;
    const inside = Math.hypot(p.x - d.x, p.z - d.z) < d.radius;
    if (s.defense.status === 'active') {
      const done = updateDefense(s.defense, dt, inside, alive);
      ctx.level.transmitter.setProgress(s.defense.progress);
      this.areaMarker.setProgress(s.defense.progress);
      this.areaMarker.setActive(inside);
      if (!inside && this.wasInsideDefense && alive) {
        ctx.banner('LEAVING THE RELAY AREA', 'Uplink progress is draining - return to the marked zone', 'danger', 2.5);
        ctx.radio('COMMAND', "You're outside the relay zone. Get back in there.");
        ctx.audio.play('klaxon', { priority: 2, volume: 0.6 });
      }
      this.wasInsideDefense = inside;
      if (done) this.completeDefense();
    } else if (s.defense.status === 'available') {
      this.areaMarker.setActive(inside);
      this.areaMarker.setProgress(0);
    }
    this.areaMarker.update(dt, time);

    // ---- hunt contract ----
    const boss = ctx.zombies.boss;
    if (s.hunt.status === 'active' && boss && boss.alive) {
      const dist = Math.hypot(boss.x - p.x, boss.z - p.z);
      if (updateHunt(s.hunt, dist, true)) {
        ctx.banner('TARGET IDENTIFIED', 'THE WARDEN - heavily armored. Aim for the head.', 'danger', 4.5);
        ctx.radio('COMMAND', "That's him. Heavy plating - go for the head and watch for the slam.");
        ctx.audio.play('objective_ping', { priority: 2 });
      }
    }

    // ---- unlock extraction ----
    if (unlockExtraction(ex, allContractsComplete(s.defense, s.hunt))) {
      ctx.banner('EXTRACTION AVAILABLE', 'Proceed to LZ ECHO and signal the helicopter', 'good', 5);
      ctx.radio('COMMAND', 'Both contracts complete. Move to LZ Echo and radio the bird.');
      ctx.audio.play('contract_complete', { priority: 3 });
      this.beam.visible = true;
      this.terminal.setState('idle');
    }

    // ---- extraction sequence ----
    if (extractionInProgress(ex)) {
      for (const ev of updateExtraction(ex, dt)) this.onExtractionEvent(ev);
      this.animateHelicopter(dt, time, camera);
    } else if (ex.phase === 'extracted' || ex.phase === 'failed') {
      this.animateHelicopter(dt, time, camera);
    }
    // flare light + audio
    if (this.flare) {
      const k = this.flare.intensity();
      const f = this.flareModel.position;
      ctx.renderer.flareLight.position.set(f.x, 1.2, f.z);
      ctx.renderer.flareLight.intensity = 26 * k;
      this.flare.setPosition({ x: f.x, y: f.y + 0.1, z: f.z });
    }
    this.terminal.update(dt, time);

    // ---- countdown ticks in the final seconds ----
    if (ex.phase === 'called' || ex.phase === 'inbound' || ex.phase === 'landing') {
      const sec = Math.ceil(ex.countdown);
      const key = `tick${sec}`;
      if (sec <= 10 && sec > 0 && !s.flags.has(key)) {
        s.flags.add(key);
        ctx.audio.play(sec <= 3 ? 'countdown_final' : 'countdown_tick', { priority: 2, volume: 0.7 });
      }
    }

    // ---- contamination ----
    this.updateHazard(dt, camera, time, alive);

    // ---- deadline ----
    if (!extractionInProgress(ex) && ex.phase !== 'extracted' && ex.phase !== 'failed') {
      const left = deadlineRemaining(s.elapsed);
      if (left <= 60 && !s.flags.has('deadline60')) {
        s.flags.add('deadline60');
        ctx.banner('LAST CALL', 'The district seals in 60 seconds - call extraction', 'danger', 4);
        ctx.radio('COMMAND', 'One minute until the district is sealed. Call extraction now.');
        ctx.audio.play('klaxon', { priority: 3 });
      }
      if (left <= 0) ctx.endRun('defeat', 'The district was sealed before extraction was called');
    }
    if (ex.phase === 'failed' && !s.ended) ctx.endRun('defeat', ex.failReason ?? 'Extraction failed');
    if (ex.phase === 'extracted' && !s.ended) ctx.endRun('victory', 'Extracted');

    // ---- staged narrative beats ----
    if (s.elapsed > 4 && !s.flags.has('brief')) {
      s.flags.add('brief');
      ctx.radio('COMMAND', 'Insertion confirmed. Two contracts: restore the depot relay and eliminate the Warden. Then radio for extraction at LZ Echo.', 7);
      ctx.audio.play('contract_new', { priority: 3 });
    }
    void escalationPhase;
  }

  private completeDefense(): void {
    const ctx = this.ctx;
    const s = ctx.session;
    ctx.level.transmitter.setState('done');
    ctx.level.transmitter.setProgress(1);
    this.transmitterLoop?.stop(0.6);
    this.transmitterLoop = null;
    ctx.audio.play('contract_complete', { priority: 3 });
    const r = claimDefenseReward(s.defense); // exactly once
    if (r) {
      const a = applyContractReward(s.inv, r);
      ctx.hudEvent({ type: 'cash', amount: a.cash });
      ctx.banner('RELAY RESTORED', `+$${a.cash.toLocaleString('en-US')}${a.plates ? `   +${a.plates} ARMOR PLATES` : ''}`, 'good', 5);
      ctx.feed(`CONTRACT COMPLETE  +$${a.cash}`, 'good');
      if (a.plates) ctx.feed(`+${a.plates} ARMOR PLATES`, 'good');
      ctx.radio('COMMAND', 'Relay restored. Nice work.');
    }
    this.areaMarker.setProgress(1);
  }

  /** Called when the Warden dies. */
  onWardenKilled(): void {
    const ctx = this.ctx;
    const s = ctx.session;
    if (!completeHunt(s.hunt)) return;
    ctx.audio.play('contract_complete', { priority: 3 });
    const r = claimHuntReward(s.hunt); // exactly once
    if (r) {
      const a = applyContractReward(s.inv, r);
      ctx.hudEvent({ type: 'cash', amount: a.cash });
      ctx.banner('THE WARDEN IS DOWN', `+$${a.cash.toLocaleString('en-US')}${a.plates ? `   +${a.plates} ARMOR PLATES` : ''}${a.grenades ? `   +${a.grenades} GRENADES` : ''}`, 'good', 5.5);
      ctx.feed(`CONTRACT COMPLETE  +$${a.cash}`, 'good');
      ctx.radio('COMMAND', 'Confirmed kill. The Warden is down.');
    }
  }

  private onExtractionEvent(ev: 'heliVisible' | 'landingStart' | 'touchdown' | 'departed' | 'extracted'): void {
    const ctx = this.ctx;
    switch (ev) {
      case 'heliVisible': {
        this.heliVisible = true;
        this.heli.root.visible = true;
        this.heliRotor = 0.6;
        const from = this.lz.heliFrom;
        this.heliPos.set(from.x, from.y, from.z);
        this.heliLoop = ctx.audio.startLoop('heli', { volume: 0.2, rate: 0.9, pos: { x: from.x, y: from.y, z: from.z }, fadeIn: 2 });
        ctx.banner('HELICOPTER INBOUND', 'Survive until touchdown', 'warn', 4);
        ctx.radio('PILOT', 'Bird on approach. Mark your position.');
        break;
      }
      case 'landingStart':
        ctx.radio('PILOT', 'Coming in hot - clear the pad!');
        break;
      case 'touchdown':
        ctx.audio.play('heli_land', { pos: { x: this.lz.heliX, y: 0.3, z: this.lz.heliZ }, priority: 3 });
        ctx.banner('HELICOPTER LANDED', 'Reach the open door and BOARD NOW', 'good', 5);
        ctx.radio('PILOT', "We're on the ground - get aboard, now!");
        this.terminal.setState('done');
        break;
      case 'departed':
        this.departT = 0;
        ctx.banner('HELICOPTER DEPARTED', 'You missed the extraction', 'danger', 4);
        break;
      case 'extracted':
        break;
    }
  }

  private animateHelicopter(dt: number, time: number, camera: THREE.Camera): void {
    const ctx = this.ctx;
    const ex = ctx.session.extraction;
    if (!this.heliVisible) return;
    const from = this.lz.heliFrom;
    const hoverY = 20;
    const hover = new THREE.Vector3(this.lz.heliX + 6, hoverY, this.lz.heliZ + 4);
    let pitch = 0;
    let lightsOn = true;
    let target = this.heliPos;
    const cd = ex.countdown;
    if (ex.phase === 'inbound' || ex.phase === 'called') {
      const p = ease(clamp01(1 - (cd - MISSION.extraction.landingDuration) / (MISSION.extraction.visibleAt - MISSION.extraction.landingDuration)));
      target = this.tmp.set(from.x + (hover.x - from.x) * p, from.y + (hover.y - from.y) * p, from.z + (hover.z - from.z) * p);
      pitch = 0.15 * (1 - p);
      this.heliRotor = Math.min(1, this.heliRotor + dt * 0.3);
      const dx = hover.x - from.x;
      const dz = hover.z - from.z;
      this.heliYaw = Math.atan2(-dx, -dz);
    } else if (ex.phase === 'landing') {
      const p = ease(clamp01(1 - cd / MISSION.extraction.landingDuration));
      target = this.tmp.set(hover.x + (this.lz.heliX - hover.x) * p, hoverY * (1 - p), hover.z + (this.lz.heliZ - hover.z) * p);
      // settle heading toward the pad's orientation
      let dy = this.lz.heliYaw - this.heliYaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      this.heliYaw += dy * Math.min(1, dt * 1.6);
      this.heliRotor = 1;
      const low = 1 - clamp01(target.y / 16);
      if (low > 0.05) ctx.fx.downwash({ x: this.lz.heliX, y: 0, z: this.lz.heliZ }, 13, low);
    } else if (ex.phase === 'landed') {
      target = this.tmp.set(this.lz.heliX, 0, this.lz.heliZ);
      this.heliYaw = this.lz.heliYaw;
      this.heliRotor = 0.85;
      this.heliDoor = Math.min(1, this.heliDoor + dt / 1.4);
      ctx.fx.downwash({ x: this.lz.heliX, y: 0, z: this.lz.heliZ }, 11, 0.35);
    } else if (ex.phase === 'boarding' || ex.phase === 'extracted') {
      // lift off with the player aboard
      const t = MISSION.extraction.boardingCinematic - ex.boardLeft;
      const lift = Math.max(0, t - 1.0);
      target = this.tmp.set(this.lz.heliX, Math.min(40, lift * lift * 2.2), this.lz.heliZ);
      this.heliRotor = 1;
      this.heliDoor = Math.max(0, 1 - Math.max(0, t - 0.6) / 0.8);
      ctx.fx.downwash({ x: this.lz.heliX, y: 0, z: this.lz.heliZ }, 13, clamp01(1 - target.y / 20));
    } else if (ex.phase === 'failed') {
      if (this.departT >= 0) {
        this.departT += dt;
        const t = this.departT;
        target = this.tmp.set(this.lz.heliX + t * t * 3, t * t * 1.6, this.lz.heliZ - t * t * 3);
        this.heliDoor = Math.max(0, this.heliDoor - dt);
        this.heliRotor = 1;
        if (t > 8) this.heli.root.visible = false;
      }
    }
    if (target !== this.heliPos) this.heliPos.copy(target);
    this.heli.root.position.copy(this.heliPos);
    this.heli.root.rotation.y = this.heliYaw;
    this.heli.update(dt, { rotor: this.heliRotor, lights: lightsOn, doorOpen: this.heliDoor, pitch, roll: pitch * 0.4 });
    lightsOn = true;
    // light + rotor audio follow the helicopter
    this.heliLight.position.set(this.heliPos.x, Math.max(2, this.heliPos.y - 2), this.heliPos.z);
    this.heliLight.intensity = this.heliPos.y < 26 ? 55 * (1 - clamp01(this.heliPos.y / 26)) + 10 : 0;
    if (this.heliLoop) {
      const dist = camera.position.distanceTo(this.heliPos);
      this.heliLoop.setPosition({ x: this.heliPos.x, y: this.heliPos.y, z: this.heliPos.z });
      this.heliLoop.setVolume(Math.min(1.2, 0.25 + 60 / (dist + 20)), 0.2);
      this.heliLoop.setRate(0.6 + 0.5 * this.heliRotor);
    }
    void time;
  }

  private updateHazard(dt: number, camera: THREE.Camera, time: number, alive: boolean): void {
    const ctx = this.ctx;
    const s = ctx.session;
    const ex = s.extraction;
    const p = ctx.player;
    const data = ctx.level.data;
    const calledAt = ex.calledAt;
    const start = surgeStartTime(calledAt);
    // advance warning
    if (!s.flags.has('surgeWarn') && s.elapsed >= start - MISSION.hazard.warningLead && calledAt === null) {
      s.flags.add('surgeWarn');
      ctx.banner('CONTAINMENT FAILING', 'A contamination surge begins in 20 seconds', 'warn', 4);
      ctx.radio('COMMAND', 'Containment is failing at the compound. Surge in twenty seconds.');
      ctx.audio.play('klaxon', { priority: 3 });
    }
    const active = surgeActive(s.elapsed, calledAt);
    if (active && !s.flags.has('surge')) {
      s.flags.add('surge');
      ctx.banner('CONTAMINATION SURGE', 'A toxic front is spreading from the compound - reach extraction', 'danger', 6);
      ctx.radio('COMMAND', 'Contamination surge! Stay ahead of the front and reach the LZ.');
      ctx.audio.play('siren_wail', { priority: 3 });
      this.sirenLoop = ctx.audio.startLoop('siren', { volume: 0.3 });
      ctx.level.spire.setSurge(true);
    }
    const r = active ? hazardRadius(s.elapsed, calledAt, extractionInProgress(ex), this.toLzDist) : 0;
    this.hazardR = r;
    this.wall.setRadius(r);
    this.wall.setIntensity(active ? clamp01((s.elapsed - start) / 5) : 0);
    this.wall.update(dt, time, camera);
    const inside = alive && isInsideHazard(p.x, p.z, data.hazardCenter.x, data.hazardCenter.z, r);
    if (inside) {
      ctx.hurtPlayer(MISSION.hazard.dps * dt, null, null, { ignoreArmor: true, toxic: true });
      this.coughTimer -= dt;
      if (this.coughTimer <= 0) {
        this.coughTimer = 1.4 + Math.random();
        ctx.audio.play('cough', { priority: 2 });
      }
      if (!this.gasLoop) this.gasLoop = ctx.audio.startLoop('gas', { volume: 0.5, fadeIn: 0.5 });
      if (!this.hazardWasInside) ctx.banner('TOXIC EXPOSURE', 'Leave the contaminated zone immediately', 'danger', 2.5);
    } else if (this.gasLoop) {
      this.gasLoop.stop(0.8);
      this.gasLoop = null;
    }
    this.hazardWasInside = inside;
    void ZOMBIES;
  }

  // ---------------------------------------------------------------------------------------------
  // HUD data
  // ---------------------------------------------------------------------------------------------

  get hazardRadiusNow(): number {
    return this.hazardR;
  }

  get insideHazard(): boolean {
    const p = this.ctx.player;
    const h = this.ctx.level.data.hazardCenter;
    return isInsideHazard(p.x, p.z, h.x, h.z, this.hazardR);
  }

  timers(): { timer: HudTimer; subTimer: HudTimer | null } {
    const s = this.ctx.session;
    const ex = s.extraction;
    let timer: HudTimer;
    if (ex.phase === 'landed') timer = { label: 'BOARD - HELICOPTER LEAVES IN', seconds: ex.windowLeft, urgent: ex.windowLeft < 15 };
    else if (ex.phase === 'called' || ex.phase === 'inbound' || ex.phase === 'landing') timer = { label: 'HELICOPTER ETA', seconds: Math.max(0, ex.countdown), urgent: ex.countdown < 15 };
    else if (ex.phase === 'boarding' || ex.phase === 'extracted') timer = { label: 'EXTRACTING', seconds: Math.max(0, ex.boardLeft), urgent: false };
    else {
      const left = deadlineRemaining(s.elapsed);
      timer = { label: surgeActive(s.elapsed, ex.calledAt) ? 'FRONT REACHES LZ IN' : 'DISTRICT SEALED IN', seconds: left, urgent: left < 90 };
    }
    let subTimer: HudTimer | null = null;
    if (s.defense.status === 'active') {
      subTimer = { label: 'UPLINK', seconds: Math.max(0, (1 - s.defense.progress) * MISSION.defense.duration), urgent: !s.defense.insideNow };
    }
    return { timer, subTimer };
  }

  objectives(): HudObjective[] {
    const ctx = this.ctx;
    const s = ctx.session;
    const p = ctx.player;
    const data = ctx.level.data;
    const list: HudObjective[] = [];
    const defDist = Math.hypot(data.defense.x - p.x, data.defense.z - p.z);
    const dstate = s.defense.status;
    let ddetail: string;
    if (dstate === 'available') ddetail = `Activate the transmitter at the depot (${Math.round(defDist)} m)`;
    else if (dstate === 'active') ddetail = s.defense.insideNow ? `Hold the area - ${Math.round(s.defense.progress * 100)}%` : 'RETURN TO THE MARKED AREA';
    else ddetail = 'Relay restored';
    list.push({
      id: 'defense',
      title: MISSION.defense.title,
      detail: ddetail,
      state: dstate === 'complete' ? 'complete' : dstate === 'active' ? 'active' : 'available',
      progress: dstate === 'available' ? -1 : s.defense.progress,
      tracked: false,
      distance: dstate === 'complete' ? -1 : defDist,
    });
    const boss = ctx.zombies.boss;
    const huntDist = Math.hypot(data.hunt.searchX - p.x, data.hunt.searchZ - p.z);
    const hstate = s.hunt.status;
    let hdetail: string;
    if (hstate === 'complete') hdetail = 'The Warden is dead';
    else if (s.hunt.identified && boss?.alive) hdetail = `Eliminate THE WARDEN (${Math.round(Math.hypot(boss.x - p.x, boss.z - p.z))} m)`;
    else hdetail = `Search the research compound (${Math.round(huntDist)} m)`;
    list.push({
      id: 'hunt',
      title: MISSION.hunt.title,
      detail: hdetail,
      state: hstate === 'complete' ? 'complete' : 'active',
      progress: hstate === 'complete' ? 1 : boss && s.hunt.identified ? 1 - boss.hp / boss.maxHp : -1,
      tracked: false,
      distance: hstate === 'complete' ? -1 : s.hunt.identified && boss?.alive ? Math.hypot(boss.x - p.x, boss.z - p.z) : huntDist,
    });
    const ex = s.extraction;
    const lzDist = Math.hypot(this.lz.lzX - p.x, this.lz.lzZ - p.z);
    let edetail = 'Complete both contracts to unlock';
    let estate: HudObjective['state'] = 'locked';
    if (ex.phase === 'available') {
      edetail = `Signal the helicopter at LZ ECHO (${Math.round(lzDist)} m)`;
      estate = 'available';
    } else if (ex.phase === 'called' || ex.phase === 'inbound' || ex.phase === 'landing') {
      edetail = 'Hold the landing zone until touchdown';
      estate = 'active';
    } else if (ex.phase === 'landed') {
      edetail = 'BOARD THE HELICOPTER';
      estate = 'active';
    } else if (ex.phase === 'boarding' || ex.phase === 'extracted') {
      edetail = 'Extracted';
      estate = 'complete';
    } else if (ex.phase === 'failed') {
      edetail = 'Extraction failed';
      estate = 'failed';
    }
    list.push({
      id: 'extract',
      title: MISSION.extraction.title + ' AT LZ ECHO',
      detail: edetail,
      state: estate,
      progress: -1,
      tracked: false,
      distance: estate === 'locked' ? -1 : lzDist,
    });
    // guide the player to the nearest unfinished objective (extraction takes over once both contracts are done)
    const open = list.filter((o) => o.id !== 'extract' && o.state !== 'complete');
    let tracked: HudObjective | undefined;
    if (open.length > 0) tracked = open.reduce((a, b) => (a.distance <= b.distance ? a : b));
    else tracked = list.find((o) => o.id === 'extract');
    if (tracked) tracked.tracked = true;
    return list;
  }

  /** Mission markers for the maps and compass (positions in world space). */
  markers(out: MapMarker[]): void {
    const ctx = this.ctx;
    const s = ctx.session;
    const data = ctx.level.data;
    out.length = 0;
    const ex = s.extraction;
    const tracked = this.objectives().find((o) => o.tracked)?.id;
    out.push({
      id: 'defense',
      kind: 'transmitter',
      x: data.defense.x,
      z: data.defense.z,
      label: 'RELAY',
      color: '#5ad0ff',
      radius: data.defense.radius,
      visible: true,
      compass: s.defense.status !== 'complete',
      pulse: tracked === 'defense',
      dim: s.defense.status === 'complete',
    });
    const boss = ctx.zombies.boss;
    if (s.hunt.status !== 'complete') {
      if (s.hunt.identified && boss?.alive) {
        out.push({ id: 'hunt', kind: 'hunt', x: boss.x, z: boss.z, label: 'THE WARDEN', color: '#ff5a4d', visible: true, compass: true, pulse: true });
      } else {
        out.push({ id: 'hunt', kind: 'hunt', x: data.hunt.searchX, z: data.hunt.searchZ, label: 'SEARCH AREA', color: '#ff8a5a', radius: data.hunt.searchRadius, visible: true, compass: true, pulse: tracked === 'hunt' });
      }
    }
    const lzShown = ex.phase !== 'locked';
    out.push({
      id: 'lz',
      kind: 'lz',
      x: this.lz.lzX,
      z: this.lz.lzZ,
      label: 'LZ ECHO',
      color: '#ffc040',
      radius: lzShown ? this.lz.lzRadius : undefined,
      visible: true,
      compass: lzShown && ex.phase !== 'extracted',
      pulse: ex.phase === 'available' || ex.phase === 'landed',
      dim: !lzShown,
    });
    if (this.heliVisible && this.heli.root.visible) {
      out.push({ id: 'heli', kind: 'helicopter', x: this.heliPos.x, z: this.heliPos.z, label: 'HELICOPTER', color: '#ffe08a', visible: true, compass: false, pulse: ex.phase === 'landed' });
    }
    out.push({ id: 'start', kind: 'start', x: data.playerStart.x, z: data.playerStart.z, label: 'INSERTION', visible: true, dim: true });
    for (const st of data.stations) {
      out.push({ id: st.id, kind: st.kind, x: st.x, z: st.z, label: st.kind === 'buy' ? 'SUPPLY' : 'ARMORY', visible: true });
    }
    const player = ctx.player;
    for (const c of this.entities.crates) {
      out.push({ id: c.def.id, kind: 'crate', x: c.def.x, z: c.def.z, visible: c.discovered && !c.opened || (!c.opened && Math.hypot(c.def.x - player.x, c.def.z - player.z) < 30) });
    }
    out.push({ id: 'spire', kind: 'landmark', x: data.hazardCenter.x, z: data.hazardCenter.z, label: 'SPIRE', color: '#5fe08a', visible: true, dim: true });
  }

  contractsDone(): number {
    return contractsCompleted(this.ctx.session.defense, this.ctx.session.hunt);
  }

  failExtractionNow(reason: string): void {
    failExtraction(this.ctx.session.extraction, reason);
  }

  dispose(): void {
    this.stopLoops();
    this.flare?.stop();
    this.root.removeFromParent();
    this.heli.dispose();
    this.wall.dispose();
    this.areaMarker.dispose();
    this.terminal.dispose();
  }
}
