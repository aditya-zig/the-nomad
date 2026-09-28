/**
 * Canvas map renderers: the rotating minimap and the full-screen north-up tactical map.
 * Both draw the REAL level (`MapData` footprints/roads/regions) and real dynamic state (`MapDynamic`), using a cached
 * static layer (terrain, roads, buildings) plus a cheap per-frame dynamic overlay (markers, enemies, hazard, player).
 *
 * World -> map: x east, z south. On the north-up tactical map screen y grows with z. Footprint rotation follows THREE
 * `rotation.y`, which is `ctx.rotate(-rot)` on this canvas. The minimap rotates by +yaw so the player faces up.
 */
import { REGIONS } from '../config';
import type { Region } from '../types';
import { TAU, clamp } from './dom';
import type { MapData, MapDynamic, MapFootprint, MapFootprintKind, MapMarker, MapMarkerKind } from './hudTypes';

export const LABEL_FONT =
  "'Bahnschrift','DIN Alternate','DIN Condensed','Arial Narrow','Roboto Condensed','Helvetica Neue',Arial,sans-serif";
export const NUM_FONT = "ui-monospace,'SF Mono','SFMono-Regular',Menlo,Consolas,'Liberation Mono',monospace";

export const MARKER_COLOR: Record<MapMarkerKind, string> = {
  objective: '#e2b04a',
  buy: '#8fd18a',
  upgrade: '#e2b04a',
  crate: '#c9d3bd',
  lz: '#dff6ff',
  start: '#9fb3a2',
  hunt: '#ff5a4d',
  helicopter: '#6ec6d6',
  transmitter: '#6ec6d6',
  gate: '#b7c0a8',
  landmark: '#d9ddcf',
};

export const MARKER_LABEL: Record<MapMarkerKind, string> = {
  objective: 'OBJECTIVE',
  buy: 'SUPPLY CAGE',
  upgrade: 'ARMORY BENCH',
  crate: 'SUPPLY CACHE',
  lz: 'LANDING ZONE',
  start: 'INSERTION',
  hunt: 'HUNT TARGET',
  helicopter: 'EXTRACTION BIRD',
  transmitter: 'RELAY',
  gate: 'GATE',
  landmark: 'LANDMARK',
};

const REGION_COLOR: Record<Region, string> = {
  low: '#7fae9c',
  medium: '#e2b04a',
  high: '#e5523f',
};

interface FootStyle {
  fill: string;
  stroke: string | null;
  lw: number;
}

const FOOT_STYLE: Record<MapFootprintKind, FootStyle> = {
  building: { fill: '#2b332a', stroke: 'rgba(178,192,162,0.7)', lw: 1.3 },
  tank: { fill: '#485148', stroke: 'rgba(170,182,158,0.55)', lw: 1 },
  container: { fill: '#565d45', stroke: 'rgba(16,20,12,0.95)', lw: 0.8 },
  vehicle: { fill: '#65705e', stroke: 'rgba(14,18,13,0.9)', lw: 0.6 },
  prop: { fill: '#3f483b', stroke: null, lw: 0 },
  wall: { fill: '#626d5a', stroke: null, lw: 0 },
  fence: { fill: '', stroke: 'rgba(168,180,154,0.75)', lw: 1 },
};
const FOOT_ORDER: MapFootprintKind[] = ['building', 'tank', 'container', 'vehicle', 'prop', 'wall', 'fence'];

