/**
 * Procedural audio engine.
 *
 * Graph:  voices -> [distance/behind low-pass -> PannerNode (spatial only)] -> bus (sfx | amb | ui) -> masterIn
 *                 \-> reverb send -> outdoor / indoor ConvolverNodes (synthetic impulse responses) -> masterIn
 *         masterIn -> DynamicsCompressor (soft limiter) -> master gain -> destination
 * The 'amb' bus passes through a low-pass that closes indoors; the 'ui' bus is dry and unaffected by environment.
 *
 * All sounds are synthesised from recipes in `./synth` into AudioBuffers: the "essential" set inside `init()` (a few hundred
 * ms), everything else progressively from `update()` under a small per-call time budget, or on demand if requested earlier.
 * Voices are capped (`AUDIO.maxVoices`) with priority-based eviction. Nothing allocates per frame in `update()`.
 */
import { AUDIO } from '../config';
import type { Vec3Like } from '../types';
import type { AudioEngineApi, LoopHandle, LoopId, LoopOpts, PlayOpts, SoundId } from './ids';
import { LOOP_IDS, SOUND_IDS } from './ids';
import { mulberry32 } from './synth/dsp';
import {
  AMBIENCE_LAYERS,
  type BusName,
  LOOP_SPECS,
  SOUND_SPECS,
  getRolloff,
  synthAmbienceLayer,
  synthLoop,
  synthSound,
} from './synth/registry';
import { getPrewarmed, getPrewarmedImpulse, layerKey, soundKey, startPrewarm, stopPrewarm } from './synth/prewarm';
import { INDOOR_IR, OUTDOOR_IR, makeImpulse } from './synth/reverb';

// -------------------------------------------------------------------------------------------------
// Public extras (tests / harness)
// -------------------------------------------------------------------------------------------------

export interface AudioEngineDebug extends AudioEngineApi {
  readonly ctxState: string;
  /** Wall time spent inside the last successful `init()` (ms). */
  readonly initMs: number;
  /** Where `init()` spent its time (ms): AudioContext creation, graph + reverb impulse responses, essential synthesis. */
  readonly initBreakdown: { context: number; graph: number; synth: number };
  /** Seconds and bytes of decoded audio held in buffers so far. */
  readonly bufferSeconds: number;
  readonly bufferBytes: number;
  /** Variant buffers still waiting for background synthesis. */
  readonly pendingSynthesis: number;
  readonly sampleRate: number;
  /** Synthesise everything immediately (tests). */
  synthesizeAll(): void;
  /** Sounds dropped by voice limiting / burst limiting since init. */
  readonly dropped: number;
}

export interface EngineOptions {
  /** Use an existing context (e.g. an OfflineAudioContext for deterministic rendering tests). */
  context?: BaseAudioContext;
  /** Override the voice cap (tests). */
  maxVoices?: number;
}

// -------------------------------------------------------------------------------------------------
// Internals
// -------------------------------------------------------------------------------------------------

interface Voice {
  active: boolean;
  token: number;
  priority: number;
  loudness: number;
  seq: number;
  end: number;
  gain: GainNode | null;
  src: AudioBufferSourceNode | null;
}

const BUS_GAIN: Record<BusName, number> = { sfx: 0.9, amb: 0.55, ui: 0.75 };
const OUTDOOR_WET = 1.15;
const INDOOR_WET = 1.25;

/** Order in which non-essential sounds are synthesised in the background (most likely needed first). */
const BACKGROUND_ORDER: SoundId[] = [
  'crate_open',
  'station_open',
  'station_close',
  'buy_ok',
  'buy_denied',
  'contract_new',
  'objective_ping',
  'radio_chirp',
  'zombie_screech',
  'zombie_bellow',
  'cough',
  'amb_creak',
  'amb_clang',
  'amb_debris',
  'amb_gunfire_far',
  'amb_thunder',
  'player_death',
  'upgrade_ok',
  'defense_start',
  'contract_complete',
  'warden_roar',
  'warden_slam',
  'flare_ignite',
  'countdown_tick',
  'countdown_final',
  'heli_land',
  'boarding',
  'siren_wail',
  'klaxon',
  'victory_sting',
  'defeat_sting',
];

const BACKGROUND_LOOPS: Exclude<LoopId, 'ambience'>[] = ['heartbeat', 'gas', 'transmitter', 'flare', 'heli', 'siren'];

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);

