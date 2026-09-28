/**
 * Node-side synthesis report (no Web Audio needed): renders every sound and loop with the same deterministic recipes the
 * engine uses and prints peak / RMS / spectral statistics and synthesis timings.
 *
 * Run:  pnpm exec vite build --ssr dev/audio-analyze.ts --outDir <tmp> --emptyOutDir && node <tmp>/audio-analyze.js [--json]
 */
import { LOOP_IDS, SOUND_IDS } from '../src/audio/ids';
import { analyze, loopSeamRatio } from '../src/audio/synth/dsp';
import { AMBIENCE_LAYERS, LOOP_SPECS, SOUND_SPECS, synthAmbienceLayer, synthLoop, synthSound } from '../src/audio/synth/registry';

const HI = 44100;
const json = process.argv.includes('--json');

interface Row {
  id: string;
  kind: 'sound' | 'loop' | 'layer';
  variants: number;
  sr: number;
  seconds: number;
  peak: number;
  rms: number;
  centroid: number;
  lowRatio: number;
  highRatio: number;
  t40: number;
  hasNaN: boolean;
  ms: number;
  seam?: number;
}

const rows: Row[] = [];
let totalMs = 0;
let totalEssentialMs = 0;
let totalSamples = 0;

for (const id of SOUND_IDS) {
  const spec = SOUND_SPECS[id];
  let worstPeak = 0;
  let sumRms = 0;
  let sumCen = 0;
  let sumLow = 0;
  let sumHigh = 0;
  let sumSec = 0;
  let sumT40 = 0;
  let nan = false;
  let ms = 0;
  let sr = 0;
  for (let v = 0; v < spec.variants; v++) {
    const t0 = performance.now();
    const { data, sampleRate } = synthSound(id, v, HI);
    ms += performance.now() - t0;
    sr = sampleRate;
    totalSamples += data.length;
    const a = analyze(data, sampleRate);
    worstPeak = Math.max(worstPeak, a.peak);
    sumRms += a.rms;
    sumCen += a.centroid;
    sumLow += a.lowRatio;
    sumHigh += a.highRatio;
    sumSec += a.seconds;
    sumT40 += a.t40;
    nan = nan || a.hasNaN;
  }
  const n = spec.variants;
  totalMs += ms;
  if (spec.essential) totalEssentialMs += ms;
  rows.push({
    id,
    kind: 'sound',
    variants: n,
    sr,
    seconds: sumSec / n,
    peak: worstPeak,
    rms: sumRms / n,
    centroid: sumCen / n,
    lowRatio: sumLow / n,
    highRatio: sumHigh / n,
    t40: sumT40 / n,
    hasNaN: nan,
    ms,
  });
}

for (const id of LOOP_IDS) {
  if (id === 'ambience') continue;
  const t0 = performance.now();
  const { data, sampleRate } = synthLoop(id, HI);
  const ms = performance.now() - t0;
  totalMs += ms;
  totalSamples += data.length;
  const a = analyze(data, sampleRate);
  rows.push({
    id: `loop:${id}`,
    kind: 'loop',
    variants: 1,
    sr: sampleRate,
    seconds: a.seconds,
    peak: a.peak,
    rms: a.rms,
    centroid: a.centroid,
    lowRatio: a.lowRatio,
    highRatio: a.highRatio,
    t40: a.t40,
    hasNaN: a.hasNaN,
    ms,
    seam: loopSeamRatio(data),
  });
  void LOOP_SPECS;
}

AMBIENCE_LAYERS.forEach((layer, i) => {
  const t0 = performance.now();
  const { data, sampleRate } = synthAmbienceLayer(i);
  const ms = performance.now() - t0;
  totalMs += ms;
  totalSamples += data.length;
  const a = analyze(data, sampleRate);
  rows.push({
    id: `amb:${layer.name}`,
    kind: 'layer',
    variants: 1,
    sr: sampleRate,
    seconds: a.seconds,
    peak: a.peak,
    rms: a.rms,
    centroid: a.centroid,
    lowRatio: a.lowRatio,
    highRatio: a.highRatio,
    t40: a.t40,
    hasNaN: a.hasNaN,
    ms,
    seam: loopSeamRatio(data),
  });
});

if (json) {
  console.log(JSON.stringify({ rows, totalMs, totalEssentialMs, totalSamples }));
} else {
  const f = (v: number, d = 2) => v.toFixed(d);
  console.log('id'.padEnd(22), 'var', 'sr'.padStart(6), 'sec'.padStart(5), 'peak'.padStart(5), 'rms'.padStart(6), 'cent'.padStart(6), 'low%'.padStart(5), 'hi%'.padStart(5), 't99'.padStart(5), 'ms'.padStart(6), 'seam');
  for (const r of rows) {
    console.log(
      r.id.padEnd(22),
      String(r.variants).padStart(3),
      String(r.sr).padStart(6),
      f(r.seconds).padStart(5),
      f(r.peak).padStart(5),
      f(r.rms, 3).padStart(6),
      f(r.centroid, 0).padStart(6),
      f(r.lowRatio * 100, 0).padStart(5),
      f(r.highRatio * 100, 0).padStart(5),
      f(r.t40).padStart(5),
      f(r.ms, 1).padStart(6),
      r.seam !== undefined ? f(r.seam, 2) : '',
      r.hasNaN ? 'NaN!' : '',
    );
  }
  console.log(`\nTOTAL synthesis ${f(totalMs, 0)} ms (essential ${f(totalEssentialMs, 0)} ms), ${(totalSamples / 1e6).toFixed(2)} M samples = ${((totalSamples * 4) / 1048576).toFixed(1)} MB float32`);
}
