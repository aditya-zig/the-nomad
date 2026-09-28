/**
 * Top-of-screen HUD elements: compass tape with waypoints, mission clocks, hazard strip, boss bar, threat-region meter.
 */
import type { Region } from '../types';
import { NumCell, TextCell, clamp01, el, fmtClock, fmtDist, setAttr, setHidden, wrap180 } from './dom';
import type { HudState, HudTimer, MapDynamic, MapMarkerKind } from './hudTypes';
import { icon } from './icons';
import { MARKER_COLOR } from './mapView';

// ---------------------------------------------------------------------------------------------
// compass
// ---------------------------------------------------------------------------------------------

const CARDINALS: [number, string][] = [
  [0, 'N'],
  [45, 'NE'],
  [90, 'E'],
  [135, 'SE'],
  [180, 'S'],
  [225, 'SW'],
  [270, 'W'],
  [315, 'NW'],
];
const NUMBERED = [30, 60, 120, 150, 210, 240, 300, 330];
const COMPASS_HALF_RANGE = 74;
const MAX_WAYPOINTS = 8;

interface Waypoint {
  node: HTMLElement;
  dist: TextCell;
  kind: MapMarkerKind | '';
  cell: NumCell;
  shown: boolean;
}

export class CompassView {
  readonly root: HTMLElement;
  private readonly tape: HTMLElement;
  private readonly hdg: TextCell;
  private readonly wps: Waypoint[] = [];
  private readonly tapeCell = new NumCell(0.01);

  constructor(parent: HTMLElement) {
    this.root = el('div', 'ds-compass', parent);
    const win = el('div', 'window', this.root);
    this.tape = el('div', 'tape', win);
    for (let c = 0; c < 3; c++) {
      const cyc = el('div', 'cyc', this.tape);
      for (const [deg, txt] of CARDINALS) {
        const l = el('span', deg % 90 === 0 ? 'lb card' : 'lb inter', cyc, txt);
        l.style.setProperty('--d', String(deg));
      }
      for (const deg of NUMBERED) {
        const l = el('span', 'lb num', cyc, String(deg).padStart(3, '0'));
        l.style.setProperty('--d', String(deg));
      }
    }
    const marks = el('div', 'marks', this.root);
    for (let i = 0; i < MAX_WAYPOINTS; i++) {
      const node = el('div', 'wp', marks);
      node.hidden = true;
      el('span', 'dia', node);
      const dist = new TextCell(el('span', 'wd', node));
      this.wps.push({ node, dist, kind: '', cell: new NumCell(0.05), shown: false });
    }
    el('div', 'caret', this.root);
    this.hdg = new TextCell(el('div', 'hdg', this.root));
  }

  update(yaw: number, map: MapDynamic): void {
    const heading = ((((-yaw * 180) / Math.PI) % 360) + 360) % 360;
    if (this.tapeCell.changed(heading)) {
      const pct = ((heading + 360) / 1080) * 100;
      this.tape.style.transform = `translateX(-${pct.toFixed(3)}%)`;
      this.hdg.set(String(Math.round(heading) % 360).padStart(3, '0'));
    }
    let n = 0;
    const p = map.player;
    for (const m of map.markers) {
      if (!m.compass || !m.visible || n >= MAX_WAYPOINTS) continue;
      const dx = m.x - p.x;
      const dz = m.z - p.z;
      const bearing = (Math.atan2(dx, -dz) * 180) / Math.PI;
      const rel = wrap180(bearing - heading);
      const wp = this.wps[n++]!;
      if (Math.abs(rel) > COMPASS_HALF_RANGE) {
        if (wp.shown) {
          wp.shown = false;
          wp.node.hidden = true;
        }
        continue;
      }
      if (!wp.shown) {
        wp.shown = true;
        wp.node.hidden = false;
      }
      if (wp.kind !== m.kind) {
        wp.kind = m.kind;
        wp.node.style.color = m.color ?? MARKER_COLOR[m.kind];
        wp.node.dataset.kind = m.kind;
      }
      wp.node.classList.toggle('dim', !!m.dim);
      if (wp.cell.changed(rel)) wp.node.style.setProperty('--rel', rel.toFixed(2));
      wp.dist.set(fmtDist(Math.hypot(dx, dz)));
    }
    for (; n < MAX_WAYPOINTS; n++) {
      const wp = this.wps[n]!;
      if (wp.shown) {
        wp.shown = false;
        wp.node.hidden = true;
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// clocks
// ---------------------------------------------------------------------------------------------

export class ClockView {
  readonly root: HTMLElement;
  private readonly main: HTMLElement;
  private readonly mainLbl: TextCell;
  private readonly mainTime: TextCell;
  private readonly sub: HTMLElement;
  private readonly subLbl: TextCell;
  private readonly subTime: TextCell;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'ds-clocks', parent);
    this.main = el('div', 'ds-clock ds-panel ds-brk', this.root);
    this.mainLbl = new TextCell(el('span', 'lbl', this.main));
    this.mainTime = new TextCell(el('span', 'time', this.main));
    this.sub = el('div', 'ds-subclock ds-panel', this.root);
    this.sub.hidden = true;
    this.subLbl = new TextCell(el('span', 'lbl', this.sub));
    this.subTime = new TextCell(el('span', 'time', this.sub));
  }

  update(t: HudTimer, sub: HudTimer | null): void {
    this.mainLbl.set(t.label);
    this.mainTime.set(fmtClock(t.seconds));
    setAttr(this.main, 'data-urgent', t.urgent ? '1' : '0');
    setHidden(this.sub, !sub);
    if (sub) {
      this.subLbl.set(sub.label);
      this.subTime.set(fmtClock(sub.seconds));
      setAttr(this.sub, 'data-urgent', sub.urgent ? '1' : '0');
    }
  }
}

// ---------------------------------------------------------------------------------------------
// hazard strip
// ---------------------------------------------------------------------------------------------

export class HazardView {
  readonly root: HTMLElement;
  private readonly msg: TextCell;
  private readonly tag: HTMLElement;
  private inside = false;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'ds-hazard', parent);
    this.root.hidden = true;
    this.root.setAttribute('role', 'alert');
    el('span', 'ic', this.root).appendChild(icon('hazard'));
    this.msg = new TextCell(el('span', 'txt', this.root));
    this.tag = el('span', 'tag', this.root, 'TOXIC EXPOSURE');
    this.tag.hidden = true;
  }

