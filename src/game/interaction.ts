/**
 * Contextual interactions: crates, stations (number-key panels), the transmitter console, the extraction terminal and the
 * helicopter door. Produces the HUD prompt / station panel each frame and executes actions exactly once.
 */
import { ECONOMY, MISSION, PLAYER, WEAPONS } from '../config';
import { addCash, spendCash } from '../logic/economy';
import { CLANS, NOMAD, refillSupplies, shareCell, type Clan } from '../logic/nomad';
import { buyMenu, purchaseBuy, purchaseUpgrade, upgradeMenu, type BuyItemId, type StationItem } from '../logic/economy';
import type { Edges } from '../player/input';
import type { HudPrompt, StationPanel } from '../ui/hudTypes';
import type { GameCtx } from './ctx';
import type { Entities, StationRuntime } from './entities';

/** What the interaction layer needs from the mission runtime. */
export interface MissionApi {
  transmitterPos(): { x: number; z: number };
  canActivateTransmitter(): boolean;
  activateTransmitter(): void;
  terminalPos(): { x: number; z: number };
  terminalState(): 'locked' | 'available' | 'busy';
  callExtraction(): boolean;
  heliDoorPos(): { x: number; z: number } | null;
  canBoard(): boolean;
  board(): boolean;
}

interface Target {
  id: string;
  dist: number;
  text: string;
  sub?: string;
  tone: HudPrompt['tone'];
  hold: number;
  enabled: boolean;
  onUse(): void;
}

export interface InteractionOutput {
  prompt: HudPrompt | null;
  panel: StationPanel | null;
  /** True while a station panel is open (weapon slot keys are then item keys). */
  panelOpen: boolean;
}

export class Interaction {
  private holdT = 0;
  private holdId = '';
  private holdLocked = false;
  private panelStation: StationRuntime | null = null;
  private readonly out: InteractionOutput = { prompt: null, panel: null, panelOpen: false };

  constructor(
    private readonly ctx: GameCtx,
    private readonly entities: Entities,
    private readonly mission: MissionApi,
  ) {}

  reset(): void {
    this.holdT = 0;
    this.holdId = '';
    this.holdLocked = false;
    this.closePanel(false);
  }

  get panelOpen(): boolean {
    return this.panelStation !== null;
  }

  closePanel(sound = true): void {
    if (this.panelStation && sound) this.ctx.audio.play('station_close', { priority: 1, volume: 0.6 });
    this.panelStation = null;
  }

  update(dt: number, edges: Edges, eHeld: boolean): InteractionOutput {
    const ctx = this.ctx;
    const out = this.out;
    out.prompt = null;
    out.panel = null;
    out.panelOpen = false;
    if (!ctx.playerAlive()) {
      this.closePanel(false);
      return out;
    }
    const px = ctx.player.x;
    const pz = ctx.player.z;

    // ---- open station panel ----
    if (this.panelStation) {
      const s = this.panelStation;
      const d = Math.hypot(s.def.x - px, s.def.z - pz);
      if (d > ECONOMY.stationRange + 1.2 || edges.interactPressed) {
        this.closePanel();
      } else {
        for (const digit of edges.digits) this.handleDigit(s, digit);
        out.panel = this.buildPanel(s);
        out.panelOpen = true;
        this.holdT = 0;
        return out;
      }
    }

    const target = this.findTarget();
    if (!target) {
      this.holdT = 0;
      this.holdId = '';
      if (!eHeld) this.holdLocked = false;
      return out;
    }
    if (!target.enabled) {
      out.prompt = { key: '', text: target.text, sub: target.sub, hold: -1, tone: target.tone };
      return out;
    }

    if (target.hold <= 0) {
      out.prompt = { key: 'E', text: target.text, sub: target.sub, hold: -1, tone: target.tone };
      if (edges.interactPressed) target.onUse();
      return out;
    }

    // hold interaction
    if (this.holdId !== target.id) {
      this.holdId = target.id;
      this.holdT = 0;
    }
    if (!eHeld) this.holdLocked = false;
    if (eHeld && !this.holdLocked) {
      this.holdT += dt;
      if (this.holdT >= target.hold) {
        this.holdT = 0;
        this.holdLocked = true; // must release E before another hold can complete
        target.onUse();
      }
    } else {
      this.holdT = Math.max(0, this.holdT - dt * 2);
    }
    out.prompt = { key: 'E', text: target.text, sub: target.sub, hold: Math.min(1, this.holdT / target.hold), tone: target.tone };
    return out;
  }

