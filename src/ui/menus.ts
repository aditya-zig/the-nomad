/**
 * Menus: title, pause, resume prompt, results, error and loading screens. Screens are rebuilt on show (never per
 * frame). The DEPLOY / RESUME callbacks are invoked SYNCHRONOUSLY from the input event handler so the game can
 * request pointer lock and start audio inside the user gesture.
 */
import './styles.css';
import './nomad.css';
import { alliedClan, CLANS } from '../logic/nomad';
import { DEFAULT_SETTINGS, REGIONS } from '../config';
import type { BestRun, MissionStats, Settings } from '../types';
import { el, fmtClock, fmtInt, fmtMoney } from './dom';
import type { MenuCallbacks, MenusApi } from './hudTypes';
import { icon } from './icons';
import { setReducedMotionSetting } from './prefs';
import { type SettingsPanel, buildControlsPanel, buildSettingsPanel } from './settingsPanel';

type ScreenKind = 'title' | 'pause' | 'resume' | 'results' | 'error';

const BRIEF: { tag: string; title: string; text: string }[] = [
  {
    tag: 'CONTRACT ALPHA',
    title: 'RESTORE THE RELAY',
    text: 'Salvage 2 power cells from glowing caches. Spend them at the depot and defend the uplink.',
  },
  {
    tag: 'CLAN ALLEGIANCE',
    title: 'POWER EARNS LOYALTY',
    text: 'Share cells at trading posts: 7 helps Ember, 8 helps Iron. Two donations earn a clan alliance. Hunt the Warden in the compound.',
  },
  {
    tag: 'EXTRACT',
    title: 'BRING THE CARAVAN HOME',
    text: 'Carry 3 cells, earn 60 trust with either clan, finish both contracts, then call your clan’s helicopter at LZ Echo.',
  },
];

class Menus implements MenusApi {
  private root: HTMLElement | null = null;
  private layer!: HTMLElement;
  private screen: HTMLElement | null = null;
  private kind: ScreenKind | null = null;
  private loading: HTMLElement | null = null;
  private loadFill!: HTMLElement;
  private loadText!: HTMLElement;
  private settings: Settings = { ...DEFAULT_SETTINGS };
  private readonly panels = new Set<SettingsPanel>();
  private deployStamp = 0;
  private readonly armTimers = new Map<HTMLButtonElement, number>();

