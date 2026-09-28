/**
 * Audio contract: every sound the game plays, and the engine interface the game codes against.
 * The implementation lives in `engine.ts` (`createAudioEngine`). All sounds are synthesised procedurally;
 * there are no audio asset files.
 */
import type { Vec3Like } from '../types';

/** One-shot sounds. Each id may internally hold several randomised variants. */
export const SOUND_IDS = [
  // ---- weapons (spatial when `pos` given; player weapon sounds are played without pos) ----
  'rifle_shot', // punchy automatic carbine: sharp crack + body thump + short tail (~0.5s)
  'pistol_shot', // snappier, higher, less bass (~0.35s)
  'shotgun_shot', // huge low boom + wide noise blast + longer tail (~0.9s)
  'rifle_shot_up', // upgraded variants: same character plus an energetic crackle/whine layer
  'pistol_shot_up',
  'shotgun_shot_up',
  'dry_fire', // empty-magazine click
  'rifle_mag_out',
  'rifle_mag_in',
  'rifle_bolt', // charging handle / bolt release
  'pistol_mag_out',
  'pistol_mag_in',
  'pistol_slide',
  'shotgun_shell_in',
  'shotgun_pump',
  'weapon_draw', // generic switch foley
  'grenade_pin',
  'grenade_throw',
  'grenade_bounce', // metallic clink
  'grenade_explosion', // big boom with rumble and debris tail (~2s)
  'armor_plate', // velcro rip + plate slide + thunk (~2.2s, matches plate apply time)
  // ---- feedback (non-spatial UI-ish) ----
  'hit_body', // short tick
  'hit_head', // higher, sharper confirmation
  'kill_confirm', // subtle low-key confirmation
  // ---- impacts (spatial) ----
  'impact_concrete',
  'impact_metal',
  'impact_dirt',
  'impact_wood',
  'impact_flesh',
  'ricochet',
  // ---- player ----
  'step_concrete', // damp street step
  'step_metal',
  'step_dirt',
  'step_indoor',
  'jump',
  'land',
  'player_hurt',
  'player_death',
  'cough', // toxin damage
  // ---- zombies (spatial) ----
  'zombie_groan', // shambler idle/chase moan (several variants)
  'zombie_alert', // growl when noticing the player
  'zombie_snarl', // runner chase
  'zombie_screech', // runner alert
  'zombie_bellow', // armoured infected
  'warden_roar', // huge; also used for slam / charge windups
  'warden_slam', // heavy ground impact
  'zombie_attack', // whoosh + grunt on attack windup
  'zombie_claw_hit', // hit landing on the player
  'zombie_hurt',
  'zombie_death',
  // ---- world / interaction ----
  'pickup_ammo',
  'pickup_cash',
  'pickup_plate',
  'crate_open',
  'buy_ok',
  'buy_denied',
  'upgrade_ok',
  'station_open',
  'station_close',
  // ---- mission ----
  'contract_new', // objective stinger
  'contract_complete', // reward stinger
  'objective_ping', // small navigation ping
  'defense_start', // transmitter power-up
  'radio_chirp', // radio squelch beeps
  'flare_ignite',
  'countdown_tick',
  'countdown_final',
  'heli_land', // skids touching ground
  'boarding', // door slide + boots
  'victory_sting',
  'defeat_sting',
  // ---- hazard ----
  'siren_wail', // one-shot air-raid style wail (~5s)
  'klaxon', // short warning blare
  // ---- ambience one-shots ----
  'amb_thunder',
  'amb_creak',
  'amb_clang',
  'amb_gunfire_far',
  'amb_debris',
  // ---- UI ----
  'ui_click',
  'ui_hover',
  'ui_deploy',
  'ui_pause',
] as const;

export type SoundId = (typeof SOUND_IDS)[number];

/** Continuous sounds; controlled through a LoopHandle. */
export const LOOP_IDS = [
  'ambience', // wind bed + electrical hum + distant rumble, with random one-shot amb_* events scheduled internally
  'heli', // rotor thump + turbine whine; rate 0.5..1.2 controls spool, volume/pos control distance
  'flare', // flare hiss and crackle
  'gas', // toxic-zone hiss
  'siren', // low-level looping alarm siren
  'heartbeat', // low-health heartbeat
  'transmitter', // transmitter hum / data chatter while the defense contract runs
] as const;

export type LoopId = (typeof LOOP_IDS)[number];

export interface PlayOpts {
  /** World position; when given the sound is spatialised relative to the listener. */
  pos?: Vec3Like;
  /** 0..~1.5 loudness multiplier (default 1). */
  volume?: number;
  /** Playback-rate multiplier (default 1). Also shifts pitch. */
  rate?: number;
  /** 0 (ambient/cosmetic) .. 3 (critical). Higher priority survives voice-limiting. Default 1. */
  priority?: 0 | 1 | 2 | 3;
  /** Delay in seconds before playing. */
  delay?: number;
}

export interface LoopHandle {
  readonly active: boolean;
  /** Fade to `volume` over `fade` seconds. */
  setVolume(volume: number, fade?: number): void;
  setRate(rate: number): void;
  setPosition(pos: Vec3Like): void;
  stop(fade?: number): void;
}

export interface LoopOpts {
  volume?: number;
  rate?: number;
  pos?: Vec3Like;
  fadeIn?: number;
}

export interface AudioEngineApi {
  /** True after a successful `init()`. */
  readonly available: boolean;
  /** Create / resume the AudioContext. MUST be called inside a user gesture. Idempotent. Returns availability. */
  init(): boolean;
  /** Suspend / resume the context (pause menu, tab hidden). */
  suspend(): void;
  resume(): void;
  /** 0..1 master volume. */
  setMasterVolume(v: number): void;
  /** Call every frame with the camera transform. */
  setListener(pos: Vec3Like, forward: Vec3Like, up: Vec3Like): void;
  /** 'indoor' = short dense reverb + high-frequency damping of outdoor ambience; 'outdoor' = wide sparse tail. */
  setEnvironment(env: 'outdoor' | 'indoor'): void;
  play(id: SoundId, opts?: PlayOpts): void;
  /** Start a loop. Starting an already-running loop id returns its existing handle. */
  startLoop(id: LoopId, opts?: LoopOpts): LoopHandle;
  /** Per-frame bookkeeping (voice pruning, ambience event scheduler). */
  update(dt: number): void;
  /** Stop everything (restart / return to title). Keeps the context alive. */
  stopAll(): void;
  /** Number of currently sounding voices (for debugging / tests). */
  readonly voiceCount: number;
  dispose(): void;
}
