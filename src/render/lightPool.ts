/**
 * Dynamic light pool: the level registers hundreds of lamp candidates (`LampSpec`), but only the few nearest to the
 * camera get a real `THREE.PointLight`. A FIXED number of lights always stays in the scene (intensity 0 when unused) so
 * materials never recompile when lamps come and go. Lamps cross-fade in and out to avoid popping.
 */
import * as THREE from 'three';
import type { LampSpec } from '../world/builder';

const hash = (n: number): number => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/** Time-varying intensity multiplier 0..1 for a lamp mode (also used by previews). */
export function lampIntensityMul(l: LampSpec, t: number): number {
  const phase = l.phase ?? 0;
  switch (l.mode) {
    case 'flicker': {
      const k = Math.floor((t + phase) * 12);
      const r = hash(k + phase * 7.3);
      return r > 0.9 ? 0.15 : r > 0.75 ? 0.55 : 0.92 + 0.08 * Math.sin((t + phase) * 31);
    }
    case 'fail': {
      // mostly dead with short bursts of flicker
      const slot = Math.floor((t + phase) * 1.6);
      const active = hash(slot * 3.17 + phase) > 0.78;
      if (!active) return 0.03;
      const k = Math.floor((t + phase) * 22);
      return hash(k + phase) > 0.45 ? 0.9 : 0.1;
    }
    case 'blink': {
      const period = l.period ?? 1.2;
      const duty = l.duty ?? 0.25;
      const ph = (((t + phase) / period) % 1 + 1) % 1;
      return ph < duty ? 1 : 0;
    }
    case 'pulse': {
      const period = l.period ?? 2;
      return 0.55 + 0.45 * Math.sin(((t + phase) * Math.PI * 2) / period);
    }
    default:
      return 1;
  }
}

export class LightPool {
  private readonly lights: THREE.PointLight[] = [];
  private readonly assigned: number[] = [];
  private readonly fade: number[] = [];
  private lamps: LampSpec[] = [];
  private active: number;
  private timer = 0;
  private readonly scores: { i: number; s: number }[] = [];

  constructor(parent: THREE.Object3D, maxCount: number, active = maxCount) {
    this.active = Math.min(active, maxCount);
    for (let i = 0; i < maxCount; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 20, 2);
      light.castShadow = false;
      parent.add(light);
      this.lights.push(light);
      this.assigned.push(-1);
      this.fade.push(0);
    }
  }

  setLamps(lamps: LampSpec[]): void {
    this.lamps = lamps;
    this.assigned.fill(-1);
    this.fade.fill(0);
    this.timer = 0;
  }

  /** Number of lights allowed to be active (quality preset); the rest fade out. */
  setActiveCount(n: number): void {
    this.active = Math.max(0, Math.min(n, this.lights.length));
  }

  get lightCount(): number {
    return this.lights.length;
  }

  update(dt: number, time: number, focus: THREE.Vector3): void {
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 0.15;
      this.select(focus);
    }
    const rate = 1 - Math.exp(-dt * 6);
    for (let k = 0; k < this.lights.length; k++) {
      const light = this.lights[k]!;
      const lampIdx = this.assigned[k]!;
      const enabled = k < this.active && lampIdx >= 0;
      const target = enabled ? 1 : 0;
      this.fade[k] = this.fade[k]! + (target - this.fade[k]!) * rate;
      if (lampIdx >= 0 && this.fade[k]! > 0.003) {
        const lamp = this.lamps[lampIdx]!;
        light.position.set(lamp.x, lamp.y, lamp.z);
        light.color.set(lamp.color);
        light.distance = lamp.distance;
        light.intensity = lamp.intensity * lampIntensityMul(lamp, time) * this.fade[k]!;
      } else {
        light.intensity = 0;
        if (!enabled && this.fade[k]! <= 0.003) this.assigned[k] = -1;
      }
    }
  }

  private select(focus: THREE.Vector3): void {
    const lamps = this.lamps;
    const scores = this.scores;
    scores.length = 0;
    for (let i = 0; i < lamps.length; i++) {
      const l = lamps[i]!;
      const dx = l.x - focus.x;
      const dz = l.z - focus.z;
      const d2 = dx * dx + dz * dz + (l.y - focus.y) * (l.y - focus.y);
      const reach = l.distance * 1.15;
      if (d2 > reach * reach) continue;
      scores.push({ i, s: ((l.weight ?? 1) * l.intensity) / (d2 + 30) });
    }
    scores.sort((a, b) => b.s - a.s);
    const wanted = new Set<number>();
    for (let k = 0; k < Math.min(this.active, scores.length); k++) wanted.add(scores[k]!.i);

    // keep lights whose lamp is still wanted; free the rest
    const kept = new Set<number>();
    for (let k = 0; k < this.lights.length; k++) {
      const idx = this.assigned[k]!;
      if (idx >= 0 && wanted.has(idx)) kept.add(idx);
    }
    for (const idx of wanted) {
      if (kept.has(idx)) continue;
      // find a free (or fully faded) light, else steal the dimmest one
      let slot = -1;
      let best = Infinity;
      for (let k = 0; k < this.lights.length; k++) {
        const a = this.assigned[k]!;
        if (a < 0) {
          slot = k;
          break;
        }
        if (!wanted.has(a) && this.fade[k]! < best) {
          best = this.fade[k]!;
          slot = k;
        }
      }
      if (slot >= 0) {
        this.assigned[slot] = idx;
        this.fade[slot] = this.fade[slot]! < 0.2 ? 0 : this.fade[slot]!;
        kept.add(idx);
      }
    }
  }

  dispose(): void {
    for (const l of this.lights) l.removeFromParent();
    this.lights.length = 0;
  }
}
