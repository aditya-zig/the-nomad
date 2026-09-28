/**
 * Transient HUD feedback: crosshair, hit markers, damage-direction arcs, screen effects, banners, the event feed,
 * radio subtitles and floating cash deltas. Discrete effects use the Web Animations API (no per-frame work).
 */
import type { HudState } from './hudTypes';
import { NumCell, clamp, el, fmtSignedMoney, svgEl } from './dom';
import { reducedMotion } from './prefs';

// ---------------------------------------------------------------------------------------------
// crosshair
// ---------------------------------------------------------------------------------------------

export class Crosshair {
  readonly root: HTMLElement;
  private gap = -1;
  private ads = false;
  private off = false;
  private vh = 1080;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'ds-xh', parent);
    for (const c of ['t', 'b', 'l', 'r', 'dot']) el('i', c, this.root);
  }

  setViewportHeight(h: number): void {
    this.vh = Math.max(240, h);
  }

  update(c: HudState['crosshair']): void {
    const px = clamp(3.5 + c.spread * (this.vh / 1080) * 9, 3.5, 90);
    if (Math.abs(px - this.gap) > 0.35) {
      this.gap = px;
      this.root.style.setProperty('--gap', `${px.toFixed(1)}px`);
    }
    if (c.ads !== this.ads) {
      this.ads = c.ads;
      this.root.classList.toggle('ads', c.ads);
    }
    if (c.hidden !== this.off) {
      this.off = c.hidden;
      this.root.classList.toggle('off', c.hidden);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// hit markers
// ---------------------------------------------------------------------------------------------

export class HitMarker {
  private readonly svg: SVGSVGElement;
  private anim: Animation | null = null;

  constructor(parent: HTMLElement) {
    this.svg = svgEl('svg', { viewBox: '-24 -24 48 48', class: 'ds-hitm', 'aria-hidden': 'true' }, parent);
    for (const [sx, sy] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const) {
      svgEl('line', { x1: sx * 5.5, y1: sy * 5.5, x2: sx * 12.5, y2: sy * 12.5 }, this.svg);
    }
    svgEl('circle', { class: 'ring', r: 17.5, cx: 0, cy: 0 }, this.svg);
  }

  trigger(head: boolean, kill: boolean): void {
    const kind = kill ? (head ? 'killhead' : 'kill') : head ? 'head' : 'body';
    this.svg.dataset.kind = kind;
    this.anim?.cancel();
    const dur = kill ? 440 : head ? 320 : 200;
    const from = kill ? 0.75 : 0.8;
    const to = kill ? 1.28 : head ? 1.12 : 1.0;
    if (reducedMotion()) {
      this.anim = this.svg.animate([{ opacity: 1 }, { opacity: 1, offset: 0.6 }, { opacity: 0 }], { duration: dur * 0.8 });
      return;
    }
    this.anim = this.svg.animate(
      [
        { opacity: 1, transform: `scale(${from})` },
        { opacity: 1, transform: `scale(${to})`, offset: 0.22 },
        { opacity: 1, transform: `scale(${to})`, offset: 0.6 },
        { opacity: 0, transform: `scale(${to * 1.08})` },
      ],
      { duration: dur, easing: 'ease-out' },
    );
  }

  reset(): void {
    this.anim?.cancel();
    this.anim = null;
  }
}

// ---------------------------------------------------------------------------------------------
// damage direction arcs
// ---------------------------------------------------------------------------------------------

interface ArcSlot {
  node: HTMLElement;
  anim: Animation | null;
}

export class DamageArcs {
  private readonly slots: ArcSlot[] = [];
  private next = 0;

  constructor(parent: HTMLElement) {
    for (let i = 0; i < 6; i++) {
      const node = el('div', 'ds-dmg', parent);
      const svg = svgEl('svg', { viewBox: '0 0 200 200', 'aria-hidden': 'true' }, node);
      svgEl('path', { class: 'glow', d: 'M58.5 19.5 A88 88 0 0 1 141.5 19.5' }, svg);
      svgEl('path', { class: 'core', d: 'M58.5 19.5 A88 88 0 0 1 141.5 19.5' }, svg);
      this.slots.push({ node, anim: null });
    }
  }

  /** `angle`: 0 = ahead, +PI/2 = right, PI = behind (radians). */
  trigger(angle: number, amount: number): void {
    const slot = this.slots[this.next]!;
    this.next = (this.next + 1) % this.slots.length;
    slot.node.style.transform = `rotate(${((angle * 180) / Math.PI).toFixed(1)}deg)`;
    slot.node.dataset.heavy = amount >= 25 ? '1' : '0';
    slot.anim?.cancel();
    slot.anim = slot.node.animate([{ opacity: 0.95 }, { opacity: 0.9, offset: 0.35 }, { opacity: 0 }], {
      duration: reducedMotion() ? 900 : 1250,
      easing: 'ease-out',
    });
  }

  reset(): void {
    for (const s of this.slots) {
      s.anim?.cancel();
      s.anim = null;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// full-screen effects
// ---------------------------------------------------------------------------------------------

export class ScreenFx {
  private readonly lowhp: HTMLElement;
  private readonly toxic: HTMLElement;
  private readonly hurt: HTMLElement;
  private readonly flashEl: HTMLElement;
  private readonly pulse: HTMLElement;
  private readonly vig = new NumCell(0.01);
  private readonly tox = new NumCell(0.01);
  private anims: (Animation | null)[] = [null, null, null];

  constructor(parent: HTMLElement) {
    const low = el('div', 'ds-fx ds-fx-lowhp', parent);
    el('div', 'inner', low);
    this.lowhp = low;
    this.toxic = el('div', 'ds-fx ds-fx-toxic', parent);
    this.pulse = el('div', 'ds-fx ds-fx-toxpulse', parent);
    this.hurt = el('div', 'ds-fx ds-fx-hurt', parent);
    this.flashEl = el('div', 'ds-fx ds-fx-flash', parent);
  }

  setVignette(v: number): void {
    const c = clamp(v, 0, 1);
    if (this.vig.changed(c)) {
      this.lowhp.style.opacity = c.toFixed(2);
      this.lowhp.classList.toggle('crit', c > 0.6);
    }
  }

  setToxic(v: number): void {
    const c = clamp(v, 0, 1);
    if (this.tox.changed(c)) this.toxic.style.opacity = c.toFixed(2);
  }

  hurtFlash(strength: number): void {
    this.anims[0]?.cancel();
    const s = clamp(strength, 0.15, 1);
    this.anims[0] = this.hurt.animate([{ opacity: 0.75 * s }, { opacity: 0 }], { duration: reducedMotion() ? 200 : 420, easing: 'ease-out' });
  }

  toxicPulse(): void {
    this.anims[1]?.cancel();
    this.anims[1] = this.pulse.animate([{ opacity: 0.55 }, { opacity: 0 }], { duration: reducedMotion() ? 300 : 700, easing: 'ease-out' });
  }

  flash(color: string, strength: number): void {
    this.anims[2]?.cancel();
    this.flashEl.style.background = color;
    const s = clamp(strength, 0, 1) * (reducedMotion() ? 0.35 : 0.8);
    this.anims[2] = this.flashEl.animate([{ opacity: s }, { opacity: 0 }], { duration: reducedMotion() ? 260 : 520, easing: 'ease-out' });
  }

  reset(): void {
    for (let i = 0; i < this.anims.length; i++) {
      this.anims[i]?.cancel();
      this.anims[i] = null;
    }
    this.lowhp.style.opacity = '0';
    this.toxic.style.opacity = '0';
  }
}

// ---------------------------------------------------------------------------------------------
// banners
// ---------------------------------------------------------------------------------------------

type Tone = 'info' | 'good' | 'warn' | 'danger';

interface BannerItem {
  title: string;
  subtitle: string;
  tone: Tone;
  duration: number;
}

export class BannerView {
  private readonly root: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly subEl: HTMLElement;
  private readonly queue: BannerItem[] = [];
  private cur: { t: number; dur: number } | null = null;
  private anim: Animation | null = null;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'ds-banner', parent);
    this.root.hidden = true;
    this.root.setAttribute('role', 'status');
    el('div', 'rule', this.root);
    this.titleEl = el('div', 'title', this.root);
    this.subEl = el('div', 'sub', this.root);
    el('div', 'rule', this.root);
  }

  push(title: string, subtitle: string | undefined, tone: Tone, duration = 3.6): void {
    if (this.queue.length >= 4) this.queue.shift();
    this.queue.push({ title, subtitle: subtitle ?? '', tone, duration });
    // hurry the visible banner along when others are waiting
    if (this.cur && this.cur.t < this.cur.dur - 1.1) this.cur.dur = this.cur.t + 1.1;
  }

  update(dt: number): void {
    if (this.cur) {
      this.cur.t += dt;
      if (this.cur.t >= this.cur.dur) {
        this.cur = null;
        this.hide();
      }
      return;
    }
    const next = this.queue.shift();
    if (next) this.show(next);
  }

  private show(item: BannerItem): void {
    this.cur = { t: 0, dur: item.duration };
    this.root.dataset.tone = item.tone;
    this.titleEl.textContent = item.title;
    this.subEl.textContent = item.subtitle;
    this.subEl.hidden = item.subtitle === '';
    this.root.hidden = false;
    this.anim?.cancel();
    this.anim = reducedMotion()
      ? this.root.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160 })
      : this.root.animate(
          [
            { opacity: 0, transform: 'translateY(-12px) scale(1.06)' },
            { opacity: 1, transform: 'none' },
          ],
          { duration: 300, easing: 'cubic-bezier(.2,.8,.2,1)' },
        );
  }

  private hide(): void {
    this.anim?.cancel();
    const a = this.root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: reducedMotion() ? 120 : 260, easing: 'ease-in' });
    this.anim = a;
    a.onfinish = () => {
      if (this.anim === a && !this.cur) this.root.hidden = true;
    };
  }

  reset(): void {
    this.queue.length = 0;
    this.cur = null;
    this.anim?.cancel();
    this.anim = null;
    this.root.hidden = true;
  }
}

