import { describe, expect, it } from 'vitest';
import { LOOP_IDS, SOUND_IDS } from '../src/audio/ids';
import { loopSeamRatio } from '../src/audio/synth/dsp';
import { AMBIENCE_LAYERS, LOOP_SPECS, SOUND_SPECS, synthAmbienceLayer, synthLoop, synthSound } from '../src/audio/synth/registry';

const HI = 44100;

function stats(buf: Float32Array): { peak: number; rms: number; finite: boolean; mean: number } {
  let peak = 0;
  let s2 = 0;
  let mean = 0;
  let finite = true;
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i]!;
    if (!Number.isFinite(v)) finite = false;
    peak = Math.max(peak, Math.abs(v));
    s2 += v * v;
    mean += v;
  }
  return { peak, rms: Math.sqrt(s2 / buf.length), finite, mean: mean / buf.length };
}

describe('procedural audio synthesis', () => {
  it('has a recipe for every sound and loop id in the contract', () => {
    for (const id of SOUND_IDS) expect(SOUND_SPECS[id], id).toBeDefined();
    for (const id of LOOP_IDS) if (id !== 'ambience') expect(LOOP_SPECS[id], id).toBeDefined();
    expect(AMBIENCE_LAYERS.length).toBe(3);
  });

  it('renders every variant finite, audible, DC-free and inside the peak budget', () => {
    for (const id of SOUND_IDS) {
      const spec = SOUND_SPECS[id];
      for (let v = 0; v < spec.variants; v++) {
        const { data, sampleRate } = synthSound(id, v, HI);
        const s = stats(data);
        expect(s.finite, `${id}#${v} finite`).toBe(true);
        expect(s.peak, `${id}#${v} peak`).toBeGreaterThan(0.1);
        expect(s.peak, `${id}#${v} peak`).toBeLessThanOrEqual(0.96);
        expect(s.rms, `${id}#${v} rms`).toBeGreaterThan(0.004);
        expect(Math.abs(s.mean), `${id}#${v} dc`).toBeLessThan(0.01);
        expect(data.length / sampleRate, `${id}#${v} duration`).toBeLessThan(8);
        // no click at the very start or end (edges are faded)
        expect(Math.abs(data[0]!), `${id}#${v} first sample`).toBeLessThan(0.05);
        expect(Math.abs(data[data.length - 1]!), `${id}#${v} last sample`).toBeLessThan(0.05);
      }
    }
  });

  it('is deterministic per (id, variant) and variants actually differ', () => {
    const a = synthSound('zombie_groan', 2, HI).data;
    const b = synthSound('zombie_groan', 2, HI).data;
    expect(a.length).toBe(b.length);
    let same = true;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) same = false;
    expect(same).toBe(true);
    for (const id of ['rifle_shot', 'step_concrete', 'zombie_groan', 'impact_metal'] as const) {
      const v0 = synthSound(id, 0, HI).data;
      const v1 = synthSound(id, 1, HI).data;
      let diff = 0;
      const n = Math.min(v0.length, v1.length);
      for (let i = 0; i < n; i++) diff += Math.abs(v0[i]! - v1[i]!);
      expect(diff / n, `${id} variants differ`).toBeGreaterThan(1e-4);
    }
  });

  it('keeps the intended loudness hierarchy', () => {
    const rms = (id: (typeof SOUND_IDS)[number]): number => stats(synthSound(id, 0, HI).data).rms;
    expect(rms('shotgun_shot')).toBeGreaterThan(rms('rifle_shot'));
    expect(rms('rifle_shot')).toBeGreaterThan(rms('pistol_shot'));
    expect(rms('grenade_explosion')).toBeGreaterThan(rms('rifle_shot'));
    expect(rms('pistol_shot')).toBeGreaterThan(rms('step_concrete'));
    expect(rms('zombie_groan')).toBeGreaterThan(rms('step_concrete'));
  });

  it('renders seamless loops (no discontinuity at the wrap point)', () => {
    for (const id of LOOP_IDS) {
      if (id === 'ambience') continue;
      const { data } = synthLoop(id, HI);
      const s = stats(data);
      expect(s.finite, `${id} finite`).toBe(true);
      expect(s.peak, `${id} peak`).toBeLessThanOrEqual(0.96);
      expect(loopSeamRatio(data), `${id} seam`).toBeLessThan(3);
    }
    for (let i = 0; i < AMBIENCE_LAYERS.length; i++) {
      const { data } = synthAmbienceLayer(i);
      expect(loopSeamRatio(data), `ambience layer ${i} seam`).toBeLessThan(3);
    }
  });
});