  // ---------------------------------------------------------------------------------------------

  private findTarget(): Target | null {
    const ctx = this.ctx;
    const px = ctx.player.x;
    const pz = ctx.player.z;
    const fx = -Math.sin(ctx.player.yaw);
    const fz = -Math.cos(ctx.player.yaw);
    const targets: Target[] = [];
    const facing = (x: number, z: number, dist: number): boolean => {
      if (dist < 1.6) return true;
      return ((x - px) * fx + (z - pz) * fz) / dist > 0.25;
    };

    for (const c of this.entities.crates) {
      if (c.opened) continue;
      const d = Math.hypot(c.def.x - px, c.def.z - pz);
      if (d > PLAYER.interactReach || !facing(c.def.x, c.def.z, d)) continue;
      targets.push({
        id: `crate:${c.def.id}`,
        dist: d,
        text: 'SALVAGE POWER CACHE',
        sub: `${NOMAD.cellYield[c.def.region]} power cell(s), water, rations and ammunition`,
        tone: 'normal',
        hold: ECONOMY.crateOpenTime,
        enabled: true,
        onUse: () => this.entities.openCrate(c),
      });
    }
    for (const s of this.entities.stations) {
      const d = Math.hypot(s.def.x - px, s.def.z - pz);
      if (d > ECONOMY.stationRange || !facing(s.def.x, s.def.z, d)) continue;
      targets.push({
        id: `station:${s.def.id}`,
        dist: d,
        text: s.def.kind === 'buy' ? 'CLAN TRADING POST' : 'CLAN ARMORY',
        sub: 'Trade gear or share cells: 7 Ember / 8 Iron / 9 supplies',
        tone: 'normal',
        hold: 0,
        enabled: true,
        onUse: () => {
          this.panelStation = s;
          ctx.audio.play('station_open', { priority: 1, volume: 0.7 });
          s.model.setState('near');
        },
      });
    }
    // transmitter console
    if (this.mission.canActivateTransmitter()) {
      const t = this.mission.transmitterPos();
      const d = Math.hypot(t.x - px, t.z - pz);
      if (d < 3.4) {
        targets.push({
          id: 'transmitter',
          dist: d,
          text: ctx.session.nomad.cells >= NOMAD.relayCells ? 'POWER THE CLAN RELAY' : 'RELAY NEEDS 2 POWER CELLS',
          sub: `Costs 2 cells. Defend the uplink for ${MISSION.defense.duration}s`,
          tone: 'warn',
          hold: MISSION.defense.activateHold,
          enabled: true,
          onUse: () => this.mission.activateTransmitter(),
        });
      }
    }
    // extraction terminal
    {
      const t = this.mission.terminalPos();
      const d = Math.hypot(t.x - px, t.z - pz);
      const st = this.mission.terminalState();
      if (d < 3.6 && st !== 'busy') {
        if (st === 'locked') {
          targets.push({ id: 'terminal-locked', dist: d, text: 'CONVOY BEACON LOCKED', sub: 'Finish contracts, carry 3 cells and earn 60 trust with either clan', tone: 'warn', hold: 0, enabled: false, onUse: () => {} });
        } else {
          targets.push({
            id: 'terminal',
            dist: d,
            text: 'CALL EXTRACTION',
            sub: 'Hold position - the final horde will converge',
            tone: 'danger',
            hold: MISSION.extraction.callHold,
            enabled: true,
            onUse: () => this.mission.callExtraction(),
          });
        }
      }
    }
    // helicopter door
    const door = this.mission.heliDoorPos();
    if (door && this.mission.canBoard()) {
      const d = Math.hypot(door.x - px, door.z - pz);
      targets.push({ id: 'board', dist: d, text: 'BOARD HELICOPTER', sub: 'Extract now', tone: 'good', hold: 0, enabled: true, onUse: () => this.mission.board() });
    }
    if (targets.length === 0) return null;
    // prefer actionable targets, then nearest
    targets.sort((a, b) => (a.enabled === b.enabled ? a.dist - b.dist : a.enabled ? -1 : 1));
    return targets[0]!;
  }

  // ---------------------------------------------------------------------------------------------
  // station panels
  // ---------------------------------------------------------------------------------------------

  private items(s: StationRuntime): StationItem[] {
    const inv = this.ctx.session.inv;
    return s.def.kind === 'buy' ? buyMenu(inv) : upgradeMenu(inv);
  }