// ---------------------------------------------------------------------------------------------
// feed
// ---------------------------------------------------------------------------------------------

interface FeedLine {
  node: HTMLElement;
  age: number;
  fading: boolean;
}

export class FeedView {
  readonly root: HTMLElement;
  private readonly lines: FeedLine[] = [];
  private static readonly LIFE = 5.2;
  private static readonly FADE = 0.7;
  private static readonly MAX = 6;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'ds-feed', parent);
    this.root.setAttribute('role', 'log');
  }

  push(text: string, tone: 'normal' | 'good' | 'warn' | 'danger' = 'normal'): void {
    const node = el('div', `ds-feed-line ${tone}`, this.root, text);
    this.lines.push({ node, age: 0, fading: false });
    if (!reducedMotion()) {
      node.animate([{ opacity: 0, transform: 'translateX(-14px)' }, { opacity: 1, transform: 'none' }], { duration: 200, easing: 'ease-out' });
    }
    while (this.lines.length > FeedView.MAX) {
      const old = this.lines.shift();
      old?.node.remove();
    }
  }

  update(dt: number): void {
    for (let i = this.lines.length - 1; i >= 0; i--) {
      const l = this.lines[i]!;
      l.age += dt;
      if (!l.fading && l.age > FeedView.LIFE) {
        l.fading = true;
        l.node.classList.add('out');
      }
      if (l.age > FeedView.LIFE + FeedView.FADE) {
        l.node.remove();
        this.lines.splice(i, 1);
      }
    }
  }

  reset(): void {
    for (const l of this.lines) l.node.remove();
    this.lines.length = 0;
  }
}