function setPannerPosition(p: PannerNode, x: number, y: number, z: number): void {
  if (p.positionX) {
    p.positionX.value = x;
    p.positionY.value = y;
    p.positionZ.value = z;
  } else {
    (p as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(x, y, z);
  }
}

function newPanner(ctx: BaseAudioContext, rolloff = 1): PannerNode {
  const p = ctx.createPanner();
  p.panningModel = 'equalpower';
  p.distanceModel = 'inverse';
  p.refDistance = AUDIO.refDistance;
  p.maxDistance = AUDIO.maxDistance;
  p.rolloffFactor = rolloff;
  return p;
}

// -------------------------------------------------------------------------------------------------
// Loop handle
// -------------------------------------------------------------------------------------------------

class LoopImpl implements LoopHandle {
  active = true;
  private panner: PannerNode | null = null;
  private lp: BiquadFilterNode | null = null;
  private volume: number;

  constructor(
    private readonly eng: Engine,
    readonly id: LoopId,
    private readonly ctx: BaseAudioContext,
    private readonly srcs: AudioBufferSourceNode[],
    private readonly gain: GainNode,
    private readonly tap: GainNode,
    private readonly dest: AudioNode,
    private readonly base: number,
    volume: number,
    readonly positional: boolean,
    private readonly extraNodes: AudioNode[],
  ) {
    this.volume = volume;
  }

  setVolume(volume: number, fade = 0.1): void {
    if (!this.active) return;
    this.volume = Math.max(0, volume);
    // no cancelScheduledValues: cancelling an active automation restores the pre-automation value (audible click)
    this.gain.gain.setTargetAtTime(this.volume * this.base, this.ctx.currentTime, Math.max(0.004, fade / 3));
  }

  setRate(rate: number): void {
    if (!this.active) return;
    const now = this.ctx.currentTime;
    for (const s of this.srcs) s.playbackRate.setTargetAtTime(Math.max(0.05, rate), now, 0.05);
  }

  setPosition(pos: Vec3Like): void {
    if (!this.active) return;
    if (!this.panner) this.insertPanner();
    if (this.panner) {
      setPannerPosition(this.panner, pos.x, pos.y, pos.z);
      if (this.lp) {
        const d = this.eng.distanceTo(pos);
        this.lp.frequency.setTargetAtTime(clamp(20000 / (1 + d / 40), 1800, 20000), this.ctx.currentTime, 0.08);
      }
    }
  }

  /** Called by the engine when creating a positional loop with an initial position. */
  insertPanner(): void {
    if (this.panner) return;
    const p = newPanner(this.ctx);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 20000;
    lp.Q.value = 0.5;
    try {
      this.tap.disconnect(this.dest);
    } catch {
      /* not connected */
    }
    this.tap.connect(lp);
    lp.connect(p);
    p.connect(this.dest);
    this.panner = p;
    this.lp = lp;
  }

  stop(fade = 0.25): void {
    if (!this.active) return;
    this.active = false;
    const now = this.ctx.currentTime;
    this.gain.gain.setTargetAtTime(0, now, Math.max(0.004, fade / 3));
    const stopAt = now + fade + 0.15;
    for (const s of this.srcs) {
      try {
        s.stop(stopAt);
      } catch {
        /* already stopped */
      }
    }
    const first = this.srcs[0];
    const nodes = [this.gain, this.tap, this.panner, this.lp, ...this.extraNodes];
    if (first) {
      first.onended = () => {
        for (const n of nodes) {
          try {
            n?.disconnect();
          } catch {
            /* ignore */
          }
        }
      };
    }
    this.eng.loopStopped(this.id);
  }
}

// -------------------------------------------------------------------------------------------------
// Engine
// -------------------------------------------------------------------------------------------------

class Engine implements AudioEngineDebug {
  private ctx: BaseAudioContext | null = null;
  private readonly external: BaseAudioContext | null;
  private readonly maxVoices: number;
  private ready = false;
  private failed = false;
  private disposed = false;
  private hiRate = 44100;
  private masterVol = AUDIO_DEFAULT_MASTER;
  private env: 'outdoor' | 'indoor' = 'outdoor';

  // graph
  private masterIn: GainNode | null = null;
  private comp: DynamicsCompressorNode | null = null;
  private master: GainNode | null = null;
  private buses: Partial<Record<BusName, GainNode>> = {};
  private ambFilter: BiquadFilterNode | null = null;
  private reverbIn: GainNode | null = null;
  private retOut: GainNode | null = null;
  private retIn: GainNode | null = null;

  // buffers
  private readonly sounds = new Map<SoundId, (AudioBuffer | null)[]>();
  private readonly loopBufs = new Map<string, AudioBuffer>();
  private readonly lastVariant = new Map<SoundId, number>();
  private readonly pending: { id: SoundId; v: number }[] = [];
  private readonly pendingLoops: Exclude<LoopId, 'ambience'>[] = [];
  private readonly idIndex = new Map<SoundId, number>();
  private readonly lastStartTime: Float64Array;
  private readonly burstCount: Uint8Array;

  // voices and loops
  private readonly voices: Voice[] = [];
  private readonly loops = new Map<LoopId, LoopImpl>();
  private tokenCounter = 0;
  private seq = 0;

  // listener
  private lx = 0;
  private ly = 0;
  private lz = 0;
  private fx = 0;
  private fz = -1;

  // ambience scheduler
  private ambTimer = 6;
  private windTimer = 3;
  private windGain: GainNode | null = null;
  private windBase = 0.85;
  private lastAmb = '';
  private readonly ambPos: Vec3Like = { x: 0, y: 0, z: 0 };

  private readonly rand = mulberry32((Math.random() * 4294967296) >>> 0);

  initMs = 0;
  initBreakdown = { context: 0, graph: 0, synth: 0 };
  bufferSeconds = 0;
  bufferBytes = 0;
  dropped = 0;

  constructor(opts: EngineOptions = {}) {
    this.external = opts.context ?? null;
    this.maxVoices = opts.maxVoices ?? AUDIO.maxVoices;
    for (let i = 0; i < this.maxVoices; i++) {
      this.voices.push({ active: false, token: 0, priority: 0, loudness: 0, seq: 0, end: 0, gain: null, src: null });
    }
    SOUND_IDS.forEach((id, i) => this.idIndex.set(id, i));
    this.lastStartTime = new Float64Array(SOUND_IDS.length).fill(-1);
    this.burstCount = new Uint8Array(SOUND_IDS.length);
    // Pure-JS synthesis of the essential sounds needs no AudioContext (and so no user gesture): begin it right away in
    // short time slices so `init()` inside the Deploy click only has to copy buffers.
    if (!this.external && typeof window !== 'undefined') startPrewarm();
  }

  // ---- state ----

  get available(): boolean {
    return this.ready && !this.failed && !this.disposed;
  }

  get ctxState(): string {
    return this.ctx ? this.ctx.state : 'none';
  }

  get sampleRate(): number {
    return this.ctx ? this.ctx.sampleRate : 0;
  }

  get pendingSynthesis(): number {
    return this.pending.length + this.pendingLoops.length;
  }

  get voiceCount(): number {
    let n = 0;
    for (const v of this.voices) if (v.active) n++;
    for (const l of this.loops.values()) if (l.active) n++;
    return n;
  }

  // ---- lifecycle ----

  init(): boolean {
    if (this.disposed || this.failed) return false;
    if (this.ready && this.ctx) {
      this.resume();
      return true;
    }
    const t0 = performance.now();
    try {
      let ctx = this.external;
      if (!ctx) {
        const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
        const Ctor = w.AudioContext ?? w.webkitAudioContext;
        if (!Ctor) {
          this.failed = true;
          return false;
        }
        ctx = new Ctor();
      }
      this.ctx = ctx;
      const tCtx = performance.now();
      this.hiRate = Math.min(48000, Math.max(22050, ctx.sampleRate));
      this.buildGraph(ctx);
      this.queueSynthesis();
      this.ready = true;
      const tGraph = performance.now();
      this.synthEssentials();
      const tSynth = performance.now();
      this.initMs = tSynth - t0;
      this.initBreakdown = { context: tCtx - t0, graph: tGraph - tCtx, synth: tSynth - tGraph };
      stopPrewarm(); // everything essential is now inside AudioBuffers
      this.resume();
      return true;
    } catch (err) {
      console.warn('[audio] initialisation failed; running silent:', err);
      this.failed = true;
      this.ready = false;
      this.teardown();
      return false;
    }
  }

  suspend(): void {
    const ctx = this.ctx as AudioContext | null;
    if (!ctx || typeof ctx.suspend !== 'function' || this.external) return;
    if (ctx.state === 'running') void ctx.suspend().catch(() => undefined);
  }

  resume(): void {
    const ctx = this.ctx as AudioContext | null;
    if (!ctx || typeof ctx.resume !== 'function' || this.external) return;
    if (ctx.state !== 'running') void ctx.resume().catch(() => undefined);
  }

  setMasterVolume(v: number): void {
    this.masterVol = clamp(Number.isFinite(v) ? v : 0, 0, 1);
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.masterVol, this.ctx.currentTime, 0.02);
  }

  setListener(pos: Vec3Like, forward: Vec3Like, up: Vec3Like): void {
    this.lx = pos.x;
    this.ly = pos.y;
    this.lz = pos.z;
    const fl = Math.hypot(forward.x, forward.z);
    if (fl > 1e-4) {
      this.fx = forward.x / fl;
      this.fz = forward.z / fl;
    }
    const ctx = this.ctx;
    if (!ctx || !this.ready) return;
    const l = ctx.listener;
    if (l.positionX) {
      l.positionX.value = pos.x;
      l.positionY.value = pos.y;
      l.positionZ.value = pos.z;
      l.forwardX.value = forward.x;
      l.forwardY.value = forward.y;
      l.forwardZ.value = forward.z;
      l.upX.value = up.x;
      l.upY.value = up.y;
      l.upZ.value = up.z;
    } else {
      const legacy = l as unknown as {
        setPosition(x: number, y: number, z: number): void;
        setOrientation(x: number, y: number, z: number, ux: number, uy: number, uz: number): void;
      };
      legacy.setPosition(pos.x, pos.y, pos.z);
      legacy.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
    }
  }

  setEnvironment(env: 'outdoor' | 'indoor'): void {
    this.env = env;
    const ctx = this.ctx;
    if (!ctx || !this.ready || !this.retOut || !this.retIn || !this.ambFilter) return;
    const now = ctx.currentTime;
    const indoor = env === 'indoor';
    this.retOut.gain.setTargetAtTime(indoor ? 0 : OUTDOOR_WET, now, 0.25);
    this.retIn.gain.setTargetAtTime(indoor ? INDOOR_WET : 0, now, 0.15);
    this.ambFilter.frequency.setTargetAtTime(indoor ? 1100 : 18000, now, 0.3);
  }

  // ---- graph ----

  private buildGraph(ctx: BaseAudioContext): void {
    const masterIn = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -8;
    comp.knee.value = 10;
    comp.ratio.value = 12;
    comp.attack.value = 0.002;
    comp.release.value = 0.12;
    const master = ctx.createGain();
    master.gain.value = this.masterVol;
    masterIn.connect(comp);
    comp.connect(master);
    master.connect(ctx.destination);
    this.masterIn = masterIn;
    this.comp = comp;
    this.master = master;

    for (const name of ['sfx', 'amb', 'ui'] as BusName[]) {
      const g = ctx.createGain();
      g.gain.value = BUS_GAIN[name];
      this.buses[name] = g;
    }
    this.buses.sfx!.connect(masterIn);
    this.buses.ui!.connect(masterIn);
    const ambFilter = ctx.createBiquadFilter();
    ambFilter.type = 'lowpass';
    ambFilter.frequency.value = 18000;
    ambFilter.Q.value = 0.5;
    this.buses.amb!.connect(ambFilter);
    ambFilter.connect(masterIn);
    this.ambFilter = ambFilter;

    // reverb: one send bus feeding two convolvers; the environment crossfades their returns
    const reverbIn = ctx.createGain();
    const mk = (spec: typeof OUTDOOR_IR, name: 'outdoor' | 'indoor'): ConvolverNode => {
      const cached = getPrewarmedImpulse(name, ctx.sampleRate);
      const [l, r] = cached ? [cached.left, cached.right] : makeImpulse(ctx.sampleRate, spec);
      const buf = ctx.createBuffer(2, l.length, ctx.sampleRate);
      buf.copyToChannel(l as Float32Array<ArrayBuffer>, 0);
      buf.copyToChannel(r as Float32Array<ArrayBuffer>, 1);
      const conv = ctx.createConvolver();
      conv.buffer = buf;
      return conv;
    };
    const outConv = mk(OUTDOOR_IR, 'outdoor');
    const inConv = mk(INDOOR_IR, 'indoor');
    const retOut = ctx.createGain();
    const retIn = ctx.createGain();
    retOut.gain.value = this.env === 'outdoor' ? OUTDOOR_WET : 0;
    retIn.gain.value = this.env === 'indoor' ? INDOOR_WET : 0;
    reverbIn.connect(outConv);
    reverbIn.connect(inConv);
    outConv.connect(retOut);
    inConv.connect(retIn);
    retOut.connect(masterIn);
    retIn.connect(masterIn);
    this.reverbIn = reverbIn;
    this.retOut = retOut;
    this.retIn = retIn;
    this.ambFilter.frequency.value = this.env === 'indoor' ? 1100 : 18000;
  }

  private teardown(): void {
    for (const l of this.loops.values()) l.stop(0.01);
    this.loops.clear();
    const nodes: (AudioNode | null)[] = [
      this.masterIn,
      this.comp,
      this.master,
      this.ambFilter,
      this.reverbIn,
      this.retOut,
      this.retIn,
      ...Object.values(this.buses),
    ];
    for (const n of nodes) {
      try {
        n?.disconnect();
      } catch {
        /* ignore */
      }
    }
    if (this.ctx && !this.external) {
      const c = this.ctx as AudioContext;
      if (typeof c.close === 'function' && c.state !== 'closed') void c.close().catch(() => undefined);
    }
    this.ctx = null;
    this.masterIn = this.comp = this.master = this.ambFilter = this.reverbIn = this.retOut = this.retIn = null;
    this.buses = {};
  }

  // ---- synthesis ----

  private queueSynthesis(): void {
    for (const id of SOUND_IDS) this.sounds.set(id, new Array<AudioBuffer | null>(SOUND_SPECS[id].variants).fill(null));
    for (const id of BACKGROUND_ORDER) {
      const spec = SOUND_SPECS[id];
      if (spec.essential) continue;
      for (let v = 0; v < spec.variants; v++) this.pending.push({ id, v });
    }
    // anything non-essential that was not listed explicitly
    for (const id of SOUND_IDS) {
      const spec = SOUND_SPECS[id];
      if (spec.essential || BACKGROUND_ORDER.includes(id)) continue;
      for (let v = 0; v < spec.variants; v++) this.pending.push({ id, v });
    }
    this.pendingLoops.push(...BACKGROUND_LOOPS);
  }

  private synthEssentials(): void {
    for (const id of SOUND_IDS) {
      const spec = SOUND_SPECS[id];
      if (!spec.essential) continue;
      for (let v = 0; v < spec.variants; v++) this.ensureVariant(id, v);
    }
    // ambience bed is needed the moment the mission starts
    for (let i = 0; i < AMBIENCE_LAYERS.length; i++) this.ensureAmbienceLayer(i);
  }

  private makeBuffer(data: Float32Array, sampleRate: number): AudioBuffer {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, data.length, sampleRate);
    buf.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
    this.bufferSeconds += data.length / sampleRate;
    this.bufferBytes += data.length * 4;
    return buf;
  }

  private ensureVariant(id: SoundId, v: number): AudioBuffer | null {
    const arr = this.sounds.get(id);
    if (!arr || !this.ctx) return null;
    if (arr[v]) return arr[v]!;
    const cached = getPrewarmed(soundKey(id, v));
    const { data, sampleRate } = cached ?? synthSound(id, v, this.hiRate);
    const buf = this.makeBuffer(data, sampleRate);
    arr[v] = buf;
    return buf;
  }

  private ensureLoop(id: Exclude<LoopId, 'ambience'>): AudioBuffer | null {
    const key = `loop:${id}`;
    const have = this.loopBufs.get(key);
    if (have) return have;
    if (!this.ctx) return null;
    const { data, sampleRate } = synthLoop(id, this.hiRate);
    const buf = this.makeBuffer(data, sampleRate);
    this.loopBufs.set(key, buf);
    return buf;
  }

  private ensureAmbienceLayer(i: number): AudioBuffer | null {
    const key = `amb:${i}`;
    const have = this.loopBufs.get(key);
    if (have) return have;
    if (!this.ctx) return null;
    const cached = getPrewarmed(layerKey(i));
    const { data, sampleRate } = cached ?? synthAmbienceLayer(i);
    const buf = this.makeBuffer(data, sampleRate);
    this.loopBufs.set(key, buf);
    return buf;
  }

  synthesizeAll(): void {
    if (!this.ready) return;
    for (const id of SOUND_IDS) for (let v = 0; v < SOUND_SPECS[id].variants; v++) this.ensureVariant(id, v);
    for (const id of LOOP_IDS) if (id !== 'ambience') this.ensureLoop(id);
    for (let i = 0; i < AMBIENCE_LAYERS.length; i++) this.ensureAmbienceLayer(i);
    this.pending.length = 0;
    this.pendingLoops.length = 0;
  }

  // ---- playback ----

  distanceTo(pos: Vec3Like): number {
    return Math.hypot(pos.x - this.lx, pos.y - this.ly, pos.z - this.lz);
  }

  play(id: SoundId, opts: PlayOpts = {}): void {
    if (!this.ready || !this.ctx || this.failed) return;
    try {
      this.playInner(this.ctx, id, opts);
    } catch (err) {
      // never let audio break the game loop
      if (import.meta.env.DEV) console.warn('[audio] play failed', id, err);
    }
  }

  private pickVariant(id: SoundId): AudioBuffer | null {
    const arr = this.sounds.get(id);
    if (!arr) return null;
    let have = 0;
    for (let i = 0; i < arr.length; i++) if (arr[i]) have++;
    if (have === 0) return this.ensureVariant(id, 0);
    const last = this.lastVariant.get(id) ?? -1;
    let choice = -1;
    let pick = Math.floor(this.rand() * have);
    if (have > 1 && this.nthAvailable(arr, pick) === last) pick = (pick + 1 + Math.floor(this.rand() * (have - 1))) % have;
    choice = this.nthAvailable(arr, pick);
    this.lastVariant.set(id, choice);
    return arr[choice] ?? null;
  }

  private nthAvailable(arr: (AudioBuffer | null)[], n: number): number {
    let k = 0;
    for (let i = 0; i < arr.length; i++) {
      if (arr[i]) {
        if (k === n) return i;
        k++;
      }
    }
    return 0;
  }

  private acquireVoice(priority: number, loudness: number): Voice | null {
    let used = 0;
    let free: Voice | null = null;
    let loops = 0;
    for (const l of this.loops.values()) if (l.active) loops++;
    const cap = Math.max(1, this.maxVoices - loops);
    for (const v of this.voices) {
      if (v.active) used++;
      else if (!free) free = v;
    }
    if (priority === 0 && used >= cap * 0.75) return null;
    if (used < cap && free) return free;
    // full: evict the least important voice (lowest priority, then quietest, then oldest)
    let worst: Voice | null = null;
    for (const v of this.voices) {
      if (!v.active) continue;
      if (
        !worst ||
        v.priority < worst.priority ||
        (v.priority === worst.priority && (v.loudness < worst.loudness || (v.loudness === worst.loudness && v.seq < worst.seq)))
      ) {
        worst = v;
      }
    }
    if (!worst) return free;
    if (worst.priority > priority) return null;
    if (worst.priority === priority && worst.loudness > loudness * 1.6) return null;
    this.killVoice(worst);
    return worst;
  }

  private killVoice(v: Voice): void {
    const ctx = this.ctx;
    if (ctx && v.gain && v.src) {
      const now = ctx.currentTime;
      try {
        v.gain.gain.setTargetAtTime(0, now, 0.006);
        v.src.stop(now + 0.05);
      } catch {
        /* already ended */
      }
    }
    v.active = false;
    v.token = ++this.tokenCounter;
  }

  private playInner(ctx: BaseAudioContext, id: SoundId, opts: PlayOpts): void {
    const spec = SOUND_SPECS[id];
    const idx = this.idIndex.get(id)!;
    const now = ctx.currentTime;
    const when = now + Math.max(0, opts.delay ?? 0);
    const pos = opts.pos;
    let dist = 0;
    if (pos) {
      dist = this.distanceTo(pos);
      if (dist > AUDIO.maxDistance * 1.25) {
        this.dropped++;
        return;
      }
    }
    const priority = opts.priority ?? spec.priority;
    // burst limiter: identical low-priority sounds started within 30 ms pile up into phasey mush
    if (priority <= 1) {
      if (when - this.lastStartTime[idx]! < 0.03) {
        if (this.burstCount[idx]! >= 3) {
          this.dropped++;
          return;
        }
        this.burstCount[idx] = this.burstCount[idx]! + 1;
      } else {
        this.burstCount[idx] = 1;
      }
      this.lastStartTime[idx] = when;
    }
    const buf = this.pickVariant(id);
    if (!buf) return;
    const volume = (opts.volume ?? 1) * (1 + (this.rand() * 2 - 1) * spec.gainJitter);
    if (volume <= 0.002) return;
    const rolloff = getRolloff(id);
    const atten = dist > AUDIO.refDistance ? AUDIO.refDistance / (AUDIO.refDistance + rolloff * (Math.min(dist, AUDIO.maxDistance) - AUDIO.refDistance)) : 1;
    const loudness = volume * atten;
    const voice = this.acquireVoice(priority, loudness);
    if (!voice) {
      this.dropped++;
      return;
    }
    const rate = (opts.rate ?? 1) * (1 + (this.rand() * 2 - 1) * spec.pitchJitter);
    const bus = this.buses[spec.bus]!;

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    src.connect(gain);
    const nodes: AudioNode[] = [src, gain];

    let tail: AudioNode = gain;
    if (pos) {
      if (dist > 2) {
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        const dx = (pos.x - this.lx) / Math.max(0.001, dist);
        const dz = (pos.z - this.lz) / Math.max(0.001, dist);
        const behind = Math.max(0, -(this.fx * dx + this.fz * dz));
        lp.frequency.value = clamp((20000 / (1 + dist / 32)) * (1 - 0.5 * behind), 1200, 20000);
        lp.Q.value = 0.5;
        gain.connect(lp);
        tail = lp;
        nodes.push(lp);
      }
      const panner = newPanner(ctx, rolloff);
      setPannerPosition(panner, pos.x, pos.y, pos.z);
      tail.connect(panner);
      panner.connect(bus);
      nodes.push(panner);
    } else {
      tail.connect(bus);
    }
    if (spec.reverb > 0 && this.reverbIn) {
      const send = ctx.createGain();
      // wetter with distance, but the absolute level still falls (the send is tapped before the panner's distance gain)
      send.gain.value = spec.reverb * (0.7 + Math.min(dist, 70) / 70) * Math.min(1, volume) * Math.pow(atten, 0.55);
      tail.connect(send);
      send.connect(this.reverbIn);
      nodes.push(send);
    }

    const token = ++this.tokenCounter;
    voice.active = true;
    voice.token = token;
    voice.priority = priority;
    voice.loudness = loudness;
    voice.seq = ++this.seq;
    voice.end = when + buf.duration / Math.max(0.1, rate);
    voice.gain = gain;
    voice.src = src;
    src.onended = () => {
      if (voice.token === token) voice.active = false;
      for (const n of nodes) {
        try {
          n.disconnect();
        } catch {
          /* ignore */
        }
      }
    };
    src.start(when);
  }

  // ---- loops ----

  startLoop(id: LoopId, opts: LoopOpts = {}): LoopHandle {
    const existing = this.loops.get(id);
    if (existing?.active) return existing;
    const ctx = this.ctx;
    if (!ctx || !this.ready) return NULL_LOOP;
    try {
      return this.startLoopInner(ctx, id, opts);
    } catch (err) {
      if (import.meta.env.DEV) console.warn('[audio] startLoop failed', id, err);
      return NULL_LOOP;
    }
  }

  private startLoopInner(ctx: BaseAudioContext, id: LoopId, opts: LoopOpts): LoopHandle {
    const now = ctx.currentTime;
    const volume = opts.volume ?? 1;
    const rate = opts.rate ?? 1;
    const fadeIn = opts.fadeIn ?? (id === 'ambience' ? 1.5 : 0.08);
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const tap = ctx.createGain();
    gain.connect(tap);
    const srcs: AudioBufferSourceNode[] = [];
    const extra: AudioNode[] = [];
    let base = 1;
    let bus: BusName = 'sfx';
    let reverb = 0;
    let positional = false;

    const addSource = (buf: AudioBuffer, layerGain: number): void => {
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      s.playbackRate.value = rate;
      if (layerGain === 1) {
        s.connect(gain);
      } else {
        const g = ctx.createGain();
        g.gain.value = layerGain;
        s.connect(g);
        g.connect(gain);
        extra.push(g);
        if (buf === this.loopBufs.get('amb:0')) this.windGain = g;
      }
      srcs.push(s);
    };

    if (id === 'ambience') {
      bus = 'amb';
      AMBIENCE_LAYERS.forEach((layer, i) => {
        const buf = this.ensureAmbienceLayer(i)!;
        addSource(buf, layer.gain);
      });
      this.windBase = AMBIENCE_LAYERS[0].gain;
      this.ambTimer = 5 + this.rand() * 8;
      this.windTimer = 2;
    } else {
      const spec = LOOP_SPECS[id];
      bus = spec.bus;
      base = spec.gain;
      reverb = spec.reverb;
      positional = spec.positional;
      addSource(this.ensureLoop(id)!, 1);
    }

    const dest = this.buses[bus]!;
    tap.connect(dest);
    if (reverb > 0 && this.reverbIn) {
      const send = ctx.createGain();
      send.gain.value = reverb;
      tap.connect(send);
      send.connect(this.reverbIn);
      extra.push(send);
    }
    const loop = new LoopImpl(this, id, ctx, srcs, gain, tap, dest, base, volume, positional, extra);
    if (opts.pos && positional) {
      loop.insertPanner();
      loop.setPosition(opts.pos);
    }
    for (const s of srcs) {
      const buf = s.buffer!;
      s.start(now, this.rand() * buf.duration);
    }
    gain.gain.setTargetAtTime(volume * base, now, Math.max(0.01, fadeIn / 3));
    this.loops.set(id, loop);
    return loop;
  }

  /** Called by a loop when it stops. */
  loopStopped(id: LoopId): void {
    this.loops.delete(id);
    if (id === 'ambience') this.windGain = null;
  }

  // ---- per-frame ----

  update(dt: number): void {
    if (!this.ready || !this.ctx) return;
    const ctx = this.ctx;
    // background synthesis under a small time budget
    if (this.pending.length > 0 || this.pendingLoops.length > 0) {
      const t0 = performance.now();
      do {
        const job = this.pending.shift();
        if (job) {
          this.ensureVariant(job.id, job.v);
        } else {
          const loop = this.pendingLoops.shift();
          if (loop) this.ensureLoop(loop);
        }
      } while ((this.pending.length > 0 || this.pendingLoops.length > 0) && performance.now() - t0 < 2.5);
    }
    // prune voices whose 'ended' event was missed (suspended context etc.)
    const now = ctx.currentTime;
    for (const v of this.voices) if (v.active && now > v.end + 0.5) v.active = false;

    // ambience: wind gusts and random one-shot events
    const amb = this.loops.get('ambience');
    if (amb?.active) {
      this.windTimer -= dt;
      if (this.windTimer <= 0 && this.windGain) {
        this.windTimer = 3 + this.rand() * 5;
        this.windGain.gain.setTargetAtTime(this.windBase * (0.55 + this.rand() * 0.9), now, 1.6);
      }
      this.ambTimer -= dt;
      if (this.ambTimer <= 0) {
        this.ambTimer = 6 + this.rand() * 19;
        this.fireAmbientEvent();
      }
    }
  }

  private fireAmbientEvent(): void {
    const table: { id: SoundId; w: number; d0: number; d1: number; vol: number }[] = [
      { id: 'amb_thunder', w: 0.12, d0: 0, d1: 0, vol: 0.85 },
      { id: 'amb_creak', w: 0.26, d0: 12, d1: 40, vol: 0.9 },
      { id: 'amb_clang', w: 0.18, d0: 25, d1: 70, vol: 0.9 },
      { id: 'amb_gunfire_far', w: 0.22, d0: 55, d1: 85, vol: 1 },
      { id: 'amb_debris', w: 0.22, d0: 14, d1: 50, vol: 0.9 },
    ];
    let pick = table[0]!;
    for (let tries = 0; tries < 3; tries++) {
      let r = this.rand();
      for (const e of table) {
        r -= e.w;
        if (r <= 0) {
          pick = e;
          break;
        }
      }
      if (pick.id !== this.lastAmb) break;
    }
    this.lastAmb = pick.id;
    if (pick.d1 === 0) {
      this.play(pick.id, { volume: pick.vol });
      return;
    }
    const az = this.rand() * Math.PI * 2;
    const d = pick.d0 + this.rand() * (pick.d1 - pick.d0);
    this.ambPos.x = this.lx + Math.cos(az) * d;
    this.ambPos.y = this.ly;
    this.ambPos.z = this.lz + Math.sin(az) * d;
    this.play(pick.id, { pos: this.ambPos, volume: pick.vol });
  }

  stopAll(): void {
    const ctx = this.ctx;
    for (const v of this.voices) if (v.active) this.killVoice(v);
    for (const l of Array.from(this.loops.values())) l.stop(0.05);
    this.loops.clear();
    this.windGain = null;
    void ctx;
  }

  dispose(): void {
    if (this.disposed) return;
    stopPrewarm();
    this.stopAll();
    this.disposed = true;
    this.ready = false;
    this.teardown();
    this.sounds.clear();
    this.loopBufs.clear();
    this.pending.length = 0;
    this.pendingLoops.length = 0;
  }
}

const AUDIO_DEFAULT_MASTER = 0.7;

const NULL_LOOP: LoopHandle = {
  active: false,
  setVolume() {},
  setRate() {},
  setPosition() {},
  stop() {},
};

/** Engine bound to a specific context (e.g. an OfflineAudioContext for tests). Exposes debug statistics. */
export function createAudioEngineOn(opts: EngineOptions): AudioEngineDebug {
  return new Engine(opts);
}

/** Debug-capable engine on a normal AudioContext (created inside `init()`, which must run in a user gesture). */
export function createDebugAudioEngine(): AudioEngineDebug {
  return new Engine();
}

/** The game's entry point. */
export function createAudioEngine(): AudioEngineApi {
  return new Engine();
}