  constructor(private readonly cb: MenuCallbacks) {}

  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.repeat || e.defaultPrevented) return;
    const active = document.activeElement;
    const free = !active || active === document.body || active === document.documentElement;
    if (this.kind === 'title' && e.key === 'Enter' && free) {
      e.preventDefault();
      this.deploy();
    } else if (this.kind === 'resume' && (e.key === 'Enter' || e.key === ' ') && free) {
      e.preventDefault();
      this.cb.onResume();
    }
  };

  mount(root: HTMLElement): void {
    if (this.root) return;
    this.root = root;
    this.layer = el('div', 'ds-menus', root);
    this.layer.dataset.ui = 'nomad-game';
    window.addEventListener('keydown', this.onKey);
  }

  get visible(): boolean {
    return this.kind !== null;
  }

  // -------------------------------------------------------------------------------------------
  // settings
  // -------------------------------------------------------------------------------------------

  setSettings(settings: Settings): void {
    this.settings = { ...settings };
    setReducedMotionSetting(settings.reducedMotion);
    for (const p of this.panels) p.sync(this.settings);
  }

  private pushSetting(patch: Partial<Settings>): void {
    this.settings = { ...this.settings, ...patch };
    if (patch.reducedMotion !== undefined) setReducedMotionSetting(patch.reducedMotion);
    for (const p of this.panels) p.sync(this.settings);
    this.cb.onSettingsChange({ ...this.settings });
  }

  private makeSettingsPanel(): HTMLElement {
    const panel = buildSettingsPanel((patch) => this.pushSetting(patch));
    panel.sync(this.settings);
    this.panels.add(panel);
    return panel.root;
  }

  // -------------------------------------------------------------------------------------------
  // screen management
  // -------------------------------------------------------------------------------------------

  private setScreen(kind: ScreenKind, node: HTMLElement): void {
    this.screen = node;
    this.kind = kind;
    node.classList.add('ds-screen', `ds-${kind}`);
    this.layer.appendChild(node);
  }

  private clearScreen(): void {
    for (const [btn, id] of this.armTimers) {
      window.clearTimeout(id);
      this.armTimers.delete(btn);
    }
    this.panels.clear();
    this.screen?.remove();
    this.screen = null;
    this.kind = null;
  }

  hide(): void {
    this.clearScreen();
  }

  private deploy(): void {
    const t = performance.now();
    if (t - this.deployStamp < 400) return;
    this.deployStamp = t;
    this.cb.onDeploy();
  }

  private button(parent: HTMLElement, label: string, cls: string, onClick: () => void): HTMLButtonElement {
    const b = el('button', `ds-btn ${cls}`.trim(), parent, label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  /** Destructive action button: first click arms it ("CONFIRM"), second click within 3 s runs the action. */
  private confirmButton(parent: HTMLElement, label: string, cls: string, onConfirm: () => void): HTMLButtonElement {
    const b = this.button(parent, label, cls, () => {
      const timer = this.armTimers.get(b);
      if (timer !== undefined) {
        window.clearTimeout(timer);
        this.armTimers.delete(b);
        b.classList.remove('armed');
        b.textContent = label;
        onConfirm();
        return;
      }
      b.classList.add('armed');
      b.textContent = 'CONFIRM';
      this.armTimers.set(
        b,
        window.setTimeout(() => {
          this.armTimers.delete(b);
          b.classList.remove('armed');
          b.textContent = label;
        }, 3000),
      );
    });
    return b;
  }

  private tabs(parent: HTMLElement, controls: HTMLElement, settings: HTMLElement, initial: 'controls' | 'settings'): (which: 'controls' | 'settings') => void {
    const bar = el('div', 'ds-tabs', parent);
    bar.setAttribute('role', 'tablist');
    const body = el('div', 'ds-tabbody', parent);
    body.append(controls, settings);
    const bC = el('button', 'tab', bar, 'CONTROLS');
    const bS = el('button', 'tab', bar, 'SETTINGS');
    for (const b of [bC, bS]) {
      b.type = 'button';
      b.setAttribute('role', 'tab');
    }
    const show = (which: 'controls' | 'settings'): void => {
      const c = which === 'controls';
      controls.hidden = !c;
      settings.hidden = c;
      bC.classList.toggle('on', c);
      bS.classList.toggle('on', !c);
      bC.setAttribute('aria-selected', c ? 'true' : 'false');
      bS.setAttribute('aria-selected', c ? 'false' : 'true');
    };
    bC.addEventListener('click', () => show('controls'));
    bS.addEventListener('click', () => show('settings'));
    show(initial);
    return show;
  }

  // -------------------------------------------------------------------------------------------
  // title
  // -------------------------------------------------------------------------------------------

  showTitle(best: BestRun | null): void {
    this.clearScreen();
    const root = el('div', '');
    el('div', 'ds-shade', root);
    el('div', 'ds-scanlines', root);

    // ---- left: title block ----
    const main = el('div', 'ds-title-main', root);
    const h1 = el('h1', 'name', main);
    el('span', 'l1', h1, 'THE NOMAD');
    el('span', 'l2', h1, 'Survive the Wastelands');
    el('p', 'nomad-run', main, 'Ashfall Run');
    el(
      'p',
      'premise',
      main,
      'The cities went dark. The clans did not. Scavenge the dead district for power, fight the infected, and decide who gets to see another dawn.',
    );

    const actions = el('div', 'actions', main);
    const deployBtn = this.button(actions, 'ENTER THE WASTELAND', 'primary big', () => this.deploy());
    deployBtn.setAttribute('aria-label', 'Enter the wasteland');
    let showTab: (w: 'controls' | 'settings') => void = () => {};
    this.button(actions, 'SETTINGS', '', () => showTab('settings'));
    this.button(actions, 'CONTROLS', '', () => showTab('controls'));
    el('div', 'note', main, 'Keyboard + mouse. Esc pauses. Headphones recommended.');
    const choice = el('div', 'nomad-choice', main);
    el('strong', '', choice, 'Every cell is a choice.');
    el('p', '', choice, 'Ember keeps people alive. Iron keeps the perimeter standing. Your convoy needs power too.');

    const bestEl = el('div', 'best', main);
    if (best) {
      el('span', 'lbl', bestEl, 'BEST EXTRACTION');
      el('span', 'val', bestEl, fmtClock(best.time));
      el(
        'span',
        'sub',
        bestEl,
        `${fmtInt(best.kills)} KILLS  /  ${fmtInt(best.headshots)} HEADSHOTS  /  ${fmtMoney(best.cash)}  /  ${best.date.slice(0, 10)}`,
      );
    } else {
      el('span', 'lbl', bestEl, 'SERVICE RECORD');
      el('span', 'sub', bestEl, 'NO SUCCESSFUL EXTRACTIONS ON FILE');
    }

    // ---- right: brief + tabbed controls/settings ----
    const side = el('div', 'ds-title-side', root);
    const brief = el('div', 'ds-brief ds-panel ds-brk', side);
    const bh = el('div', 'ds-panel-head', brief);
    el('span', '', bh, 'OPERATION BRIEF');
    el('span', 'aux', bh, 'PRIORITY ALPHA');
    for (let i = 0; i < BRIEF.length; i++) {
      const item = BRIEF[i]!;
      const row = el('div', 'row', brief);
      el('span', 'n', row, String(i + 1));
      const body = el('div', 'body', row);
      const tt = el('div', 't', body);
      el('span', 'tag', tt, item.tag);
      el('span', 'title', tt, item.title);
      el('div', 'text', body, item.text);
    }
    el('div', 'foot', brief, 'Water and food drain as you travel. Caches restore both. At a trading post, 9 buys a full refill. The ash surge arrives at 7:30.');

    const panel = el('div', 'ds-sidepanel ds-panel ds-brk', side);
    showTab = this.tabs(panel, buildControlsPanel(), this.makeSettingsPanel(), 'controls');

    el('div', 'ds-title-foot', root, 'THE NOMAD / ASHFALL RUN · Adapted from DEAD SIGNAL by bridge-mind · Local single-player');

    this.setScreen('title', root);
    deployBtn.focus({ preventScroll: true });
  }

  // -------------------------------------------------------------------------------------------
  // pause + resume
  // -------------------------------------------------------------------------------------------

  showPause(): void {
    this.clearScreen();
    const root = el('div', '');
    el('div', 'ds-scrim', root);
    const panel = el('div', 'ds-pause-panel ds-panel ds-brk', root);
    const head = el('div', 'ds-panel-head big', panel);
    el('span', '', head, 'MISSION SUSPENDED');
    el('span', 'aux', head, 'PAUSED');
    this.tabs(panel, buildControlsPanel(), this.makeSettingsPanel(), 'controls');
    const actions = el('div', 'actions', panel);
    const resume = this.button(actions, 'RESUME', 'primary', () => this.cb.onResume());
    this.confirmButton(actions, 'RESTART MISSION', '', () => this.cb.onRestart());
    this.confirmButton(actions, 'QUIT TO TITLE', '', () => this.cb.onQuitToTitle());
    this.setScreen('pause', root);
    resume.focus({ preventScroll: true });
  }

  showResumePrompt(reason: string): void {
    this.clearScreen();
    const root = el('div', '');
    el('div', 'ds-scrim light', root);
    const box = el('div', 'ds-resume-box ds-panel ds-brk', root);
    el('div', 'ttl', box, 'SIGNAL INTERRUPTED');
    el('div', 'why', box, reason);
    const btn = this.button(box, 'CLICK TO RESUME', 'primary', () => this.cb.onResume());
    el('div', 'note', box, 'The simulation is frozen until you resume.');
    root.addEventListener('click', (e) => {
      if (e.target !== btn) this.cb.onResume();
    });
    this.setScreen('resume', root);
    btn.focus({ preventScroll: true });
  }

  // -------------------------------------------------------------------------------------------
  // results
  // -------------------------------------------------------------------------------------------

  showResults(stats: MissionStats, best: BestRun | null, isNewBest: boolean): void {
    this.clearScreen();
    const win = stats.outcome === 'victory';
    const root = el('div', '');
    root.dataset.outcome = stats.outcome;
    el('div', 'ds-scrim', root);
    const panel = el('div', 'ds-results-panel ds-panel ds-brk', root);
    el('div', 'hazbar', panel);

    const hdr = el('div', 'hdr', panel);
    el('div', 'kick', hdr, win ? 'OPERATION COMPLETE' : 'OPERATION TERMINATED');
    el('div', 'oc', hdr, win ? 'EXTRACTION SUCCESSFUL' : 'MISSION FAILED');
    if (!(win && stats.reason.trim().toLowerCase() === 'extracted')) el('div', 'reason', hdr, stats.reason.toUpperCase());

    const accuracy = stats.shotsFired > 0 ? `${Math.round((stats.shotsHit / stats.shotsFired) * 100)}%` : '--';
    const hsPct = stats.kills > 0 ? ` (${Math.round((stats.headshots / stats.kills) * 100)}%)` : '';
    const region = REGIONS[stats.highestRegion];

    const grid = el('div', 'grid', panel);
    const cell = (label: string, value: string, tone = ''): void => {
      const c = el('div', `c ${tone}`.trim(), grid);
      el('span', 'l', c, label);
      el('span', 'v', c, value);
    };
    cell('TIME SURVIVED', fmtClock(stats.timeSurvived), 'big');
    cell('KILLS', fmtInt(stats.kills), 'big');
    cell('HEADSHOTS', `${fmtInt(stats.headshots)}${hsPct}`);
    cell('ACCURACY', `${accuracy}   ${fmtInt(stats.shotsHit)} / ${fmtInt(stats.shotsFired)}`);
    cell('CONTRACTS', `${stats.contractsCompleted} / ${stats.contractsTotal}`, stats.contractsCompleted >= stats.contractsTotal ? 'good' : '');
    cell('SUPPLY CACHES', fmtInt(stats.cratesOpened));
    if (stats.nomad) {
      const n = stats.nomad;
      const ally = alliedClan(n);
      cell('CELLS SALVAGED / SHARED', `${n.cellsFound} / ${n.cellsShared}`);
      cell('CLAN ALLIANCE', ally ? CLANS[ally].toUpperCase() : 'UNALIGNED');
      cell('EMBER / IRON TRUST', `${n.trust.ember} / ${n.trust.iron}`);
      cell('CONVOY CARGO', n.cargoLoaded ? '3 CELLS SECURED' : `${n.cells} CELLS CARRIED`);
    }
    cell('CASH EARNED', fmtMoney(stats.cashEarned));
    cell('CASH SPENT', fmtMoney(stats.cashSpent));
    cell('AMMO COLLECTED', fmtInt(stats.ammoCollected));
    cell('PLATES COLLECTED', fmtInt(stats.platesCollected));
    const threat = el('div', `c threat ${stats.highestRegion}`, grid);
    el('span', 'l', threat, 'HIGHEST THREAT');
    el('span', 'v', threat, region.name);

    const bestEl = el('div', 'best', panel);
    if (win && isNewBest) {
      el('span', 'flag', bestEl, 'NEW PERSONAL BEST');
      el('span', 'txt', bestEl, `${fmtClock(stats.timeSurvived)} extraction time recorded`);
    } else if (best) {
      el('span', 'lbl', bestEl, 'BEST EXTRACTION');
      el('span', 'val', bestEl, fmtClock(best.time));
      if (win) {
        const delta = Math.round(stats.timeSurvived - best.time);
        el('span', `delta ${delta <= 0 ? 'good' : 'bad'}`, bestEl, `${delta <= 0 ? '-' : '+'}${fmtClock(Math.abs(delta))} vs this run`);
      } else {
        el('span', 'txt', bestEl, `${fmtInt(best.kills)} kills  /  ${fmtInt(best.headshots)} headshots  /  ${fmtMoney(best.cash)}`);
      }
    } else {
      el('span', 'txt', bestEl, win ? 'First extraction on file.' : 'Only successful extractions are recorded.');
    }

    const actions = el('div', 'actions', panel);
    const again = this.button(actions, 'REDEPLOY', 'primary', () => this.cb.onRestart());
    this.button(actions, 'RETURN TO TITLE', '', () => this.cb.onQuitToTitle());
    this.setScreen('results', root);
    again.focus({ preventScroll: true });
  }

  // -------------------------------------------------------------------------------------------
  // error + loading
  // -------------------------------------------------------------------------------------------

  showError(title: string, message: string, details?: string): void {
    this.clearScreen();
    const root = el('div', '');
    el('div', 'ds-scrim heavy', root);
    const box = el('div', 'ds-error-box ds-panel ds-brk', root);
    const head = el('div', 'ds-panel-head big', box);
    el('span', '', head, 'SYSTEM FAULT');
    el('span', 'aux', head).appendChild(icon('hazard'));
    el('div', 'ttl', box, title);
    el('p', 'msg', box, message);
    if (details) el('pre', 'det', box, details);
    const actions = el('div', 'actions', box);
    const reload = this.button(actions, 'RELOAD PAGE', 'primary', () => window.location.reload());
    this.setScreen('error', root);
    reload.focus({ preventScroll: true });
  }

  showLoading(fraction: number, text: string): void {
    if (!this.root) return;
    if (!this.loading) {
      this.loading = el('div', 'ds-loading', this.layer);
      this.loadText = el('div', 'txt', this.loading);
      const bar = el('div', 'bar', this.loading);
      this.loadFill = el('i', '', bar);
    }
    this.loadText.textContent = text;
    this.loadFill.style.transform = `scaleX(${Math.max(0, Math.min(1, fraction)).toFixed(3)})`;
  }

  hideLoading(): void {
    this.loading?.remove();
    this.loading = null;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey);
    this.clearScreen();
    this.hideLoading();
    this.layer?.remove();
    this.root = null;
  }
}

export function createMenus(cb: MenuCallbacks): MenusApi {
  return new Menus(cb);
}
