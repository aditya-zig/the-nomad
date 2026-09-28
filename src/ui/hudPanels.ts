/**
 * Static-structure HUD panels that are updated in place: vitals, weapon block, objective tracker, station panel,
 * interaction prompt and the armour-plate progress ring. Every write is guarded by change detection.
 */
import type { WeaponId } from '../types';
import { NumCell, TextCell, clamp01, el, fmtDist, fmtInt, fmtMoney, setAttr, setHidden, svgEl } from './dom';
import type { HudObjective, HudPrompt, HudState, HudWeaponInfo, StationPanel } from './hudTypes';
import { type IconName, icon, weaponSilhouette } from './icons';

// ---------------------------------------------------------------------------------------------
// vitals: health, armour, plates, stamina
// ---------------------------------------------------------------------------------------------

export class VitalsView {
  readonly root: HTMLElement;
  private readonly hpFill: HTMLElement;
  private readonly hpGhost: HTMLElement;
  private readonly hpRow: HTMLElement;
  private readonly hpNum: TextCell;
  private readonly armorBar: HTMLElement;
  private armorSegs: HTMLElement[] = [];
  private readonly armorNum: TextCell;
  private readonly platePips: HTMLElement;
  private pips: HTMLElement[] = [];
  private readonly stam: HTMLElement;
  private readonly hp = new NumCell(0.002);
  private readonly stamCell = new NumCell(0.004);
  private readonly armorCells: NumCell[] = [];
  private segCount = 0;
  private pipCount = 0;
  private pipsOn = -1;
  private lvl = '';
  private exhausted = false;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'ds-vitals ds-panel ds-brk', parent);

    this.hpRow = el('div', 'ds-vrow health', this.root);
    const hIc = el('span', 'ic', this.hpRow);
    hIc.appendChild(icon('cross'));
    const hBar = el('div', 'bar', this.hpRow);
    this.hpGhost = el('i', 'ghost', hBar);
    this.hpFill = el('i', 'fill', hBar);
    el('b', 'ticks', hBar);
    this.hpNum = new TextCell(el('span', 'num', this.hpRow));

    const aRow = el('div', 'ds-vrow armor', this.root);
    el('span', 'ic', aRow).appendChild(icon('shield'));
    this.armorBar = el('div', 'bar seg', aRow);
    this.armorNum = new TextCell(el('span', 'num', aRow));

    const pRow = el('div', 'ds-vrow plates', this.root);
    el('span', 'ic', pRow).appendChild(icon('plate'));
    this.platePips = el('div', 'pips', pRow);
    el('span', 'lbl', pRow, 'PLATES');
    el('kbd', 'key', pRow, 'Q');

    const sRow = el('div', 'ds-stam', this.root);
    this.stam = el('i', '', sRow);
  }

  update(s: HudState): void {
    const hf = clamp01(s.maxHealth > 0 ? s.health / s.maxHealth : 0);
    if (this.hp.changed(hf)) {
      const t = `scaleX(${hf.toFixed(3)})`;
      this.hpFill.style.transform = t;
      this.hpGhost.style.transform = t;
      const lvl = hf > 0.5 ? 'ok' : hf > 0.25 ? 'warn' : 'crit';
      if (lvl !== this.lvl) {
        this.lvl = lvl;
        this.hpRow.dataset.lvl = lvl;
      }
    }
    this.hpNum.set(String(Math.ceil(s.health)));

    // armour segments (one per plate worth of armour)
    const segs = Math.max(1, Math.round(s.maxArmor / 50));
    if (segs !== this.segCount) {
      this.segCount = segs;
      this.armorBar.replaceChildren();
      this.armorSegs = [];
      this.armorCells.length = 0;
      for (let i = 0; i < segs; i++) {
        const seg = el('span', 's', this.armorBar);
        this.armorSegs.push(el('i', '', seg));
        this.armorCells.push(new NumCell(0.004));
      }
    }
    for (let i = 0; i < segs; i++) {
      const f = clamp01((s.armor - i * 50) / 50);
      if (this.armorCells[i]!.changed(f)) this.armorSegs[i]!.style.transform = `scaleX(${f.toFixed(3)})`;
    }
    this.armorNum.set(String(Math.ceil(s.armor)));

    // plate pips
    if (s.maxPlates !== this.pipCount) {
      this.pipCount = s.maxPlates;
      this.platePips.replaceChildren();
      this.pips = [];
      for (let i = 0; i < s.maxPlates; i++) this.pips.push(el('i', '', this.platePips));
      this.pipsOn = -1;
    }
    if (s.plates !== this.pipsOn) {
      this.pipsOn = s.plates;
      for (let i = 0; i < this.pips.length; i++) this.pips[i]!.classList.toggle('on', i < s.plates);
    }

    if (this.stamCell.changed(s.stamina)) this.stam.style.transform = `scaleX(${clamp01(s.stamina).toFixed(3)})`;
    if (s.staminaExhausted !== this.exhausted) {
      this.exhausted = s.staminaExhausted;
      this.stam.parentElement?.classList.toggle('exhausted', s.staminaExhausted);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// weapon block
// ---------------------------------------------------------------------------------------------

export class WeaponView {
  readonly root: HTMLElement;
  private readonly name: TextCell;
  private readonly tier: HTMLElement;
  private readonly tierText: TextCell;
  private readonly mode: TextCell;
  private readonly silHost: HTMLElement;
  private readonly mag: HTMLElement;
  private readonly magText: TextCell;
  private readonly resText: TextCell;
  private readonly bar: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly hintText: TextCell;
  private readonly other: TextCell;
  private readonly otherKey: TextCell;
  private readonly otherRoot: HTMLElement;
  private otherSig = '';
  private readonly gren: HTMLElement;
  private grenPips: HTMLElement[] = [];
  private grenCount = -1;
  private grenOn = -1;
  private sil: WeaponId | '' = '';
  private readonly reload = new NumCell(0.004);
  private hintKind = '';
  private magState = '';

  constructor(parent: HTMLElement) {
    this.root = el('div', 'ds-weapon ds-panel ds-brk', parent);

    const top = el('div', 'wtop', this.root);
    this.name = new TextCell(el('span', 'wname', top));
    this.tier = el('span', 'tier', top);
    this.tierText = new TextCell(this.tier);
    this.mode = new TextCell(el('span', 'mode', top));

    const mid = el('div', 'wmid', this.root);
    this.silHost = el('div', 'wsil', mid);
    const ammo = el('div', 'wammo', mid);
    this.mag = el('span', 'mag', ammo);
    this.magText = new TextCell(this.mag);
    el('span', 'sep', ammo, '/');
    this.resText = new TextCell(el('span', 'res', ammo));

    const bar = el('div', 'wbar', this.root);
    this.bar = el('i', '', bar);
    this.hint = el('div', 'whint', this.root);
    this.hintText = new TextCell(this.hint);

    const foot = el('div', 'wfoot', this.root);
    this.otherRoot = el('div', 'wother', foot);
    this.otherKey = new TextCell(el('kbd', 'key', this.otherRoot));
    this.other = new TextCell(el('span', 'txt', this.otherRoot));
    this.gren = el('div', 'wgren', foot);
    el('kbd', 'key', this.gren, 'G');
  }

  update(s: HudState): void {
    const w: HudWeaponInfo | null = s.weapon;
    this.root.classList.toggle('none', !w);
    if (w) {
      this.name.set(w.short);
      const showTier = w.tier > 0;
      setHidden(this.tier, !showTier);
      this.tierText.set(w.tierLabel);
      setAttr(this.tier, 'data-tier', String(w.tier));
      this.mode.set(w.auto ? 'AUTO' : w.id === 'shotgun' ? 'PUMP' : 'SEMI');
      if (w.id !== this.sil) {
        this.sil = w.id;
        this.silHost.replaceChildren(weaponSilhouette(w.id));
      }
      this.magText.set(String(w.mag));
      this.resText.set(String(w.reserve));
      const dry = w.mag === 0 && w.reserve === 0;
      let magState = 'ok';
      if (dry) magState = 'empty';
      else if (w.mag === 0 && !w.reloading) magState = 'dry';
      else if (s.lowAmmo) magState = 'low';
      if (magState !== this.magState) {
        this.magState = magState;
        this.root.dataset.ammo = magState;
      }
      let hint = '';
      if (w.reloading) hint = 'RELOADING';
      else if (s.outOfAmmo || dry) hint = 'NO AMMO';
      else if (w.mag === 0) hint = 'RELOAD  [R]';
      else if (s.lowAmmo) hint = 'LOW AMMO';
      if (hint !== this.hintKind) {
        this.hintKind = hint;
        this.hintText.set(hint);
        this.hint.dataset.kind = w.reloading ? 'reload' : hint === '' ? 'none' : hint.startsWith('LOW') ? 'low' : 'crit';
      }
      const rp = w.reloading ? clamp01(w.reloadProgress) : 0;
      if (this.reload.changed(rp)) {
        this.bar.style.transform = `scaleX(${rp.toFixed(3)})`;
        (this.bar.parentElement as HTMLElement).style.opacity = rp > 0 ? '1' : '0';
      }
    }
    const o = s.otherWeapon;
    setHidden(this.otherRoot, !o);
    if (o) {
      const sig = `${o.short}|${o.tier}|${o.mag}|${o.reserve}|${s.activeSlot}`;
      if (sig !== this.otherSig) {
        this.otherSig = sig;
        this.otherKey.set(String(s.activeSlot === 0 ? 2 : 1));
        this.other.set(`${o.short}${o.tier > 0 ? (o.tier > 1 ? ' III' : ' II') : ''}  ${fmtInt(o.mag)}/${fmtInt(o.reserve)}`);
      }
    }

    // grenade pips
    if (s.maxGrenades !== this.grenCount) {
      this.grenCount = s.maxGrenades;
      for (const p of this.grenPips) p.remove();
      this.grenPips = [];
      for (let i = 0; i < s.maxGrenades; i++) {
        const pip = el('span', 'gp', this.gren);
        pip.appendChild(icon('grenade'));
        this.gren.insertBefore(pip, this.gren.lastElementChild);
        this.grenPips.push(pip);
      }
      this.grenOn = -1;
    }
    if (s.grenades !== this.grenOn) {
      this.grenOn = s.grenades;
      for (let i = 0; i < this.grenPips.length; i++) this.grenPips[i]!.classList.toggle('on', i < s.grenades);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// objectives
// ---------------------------------------------------------------------------------------------

interface ObjRow {
  root: HTMLElement;
  mark: HTMLElement;
  title: TextCell;
  dist: TextCell;
  detail: TextCell;
  prog: HTMLElement;
  progFill: HTMLElement;
  progText: TextCell;
  state: string;
  cell: NumCell;
}

const OBJ_ICON: Record<HudObjective['state'], IconName> = {
  locked: 'lock',
  available: 'diamondHollow',
  active: 'diamond',
  complete: 'check',
  failed: 'x',
};

export class ObjectivesView {
  readonly root: HTMLElement;
  private readonly list: HTMLElement;
  private rows: ObjRow[] = [];

  constructor(parent: HTMLElement) {
    this.root = el('div', 'ds-obj ds-panel ds-brk', parent);
    const head = el('div', 'ds-panel-head', this.root);
    el('span', '', head, 'OBJECTIVES');
    el('span', 'aux', head, 'MISSION');
    this.list = el('div', 'list', this.root);
  }

  update(objs: HudObjective[]): void {
    setHidden(this.root, objs.length === 0);
    while (this.rows.length < objs.length) this.rows.push(this.makeRow());
    while (this.rows.length > objs.length) this.rows.pop()!.root.remove();
    for (let i = 0; i < objs.length; i++) this.fill(this.rows[i]!, objs[i]!);
  }

  private makeRow(): ObjRow {
    const root = el('div', 'ds-obj-row', this.list);
    const mark = el('span', 'mark', root);
    const body = el('div', 'body', root);
    const t = el('div', 't', body);
    const title = new TextCell(el('span', 'title', t));
    const dist = new TextCell(el('span', 'dist', t));
    const detail = new TextCell(el('div', 'detail', body));
    const prog = el('div', 'prog', body);
    const bar = el('span', 'barw', prog);
    const progFill = el('i', '', bar);
    const progText = new TextCell(el('span', 'pct', prog));
    return { root, mark, title, dist, detail, prog, progFill, progText, state: '', cell: new NumCell(0.003) };
  }

  private fill(r: ObjRow, o: HudObjective): void {
    r.title.set(o.title);
    r.detail.set(o.detail);
    r.dist.set(o.state === 'active' || o.state === 'available' ? fmtDist(o.distance) : '');
    if (o.state !== r.state) {
      r.state = o.state;
      r.root.dataset.state = o.state;
      r.mark.replaceChildren(icon(OBJ_ICON[o.state]));
    }
    setAttr(r.root, 'data-tracked', o.tracked ? '1' : '0');
    const showProg = o.progress >= 0 && o.state !== 'locked';
    setHidden(r.prog, !showProg);
    if (showProg) {
      const p = clamp01(o.progress);
      if (r.cell.changed(p)) r.progFill.style.transform = `scaleX(${p.toFixed(3)})`;
      r.progText.set(`${Math.round(p * 100)}%`);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// station panel
// ---------------------------------------------------------------------------------------------

interface StationRow {
  root: HTMLElement;
  key: TextCell;
  label: TextCell;
  detail: TextCell;
  cost: TextCell;
  note: TextCell;
  state: string;
}

export class StationView {
  readonly root: HTMLElement;
  private readonly title: TextCell;
  private readonly sub: TextCell;
  private readonly items: HTMLElement;
  private readonly hint: TextCell;
  private rows: StationRow[] = [];

  constructor(parent: HTMLElement) {
    this.root = el('div', 'ds-station ds-panel ds-brk', parent);
    this.root.hidden = true;
    const head = el('div', 'head', this.root);
    this.title = new TextCell(el('span', 'title', head));
    this.sub = new TextCell(el('span', 'sub', head));
    this.items = el('div', 'items', this.root);
    this.hint = new TextCell(el('div', 'hint', this.root));
  }

  update(p: StationPanel | null): void {
    const wasHidden = this.root.hidden;
    setHidden(this.root, !p);
    if (!p) return;
    if (wasHidden && !this.root.hidden) {
      this.root.animate([{ opacity: 0, transform: 'translateX(14px)' }, { opacity: 1, transform: 'none' }], { duration: 180, easing: 'ease-out' });
    }
    this.title.set(p.title);
    this.sub.set(p.subtitle);
    this.hint.set(p.hint);
    while (this.rows.length < p.items.length) this.rows.push(this.makeRow());
    while (this.rows.length > p.items.length) this.rows.pop()!.root.remove();
    for (let i = 0; i < p.items.length; i++) {
      const it = p.items[i]!;
      const r = this.rows[i]!;
      r.key.set(it.key);
      r.label.set(it.label);
      r.detail.set(it.detail);
      r.note.set(it.note ?? '');
      let costText = fmtMoney(it.cost);
      if (it.state === 'full') costText = 'FULL';
      else if (it.state === 'owned') costText = 'OWNED';
      else if (it.state === 'maxed') costText = 'MAXED';
      else if (it.state === 'unavailable') costText = 'LOCKED';
      r.cost.set(costText);
      if (it.state !== r.state) {
        r.state = it.state;
        r.root.dataset.state = it.state;
      }
    }
  }

  private makeRow(): StationRow {
    const root = el('div', 'it', this.items);
    const key = new TextCell(el('kbd', 'key', root));
    const mid = el('div', 'mid', root);
    const line = el('div', 'line', mid);
    const label = new TextCell(el('span', 'label', line));
    const note = new TextCell(el('span', 'note', line));
    const detail = new TextCell(el('div', 'detail', mid));
    const cost = new TextCell(el('span', 'cost', root));
    return { root, key, label, detail, cost, note, state: '' };
  }
}

// ---------------------------------------------------------------------------------------------
// interaction prompt
// ---------------------------------------------------------------------------------------------

const RING_C = 2 * Math.PI * 21;

export class PromptView {
  readonly root: HTMLElement;
  private readonly key: TextCell;
  private readonly text: TextCell;
  private readonly sub: HTMLElement;
  private readonly subText: TextCell;
  private readonly ringFg: SVGCircleElement;
  private readonly ring: SVGSVGElement;
  private readonly holdCell = new NumCell(0.004);
  private tone = '';
  private ringOn = false;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'ds-prompt', parent);
    this.root.hidden = true;
    const cap = el('div', 'cap', this.root);
    this.ring = svgEl('svg', { viewBox: '0 0 50 50', class: 'ring', 'aria-hidden': 'true' }, cap);
    svgEl('circle', { class: 'bg', cx: 25, cy: 25, r: 21 }, this.ring);
    this.ringFg = svgEl('circle', { class: 'fg', cx: 25, cy: 25, r: 21, 'stroke-dasharray': RING_C.toFixed(2), 'stroke-dashoffset': RING_C.toFixed(2) }, this.ring);
    this.key = new TextCell(el('kbd', 'key', cap));
    const txt = el('div', 'txt', this.root);
    this.text = new TextCell(el('div', 'text', txt));
    this.sub = el('div', 'sub', txt);
    this.subText = new TextCell(this.sub);
  }

  update(p: HudPrompt | null): void {
    setHidden(this.root, !p);
    if (!p) return;
    this.key.set(p.key);
    this.text.set(p.text);
    this.subText.set(p.sub ?? '');
    setHidden(this.sub, !p.sub);
    if (p.tone !== this.tone) {
      this.tone = p.tone;
      this.root.dataset.tone = p.tone;
    }
    const hold = p.hold >= 0 ? clamp01(p.hold) : -1;
    const ringOn = hold >= 0;
    if (ringOn !== this.ringOn) {
      this.ringOn = ringOn;
      this.ring.style.opacity = ringOn ? '1' : '0';
    }
    if (this.holdCell.changed(hold)) {
      this.ringFg.setAttribute('stroke-dashoffset', (RING_C * (1 - Math.max(0, hold))).toFixed(2));
    }
  }
}

// ---------------------------------------------------------------------------------------------
// plate application ring
// ---------------------------------------------------------------------------------------------

export class PlateRing {
  readonly root: HTMLElement;
  private readonly fg: SVGCircleElement;
  private readonly cell = new NumCell(0.004);
  private static readonly C = 2 * Math.PI * 26;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'ds-plate', parent);
    this.root.hidden = true;
    const svg = svgEl('svg', { viewBox: '0 0 60 60', 'aria-hidden': 'true' }, this.root);
    svgEl('circle', { class: 'bg', cx: 30, cy: 30, r: 26 }, svg);
    this.fg = svgEl('circle', { class: 'fg', cx: 30, cy: 30, r: 26, 'stroke-dasharray': PlateRing.C.toFixed(2), 'stroke-dashoffset': PlateRing.C.toFixed(2) }, svg);
    el('span', 'ic', this.root).appendChild(icon('plate'));
    el('span', 'lbl', this.root, 'APPLYING PLATE');
  }

  update(progress: number): void {
    const on = progress >= 0;
    setHidden(this.root, !on);
    if (!on) return;
    const p = clamp01(progress);
    if (this.cell.changed(p)) this.fg.setAttribute('stroke-dashoffset', (PlateRing.C * (1 - p)).toFixed(2));
  }
}
