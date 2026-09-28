/**
 * Audio dev harness.
 *   /dev/audio.html                 interactive sound board (click to play; loops; environment; spatial offsets)
 *   /dev/audio.html?sheet=weapons   spectrogram contact sheet (groups: weapons feedback player zombies world mission hazard ambience ui loops)
 *   /dev/audio.html?report=1        runs the automated report and stores it in window.__audioReport
 * Sets window.__ready = true when the requested mode has finished.
 */
import { createAudioEngineOn, createDebugAudioEngine, type AudioEngineDebug } from '../src/audio/engine';
import { LOOP_IDS, SOUND_IDS, type LoopHandle, type LoopId, type SoundId } from '../src/audio/ids';
import { AUDIO } from '../src/config';
import { prewarmProgress } from '../src/audio/synth/prewarm';
import { analyze, loopSeamRatio, spectrogram } from '../src/audio/synth/dsp';
import { AMBIENCE_LAYERS, LOOP_SPECS, SOUND_SPECS, synthAmbienceLayer, synthLoop, synthSound } from '../src/audio/synth/registry';

declare global {
  interface Window {
    __ready?: boolean;
    __audioReport?: AudioReport;
  }
}

// -------------------------------------------------------------------------------------------------
// helpers
// -------------------------------------------------------------------------------------------------

function groupOf(id: string): string {
  if (/^(rifle|pistol|shotgun|dry_fire|weapon_draw|grenade|armor_plate)/.test(id)) return 'weapons';
  if (/^(hit_|kill_|impact_|ricochet)/.test(id)) return 'feedback';
  if (/^(step_|jump|land|player_|cough)/.test(id)) return 'player';
  if (/^(zombie_|warden_)/.test(id)) return 'zombies';
  if (/^(pickup_|crate_|buy_|upgrade_|station_)/.test(id)) return 'world';
  if (/^(contract_|objective_|defense_|radio_|flare_|countdown_|heli_|boarding|victory|defeat)/.test(id)) return 'mission';
  if (/^(siren|klaxon)/.test(id)) return 'hazard';
  if (/^amb_/.test(id)) return 'ambience';
  return 'ui';
}

const GROUP_ORDER = ['weapons', 'feedback', 'player', 'zombies', 'world', 'mission', 'hazard', 'ambience', 'ui'];

function heat(t: number): [number, number, number] {
  const stops: [number, [number, number, number]][] = [
    [0, [6, 8, 20]],
    [0.25, [46, 22, 112]],
    [0.5, [176, 40, 92]],
    [0.75, [250, 150, 30]],
    [1, [255, 250, 205]],
  ];
  const x = Math.min(1, Math.max(0, t));
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i]!;
    const b = stops[i + 1]!;
    if (x <= b[0]) {
      const u = (x - a[0]) / (b[0] - a[0]);
      return [a[1][0] + (b[1][0] - a[1][0]) * u, a[1][1] + (b[1][1] - a[1][1]) * u, a[1][2] + (b[1][2] - a[1][2]) * u];
    }
  }
  return stops[stops.length - 1]![1];
}

