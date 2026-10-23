/**
 * In-game HUD. Builds its DOM once under the given root and is driven entirely by `update(state, map, dt)` plus
 * discrete `event()`s. No internal animation loop: per-frame work is change-detected DOM writes and two small
 * canvas draws (minimap always, tactical map only while open).
 */
import './styles.css';
import './nomad.css';
import { NomadView } from './nomadView';
import { TextCell, el, fmtMoney, setHidden } from './dom';
import {
  BannerView,
  CashDeltas,
  Crosshair,
  DamageArcs,
  FeedView,
  HitMarker,
  RadioView,
  ScreenFx,
} from './hudFx';
import { ObjectivesView, PlateRing, PromptView, StationView, VitalsView, WeaponView } from './hudPanels';
import { BossView, ClockView, CompassView, HazardView, RegionView } from './hudTop';
import type { HudApi, HudEvent, HudState, MapData, MapDynamic } from './hudTypes';
import { Minimap, TacticalMap } from './mapView';
import { setReducedMotionSetting } from './prefs';

class Hud implements HudApi {
  private root: HTMLElement | null = null;
  private hud!: HTMLElement;
  private visible = true;
  private tactical = false;

  private fx!: ScreenFx;
  private crosshair!: Crosshair;
  private hitMarker!: HitMarker;
  private arcs!: DamageArcs;
  private banner!: BannerView;
  private feed!: FeedView;
  private radio!: RadioView;
  private cashDeltas!: CashDeltas;
  private vitals!: VitalsView;
  private weapon!: WeaponView;
  private objectives!: ObjectivesView;
  private station!: StationView;
  private prompt!: PromptView;
  private plate!: PlateRing;
  private compass!: CompassView;
  private clocks!: ClockView;
  private hazard!: HazardView;
  private boss!: BossView;
  private region!: RegionView;
  private nomad!: NomadView;
  private minimap!: Minimap;
  private tacMap!: TacticalMap;
  private tacRoot!: HTMLElement;
  private cashText!: TextCell;
  private fpsEl!: HTMLElement;
  private fpsText!: TextCell;
  private lastCash = Number.NaN;
  private resizeObs: ResizeObserver | null = null;
  private readonly onWinResize = (): void => this.layout();

  mount(root: HTMLElement): void {
    if (this.root) return;
    this.root = root;
    const hud = el('div', 'ds-hud', root);
    this.hud = hud;
    hud.dataset.ui = 'nomad-game';

    // ---- full-screen effects ----
    this.fx = new ScreenFx(hud);

    // ---- top-left: minimap + threat ----
    const tl = el('div', 'ds-topleft', hud);
    const mm = el('div', 'ds-minimap', tl);
    const mmCanvas = el('canvas', '', mm);
    mmCanvas.setAttribute('aria-label', 'Minimap');
    this.minimap = new Minimap(mmCanvas);
    this.region = new RegionView(tl);
    this.nomad = new NomadView(tl);

    // ---- top-centre: compass, clocks, hazard, boss ----
    const tc = el('div', 'ds-topcenter', hud);
    this.compass = new CompassView(tc);
    this.clocks = new ClockView(tc);
    this.hazard = new HazardView(tc);
    this.boss = new BossView(tc);
    this.banner = new BannerView(hud);

    // ---- right column: objectives + station panel ----
    const right = el('div', 'ds-right', hud);
    this.fpsEl = el('div', 'ds-fps', hud);
    this.fpsEl.hidden = true;
    this.fpsText = new TextCell(this.fpsEl);
    this.objectives = new ObjectivesView(right);
    this.station = new StationView(right);

    // ---- centre: crosshair, hit marker, damage arcs, prompts ----
    const centre = el('div', 'ds-center', hud);
    this.arcs = new DamageArcs(centre);
    this.crosshair = new Crosshair(centre);
    this.hitMarker = new HitMarker(centre);
    this.plate = new PlateRing(hud);
    this.prompt = new PromptView(hud);

    // ---- bottom-left: feed, cash, vitals ----
    const bl = el('div', 'ds-bottomleft', hud);
    this.feed = new FeedView(bl);
    const cash = el('div', 'ds-cash', bl);
    el('span', 'lbl', cash, 'FUNDS');
    this.cashText = new TextCell(el('span', 'amt', cash));
    this.cashDeltas = new CashDeltas(el('span', 'deltas', cash));
    this.vitals = new VitalsView(bl);

    // ---- bottom-right: weapon ----
    const br = el('div', 'ds-bottomright', hud);
    this.weapon = new WeaponView(br);

    // ---- bottom-centre: radio ----
    const bc = el('div', 'ds-bottomcenter', hud);
    this.radio = new RadioView(bc);

    // ---- tactical map overlay ----
    this.tacRoot = el('div', 'ds-tactical', hud);
    this.tacRoot.hidden = true;
    const tacCanvas = el('canvas', '', this.tacRoot);
    tacCanvas.setAttribute('aria-label', 'Tactical map');
    this.tacMap = new TacticalMap(tacCanvas);

    this.layout();
    if (typeof ResizeObserver === 'function') {
      this.resizeObs = new ResizeObserver(() => this.layout());
      this.resizeObs.observe(hud);
    }
    window.addEventListener('resize', this.onWinResize);
  }

