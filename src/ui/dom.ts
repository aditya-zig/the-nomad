/** Tiny DOM helpers: element factories (never innerHTML from data), change-detecting cells, and formatters. */

const SVG_NS = 'http://www.w3.org/2000/svg';

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  parent?: Node | null,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

export function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs?: Record<string, string | number>,
  parent?: Node | null,
): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, tag);
  if (attrs) for (const k of Object.keys(attrs)) e.setAttribute(k, String(attrs[k]));
  if (parent) parent.appendChild(e);
  return e;
}

/** Writes textContent only when the value changed. */
export class TextCell {
  private v: string | null = null;
  constructor(readonly node: Node) {}
  set(v: string): void {
    if (v !== this.v) {
      this.v = v;
      this.node.textContent = v;
    }
  }
}

/** Writes a numeric style value only when it moved by more than `eps`. */
export class NumCell {
  private v = Number.NaN;
  constructor(private readonly eps = 0.001) {}
  /** Returns true when the value changed enough to warrant a DOM write. */
  changed(v: number): boolean {
    if (Number.isNaN(this.v) || Math.abs(v - this.v) > this.eps) {
      this.v = v;
      return true;
    }
    return false;
  }
}

/** Sets a data attribute only when it changed. */
export function setAttr(node: Element, name: string, value: string): void {
  if (node.getAttribute(name) !== value) node.setAttribute(name, value);
}

export function setHidden(node: HTMLElement, hidden: boolean): void {
  if (node.hidden !== hidden) node.hidden = hidden;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function fmtClock(sec: number): string {
  const s = Math.max(0, Math.ceil(sec - 1e-6));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const rr = r < 10 ? `0${r}` : `${r}`;
  if (h > 0) return `${h}:${m < 10 ? '0' : ''}${m}:${rr}`;
  return `${m}:${rr}`;
}

export function fmtMoney(n: number): string {
  return `$${Math.max(0, Math.round(n)).toLocaleString('en-US')}`;
}

export function fmtSignedMoney(n: number): string {
  const v = Math.round(n);
  return `${v < 0 ? '-' : '+'}$${Math.abs(v).toLocaleString('en-US')}`;
}

export function fmtDist(m: number): string {
  if (m < 0 || !Number.isFinite(m)) return '';
  if (m >= 1000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m)} m`;
}

export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

export const TAU = Math.PI * 2;

/** Wrap an angle in degrees to [-180, 180). */
export function wrap180(deg: number): number {
  let d = (deg + 180) % 360;
  if (d < 0) d += 360;
  return d - 180;
}