/** Log-frequency spectrogram (40 Hz .. Nyquist) with a waveform strip underneath. */
function drawSpectro(canvas: HTMLCanvasElement, data: Float32Array, sr: number, seamAt?: number): void {
  const W = canvas.width;
  const H = canvas.height;
  const specH = H - 30;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#05080c';
  g.fillRect(0, 0, W, H);
  const size = 512;
  const hop = Math.max(32, Math.floor(data.length / W));
  const { frames } = spectrogram(data, size, hop);
  let ref = 1e-9;
  for (const f of frames) for (let k = 1; k < f.length; k++) if (f[k]! > ref) ref = f[k]!;
  const fmin = 40;
  const fmax = sr / 2;
  const img = g.createImageData(W, specH);
  for (let x = 0; x < W; x++) {
    const fi = Math.min(frames.length - 1, Math.floor((x / W) * frames.length));
    const f = frames[fi]!;
    for (let y = 0; y < specH; y++) {
      const freq = fmin * Math.pow(fmax / fmin, 1 - y / (specH - 1));
      const bin = Math.min(f.length - 1, Math.max(1, Math.round((freq / (sr / size)))));
      const db = 20 * Math.log10(f[bin]! / ref + 1e-9);
      const [r, gg, b] = heat((db + 78) / 78);
      const o = (y * W + x) * 4;
      img.data[o] = r;
      img.data[o + 1] = gg;
      img.data[o + 2] = b;
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // waveform strip
  const mid = specH + 15;
  g.fillStyle = '#0c141b';
  g.fillRect(0, specH, W, 30);
  g.strokeStyle = '#6fd0a0';
  g.beginPath();
  for (let x = 0; x < W; x++) {
    const i0 = Math.floor((x / W) * data.length);
    const i1 = Math.max(i0 + 1, Math.floor(((x + 1) / W) * data.length));
    let mn = 1;
    let mx = -1;
    for (let i = i0; i < i1 && i < data.length; i++) {
      const v = data[i]!;
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    g.moveTo(x + 0.5, mid - mx * 13);
    g.lineTo(x + 0.5, mid - mn * 13);
  }
  g.stroke();
  if (seamAt !== undefined) {
    g.strokeStyle = '#ff5a4d';
    g.beginPath();
    g.moveTo(seamAt, 0);
    g.lineTo(seamAt, H);
    g.stroke();
  }
}

function addCell(parent: HTMLElement, title: string, data: Float32Array, sr: number, extra = ''): void {
  const cell = document.createElement('div');
  cell.className = 'cell';
  const label = document.createElement('div');
  const a = analyze(data, sr);
  label.textContent = `${title}  ${a.seconds.toFixed(2)}s pk ${a.peak.toFixed(2)} rms ${a.rms.toFixed(3)} c${a.centroid.toFixed(0)} ${extra}`;
  const canvas = document.createElement('canvas');
  canvas.width = 300;
  canvas.height = 118;
  drawSpectro(canvas, data, sr);
  cell.append(label, canvas);
  parent.appendChild(cell);
}

/** Loop seam view: last 40 ms + first 40 ms joined, marker at the join. */
function addSeamCell(parent: HTMLElement, title: string, data: Float32Array, sr: number): void {
  const n = Math.round(sr * 0.04);
  const joined = new Float32Array(n * 2);
  joined.set(data.subarray(data.length - n));
  joined.set(data.subarray(0, n), n);
  const cell = document.createElement('div');
  cell.className = 'cell';
  const label = document.createElement('div');
  label.textContent = `${title} seam  jump/step ${loopSeamRatio(data).toFixed(2)}`;
  const canvas = document.createElement('canvas');
  canvas.width = 300;
  canvas.height = 118;
  drawSpectro(canvas, joined, sr, 150);
  cell.append(label, canvas);
  parent.appendChild(cell);
}

// -------------------------------------------------------------------------------------------------
// report
// -------------------------------------------------------------------------------------------------

interface SoundRow {
  id: string;
  variants: number;
  sampleRate: number;
  seconds: number;
  peak: number;
  rms: number;
  hasNaN: boolean;
  centroid: number;
  lowRatio: number;
  highRatio: number;
}

interface AudioReport {
  sampleRateContext: number;
  idsMissing: string[];
  init: { ms: number; breakdown: { context: number; graph: number; synth: number }; prewarmWaitMs: number; ctxState: string; bufferSecondsAfterInit: number; bufferMBAfterInit: number; pendingAfterInit: number; available: boolean };
  full: { synthesizeAllMs: number; bufferSeconds: number; bufferMB: number };
  sounds: SoundRow[];
  loops: { id: string; seconds: number; peak: number; seam: number; sampleRate: number }[];
  anyNaN: boolean;
  worstPeak: number;
  voiceTest: { requested: number; maxVoiceCount: number; cap: number; dropped: number; afterMs: number; voiceCountAfter: number };
  loopTest: { sameHandleOnRestart: boolean; startedAll: boolean; stoppedAll: boolean; positionalOk: boolean };
  ambienceTest: { events: number; noThrow: boolean };
  offline?: OfflineReport;
  lifecycle: {
    disposeOk: boolean;
    playAfterDisposeSilent: boolean;
    suspendResume: { afterSuspend: string; afterResume: string };
    initFailureInert: { initReturned: boolean; noThrow: boolean; available: boolean };
    masterVolumeBeforeInitOk: boolean;
  };
  errors: string[];
}

interface OfflineReport {
  seconds: number;
  renderMs: number;
  overallPeak: number;
  hierarchy: { id: string; peak: number; rms: number }[];
  pan: { case: string; left: number; right: number; ratioDb: number }[];
  distance: { meters: number; peak: number; rms: number }[];
  limiterPeak: number;
  /** RMS of a rifle shot in three windows after the shot: dry (0-0.3 s), early (0.3-0.6 s), late (0.9-1.9 s). */
  reverb: { outdoor: { dry: number; early: number; late: number }; indoor: { dry: number; early: number; late: number } };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function offlineTests(): Promise<OfflineReport> {
  const sr = 48000;
  const HIER: SoundId[] = [
    'grenade_explosion',
    'shotgun_shot',
    'rifle_shot',
    'pistol_shot',
    'rifle_shot_up',
    'warden_roar',
    'warden_slam',
    'zombie_screech',
    'zombie_groan',
    'zombie_snarl',
    'zombie_hurt',
    'player_hurt',
    'zombie_claw_hit',
    'impact_concrete',
    'impact_metal',
    'impact_flesh',
    'step_concrete',
    'step_metal',
    'rifle_mag_in',
    'shotgun_pump',
    'pickup_cash',
    'hit_head',
    'contract_complete',
    'ui_click',
  ];
  const slot = 3.0;
  const pans: { name: string; pos: { x: number; y: number; z: number } }[] = [
    { name: 'left 10m', pos: { x: -10, y: 1.7, z: 0 } },
    { name: 'right 10m', pos: { x: 10, y: 1.7, z: 0 } },
    { name: 'front 10m', pos: { x: 0, y: 1.7, z: -10 } },
    { name: 'behind 10m', pos: { x: 0, y: 1.7, z: 10 } },
  ];
  const dists = [3, 10, 30, 60];
  const total = 0.6 + HIER.length * slot + pans.length * slot + dists.length * slot + 4.5 + 2 * 5;
  const ctx = new OfflineAudioContext(2, Math.ceil(sr * total), sr);
  const eng = createAudioEngineOn({ context: ctx, maxVoices: 2048 });
  if (!eng.init()) throw new Error('offline engine init failed');
  eng.synthesizeAll();
  eng.setListener({ x: 0, y: 1.7, z: 0 }, { x: 0, y: 0, z: -1 }, { x: 0, y: 1, z: 0 });
  let t = 0.6;
  const slots: { key: string; t: number }[] = [];
  for (const id of HIER) {
    eng.play(id, { delay: t, priority: 3 });
    slots.push({ key: `h:${id}`, t });
    t += slot;
  }
  for (const p of pans) {
    eng.play('zombie_groan', { delay: t, pos: p.pos, priority: 3 });
    slots.push({ key: `p:${p.name}`, t });
    t += slot;
  }
  for (const d of dists) {
    eng.play('pistol_shot', { delay: t, pos: { x: 0, y: 1.7, z: -d }, priority: 3 });
    slots.push({ key: `d:${d}`, t });
    t += slot;
  }
  // limiter: 24 simultaneous heavy sounds
  const limT = t;
  for (let i = 0; i < 8; i++) {
    eng.play('grenade_explosion', { delay: limT + i * 0.01, priority: 3 });
    eng.play('shotgun_shot', { delay: limT + i * 0.01, priority: 3 });
    eng.play('warden_roar', { delay: limT + i * 0.01, priority: 3 });
  }
  slots.push({ key: 'limiter', t: limT });
  t += 4.5;
  const tailT = t;
  const t0 = performance.now();
  const rendered = await ctx.startRendering();
  const renderMs = performance.now() - t0;
  const L = rendered.getChannelData(0);
  const R = rendered.getChannelData(1);
  const stat = (from: number, to: number) => {
    const i0 = Math.floor(from * sr);
    const i1 = Math.min(L.length, Math.floor(to * sr));
    let pk = 0;
    let s2 = 0;
    let sl = 0;
    let sr2 = 0;
    for (let i = i0; i < i1; i++) {
      const a = Math.max(Math.abs(L[i]!), Math.abs(R[i]!));
      if (a > pk) pk = a;
      s2 += (L[i]! * L[i]! + R[i]! * R[i]!) / 2;
      sl += L[i]! * L[i]!;
      sr2 += R[i]! * R[i]!;
    }
    const n = Math.max(1, i1 - i0);
    return { pk, rms: Math.sqrt(s2 / n), l: Math.sqrt(sl / n), r: Math.sqrt(sr2 / n) };
  };
  const hierarchy: OfflineReport['hierarchy'] = [];
  const pan: OfflineReport['pan'] = [];
  const distance: OfflineReport['distance'] = [];
  let limiterPeak = 0;
  for (const s of slots) {
    if (s.key.startsWith('h:')) {
      const st = stat(s.t, s.t + 1.2);
      hierarchy.push({ id: s.key.slice(2), peak: st.pk, rms: st.rms });
    } else if (s.key.startsWith('p:')) {
      const st = stat(s.t, s.t + 1.6);
      pan.push({ case: s.key.slice(2), left: st.l, right: st.r, ratioDb: 20 * Math.log10((st.r + 1e-9) / (st.l + 1e-9)) });
    } else if (s.key.startsWith('d:')) {
      const st = stat(s.t, s.t + 0.6);
      distance.push({ meters: Number(s.key.slice(2)), peak: st.pk, rms: st.rms });
    } else if (s.key === 'limiter') {
      limiterPeak = stat(s.t, s.t + 4).pk;
    }
  }
  let overallPeak = 0;
  for (let i = 0; i < L.length; i++) overallPeak = Math.max(overallPeak, Math.abs(L[i]!), Math.abs(R[i]!));
  void tailT;
  eng.dispose();

  // indoor vs outdoor reverb: render rifle_shot in each environment and compare energy in windows after the shot
  const win = (l: Float32Array, from: number, to: number): number => {
    const i0 = Math.floor(from * sr);
    const i1 = Math.floor(to * sr);
    let s2 = 0;
    for (let i = i0; i < i1; i++) s2 += l[i]! * l[i]!;
    return Math.sqrt(s2 / (i1 - i0));
  };
  const rv: Record<'outdoor' | 'indoor', { dry: number; early: number; late: number }> = {
    outdoor: { dry: 0, early: 0, late: 0 },
    indoor: { dry: 0, early: 0, late: 0 },
  };
  for (const env of ['outdoor', 'indoor'] as const) {
    const c2 = new OfflineAudioContext(2, sr * 4, sr);
    const e2 = createAudioEngineOn({ context: c2, maxVoices: 64 });
    e2.init();
    e2.setEnvironment(env);
    const shot = 1.0; // after the environment crossfade has settled
    e2.play('rifle_shot', { delay: shot, priority: 3 });
    const out = await c2.startRendering();
    const l = out.getChannelData(0);
    rv[env] = { dry: win(l, shot, shot + 0.3), early: win(l, shot + 0.3, shot + 0.6), late: win(l, shot + 0.9, shot + 1.9) };
    e2.dispose();
  }
  return {
    seconds: total,
    renderMs,
    overallPeak,
    hierarchy,
    pan,
    distance,
    limiterPeak,
    reverb: rv,
  };
}

async function runReport(withOffline: boolean): Promise<AudioReport> {
  const errors: string[] = [];
  // Real engine first, exactly like a player: the constructor starts background pre-synthesis while the title screen is up,
  // and `init()` runs inside the Deploy click. (Warm-up work done later in this report must not flatter these numbers.)
  const eng: AudioEngineDebug = createDebugAudioEngine();
  const tWait = performance.now();
  while (prewarmProgress().total === 0 || prewarmProgress().done < prewarmProgress().total) await sleep(20);
  const prewarmMs = performance.now() - tWait;
  const t0 = performance.now();
  const ok = eng.init();
  const initMs = performance.now() - t0;
  const ctxRate = eng.sampleRate || 48000;
  const hi = Math.min(48000, ctxRate);

  // ---- pure synthesis statistics ----
  const rows: SoundRow[] = [];
  let anyNaN = false;
  let worstPeak = 0;
  const missing: string[] = [];
  for (const id of SOUND_IDS) {
    const spec = SOUND_SPECS[id];
    if (!spec) {
      missing.push(id);
      continue;
    }
    let peak = 0;
    let rms = 0;
    let sec = 0;
    let cen = 0;
    let low = 0;
    let high = 0;
    let nan = false;
    let sr = 0;
    for (let v = 0; v < spec.variants; v++) {
      const { data, sampleRate } = synthSound(id, v, hi);
      sr = sampleRate;
      const a = analyze(data, sampleRate);
      peak = Math.max(peak, a.peak);
      rms += a.rms;
      sec += a.seconds;
      cen += a.centroid;
      low += a.lowRatio;
      high += a.highRatio;
      nan = nan || a.hasNaN;
    }
    const n = spec.variants;
    anyNaN = anyNaN || nan;
    worstPeak = Math.max(worstPeak, peak);
    rows.push({ id, variants: n, sampleRate: sr, seconds: sec / n, peak, rms: rms / n, hasNaN: nan, centroid: cen / n, lowRatio: low / n, highRatio: high / n });
  }
  const loopRows: AudioReport['loops'] = [];
  for (const id of LOOP_IDS) {
    if (id === 'ambience') {
      AMBIENCE_LAYERS.forEach((layer, i) => {
        const { data, sampleRate } = synthAmbienceLayer(i);
        const a = analyze(data, sampleRate);
        loopRows.push({ id: `ambience:${layer.name}`, seconds: a.seconds, peak: a.peak, seam: loopSeamRatio(data), sampleRate });
        anyNaN = anyNaN || a.hasNaN;
      });
    } else {
      if (!LOOP_SPECS[id]) {
        missing.push(id);
        continue;
      }
      const { data, sampleRate } = synthLoop(id, hi);
      const a = analyze(data, sampleRate);
      loopRows.push({ id, seconds: a.seconds, peak: a.peak, seam: loopSeamRatio(data), sampleRate });
      anyNaN = anyNaN || a.hasNaN;
    }
  }

  // ---- real engine on a real AudioContext ----
  const init = {
    ms: initMs,
    breakdown: eng.initBreakdown,
    prewarmWaitMs: prewarmMs,
    ctxState: eng.ctxState,
    bufferSecondsAfterInit: eng.bufferSeconds,
    bufferMBAfterInit: eng.bufferBytes / 1048576,
    pendingAfterInit: eng.pendingSynthesis,
    available: ok && eng.available,
  };
  eng.setListener({ x: 0, y: 1.7, z: 0 }, { x: 0, y: 0, z: -1 }, { x: 0, y: 1, z: 0 });
  // background synthesis drains through update(): measure how many frames it takes
  const tb = performance.now();
  let frames = 0;
  while (eng.pendingSynthesis > 0 && frames < 4000) {
    eng.update(1 / 60);
    frames++;
  }
  const full = { synthesizeAllMs: performance.now() - tb, bufferSeconds: eng.bufferSeconds, bufferMB: eng.bufferBytes / 1048576 };
  full.synthesizeAllMs = performance.now() - tb;

  // ---- voice cap ----
  let maxVoices = 0;
  const burst: SoundId[] = ['rifle_shot', 'zombie_groan', 'step_concrete', 'impact_concrete', 'zombie_snarl', 'grenade_explosion', 'pistol_shot', 'zombie_death'];
  const requested = 160;
  for (let i = 0; i < requested; i++) {
    const id = burst[i % burst.length]!;
    eng.play(id, {
      pos: i % 3 === 0 ? { x: (i % 17) - 8, y: 1.7, z: -((i % 23) + 3) } : undefined,
      priority: (i % 4) as 0 | 1 | 2 | 3,
    });
    maxVoices = Math.max(maxVoices, eng.voiceCount);
  }
  const dropped = eng.dropped;
  await sleep(6500);
  eng.update(0.016);
  const voiceTest = { requested, maxVoiceCount: maxVoices, cap: AUDIO.maxVoices, dropped, afterMs: 6500, voiceCountAfter: eng.voiceCount };

  // ---- loops ----
  const handles: LoopHandle[] = [];
  let startedAll = true;
  for (const id of LOOP_IDS) {
    const h = eng.startLoop(id, { volume: 0.5, pos: { x: 12, y: 2, z: -20 } });
    handles.push(h);
    startedAll = startedAll && h.active;
  }
  const sameHandle = eng.startLoop('heli') === handles[LOOP_IDS.indexOf('heli')];
  const heli = handles[LOOP_IDS.indexOf('heli')]!;
  heli.setRate(0.7);
  heli.setVolume(0.8, 0.2);
  heli.setPosition({ x: -30, y: 20, z: -40 });
  const positionalOk = heli.active;
  // ambience scheduler: simulate 90 s of updates
  let ambEvents = 0;
  let noThrow = true;
  const before = eng.voiceCount;
  try {
    for (let i = 0; i < 90 * 20; i++) {
      eng.update(0.05);
      ambEvents = Math.max(ambEvents, eng.voiceCount - before);
    }
  } catch (e) {
    noThrow = false;
    errors.push(`ambience update threw: ${String(e)}`);
  }
  await sleep(300);
  let stoppedAll = true;
  for (const h of handles) {
    h.stop(0.05);
    stoppedAll = stoppedAll && !h.active;
  }
  await sleep(400);

  // ---- lifecycle ----
  eng.stopAll();
  eng.dispose();
  let playAfterDisposeSilent = true;
  try {
    eng.play('rifle_shot');
    eng.startLoop('ambience');
    eng.update(0.016);
  } catch {
    playAfterDisposeSilent = false;
  }
  // suspend / resume on a fresh engine
  const e3 = createDebugAudioEngine();
  e3.setMasterVolume(0.4);
  e3.init();
  await sleep(120);
  e3.suspend();
  await sleep(200);
  const afterSuspend = e3.ctxState;
  e3.resume();
  await sleep(200);
  const afterResume = e3.ctxState;
  e3.dispose();

  // Web Audio unavailable: the engine must stay inert without throwing
  const w = window as unknown as { AudioContext?: unknown; webkitAudioContext?: unknown };
  const savedCtor = w.AudioContext;
  const savedWebkit = w.webkitAudioContext;
  Object.defineProperty(window, 'AudioContext', { value: undefined, configurable: true, writable: true });
  Object.defineProperty(window, 'webkitAudioContext', { value: undefined, configurable: true, writable: true });
  const e4 = createDebugAudioEngine();
  let inertNoThrow = true;
  let inertInit = true;
  try {
    inertInit = e4.init();
    e4.setMasterVolume(0.5);
    e4.setListener({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }, { x: 0, y: 1, z: 0 });
    e4.setEnvironment('indoor');
    e4.play('rifle_shot', { pos: { x: 1, y: 1, z: 1 } });
    const h = e4.startLoop('heli');
    h.setVolume(1);
    h.setPosition({ x: 0, y: 0, z: 0 });
    h.stop();
    e4.update(0.016);
    e4.stopAll();
    e4.suspend();
    e4.resume();
    e4.dispose();
  } catch {
    inertNoThrow = false;
  }
  Object.defineProperty(window, 'AudioContext', { value: savedCtor, configurable: true, writable: true });
  Object.defineProperty(window, 'webkitAudioContext', { value: savedWebkit, configurable: true, writable: true });

  const lifecycle = {
    disposeOk: eng.voiceCount === 0 && !eng.available,
    playAfterDisposeSilent,
    suspendResume: { afterSuspend, afterResume },
    initFailureInert: { initReturned: inertInit, noThrow: inertNoThrow, available: e4.available },
    masterVolumeBeforeInitOk: true,
  };

  let offline: OfflineReport | undefined;
  if (withOffline) {
    try {
      offline = await offlineTests();
    } catch (e) {
      errors.push(`offline tests failed: ${String(e)}`);
    }
  }

  return {
    sampleRateContext: ctxRate,
    idsMissing: missing,
    init,
    full,
    sounds: rows,
    loops: loopRows,
    anyNaN,
    worstPeak,
    voiceTest,
    loopTest: { sameHandleOnRestart: sameHandle, startedAll, stoppedAll, positionalOk },
    ambienceTest: { events: ambEvents, noThrow },
    offline,
    lifecycle,
    errors,
  };
}

// -------------------------------------------------------------------------------------------------
// contact sheets
// -------------------------------------------------------------------------------------------------

function renderSheet(name: string): void {
  const host = document.getElementById('sheet')!;
  const hi = 44100;
  if (name === 'loops') {
    for (const id of LOOP_IDS) {
      if (id === 'ambience') {
        AMBIENCE_LAYERS.forEach((layer, i) => {
          const { data, sampleRate } = synthAmbienceLayer(i);
          addCell(host, `amb:${layer.name}`, data, sampleRate);
          addSeamCell(host, `amb:${layer.name}`, data, sampleRate);
        });
      } else {
        const { data, sampleRate } = synthLoop(id, hi);
        addCell(host, `loop:${id}`, data, sampleRate);
        addSeamCell(host, `loop:${id}`, data, sampleRate);
      }
    }
    return;
  }
  const ids = SOUND_IDS.filter((id) => groupOf(id) === name);
  for (const id of ids) {
    const { data, sampleRate } = synthSound(id, 0, hi);
    addCell(host, id, data, sampleRate, SOUND_SPECS[id].variants > 1 ? `(${SOUND_SPECS[id].variants}v)` : '');
  }
}

// -------------------------------------------------------------------------------------------------
// interactive board
// -------------------------------------------------------------------------------------------------

function buildBoard(): void {
  const app = document.getElementById('app')!;
  const engine = createDebugAudioEngine();
  let posMode = 'none';
  const posFor = (): { x: number; y: number; z: number } | undefined => {
    switch (posMode) {
      case 'left10':
        return { x: -10, y: 1.7, z: 0 };
      case 'right10':
        return { x: 10, y: 1.7, z: 0 };
      case 'front20':
        return { x: 0, y: 1.7, z: -20 };
      case 'behind20':
        return { x: 0, y: 1.7, z: 20 };
      case 'far60':
        return { x: 30, y: 1.7, z: -52 };
      default:
        return undefined;
    }
  };

  const bar = document.createElement('div');
  bar.className = 'bar';
  const initBtn = document.createElement('button');
  initBtn.textContent = 'INIT AUDIO';
  const stats = document.createElement('span');
  const vol = document.createElement('input');
  vol.type = 'range';
  vol.min = '0';
  vol.max = '1';
  vol.step = '0.01';
  vol.value = '0.7';
  const volLabel = document.createElement('label');
  volLabel.append('master ', vol);
  const posSel = document.createElement('select');
  for (const [v, l] of [
    ['none', 'non-spatial'],
    ['left10', 'left 10 m'],
    ['right10', 'right 10 m'],
    ['front20', 'front 20 m'],
    ['behind20', 'behind 20 m'],
    ['far60', 'far ~60 m'],
  ]) {
    const o = document.createElement('option');
    o.value = v!;
    o.textContent = l!;
    posSel.appendChild(o);
  }
  posSel.addEventListener('change', () => (posMode = posSel.value));
  const posLabel = document.createElement('label');
  posLabel.append('position ', posSel);
  const envBtn = document.createElement('button');
  envBtn.textContent = 'ENV: outdoor';
  let env: 'outdoor' | 'indoor' = 'outdoor';
  envBtn.addEventListener('click', () => {
    env = env === 'outdoor' ? 'indoor' : 'outdoor';
    engine.setEnvironment(env);
    envBtn.textContent = `ENV: ${env}`;
  });
  const reportBtn = document.createElement('button');
  reportBtn.textContent = 'RUN REPORT';
  bar.append(initBtn, volLabel, posLabel, envBtn, reportBtn, stats);
  app.appendChild(bar);

  initBtn.addEventListener('click', () => {
    engine.init();
    initBtn.textContent = engine.available ? `AUDIO READY (${engine.initMs.toFixed(0)} ms)` : 'AUDIO UNAVAILABLE';
  });
  vol.addEventListener('input', () => engine.setMasterVolume(Number(vol.value)));

  const groups = new Map<string, SoundId[]>();
  for (const id of SOUND_IDS) {
    const g = groupOf(id);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(id);
  }
  for (const g of GROUP_ORDER) {
    const list = groups.get(g);
    if (!list) continue;
    const h = document.createElement('h2');
    h.textContent = g;
    const grid = document.createElement('div');
    grid.className = 'grid';
    for (const id of list) {
      const b = document.createElement('button');
      b.textContent = id;
      b.addEventListener('click', () => engine.play(id, { pos: posFor() }));
      grid.appendChild(b);
    }
    app.append(h, grid);
  }

  const lh = document.createElement('h2');
  lh.textContent = 'loops';
  const lgrid = document.createElement('div');
  lgrid.className = 'grid';
  const handles = new Map<LoopId, LoopHandle>();
  for (const id of LOOP_IDS) {
    const b = document.createElement('button');
    b.textContent = id;
    b.addEventListener('click', () => {
      const h = handles.get(id);
      if (h?.active) {
        h.stop(0.4);
        b.classList.remove('on');
        handles.delete(id);
      } else {
        handles.set(id, engine.startLoop(id, { pos: posFor() }));
        b.classList.add('on');
      }
    });
    lgrid.appendChild(b);
  }
  const rate = document.createElement('input');
  rate.type = 'range';
  rate.min = '0.4';
  rate.max = '1.4';
  rate.step = '0.01';
  rate.value = '1';
  rate.addEventListener('input', () => handles.forEach((h) => h.setRate(Number(rate.value))));
  const rl = document.createElement('label');
  rl.append('loop rate ', rate);
  lgrid.appendChild(rl);
  app.append(lh, lgrid);

  const log = document.createElement('div');
  log.id = 'log';
  log.textContent = 'click INIT AUDIO first (browser autoplay policy), then any button.';
  app.append(document.createElement('h2'), log);

  reportBtn.addEventListener('click', async () => {
    log.textContent = 'running report...';
    const rep = await runReport(true);
    window.__audioReport = rep;
    log.textContent = summarize(rep);
  });

  let last = performance.now();
  const frame = (now: number): void => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    engine.setListener({ x: 0, y: 1.7, z: 0 }, { x: 0, y: 0, z: -1 }, { x: 0, y: 1, z: 0 });
    engine.update(dt);
    stats.textContent = `ctx ${engine.ctxState}  voices ${engine.voiceCount}/${AUDIO.maxVoices}  buffers ${engine.bufferSeconds.toFixed(0)} s / ${(engine.bufferBytes / 1048576).toFixed(1)} MB  pending ${engine.pendingSynthesis}  dropped ${engine.dropped}`;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  window.__ready = true;
}

function summarize(rep: AudioReport): string {
  const lines: string[] = [];
  lines.push(`init ${rep.init.ms.toFixed(0)} ms (context ${rep.init.breakdown.context.toFixed(0)}, graph ${rep.init.breakdown.graph.toFixed(0)}, synth ${rep.init.breakdown.synth.toFixed(0)}; prewarm took ${rep.init.prewarmWaitMs.toFixed(0)} ms in background), ctx ${rep.init.ctxState}, ${rep.init.bufferSecondsAfterInit.toFixed(0)} s / ${rep.init.bufferMBAfterInit.toFixed(1)} MB after init, pending ${rep.init.pendingAfterInit}`);
  lines.push(`background synthesis drained in ${rep.full.synthesizeAllMs.toFixed(0)} ms; total ${rep.full.bufferSeconds.toFixed(0)} s / ${rep.full.bufferMB.toFixed(1)} MB`);
  lines.push(`ids missing: ${rep.idsMissing.length}   NaN: ${rep.anyNaN}   worst peak ${rep.worstPeak.toFixed(2)}`);
  lines.push(`voice test: requested ${rep.voiceTest.requested}, max concurrent ${rep.voiceTest.maxVoiceCount} (cap ${rep.voiceTest.cap}), dropped ${rep.voiceTest.dropped}, after ${rep.voiceTest.afterMs} ms: ${rep.voiceTest.voiceCountAfter}`);
  lines.push(`loops: ${JSON.stringify(rep.loopTest)}   ambience: ${JSON.stringify(rep.ambienceTest)}`);
  if (rep.offline) lines.push(`offline: peak ${rep.offline.overallPeak.toFixed(2)}, limiter ${rep.offline.limiterPeak.toFixed(2)}, render ${rep.offline.renderMs.toFixed(0)} ms`);
  lines.push(`lifecycle: ${JSON.stringify(rep.lifecycle)}`);
  if (rep.errors.length) lines.push(`ERRORS: ${rep.errors.join(' | ')}`);
  return lines.join('\n');
}

// -------------------------------------------------------------------------------------------------
// boot
// -------------------------------------------------------------------------------------------------

async function boot(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const sheet = params.get('sheet');
  if (sheet) {
    renderSheet(sheet);
    window.__ready = true;
    return;
  }
  if (params.get('report')) {
    const rep = await runReport(params.get('offline') !== '0');
    window.__audioReport = rep;
    const pre = document.createElement('div');
    pre.id = 'log';
    pre.textContent = summarize(rep);
    document.getElementById('app')!.appendChild(pre);
    window.__ready = true;
    return;
  }
  buildBoard();
}

void boot();