  update(h: HudState['hazard']): void {
    const show = h.active && h.message !== null;
    setHidden(this.root, !show);
    if (!show) return;
    this.msg.set(h.message ?? '');
    if (h.inside !== this.inside) {
      this.inside = h.inside;
      this.root.dataset.inside = h.inside ? '1' : '0';
      this.tag.hidden = !h.inside;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// boss bar
// ---------------------------------------------------------------------------------------------

export class BossView {
  readonly root: HTMLElement;
  private readonly name: TextCell;
  private readonly fill: HTMLElement;
  private readonly ghost: HTMLElement;
  private readonly tag: HTMLElement;
  private readonly cell = new NumCell(0.002);
  private enraged = false;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'ds-boss', parent);
    this.root.hidden = true;
    const top = el('div', 'top', this.root);
    el('span', 'ic', top).appendChild(icon('target'));
    this.name = new TextCell(el('span', 'name', top));
    this.tag = el('span', 'tag', top, 'ENRAGED');
    this.tag.hidden = true;
    const bar = el('div', 'bar', this.root);
    this.ghost = el('i', 'ghost', bar);
    this.fill = el('i', 'fill', bar);
  }

  update(b: HudState['boss']): void {
    setHidden(this.root, !b);
    if (!b) return;
    this.name.set(b.name);
    const f = clamp01(b.fraction);
    if (this.cell.changed(f)) {
      const t = `scaleX(${f.toFixed(4)})`;
      this.fill.style.transform = t;
      this.ghost.style.transform = t;
    }
    if (b.enraged !== this.enraged) {
      this.enraged = b.enraged;
      this.root.dataset.enraged = b.enraged ? '1' : '0';
      this.tag.hidden = !b.enraged;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// threat region meter
// ---------------------------------------------------------------------------------------------

const REGION_LEVEL: Record<Region, number> = { low: 1, medium: 2, high: 3 };

export class RegionView {
  readonly root: HTMLElement;
  private readonly name: TextCell;
  private readonly segs: HTMLElement[] = [];
  private region: Region | '' = '';
  private color = '';

  constructor(parent: HTMLElement) {
    this.root = el('div', 'ds-region ds-panel', parent);
    const segs = el('span', 'segs', this.root);
    for (let i = 0; i < 3; i++) this.segs.push(el('i', '', segs));
    this.name = new TextCell(el('span', 'name', this.root));
  }

  update(region: Region, name: string, color: string): void {
    this.name.set(name);
    if (region !== this.region) {
      this.region = region;
      const lvl = REGION_LEVEL[region];
      for (let i = 0; i < 3; i++) this.segs[i]!.classList.toggle('on', i < lvl);
      this.root.dataset.region = region;
    }
    if (color !== this.color) {
      this.color = color;
      this.root.style.setProperty('--rc', color);
    }
  }
}