  private layout(): void {
    if (!this.root) return;
    this.crosshair.setViewportHeight(this.hud.clientHeight || window.innerHeight);
    this.minimap.resize();
    if (this.tactical) this.tacMap.resize();
  }

  setMapData(data: MapData): void {
    this.minimap.setData(data);
    this.tacMap.setData(data);
    this.layout();
  }

  update(s: HudState, map: MapDynamic, dt: number): void {
    this.nomad.update(s.nomad);
    if (!this.root || !this.visible) return;

    this.fx.setVignette(s.vignette);
    this.fx.setToxic(s.toxic);
    this.crosshair.update(s.crosshair);
    this.vitals.update(s);
    this.weapon.update(s);
    if (s.cash !== this.lastCash) {
      this.lastCash = s.cash;
      this.cashText.set(fmtMoney(s.cash));
    }
    this.region.update(s.region, s.regionName, s.regionColor);
    this.clocks.update(s.timer, s.subTimer);
    this.hazard.update(s.hazard);
    this.boss.update(s.boss);
    this.compass.update(s.compassYaw, map);
    this.objectives.update(s.objectives);
    this.station.update(s.panel);
    this.prompt.update(s.prompt);
    this.plate.update(s.plateProgress);
    if (s.fps === null) {
      setHidden(this.fpsEl, true);
    } else {
      setHidden(this.fpsEl, false);
      this.fpsText.set(`${Math.round(s.fps)} FPS`);
    }

    this.banner.update(dt);
    this.feed.update(dt);
    this.radio.update(dt);

    this.minimap.draw(map);
    if (this.tactical) this.tacMap.draw(map, { regionName: s.regionName });
  }

  event(e: HudEvent): void {
    if (!this.root) return;
    switch (e.type) {
      case 'hit':
        this.hitMarker.trigger(e.head, e.kill);
        break;
      case 'damage':
        if (e.toxic || e.angle === undefined) {
          if (e.toxic) this.fx.toxicPulse();
          else this.fx.hurtFlash(e.amount / 30);
        } else {
          this.arcs.trigger(e.angle, e.amount);
          this.fx.hurtFlash(e.amount / 30);
        }
        break;
      case 'banner':
        this.banner.push(e.title, e.subtitle, e.tone, e.duration);
        break;
      case 'feed':
        this.feed.push(e.text, e.tone);
        break;
      case 'radio':
        this.radio.push(e.speaker, e.text, e.duration);
        break;
      case 'flash':
        this.fx.flash(e.color, e.strength);
        break;
      case 'cash':
        this.cashDeltas.pop(e.amount);
        break;
    }
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    if (this.hud) this.hud.hidden = !visible;
    if (visible) this.layout();
  }

  toggleTacticalMap(force?: boolean): boolean {
    const open = force ?? !this.tactical;
    if (open === this.tactical) return this.tactical;
    this.tactical = open;
    this.hud?.classList.toggle('tac-open', open);
    if (this.tacRoot) {
      this.tacRoot.hidden = !open;
      if (open) this.tacMap.resize();
    }
    return this.tactical;
  }

  get tacticalMapOpen(): boolean {
    return this.tactical;
  }

  /** Extra (not part of the contract): mirror the reduced-motion setting when the HUD is used without the menus. */
  setReducedMotion(v: boolean): void {
    setReducedMotionSetting(v);
  }

  reset(): void {
    if (!this.root) return;
    this.fx.reset();
    this.hitMarker.reset();
    this.arcs.reset();
    this.banner.reset();
    this.feed.reset();
    this.radio.reset();
    this.cashDeltas.reset();
    this.toggleTacticalMap(false);
    this.lastCash = Number.NaN;
  }

  dispose(): void {
    window.removeEventListener('resize', this.onWinResize);
    this.resizeObs?.disconnect();
    this.hud?.remove();
    this.root = null;
  }
}

export function createHud(): HudApi {
  return new Hud();
}