// ---------------------------------------------------------------------------------------------
// radio subtitles
// ---------------------------------------------------------------------------------------------

interface RadioItem {
  speaker: string;
  text: string;
  duration: number;
}

export class RadioView {
  private readonly root: HTMLElement;
  private readonly tag: HTMLElement;
  private readonly textEl: HTMLElement;
  private readonly queue: RadioItem[] = [];
  private cur: { t: number; dur: number } | null = null;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'ds-radio', parent);
    this.root.hidden = true;
    this.root.setAttribute('role', 'status');
    const bars = el('div', 'bars', this.root);
    for (let i = 0; i < 4; i++) el('i', '', bars);
    this.tag = el('div', 'tag', this.root);
    this.textEl = el('div', 'text', this.root);
  }

  push(speaker: string, text: string, duration?: number): void {
    if (this.queue.length >= 3) this.queue.shift();
    this.queue.push({ speaker, text, duration: duration ?? clamp(2.6 + text.length * 0.05, 3, 8) });
  }

  update(dt: number): void {
    if (this.cur) {
      this.cur.t += dt;
      if (this.cur.t >= this.cur.dur) {
        this.cur = null;
        this.root.hidden = true;
      }
      return;
    }
    const next = this.queue.shift();
    if (!next) return;
    this.cur = { t: 0, dur: next.duration };
    this.tag.textContent = next.speaker;
    this.textEl.textContent = next.text;
    this.root.hidden = false;
    if (!reducedMotion()) this.root.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 180, easing: 'ease-out' });
  }

  reset(): void {
    this.queue.length = 0;
    this.cur = null;
    this.root.hidden = true;
  }
}

// ---------------------------------------------------------------------------------------------
// cash deltas
// ---------------------------------------------------------------------------------------------

export class CashDeltas {
  constructor(private readonly host: HTMLElement) {}

  pop(amount: number): void {
    if (amount === 0) return;
    while (this.host.childElementCount >= 4) this.host.firstElementChild?.remove();
    const node = el('span', amount > 0 ? 'plus' : 'minus', this.host, fmtSignedMoney(amount));
    const a = node.animate(
      reducedMotion()
        ? [{ opacity: 1 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }]
        : [
            { opacity: 0, transform: 'translateY(6px)' },
            { opacity: 1, transform: 'translateY(-4px)', offset: 0.15 },
            { opacity: 1, transform: 'translateY(-16px)', offset: 0.7 },
            { opacity: 0, transform: 'translateY(-26px)' },
          ],
      { duration: 1300, easing: 'ease-out' },
    );
    a.onfinish = () => node.remove();
  }

  reset(): void {
    this.host.replaceChildren();
  }
}
