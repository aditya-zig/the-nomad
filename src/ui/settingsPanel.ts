/** Shared settings + controls panels used by the title screen and the pause menu. */
import type { QualityLevel, Settings } from '../types';
import { el } from './dom';

export interface SettingsPanel {
  root: HTMLElement;
  sync(s: Settings): void;
}

interface SliderRow {
  input: HTMLInputElement;
  out: HTMLElement;
  fmt: (v: number) => string;
}

function slider(
  parent: HTMLElement,
  label: string,
  min: number,
  max: number,
  step: number,
  fmt: (v: number) => string,
  onInput: (v: number) => void,
): SliderRow {
  const row = el('div', 'ds-set-row', parent);
  const id = `ds-set-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`;
  const lab = el('label', 'lbl', row, label);
  lab.htmlFor = id;
  const wrap = el('div', 'ctl', row);
  const input = el('input', 'ds-range', wrap);
  input.type = 'range';
  input.id = id;
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  const out = el('output', 'val', wrap);
  out.htmlFor = id;
  const paint = (): void => {
    const v = Number(input.value);
    input.style.setProperty('--fill', `${((v - min) / (max - min)) * 100}%`);
    out.textContent = fmt(v);
  };
  input.addEventListener('input', () => {
    paint();
    onInput(Number(input.value));
  });
  // expose repaint through the row
  (input as HTMLInputElement & { _paint?: () => void })._paint = paint;
  return { input, out, fmt };
}

function toggle(parent: HTMLElement, label: string, onChange: (v: boolean) => void): HTMLInputElement {
  const row = el('div', 'ds-set-row toggle', parent);
  const lab = el('label', 'ds-toggle', row);
  const input = el('input', '', lab);
  input.type = 'checkbox';
  el('span', 'box', lab);
  el('span', 'txt', lab, label);
  input.addEventListener('change', () => onChange(input.checked));
  return input;
}

const QUALITIES: QualityLevel[] = ['low', 'medium', 'high'];

export function buildSettingsPanel(change: (patch: Partial<Settings>) => void): SettingsPanel {
  const root = el('div', 'ds-settings');

  const sens = slider(root, 'MOUSE SENSITIVITY', 0.2, 3, 0.05, (v) => v.toFixed(2), (v) => change({ sensitivity: v }));
  const fov = slider(root, 'FIELD OF VIEW', 70, 110, 1, (v) => `${Math.round(v)}°`, (v) => change({ fov: Math.round(v) }));
  const vol = slider(root, 'MASTER VOLUME', 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`, (v) => change({ masterVolume: v }));

  const qRow = el('div', 'ds-set-row', root);
  el('span', 'lbl', qRow, 'GRAPHICS QUALITY');
  const seg = el('div', 'ds-seg', qRow);
  seg.setAttribute('role', 'radiogroup');
  seg.setAttribute('aria-label', 'Graphics quality');
  const qBtns = new Map<QualityLevel, HTMLButtonElement>();
  for (const q of QUALITIES) {
    const b = el('button', 'seg-btn', seg, q.toUpperCase());
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.addEventListener('click', () => change({ quality: q }));
    qBtns.set(q, b);
  }

  const rm = toggle(root, 'REDUCED MOTION', (v) => change({ reducedMotion: v }));
  const inv = toggle(root, 'INVERT Y-AXIS', (v) => change({ invertY: v }));
  const fps = toggle(root, 'SHOW FPS COUNTER', (v) => change({ showFps: v }));

  const hint = el('div', 'ds-set-hint', root);
  hint.textContent = 'Quality changes pixel ratio, shadow resolution and post-processing. Reduced motion cuts camera bob, sway and screen shake.';

  const paintOf = (r: SliderRow): void => (r.input as HTMLInputElement & { _paint?: () => void })._paint?.();

  return {
    root,
    sync(s: Settings): void {
      sens.input.value = String(s.sensitivity);
      fov.input.value = String(s.fov);
      vol.input.value = String(s.masterVolume);
      paintOf(sens);
      paintOf(fov);
      paintOf(vol);
      for (const [q, b] of qBtns) {
        const on = q === s.quality;
        b.classList.toggle('on', on);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
      }
      rm.checked = s.reducedMotion;
      inv.checked = s.invertY;
      fps.checked = s.showFps;
    },
  };
}

const CONTROLS: { keys: string[]; action: string }[] = [
  { keys: ['W', 'A', 'S', 'D'], action: 'MOVE' },
  { keys: ['MOUSE'], action: 'LOOK' },
  { keys: ['LMB'], action: 'FIRE' },
  { keys: ['RMB'], action: 'AIM DOWN SIGHTS' },
  { keys: ['R'], action: 'RELOAD' },
  { keys: ['SHIFT'], action: 'SPRINT' },
  { keys: ['SPACE'], action: 'JUMP' },
  { keys: ['C'], action: 'CROUCH' },
  { keys: ['E'], action: 'INTERACT' },
  { keys: ['1', '2', 'WHEEL'], action: 'SWITCH WEAPON' },
  { keys: ['G'], action: 'THROW GRENADE' },
  { keys: ['Q'], action: 'ARMOR PLATE' },
  { keys: ['M'], action: 'TACTICAL MAP' },
  { keys: ['ESC'], action: 'PAUSE' },
];

export function buildControlsPanel(): HTMLElement {
  const root = el('div', 'ds-controls');
  for (const c of CONTROLS) {
    const row = el('div', 'ds-ctl-row', root);
    const keys = el('span', 'keys', row);
    for (const k of c.keys) el('kbd', k.length > 2 ? 'key wide' : 'key', keys, k);
    el('span', 'act', row, c.action);
  }
  return root;
}