  private buildPanel(s: StationRuntime): StationPanel {
    const items = this.items(s);
    const inv = this.ctx.session.inv;
    const buy = s.def.kind === 'buy';
    return {
      title: buy ? 'WASTELAND EXCHANGE' : 'CLAN ARMORY',
      subtitle: `$${inv.cash.toLocaleString('en-US')}  /  ${this.ctx.session.nomad.cells} CELLS  /  SHARE TO EARN TRUST`,
      items: [
        ...items.map((i) => ({ key: i.key, label: i.label, detail: i.detail, cost: i.cost, state: i.state, note: i.note })),
        ...(['ember', 'iron'] as const).map((clan, i) => ({
          key: String(i + 7), label: `SHARE WITH ${CLANS[clan].toUpperCase()}`,
          detail: clan === 'ember' ? '1 cell → +20 trust, water +40, rations +35' : '1 cell → +20 trust, armor +25, $150',
          cost: 0, note: `${this.ctx.session.nomad.trust[clan]} TRUST`,
          state: this.ctx.session.nomad.trust[clan] >= 100 ? 'maxed' as const : this.ctx.session.nomad.cells > 0 ? 'ok' as const : 'unavailable' as const,
        })),
        { key: '9', label: 'WATER + RATIONS', detail: 'Refill both survival supplies to 100%', cost: NOMAD.refillCost,
          state: inv.cash >= NOMAD.refillCost ? 'ok' : 'unaffordable' },
      ],
      hint: 'PRESS NUMBER TO TRADE / SHARE   E OR WALK AWAY TO CLOSE',
    };
  }

  private handleDigit(s: StationRuntime, digit: number): void {
    const ctx = this.ctx;
    const inv = ctx.session.inv;
    if (digit >= 7 && digit <= 9) {
      const n = ctx.session.nomad;
      let ok = false;
      if (digit === 9) {
        if (n.water < 100 || n.food < 100) {
          ok = spendCash(inv, NOMAD.refillCost);
          if (ok) refillSupplies(n);
        }
        ctx.feed(ok ? 'SUPPLIES REFILLED  -$100' : 'SUPPLIES FULL OR NOT ENOUGH FUNDS', ok ? 'good' : 'warn');
      } else {
        const clan: Clan = digit === 7 ? 'ember' : 'iron';
        ok = shareCell(n, clan);
        if (ok) {
          if (clan === 'iron') {
            addCash(inv, 150);
            ctx.session.vitals.armor = Math.min(PLAYER.maxArmor, ctx.session.vitals.armor + 25);
          }
          ctx.radio(CLANS[clan].toUpperCase(), clan === 'ember'
            ? 'Our water pumps are running again. Take these rations. We remember who shares.'
            : 'A cell for our defenses. You earned your cut, Nomad.');
          ctx.feed(`${CLANS[clan].toUpperCase()}  +20 TRUST  /  -1 CELL`, 'good');
        } else ctx.feed('NEED A POWER CELL / CLAN TRUST ALREADY FULL', 'warn');
      }
      ctx.audio.play(ok ? 'buy_ok' : 'buy_denied', { priority: 2 });
      s.model.setState(ok ? 'used' : 'denied');
      return;
    }
    const items = this.items(s);
    const item = items.find((i) => i.key === String(digit));
    if (!item) return;
    // any in-progress reload of a weapon that is about to be swapped must not survive the purchase
    const result = s.def.kind === 'buy' ? purchaseBuy(inv, item.id as BuyItemId) : purchaseUpgrade(inv, (digit - 1) as 0 | 1);
    if (result.ok) {
      const equipped = inv.slots[inv.activeSlot];
      if (s.def.kind === 'buy' && (item.id === 'shotgun' || item.id === 'rearm')) ctx.weapons.cancelActions();
      if (s.def.kind === 'upgrade') ctx.weapons.cancelActions();
      void equipped;
      ctx.audio.play(s.def.kind === 'upgrade' ? 'upgrade_ok' : 'buy_ok', { priority: 2 });
      s.model.setState(s.def.kind === 'upgrade' ? 'used' : 'used');
      ctx.hudEvent({ type: 'cash', amount: -result.cost });
      ctx.feed(`${result.message.toUpperCase()}  -$${result.cost}`, 'good');
      ctx.fx.sparkle({ x: s.def.x, y: 1.6, z: s.def.z }, s.def.kind === 'upgrade' ? 0x6ff0ff : 0x9be07a, 16);
    } else {
      ctx.audio.play('buy_denied', { priority: 2, volume: 0.8 });
      s.model.setState('denied');
      ctx.feed(result.message.toUpperCase(), 'warn');
    }
    void WEAPONS;
  }
}