function setLetterSpacing(g: CanvasRenderingContext2D, px: number): void {
  (g as unknown as { letterSpacing: string }).letterSpacing = `${px}px`;
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

// ---------------------------------------------------------------------------------------------
// static layer
// ---------------------------------------------------------------------------------------------

/** Renders the whole level into an offscreen canvas at `pxPerM` device pixels per metre. */
export function buildStaticLayer(data: MapData, pxPerM: number): HTMLCanvasElement {
  const b = data.bounds;
  const W = b.maxX - b.minX;
  const H = b.maxZ - b.minZ;
  const canvas = makeCanvas(W * pxPerM, H * pxPerM);
  const g = canvas.getContext('2d');
  if (!g) return canvas;
  g.scale(pxPerM, pxPerM);
  g.translate(-b.minX, -b.minZ);
  const px = 1 / pxPerM;

  // ground
  g.fillStyle = '#0b110e';
  g.fillRect(b.minX, b.minZ, W, H);

  // threat-region tint: first match wins, so paint opaque colours in reverse order then blend once
  {
    const layer = makeCanvas(canvas.width, canvas.height);
    const lg = layer.getContext('2d');
    if (lg) {
      lg.scale(pxPerM, pxPerM);
      lg.translate(-b.minX, -b.minZ);
      lg.fillStyle = REGION_COLOR.low;
      lg.fillRect(b.minX, b.minZ, W, H);
      for (let i = data.regions.length - 1; i >= 0; i--) {
        const r = data.regions[i]!;
        lg.fillStyle = REGION_COLOR[r.region];
        lg.fillRect(Math.min(r.x0, r.x1), Math.min(r.z0, r.z1), Math.abs(r.x1 - r.x0), Math.abs(r.z1 - r.z0));
      }
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha = 0.13;
      g.drawImage(layer, 0, 0);
      g.restore();
    }
    // dashed region borders
    g.save();
    g.lineWidth = px * 1.2;
    g.setLineDash([px * 6, px * 5]);
    for (const r of data.regions) {
      g.strokeStyle = REGION_COLOR[r.region];
      g.globalAlpha = 0.4;
      g.strokeRect(Math.min(r.x0, r.x1), Math.min(r.z0, r.z1), Math.abs(r.x1 - r.x0), Math.abs(r.z1 - r.z0));
    }
    g.restore();
  }

  // roads
  for (const r of data.roads) {
    const x = Math.min(r.x0, r.x1);
    const z = Math.min(r.z0, r.z1);
    const w = Math.abs(r.x1 - r.x0);
    const d = Math.abs(r.z1 - r.z0);
    g.fillStyle = '#26302a';
    g.fillRect(x, z, w, d);
    g.strokeStyle = 'rgba(96,112,98,0.55)';
    g.lineWidth = px;
    g.strokeRect(x, z, w, d);
    // faint centre line
    g.save();
    g.strokeStyle = 'rgba(210,220,196,0.13)';
    g.setLineDash([px * 7, px * 7]);
    g.beginPath();
    if (w >= d) {
      g.moveTo(x, z + d / 2);
      g.lineTo(x + w, z + d / 2);
    } else {
      g.moveTo(x + w / 2, z);
      g.lineTo(x + w / 2, z + d);
    }
    g.stroke();
    g.restore();
  }

  // footprints by kind
  const buckets = new Map<MapFootprintKind, MapFootprint[]>();
  for (const f of data.footprints) {
    let list = buckets.get(f.kind);
    if (!list) {
      list = [];
      buckets.set(f.kind, list);
    }
    list.push(f);
  }
  for (const kind of FOOT_ORDER) {
    const list = buckets.get(kind);
    if (!list) continue;
    const st = FOOT_STYLE[kind];
    for (const f of list) {
      g.save();
      g.translate(f.x, f.z);
      g.rotate(-f.rot);
      if (kind === 'fence') {
        g.strokeStyle = st.stroke ?? '#889';
        g.lineWidth = px * st.lw;
        g.setLineDash([px * 3, px * 2]);
        g.beginPath();
        if (f.hx >= f.hz) {
          g.moveTo(-f.hx, 0);
          g.lineTo(f.hx, 0);
        } else {
          g.moveTo(0, -f.hz);
          g.lineTo(0, f.hz);
        }
        g.stroke();
      } else {
        // never draw a solid thinner than ~1.4 px so thin walls stay visible
        const hx = Math.max(f.hx, px * 0.7);
        const hz = Math.max(f.hz, px * 0.7);
        g.fillStyle = st.fill;
        g.fillRect(-hx, -hz, hx * 2, hz * 2);
        if (st.stroke) {
          g.strokeStyle = st.stroke;
          g.lineWidth = px * st.lw;
          g.strokeRect(-hx, -hz, hx * 2, hz * 2);
        }
        if (kind === 'container' && hx * pxPerM > 5) {
          // rib hint
          g.strokeStyle = 'rgba(0,0,0,0.28)';
          g.lineWidth = px * 0.6;
          g.beginPath();
          g.moveTo(-hx * 0.5, -hz);
          g.lineTo(-hx * 0.5, hz);
          g.moveTo(hx * 0.5, -hz);
          g.lineTo(hx * 0.5, hz);
          g.stroke();
        }
      }
      g.restore();
    }
  }

  // world boundary
  g.strokeStyle = 'rgba(140,156,130,0.75)';
  g.lineWidth = px * 2;
  g.strokeRect(b.minX + px, b.minZ + px, W - px * 2, H - px * 2);
  return canvas;
}

// ---------------------------------------------------------------------------------------------
// marker icons (screen space, radius `r` px, centred at the current origin)
// ---------------------------------------------------------------------------------------------

export function drawMarkerIcon(
  g: CanvasRenderingContext2D,
  kind: MapMarkerKind,
  x: number,
  y: number,
  r: number,
  color: string,
  dim = false,
): void {
  g.save();
  g.translate(x, y);
  g.globalAlpha = dim ? 0.45 : 1;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.fillStyle = color;
  g.strokeStyle = color;
  g.lineWidth = Math.max(1.3, r * 0.22);
  g.shadowColor = 'rgba(0,0,0,0.85)';
  g.shadowBlur = 3;
  switch (kind) {
    case 'objective': {
      g.beginPath();
      g.moveTo(0, -r);
      g.lineTo(r * 0.82, 0);
      g.lineTo(0, r);
      g.lineTo(-r * 0.82, 0);
      g.closePath();
      g.fill();
      g.shadowBlur = 0;
      g.strokeStyle = 'rgba(20,16,6,0.9)';
      g.lineWidth = 1;
      g.stroke();
      break;
    }
    case 'hunt': {
      g.beginPath();
      g.arc(0, 0, r * 0.68, 0, TAU);
      g.stroke();
      g.beginPath();
      g.arc(0, 0, r * 0.2, 0, TAU);
      g.fill();
      g.beginPath();
      g.moveTo(0, -r);
      g.lineTo(0, -r * 0.45);
      g.moveTo(0, r);
      g.lineTo(0, r * 0.45);
      g.moveTo(-r, 0);
      g.lineTo(-r * 0.45, 0);
      g.moveTo(r, 0);
      g.lineTo(r * 0.45, 0);
      g.stroke();
      break;
    }
    case 'transmitter': {
      g.beginPath();
      g.moveTo(0, r);
      g.lineTo(0, -r * 0.15);
      g.stroke();
      g.beginPath();
      g.arc(0, -r * 0.3, r * 0.14, 0, TAU);
      g.fill();
      g.lineWidth = Math.max(1.1, r * 0.16);
      for (const k of [0.55, 0.95]) {
        g.beginPath();
        g.arc(0, -r * 0.3, r * k, -Math.PI * 0.86, -Math.PI * 0.14);
        g.stroke();
      }
      break;
    }
    case 'buy':
    case 'upgrade': {
      const s = r * 0.92;
      g.fillStyle = 'rgba(8,12,9,0.78)';
      g.fillRect(-s, -s, s * 2, s * 2);
      g.strokeRect(-s, -s, s * 2, s * 2);
      g.shadowBlur = 0;
      g.fillStyle = color;
      if (kind === 'buy') {
        g.font = `700 ${Math.round(r * 1.45)}px ${LABEL_FONT}`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('$', 0, r * 0.06);
      } else {
        g.beginPath();
        g.moveTo(-s * 0.55, s * 0.1);
        g.lineTo(0, -s * 0.42);
        g.lineTo(s * 0.55, s * 0.1);
        g.moveTo(-s * 0.55, s * 0.62);
        g.lineTo(0, s * 0.1);
        g.lineTo(s * 0.55, s * 0.62);
        g.stroke();
      }
      break;
    }
    case 'crate': {
      const s = r * 0.62;
      g.fillStyle = 'rgba(12,16,11,0.8)';
      g.fillRect(-s, -s, s * 2, s * 2);
      g.lineWidth = Math.max(1.2, r * 0.2);
      g.strokeRect(-s, -s, s * 2, s * 2);
      g.shadowBlur = 0;
      g.beginPath();
      g.moveTo(-s, -s);
      g.lineTo(s, s);
      g.moveTo(s, -s);
      g.lineTo(-s, s);
      g.stroke();
      break;
    }
    case 'lz': {
      g.fillStyle = 'rgba(8,14,18,0.7)';
      g.beginPath();
      g.arc(0, 0, r, 0, TAU);
      g.fill();
      g.stroke();
      g.shadowBlur = 0;
      g.fillStyle = color;
      g.font = `700 ${Math.round(r * 1.25)}px ${LABEL_FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('H', 0, r * 0.06);
      break;
    }
    case 'start': {
      g.beginPath();
      g.moveTo(-r * 0.5, r);
      g.lineTo(-r * 0.5, -r);
      g.stroke();
      g.beginPath();
      g.moveTo(-r * 0.5, -r);
      g.lineTo(r * 0.85, -r * 0.45);
      g.lineTo(-r * 0.5, r * 0.1);
      g.closePath();
      g.fill();
      break;
    }
    case 'helicopter': {
      g.beginPath();
      g.arc(0, 0, r * 0.85, 0, TAU);
      g.stroke();
      g.beginPath();
      g.moveTo(-r * 0.75, -r * 0.75);
      g.lineTo(r * 0.75, r * 0.75);
      g.moveTo(r * 0.75, -r * 0.75);
      g.lineTo(-r * 0.75, r * 0.75);
      g.stroke();
      g.beginPath();
      g.arc(0, 0, r * 0.22, 0, TAU);
      g.fill();
      break;
    }
    case 'gate': {
      g.beginPath();
      g.moveTo(-r * 0.8, -r * 0.7);
      g.lineTo(-r * 0.8, r * 0.7);
      g.moveTo(r * 0.8, -r * 0.7);
      g.lineTo(r * 0.8, r * 0.7);
      g.stroke();
      g.setLineDash([2, 2]);
      g.beginPath();
      g.moveTo(-r * 0.8, 0);
      g.lineTo(r * 0.8, 0);
      g.stroke();
      break;
    }
    case 'landmark':
    default: {
      g.beginPath();
      g.moveTo(0, -r);
      g.lineTo(r * 0.7, r * 0.85);
      g.lineTo(-r * 0.7, r * 0.85);
      g.closePath();
      g.stroke();
      g.beginPath();
      g.arc(0, -r * 0.62, r * 0.2, 0, TAU);
      g.fill();
      break;
    }
  }
  g.restore();
}

function markerColor(m: MapMarker): string {
  return m.color ?? MARKER_COLOR[m.kind];
}

interface LabelRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function rectsHit(list: LabelRect[], r: LabelRect): boolean {
  for (const o of list) {
    if (r.x0 < o.x1 && r.x1 > o.x0 && r.y0 < o.y1 && r.y1 > o.y0) return true;
  }
  return false;
}

/** Lower number = gets first pick of label space on the tactical map. */
const MARKER_PRIORITY: Record<MapMarkerKind, number> = {
  objective: 0,
  hunt: 0,
  transmitter: 0,
  helicopter: 0,
  lz: 1,
  buy: 2,
  upgrade: 2,
  start: 3,
  gate: 4,
  landmark: 4,
  crate: 9,
};

interface MarkerPlan {
  m: MapMarker;
  x: number;
  y: number;
  r: number;
  text: string;
  lx: number;
  ly: number;
  align: CanvasTextAlign;
  show: boolean;
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// ---------------------------------------------------------------------------------------------
// minimap
// ---------------------------------------------------------------------------------------------

const MINI_RANGE_M = 50;
/** Kinds that stay visible as edge arrows when outside the minimap radius. */
const EDGE_KINDS = new Set<MapMarkerKind>(['objective', 'hunt', 'transmitter', 'lz', 'helicopter']);

export class Minimap {
  private readonly ctx: CanvasRenderingContext2D | null;
  private size = 0;
  private dpr = 1;
  private data: MapData | null = null;
  private stat: HTMLCanvasElement | null = null;
  private statDpr = 0;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d');
  }

  setData(data: MapData): void {
    this.data = data;
    // build the cached static layer now so the first gameplay frame does not hitch
    const dpr = clamp(window.devicePixelRatio || 1, 1, 3);
    this.stat = buildStaticLayer(data, 5.5 * dpr);
    this.statDpr = dpr;
  }

  /** Re-read the CSS size / device pixel ratio. Call when the element size may have changed. */
  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const css = Math.round(rect.width);
    if (css <= 0) return;
    const dpr = clamp(window.devicePixelRatio || 1, 1, 3);
    if (css === this.size && dpr === this.dpr) return;
    this.size = css;
    this.dpr = dpr;
    this.canvas.width = Math.round(css * dpr);
    this.canvas.height = Math.round(css * dpr);
  }

  draw(dyn: MapDynamic): void {
    const g = this.ctx;
    const data = this.data;
    if (!g || !data) return;
    if (this.size === 0) this.resize();
    if (this.size === 0) return;
    const size = this.size;
    const dpr = this.dpr;
    if (!this.stat || this.statDpr !== dpr) {
      this.stat = buildStaticLayer(data, 5.5 * dpr);
      this.statDpr = dpr;
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, size, size);
    const R = size / 2;
    const c = R;
    const s = (R - 4) / MINI_RANGE_M;
    const p = dyn.player;
    const cosY = Math.cos(p.yaw);
    const sinY = Math.sin(p.yaw);
    const t = now() / 1000;

    g.save();
    g.beginPath();
    g.arc(c, c, R - 1.5, 0, TAU);
    g.clip();
    g.fillStyle = 'rgba(7,11,9,0.9)';
    g.fillRect(0, 0, size, size);

    // rotated world layer
    g.save();
    g.translate(c, c);
    g.rotate(p.yaw);
    g.scale(s, s);
    g.translate(-p.x, -p.z);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    const b = data.bounds;
    g.drawImage(this.stat, b.minX, b.minZ, b.maxX - b.minX, b.maxZ - b.minZ);

    if (dyn.hazard) {
      g.beginPath();
      g.arc(dyn.hazard.x, dyn.hazard.z, dyn.hazard.radius, 0, TAU);
      g.fillStyle = 'rgba(90,255,130,0.16)';
      g.fill();
      g.lineWidth = 2.2 / s;
      g.strokeStyle = 'rgba(130,255,160,0.9)';
      g.stroke();
    }
    for (const m of dyn.markers) {
      if (!m.visible || !m.radius) continue;
      const col = markerColor(m);
      g.beginPath();
      g.arc(m.x, m.z, m.radius, 0, TAU);
      g.globalAlpha = m.dim ? 0.05 : 0.11;
      g.fillStyle = col;
      g.fill();
      g.globalAlpha = m.dim ? 0.35 : 0.85;
      g.strokeStyle = col;
      g.lineWidth = 1.3 / s;
      g.setLineDash([4 / s, 3 / s]);
      g.stroke();
      g.setLineDash([]);
      g.globalAlpha = 1;
    }
    g.restore();

    // view cone
    const grad = g.createRadialGradient(c, c, 0, c, c, R);
    grad.addColorStop(0, 'rgba(230,238,220,0.20)');
    grad.addColorStop(1, 'rgba(230,238,220,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(c, c);
    g.arc(c, c, R, -Math.PI / 2 - 0.62, -Math.PI / 2 + 0.62);
    g.closePath();
    g.fill();

    // hostiles (alerted only)
    g.fillStyle = '#ff4a3a';
    g.shadowColor = 'rgba(255,60,40,0.9)';
    g.shadowBlur = 4;
    for (const e of dyn.enemies) {
      if (!e.alerted) continue;
      const dx = e.x - p.x;
      const dz = e.z - p.z;
      const rx = (dx * cosY - dz * sinY) * s;
      const ry = (dx * sinY + dz * cosY) * s;
      if (rx * rx + ry * ry > (R - 4) * (R - 4)) continue;
      g.beginPath();
      g.arc(c + rx, c + ry, e.type === 'warden' ? 4 : e.type === 'armored' ? 3 : 2.2, 0, TAU);
      g.fill();
    }
    g.shadowBlur = 0;

    // marker icons (unrotated)
    const edge = R - 9;
    for (const m of dyn.markers) {
      if (!m.visible) continue;
      const dx = m.x - p.x;
      const dz = m.z - p.z;
      let rx = (dx * cosY - dz * sinY) * s;
      let ry = (dx * sinY + dz * cosY) * s;
      const dist = Math.hypot(rx, ry);
      const col = markerColor(m);
      if (dist > edge) {
        if (!EDGE_KINDS.has(m.kind) && !m.compass) continue;
        const k = edge / dist;
        rx *= k;
        ry *= k;
        drawMarkerIcon(g, m.kind, c + rx, c + ry, 4.6, col, m.dim);
        continue;
      }
      if (m.pulse && !m.dim) {
        const ph = (t * 1.1) % 1;
        g.strokeStyle = col;
        g.globalAlpha = 0.6 * (1 - ph);
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(c + rx, c + ry, 6 + ph * 10, 0, TAU);
        g.stroke();
        g.globalAlpha = 1;
      }
      drawMarkerIcon(g, m.kind, c + rx, c + ry, m.kind === 'crate' ? 4.2 : 5.6, col, m.dim);
    }
    g.restore();

    // player arrow
    g.save();
    g.translate(c, c);
    g.fillStyle = '#f3d27a';
    g.strokeStyle = 'rgba(10,8,2,0.95)';
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(0, -6.5);
    g.lineTo(4.6, 5.2);
    g.lineTo(0, 2.6);
    g.lineTo(-4.6, 5.2);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();

    // bezel: ring, ticks, north marker
    g.strokeStyle = 'rgba(196,210,184,0.55)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(c, c, R - 1, 0, TAU);
    g.stroke();
    g.strokeStyle = 'rgba(196,210,184,0.35)';
    g.lineWidth = 1;
    for (let a = 0; a < 360; a += 30) {
      const rad = (a * Math.PI) / 180;
      const r0 = R - 1;
      const r1 = R - (a % 90 === 0 ? 8 : 5);
      g.beginPath();
      g.moveTo(c + Math.sin(rad) * r0, c - Math.cos(rad) * r0);
      g.lineTo(c + Math.sin(rad) * r1, c - Math.cos(rad) * r1);
      g.stroke();
    }
    // 'N' rides the bezel toward true north
    const nx = c + Math.sin(p.yaw) * (R - 12);
    const ny = c - Math.cos(p.yaw) * (R - 12);
    g.fillStyle = 'rgba(8,12,9,0.85)';
    g.beginPath();
    g.arc(nx, ny, 7, 0, TAU);
    g.fill();
    g.fillStyle = '#e2b04a';
    g.font = `700 10px ${LABEL_FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('N', nx, ny + 0.5);
  }
}

// ---------------------------------------------------------------------------------------------
// tactical map
// ---------------------------------------------------------------------------------------------

interface TacLayout {
  w: number;
  h: number;
  mapX: number;
  mapY: number;
  mapW: number;
  mapH: number;
  scale: number;
  legendX: number;
  legendW: number;
}

export interface TacticalInfo {
  /** Player's current threat region name for the readout, e.g. "MEDIUM THREAT". */
  regionName?: string;
}

const LEGEND_KIND_ORDER: MapMarkerKind[] = [
  'objective',
  'hunt',
  'transmitter',
  'lz',
  'helicopter',
  'buy',
  'upgrade',
  'crate',
  'start',
  'gate',
  'landmark',
];

export class TacticalMap {
  private readonly ctx: CanvasRenderingContext2D | null;
  private data: MapData | null = null;
  private layout: TacLayout | null = null;
  private stat: HTMLCanvasElement | null = null;
  private statKey = '';
  private dpr = 1;
  private readonly occ: LabelRect[] = [];

  constructor(readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d');
  }

  setData(data: MapData): void {
    this.data = data;
    this.stat = null;
    this.statKey = '';
    this.layout = null;
  }

  /** Recompute layout from the CSS size of the canvas (call when opened and on resize). */
  resize(): void {
    const data = this.data;
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);
    if (!data || w < 40 || h < 40) return;
    const dpr = clamp(window.devicePixelRatio || 1, 1, 2.5);
    this.dpr = dpr;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    const b = data.bounds;
    const bw = b.maxX - b.minX;
    const bh = b.maxZ - b.minZ;
    const padTop = Math.max(50, h * 0.08);
    const padBottom = Math.max(40, h * 0.06);
    const padSide = Math.max(24, w * 0.02);
    const legendW = clamp(w * 0.16, 150, 250);
    const areaW = w - padSide * 2 - legendW - 16;
    const areaH = h - padTop - padBottom;
    const scale = Math.max(1, Math.min(areaW / bw, areaH / bh));
    const mapW = bw * scale;
    const mapH = bh * scale;
    const mapX = padSide + (areaW - mapW) / 2;
    const mapY = padTop + (areaH - mapH) / 2;
    this.layout = { w, h, mapX, mapY, mapW, mapH, scale, legendX: mapX + mapW + 18, legendW };
    const key = `${scale.toFixed(3)}@${dpr}`;
    if (key !== this.statKey || !this.stat) {
      this.stat = buildStaticLayer(data, scale * dpr);
      this.statKey = key;
    }
  }

  draw(dyn: MapDynamic, info: TacticalInfo = {}): void {
    const g = this.ctx;
    const data = this.data;
    if (!g || !data) return;
    if (!this.layout) this.resize();
    const L = this.layout;
    if (!L || !this.stat) return;
    const dpr = this.dpr;
    const b = data.bounds;
    const t = now() / 1000;
    const S = L.scale;
    const wx = (x: number): number => L.mapX + (x - b.minX) * S;
    const wz = (z: number): number => L.mapY + (z - b.minZ) * S;

    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, L.w, L.h);

    // ---- title bar ----
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.fillStyle = '#e2b04a';
    g.font = `700 ${Math.round(clamp(L.h * 0.024, 14, 22))}px ${LABEL_FONT}`;
    setLetterSpacing(g, 4);
    const titleY = Math.max(22, L.mapY * 0.5);
    g.fillText('TACTICAL MAP', L.mapX, titleY);
    const tw = g.measureText('TACTICAL MAP').width;
    g.fillStyle = 'rgba(196,210,184,0.55)';
    g.font = `600 ${Math.round(clamp(L.h * 0.016, 10, 14))}px ${LABEL_FONT}`;
    setLetterSpacing(g, 3);
    if (L.w >= 1250) g.fillText('SECTOR 7 PERIMETER', L.mapX + tw + 22, titleY + 1);
    setLetterSpacing(g, 0);
    g.textAlign = 'right';
    g.fillStyle = 'rgba(226,232,216,0.85)';
    g.font = `500 ${Math.round(clamp(L.h * 0.017, 11, 15))}px ${NUM_FONT}`;
    const heading = ((((-dyn.player.yaw * 180) / Math.PI) % 360) + 360) % 360;
    g.fillText(
      `X ${Math.round(dyn.player.x)}   Z ${Math.round(dyn.player.z)}   HDG ${String(Math.round(heading) % 360).padStart(3, '0')}°`,
      L.mapX + L.mapW,
      titleY + 1,
    );

    // ---- map base ----
    g.save();
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(this.stat, L.mapX, L.mapY, L.mapW, L.mapH);
    g.restore();

    // clip everything below to the map rect
    g.save();
    g.beginPath();
    g.rect(L.mapX, L.mapY, L.mapW, L.mapH);
    g.clip();

    // grid every 10 m (major every 50 m)
    g.lineWidth = 1;
    const gx0 = Math.ceil(b.minX / 10) * 10;
    for (let x = gx0; x <= b.maxX; x += 10) {
      const major = x % 50 === 0;
      g.strokeStyle = major ? 'rgba(196,210,184,0.13)' : 'rgba(196,210,184,0.045)';
      const sx = Math.round(wx(x)) + 0.5;
      g.beginPath();
      g.moveTo(sx, L.mapY);
      g.lineTo(sx, L.mapY + L.mapH);
      g.stroke();
    }
    const gz0 = Math.ceil(b.minZ / 10) * 10;
    for (let z = gz0; z <= b.maxZ; z += 10) {
      const major = z % 50 === 0;
      g.strokeStyle = major ? 'rgba(196,210,184,0.13)' : 'rgba(196,210,184,0.045)';
      const sy = Math.round(wz(z)) + 0.5;
      g.beginPath();
      g.moveTo(L.mapX, sy);
      g.lineTo(L.mapX + L.mapW, sy);
      g.stroke();
    }

    // ---- label planning: marker labels get first pick of space, then place names, then road names ----
    const occ = this.occ;
    occ.length = 0;
    const box: LabelRect = { x0: L.mapX + 2, y0: L.mapY + 2, x1: L.mapX + L.mapW - 2, y1: L.mapY + L.mapH - 2 };
    const fits = (r: LabelRect): boolean => r.x0 >= box.x0 && r.x1 <= box.x1 && r.y0 >= box.y0 && r.y1 <= box.y1 && !rectsHit(occ, r);
    const plans: MarkerPlan[] = [];
    for (const m of dyn.markers) {
      if (!m.visible) continue;
      const rr = m.kind === 'crate' ? 6 : 9;
      const pl: MarkerPlan = { m, x: wx(m.x), y: wz(m.z), r: rr, text: '', lx: 0, ly: 0, align: 'left', show: false };
      plans.push(pl);
      occ.push({ x0: pl.x - rr - 3, y0: pl.y - rr - 3, x1: pl.x + rr + 3, y1: pl.y + rr + 3 });
    }
    plans.sort((a, c) => MARKER_PRIORITY[a.m.kind] - MARKER_PRIORITY[c.m.kind]);
    const mfs = Math.round(clamp(L.h * 0.0165, 10, 14));
    g.font = `700 ${mfs}px ${LABEL_FONT}`;
    setLetterSpacing(g, 1.5);
    for (const pl of plans) {
      if (pl.m.kind === 'crate') continue;
      pl.text = (pl.m.label ?? MARKER_LABEL[pl.m.kind]).toUpperCase();
      const tw2 = g.measureText(pl.text).width;
      const th = mfs * 1.2;
      const cands: [number, number, CanvasTextAlign][] = [
        [pl.x + pl.r + 6, pl.y, 'left'],
        [pl.x - pl.r - 6, pl.y, 'right'],
        [pl.x, pl.y + pl.r + 3 + th / 2, 'center'],
        [pl.x, pl.y - pl.r - 3 - th / 2, 'center'],
      ];
      for (const [tx, ty, al] of cands) {
        const x0 = al === 'left' ? tx : al === 'right' ? tx - tw2 : tx - tw2 / 2;
        const rect: LabelRect = { x0: x0 - 3, y0: ty - th / 2, x1: x0 + tw2 + 3, y1: ty + th / 2 };
        if (fits(rect)) {
          pl.lx = tx;
          pl.ly = ty;
          pl.align = al;
          pl.show = true;
          occ.push(rect);
          break;
        }
      }
    }

    const places: { text: string; x: number; y: number; px: number }[] = [];
    for (const lb of data.labels) {
      const px = Math.round(clamp(S * 1.45, 11, 20) * (lb.size ?? 1));
      g.font = `700 ${px}px ${LABEL_FONT}`;
      setLetterSpacing(g, 3);
      const text = lb.text.toUpperCase();
      const tw2 = g.measureText(text).width;
      const th = px * 1.2;
      const cx = wx(lb.x);
      const cy = wz(lb.z);
      const offs: [number, number][] = [
        [0, 0],
        [0, -th * 1.05],
        [0, th * 1.05],
        [0, -th * 2.1],
        [0, th * 2.1],
        [-tw2 * 0.4, -th * 1.05],
        [tw2 * 0.4, th * 1.05],
      ];
      for (const [ox, oy] of offs) {
        const rect: LabelRect = { x0: cx + ox - tw2 / 2 - 3, y0: cy + oy - th / 2, x1: cx + ox + tw2 / 2 + 3, y1: cy + oy + th / 2 };
        if (fits(rect)) {
          places.push({ text, x: cx + ox, y: cy + oy, px });
          occ.push(rect);
          break;
        }
      }
    }

    const roadsOut: { text: string; x: number; y: number; vertical: boolean }[] = [];
    const rfs = Math.round(clamp(S * 1.15, 9, 13));
    g.font = `600 ${rfs}px ${LABEL_FONT}`;
    setLetterSpacing(g, 2.5);
    for (const r of data.roads) {
      if (!r.name) continue;
      const text = r.name.toUpperCase();
      const tw2 = g.measureText(text).width;
      const th = rfs * 1.25;
      const horizontal = Math.abs(r.x1 - r.x0) >= Math.abs(r.z1 - r.z0);
      for (const f of [0.2, 0.8, 0.5]) {
        const cx = wx(horizontal ? r.x0 + (r.x1 - r.x0) * f : (r.x0 + r.x1) / 2);
        const cz = wz(horizontal ? (r.z0 + r.z1) / 2 : r.z0 + (r.z1 - r.z0) * f);
        const rect: LabelRect = horizontal
          ? { x0: cx - tw2 / 2 - 4, y0: cz - th / 2, x1: cx + tw2 / 2 + 4, y1: cz + th / 2 }
          : { x0: cx - th / 2, y0: cz - tw2 / 2 - 4, x1: cx + th / 2, y1: cz + tw2 / 2 + 4 };
        if (fits(rect)) {
          roadsOut.push({ text, x: cx, y: cz, vertical: !horizontal });
          occ.push(rect);
          break;
        }
      }
    }

    // road names (drawn first, dimmest)
    g.fillStyle = 'rgba(206,216,192,0.45)';
    g.font = `600 ${rfs}px ${LABEL_FONT}`;
    g.textAlign = 'center';
    setLetterSpacing(g, 2.5);
    for (const r of roadsOut) {
      g.save();
      g.translate(r.x, r.y);
      if (r.vertical) g.rotate(-Math.PI / 2);
      g.fillText(r.text, 0, 0);
      g.restore();
    }
    // place names
    g.textAlign = 'center';
    setLetterSpacing(g, 3);
    for (const pl of places) {
      g.font = `700 ${pl.px}px ${LABEL_FONT}`;
      g.lineWidth = 3.5;
      g.strokeStyle = 'rgba(6,9,7,0.85)';
      g.strokeText(pl.text, pl.x, pl.y);
      g.fillStyle = 'rgba(232,236,222,0.8)';
      g.fillText(pl.text, pl.x, pl.y);
    }
    setLetterSpacing(g, 0);

    // hazard
    if (dyn.hazard) {
      const hx = wx(dyn.hazard.x);
      const hz = wz(dyn.hazard.z);
      const hr = dyn.hazard.radius * S;
      g.beginPath();
      g.arc(hx, hz, hr, 0, TAU);
      g.fillStyle = 'rgba(90,255,130,0.14)';
      g.fill();
      g.lineWidth = 2.5;
      g.strokeStyle = 'rgba(140,255,168,0.9)';
      g.stroke();
      g.lineWidth = 1;
      g.setLineDash([7, 7]);
      g.lineDashOffset = -t * 12;
      g.strokeStyle = 'rgba(140,255,168,0.5)';
      g.beginPath();
      g.arc(hx, hz, Math.max(2, hr - 8), 0, TAU);
      g.stroke();
      g.setLineDash([]);
    }

    // area markers
    for (const m of dyn.markers) {
      if (!m.visible || !m.radius) continue;
      const col = markerColor(m);
      const mx = wx(m.x);
      const mz = wz(m.z);
      const mr = m.radius * S;
      g.beginPath();
      g.arc(mx, mz, mr, 0, TAU);
      g.globalAlpha = m.dim ? 0.05 : 0.11;
      g.fillStyle = col;
      g.fill();
      g.globalAlpha = m.dim ? 0.4 : 0.9;
      g.strokeStyle = col;
      g.lineWidth = 1.6;
      g.setLineDash([9, 6]);
      g.lineDashOffset = -t * 8;
      g.stroke();
      g.setLineDash([]);
      g.globalAlpha = 1;
    }

    // hostiles
    for (const e of dyn.enemies) {
      const ex = wx(e.x);
      const ez = wz(e.z);
      const big = e.type === 'warden' ? 5.5 : e.type === 'armored' ? 3.8 : 3;
      g.beginPath();
      g.arc(ex, ez, big, 0, TAU);
      if (e.alerted) {
        g.fillStyle = '#ff4a3a';
        g.shadowColor = 'rgba(255,60,40,0.9)';
        g.shadowBlur = 5;
      } else {
        g.fillStyle = 'rgba(226,176,74,0.55)';
      }
      g.fill();
      g.shadowBlur = 0;
    }

    // markers (highest priority on top) with their planned labels
    for (let i = plans.length - 1; i >= 0; i--) {
      const pl = plans[i]!;
      const m = pl.m;
      const col = markerColor(m);
      if (m.pulse && !m.dim) {
        const ph = (t * 1.1) % 1;
        g.strokeStyle = col;
        g.globalAlpha = 0.65 * (1 - ph);
        g.lineWidth = 2;
        g.beginPath();
        g.arc(pl.x, pl.y, pl.r + 3 + ph * 16, 0, TAU);
        g.stroke();
        g.globalAlpha = 1;
      }
      drawMarkerIcon(g, m.kind, pl.x, pl.y, pl.r, col, m.dim);
      if (!pl.show) continue;
      g.font = `700 ${mfs}px ${LABEL_FONT}`;
      setLetterSpacing(g, 1.5);
      g.textAlign = pl.align;
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(6,9,7,0.9)';
      g.strokeText(pl.text, pl.lx, pl.ly + 1);
      g.fillStyle = m.dim ? 'rgba(200,210,190,0.5)' : col;
      g.fillText(pl.text, pl.lx, pl.ly + 1);
      setLetterSpacing(g, 0);
    }

    // player
    {
      const px = wx(dyn.player.x);
      const pz = wz(dyn.player.z);
      g.save();
      g.translate(px, pz);
      g.rotate(-dyn.player.yaw);
      const grad = g.createRadialGradient(0, 0, 0, 0, 0, 70);
      grad.addColorStop(0, 'rgba(240,244,230,0.28)');
      grad.addColorStop(1, 'rgba(240,244,230,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(0, 0);
      g.arc(0, 0, 70, -Math.PI / 2 - 0.7, -Math.PI / 2 + 0.7);
      g.closePath();
      g.fill();
      g.fillStyle = '#f3d27a';
      g.strokeStyle = 'rgba(10,8,2,0.95)';
      g.lineWidth = 1.4;
      g.beginPath();
      g.moveTo(0, -10);
      g.lineTo(7, 8);
      g.lineTo(0, 4);
      g.lineTo(-7, 8);
      g.closePath();
      g.fill();
      g.stroke();
      g.restore();
      // sonar ping ring
      const ph = (t * 0.7) % 1;
      g.strokeStyle = '#f3d27a';
      g.globalAlpha = 0.5 * (1 - ph);
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(px, pz, 8 + ph * 22, 0, TAU);
      g.stroke();
      g.globalAlpha = 1;
    }
    g.restore(); // end map clip

    // ---- frame + coordinate ticks ----
    g.strokeStyle = 'rgba(196,210,184,0.4)';
    g.lineWidth = 1;
    g.strokeRect(L.mapX + 0.5, L.mapY + 0.5, L.mapW - 1, L.mapH - 1);
    g.strokeStyle = '#e2b04a';
    g.lineWidth = 2;
    const bl = 16;
    const corners: [number, number, number, number][] = [
      [L.mapX, L.mapY, 1, 1],
      [L.mapX + L.mapW, L.mapY + L.mapH, -1, -1],
    ];
    for (const [cx, cy, sx, sy] of corners) {
      g.beginPath();
      g.moveTo(cx + sx * bl, cy);
      g.lineTo(cx, cy);
      g.lineTo(cx, cy + sy * bl);
      g.stroke();
    }
    g.fillStyle = 'rgba(196,210,184,0.5)';
    g.font = `500 10px ${NUM_FONT}`;
    g.textAlign = 'center';
    for (let x = Math.ceil(b.minX / 20) * 20; x <= b.maxX; x += 20) {
      g.fillText(String(x), wx(x), L.mapY - 8);
    }
    g.textAlign = 'right';
    for (let z = Math.ceil(b.minZ / 20) * 20; z <= b.maxZ; z += 20) {
      g.fillText(String(z), L.mapX - 7, wz(z) + 1);
    }

    // scale bar
    {
      const bx = L.mapX + 14;
      const by = L.mapY + L.mapH - 16;
      g.strokeStyle = 'rgba(232,236,222,0.85)';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(bx, by - 4);
      g.lineTo(bx, by);
      g.lineTo(bx + 20 * S, by);
      g.lineTo(bx + 20 * S, by - 4);
      g.stroke();
      g.fillStyle = 'rgba(232,236,222,0.85)';
      g.textAlign = 'left';
      g.font = `600 11px ${NUM_FONT}`;
      g.strokeStyle = 'rgba(6,9,7,0.9)';
      g.lineWidth = 3;
      g.strokeText('20 M', bx + 20 * S + 8, by - 1);
      g.fillText('20 M', bx + 20 * S + 8, by - 1);
    }

    this.drawLegend(g, L, dyn, info);

    // footer hint
    g.textAlign = 'left';
    g.fillStyle = 'rgba(196,210,184,0.55)';
    g.font = `600 ${Math.round(clamp(L.h * 0.0155, 10, 13))}px ${LABEL_FONT}`;
    setLetterSpacing(g, 2);
    g.fillText('PRESS  M  TO CLOSE  //  NORTH UP', L.mapX, L.mapY + L.mapH + Math.max(20, (L.h - L.mapY - L.mapH) * 0.55));
    setLetterSpacing(g, 0);
  }

  private drawLegend(g: CanvasRenderingContext2D, L: TacLayout, dyn: MapDynamic, info: TacticalInfo): void {
    const x = L.legendX;
    let y = L.mapY + 4;
    const rowH = clamp(L.h * 0.029, 20, 28);
    const fs = Math.round(clamp(L.h * 0.0165, 10, 14));
    g.textAlign = 'left';
    g.textBaseline = 'middle';

    const head = (text: string): void => {
      g.fillStyle = '#e2b04a';
      g.font = `700 ${fs}px ${LABEL_FONT}`;
      setLetterSpacing(g, 3);
      g.fillText(text, x, y + rowH * 0.4);
      g.strokeStyle = 'rgba(226,176,74,0.5)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x, y + rowH * 0.9);
      g.lineTo(x + L.legendW - 6, y + rowH * 0.9);
      g.stroke();
      setLetterSpacing(g, 0);
      y += rowH * 1.25;
    };
    const row = (drawIcon: (cx: number, cy: number) => void, text: string, color = 'rgba(226,232,216,0.85)'): void => {
      drawIcon(x + 10, y + rowH * 0.45);
      g.fillStyle = color;
      g.font = `600 ${fs}px ${LABEL_FONT}`;
      setLetterSpacing(g, 1.5);
      g.fillText(text, x + 28, y + rowH * 0.48);
      setLetterSpacing(g, 0);
      y += rowH;
    };

    head('LEGEND');
    row((cx, cy) => {
      g.save();
      g.translate(cx, cy);
      g.fillStyle = '#f3d27a';
      g.beginPath();
      g.moveTo(0, -7);
      g.lineTo(5.5, 6);
      g.lineTo(0, 3);
      g.lineTo(-5.5, 6);
      g.closePath();
      g.fill();
      g.restore();
    }, 'YOU');
    const present = new Set<MapMarkerKind>();
    for (const m of dyn.markers) if (m.visible) present.add(m.kind);
    for (const kind of LEGEND_KIND_ORDER) {
      if (!present.has(kind)) continue;
      row((cx, cy) => drawMarkerIcon(g, kind, cx, cy, 6.5, MARKER_COLOR[kind]), MARKER_LABEL[kind]);
    }
    row((cx, cy) => {
      g.fillStyle = '#ff4a3a';
      g.beginPath();
      g.arc(cx, cy, 3.4, 0, TAU);
      g.fill();
    }, 'HOSTILE (ALERTED)');
    if (dyn.hazard) {
      row((cx, cy) => {
        g.fillStyle = 'rgba(90,255,130,0.3)';
        g.strokeStyle = 'rgba(140,255,168,0.95)';
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(cx, cy, 6, 0, TAU);
        g.fill();
        g.stroke();
      }, 'CONTAMINATION', '#9dffb5');
    }

    y += rowH * 0.4;
    head('THREAT LEVEL');
    for (const key of ['low', 'medium', 'high'] as const) {
      const def = REGIONS[key];
      row(
        (cx, cy) => {
          g.fillStyle = REGION_COLOR[key];
          g.globalAlpha = 0.85;
          g.fillRect(cx - 7, cy - 5, 14, 10);
          g.globalAlpha = 1;
        },
        def.name,
        info.regionName === def.name ? '#ffffff' : 'rgba(226,232,216,0.72)',
      );
    }
    if (info.regionName) {
      y += rowH * 0.3;
      g.fillStyle = 'rgba(196,210,184,0.6)';
      g.font = `600 ${fs - 1}px ${LABEL_FONT}`;
      setLetterSpacing(g, 1.5);
      g.fillText(`YOU ARE IN: ${info.regionName}`, x, y + rowH * 0.4);
      setLetterSpacing(g, 0);
    }
  }
}
