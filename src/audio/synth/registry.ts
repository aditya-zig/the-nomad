/**
 * Sound registry: maps every `SoundId` / `LoopId` in the audio contract to its synthesis recipe plus playback metadata
 * (variant count, sample-rate class, default priority, bus, jitter, reverb send).
 * `Record<SoundId, ...>` makes the compiler prove that every contract id has a recipe.
 */
import type { LoopId, SoundId } from '../ids';
import { type Ctx, mulberry32, seedFor } from './dsp';
import {
  ambClang,
  ambCreak,
  ambDebris,
  ambGunfireFar,
  ambHum,
  ambRumble,
  ambThunder,
  ambWind,
  loopFlare,
  loopGas,
  loopHeartbeat,
  loopHeli,
  loopSiren,
  loopTransmitter,
} from './ambience';
import {
  cough,
  playerDeath,
  playerHurt,
  playerJump,
  playerLand,
  wardenRoar,
  wardenSlam,
  zombieAlert,
  zombieAttack,
  zombieBellow,
  zombieClawHit,
  zombieDeath,
  zombieGroan,
  zombieHurt,
  zombieScreech,
  zombieSnarl,
} from './creatures';
import {
  boarding,
  contractComplete,
  contractNew,
  countdownFinal,
  countdownTick,
  defeatSting,
  defenseStart,
  flareIgnite,
  heliLand,
  klaxon,
  objectivePing,
  radioChirp,
  sirenWail,
  victorySting,
} from './mission';
import {
  armorPlate,
  dryFire,
  grenadeBounce,
  grenadeExplosion,
  grenadePin,
  grenadeThrow,
  gunshot,
  pistolMagIn,
  pistolMagOut,
  pistolSlide,
  rifleBolt,
  rifleMagIn,
  rifleMagOut,
  shotgunPump,
  shotgunShellIn,
  weaponDraw,
} from './weapons';
import {
  buyDenied,
  buyOk,
  crateOpen,
  hitBody,
  hitHead,
  impactConcrete,
  impactDirt,
  impactFlesh,
  impactMetal,
  impactWood,
  killConfirm,
  pickupAmmo,
  pickupCash,
  pickupPlate,
  ricochet,
  stationClose,
  stationOpen,
  stepConcrete,
  stepDirt,
  stepIndoor,
  stepMetal,
  uiClick,
  uiDeploy,
  uiHover,
  uiPause,
  upgradeOk,
} from './world';

/** Sample-rate class: hi = context rate (max 48 kHz), mid = 32 kHz, lo = 22.05 kHz, xlo = 11.025 kHz. */
export type RateClass = 'hi' | 'mid' | 'lo' | 'xlo';

export function resolveRate(cls: RateClass, hiRate: number): number {
  switch (cls) {
    case 'hi':
      return hiRate;
    case 'mid':
      return Math.min(hiRate, 32000);
    case 'lo':
      return Math.min(hiRate, 22050);
    default:
      return 11025;
  }
}

export type BusName = 'sfx' | 'amb' | 'ui';

export interface SoundSpec {
  variants: number;
  rate: RateClass;
  /** Default voice priority 0..3 (callers may override). */
  priority: 0 | 1 | 2 | 3;
  bus: BusName;
  /** +- fractional playback-rate jitter and gain jitter. */
  pitchJitter: number;
  gainJitter: number;
  /** Reverb send level (0 = dry). Spatial voices get more wet with distance. */
  reverb: number;
  /** Synthesised during init() (true) or in the background / on demand (false). */
  essential: boolean;
  gen: (c: Ctx) => Float32Array;
}

const S = (
  variants: number,
  rate: RateClass,
  priority: 0 | 1 | 2 | 3,
  bus: BusName,
  pitchJitter: number,
  gainJitter: number,
  reverb: number,
  essential: boolean,
  gen: (c: Ctx) => Float32Array,
): SoundSpec => ({ variants, rate, priority, bus, pitchJitter, gainJitter, reverb, essential, gen });

export const SOUND_SPECS: Record<SoundId, SoundSpec> = {
  // ---- weapons ----
  rifle_shot: S(3, 'hi', 3, 'sfx', 0.02, 0.05, 0.3, true, (c) => gunshot(c, 'rifle', false)),
  pistol_shot: S(3, 'hi', 3, 'sfx', 0.02, 0.05, 0.3, true, (c) => gunshot(c, 'pistol', false)),
  shotgun_shot: S(3, 'hi', 3, 'sfx', 0.02, 0.04, 0.32, true, (c) => gunshot(c, 'shotgun', false)),
  rifle_shot_up: S(2, 'hi', 3, 'sfx', 0.02, 0.05, 0.3, true, (c) => gunshot(c, 'rifle', true)),
  pistol_shot_up: S(2, 'hi', 3, 'sfx', 0.02, 0.05, 0.3, true, (c) => gunshot(c, 'pistol', true)),
  shotgun_shot_up: S(2, 'hi', 3, 'sfx', 0.02, 0.04, 0.32, true, (c) => gunshot(c, 'shotgun', true)),
  dry_fire: S(2, 'mid', 3, 'sfx', 0.03, 0.05, 0.1, true, dryFire),
  rifle_mag_out: S(2, 'mid', 2, 'sfx', 0.02, 0.05, 0.1, true, rifleMagOut),
  rifle_mag_in: S(2, 'mid', 2, 'sfx', 0.02, 0.05, 0.1, true, rifleMagIn),
  rifle_bolt: S(2, 'mid', 2, 'sfx', 0.02, 0.05, 0.1, true, rifleBolt),
  pistol_mag_out: S(2, 'mid', 2, 'sfx', 0.02, 0.05, 0.1, true, pistolMagOut),
  pistol_mag_in: S(2, 'mid', 2, 'sfx', 0.02, 0.05, 0.1, true, pistolMagIn),
  pistol_slide: S(2, 'mid', 2, 'sfx', 0.02, 0.05, 0.1, true, pistolSlide),
  shotgun_shell_in: S(3, 'mid', 2, 'sfx', 0.03, 0.05, 0.1, true, shotgunShellIn),
  shotgun_pump: S(2, 'mid', 2, 'sfx', 0.02, 0.05, 0.12, true, shotgunPump),
  weapon_draw: S(2, 'mid', 2, 'sfx', 0.03, 0.06, 0.05, true, weaponDraw),
  grenade_pin: S(1, 'mid', 2, 'sfx', 0.03, 0.05, 0.1, true, grenadePin),
  grenade_throw: S(2, 'mid', 2, 'sfx', 0.03, 0.05, 0.1, true, grenadeThrow),
  grenade_bounce: S(3, 'mid', 2, 'sfx', 0.08, 0.1, 0.25, true, grenadeBounce),
  grenade_explosion: S(2, 'mid', 3, 'sfx', 0.03, 0.04, 0.4, true, grenadeExplosion),
  armor_plate: S(1, 'mid', 2, 'sfx', 0.01, 0.02, 0.05, true, armorPlate),
  // ---- feedback ----
  hit_body: S(2, 'mid', 3, 'ui', 0.03, 0.05, 0, true, hitBody),
  hit_head: S(2, 'mid', 3, 'ui', 0.03, 0.05, 0, true, hitHead),
  kill_confirm: S(1, 'mid', 3, 'ui', 0.02, 0.05, 0, true, killConfirm),
  // ---- impacts ----
  impact_concrete: S(3, 'mid', 0, 'sfx', 0.1, 0.15, 0.3, true, impactConcrete),
  impact_metal: S(3, 'mid', 0, 'sfx', 0.08, 0.15, 0.3, true, impactMetal),
  impact_dirt: S(3, 'mid', 0, 'sfx', 0.1, 0.15, 0.2, true, impactDirt),
  impact_wood: S(3, 'mid', 0, 'sfx', 0.1, 0.15, 0.25, true, impactWood),
  impact_flesh: S(3, 'mid', 1, 'sfx', 0.1, 0.15, 0.2, true, impactFlesh),
  ricochet: S(3, 'mid', 0, 'sfx', 0.1, 0.15, 0.35, true, ricochet),
  // ---- player ----
  step_concrete: S(4, 'lo', 0, 'sfx', 0.07, 0.12, 0.14, true, stepConcrete),
  step_metal: S(4, 'lo', 0, 'sfx', 0.07, 0.12, 0.14, true, stepMetal),
  step_dirt: S(4, 'lo', 0, 'sfx', 0.07, 0.12, 0.1, true, stepDirt),
  step_indoor: S(4, 'lo', 0, 'sfx', 0.07, 0.12, 0.18, true, stepIndoor),
  jump: S(2, 'lo', 1, 'sfx', 0.05, 0.1, 0.1, true, playerJump),
  land: S(2, 'lo', 1, 'sfx', 0.06, 0.1, 0.16, true, playerLand),
  player_hurt: S(3, 'lo', 3, 'sfx', 0.04, 0.05, 0.1, true, playerHurt),
  player_death: S(1, 'lo', 3, 'sfx', 0.01, 0.02, 0.15, false, playerDeath),
  cough: S(2, 'lo', 2, 'sfx', 0.05, 0.08, 0.1, false, cough),
  // ---- zombies ----
  zombie_groan: S(5, 'lo', 1, 'sfx', 0.08, 0.12, 0.3, true, zombieGroan),
  zombie_alert: S(3, 'lo', 2, 'sfx', 0.06, 0.1, 0.3, true, zombieAlert),
  zombie_snarl: S(4, 'lo', 1, 'sfx', 0.07, 0.1, 0.25, true, zombieSnarl),
  zombie_screech: S(3, 'mid', 2, 'sfx', 0.05, 0.08, 0.32, false, zombieScreech),
  zombie_bellow: S(3, 'lo', 2, 'sfx', 0.05, 0.08, 0.32, false, zombieBellow),
  warden_roar: S(2, 'lo', 3, 'sfx', 0.03, 0.04, 0.4, false, wardenRoar),
  warden_slam: S(1, 'lo', 3, 'sfx', 0.03, 0.04, 0.4, false, wardenSlam),
  zombie_attack: S(3, 'lo', 2, 'sfx', 0.06, 0.1, 0.2, true, zombieAttack),
  zombie_claw_hit: S(3, 'lo', 3, 'sfx', 0.05, 0.08, 0.1, true, zombieClawHit),
  zombie_hurt: S(4, 'lo', 1, 'sfx', 0.07, 0.1, 0.2, true, zombieHurt),
  zombie_death: S(3, 'lo', 1, 'sfx', 0.06, 0.1, 0.25, true, zombieDeath),
  // ---- world / interaction ----
  pickup_ammo: S(2, 'mid', 2, 'sfx', 0.04, 0.06, 0.05, true, pickupAmmo),
  pickup_cash: S(2, 'mid', 2, 'sfx', 0.04, 0.06, 0.05, true, pickupCash),
  pickup_plate: S(2, 'mid', 2, 'sfx', 0.04, 0.06, 0.05, true, pickupPlate),
  crate_open: S(2, 'mid', 2, 'sfx', 0.03, 0.05, 0.2, false, crateOpen),
  buy_ok: S(1, 'mid', 3, 'ui', 0.01, 0.02, 0, false, buyOk),
  buy_denied: S(1, 'lo', 3, 'ui', 0.01, 0.02, 0, false, buyDenied),
  upgrade_ok: S(1, 'mid', 3, 'ui', 0.01, 0.02, 0, false, upgradeOk),
  station_open: S(1, 'mid', 2, 'ui', 0.01, 0.02, 0, false, stationOpen),
  station_close: S(1, 'mid', 2, 'ui', 0.01, 0.02, 0, false, stationClose),
  // ---- mission ----
  contract_new: S(1, 'mid', 3, 'ui', 0, 0.02, 0, false, contractNew),
  contract_complete: S(1, 'mid', 3, 'ui', 0, 0.02, 0, false, contractComplete),
  objective_ping: S(1, 'mid', 2, 'ui', 0, 0.02, 0, false, objectivePing),
  defense_start: S(1, 'mid', 3, 'ui', 0, 0.02, 0, false, defenseStart),
  radio_chirp: S(2, 'lo', 2, 'ui', 0.02, 0.03, 0, false, radioChirp),
  flare_ignite: S(1, 'mid', 3, 'sfx', 0.02, 0.03, 0.2, false, flareIgnite),
  countdown_tick: S(1, 'lo', 2, 'ui', 0, 0.02, 0, false, countdownTick),
  countdown_final: S(1, 'lo', 3, 'ui', 0, 0.02, 0, false, countdownFinal),
  heli_land: S(1, 'lo', 3, 'sfx', 0.02, 0.03, 0.3, false, heliLand),
  boarding: S(1, 'lo', 3, 'sfx', 0.01, 0.02, 0.1, false, boarding),
  victory_sting: S(1, 'mid', 3, 'ui', 0, 0.01, 0, false, victorySting),
  defeat_sting: S(1, 'mid', 3, 'ui', 0, 0.01, 0, false, defeatSting),
  // ---- hazard ----
  siren_wail: S(1, 'lo', 2, 'sfx', 0.01, 0.02, 0.4, false, sirenWail),
  klaxon: S(1, 'lo', 2, 'sfx', 0.01, 0.02, 0.35, false, klaxon),
  // ---- ambience one-shots ----
  amb_thunder: S(2, 'xlo', 0, 'amb', 0.05, 0.1, 0.5, false, ambThunder),
  amb_creak: S(3, 'lo', 0, 'amb', 0.08, 0.15, 0.4, false, ambCreak),
  amb_clang: S(3, 'lo', 0, 'amb', 0.06, 0.15, 0.45, false, ambClang),
  amb_gunfire_far: S(3, 'lo', 0, 'amb', 0.04, 0.12, 0.5, false, ambGunfireFar),
  amb_debris: S(2, 'lo', 0, 'amb', 0.05, 0.15, 0.35, false, ambDebris),
  // ---- UI ----
  ui_click: S(2, 'mid', 3, 'ui', 0.03, 0.04, 0, true, uiClick),
  ui_hover: S(1, 'mid', 3, 'ui', 0.02, 0.05, 0, true, uiHover),
  ui_deploy: S(1, 'mid', 3, 'ui', 0, 0.02, 0, true, uiDeploy),
  ui_pause: S(1, 'mid', 3, 'ui', 0, 0.02, 0, true, uiPause),
};

/** Per-sound distance rolloff (Web Audio 'inverse' model factor; default 1). Lower = carries farther. Threat cues carry further so the player can hear the horde coming. */
const ROLLOFF: Partial<Record<SoundId, number>> = {
  zombie_groan: 0.62,
  zombie_alert: 0.62,
  zombie_snarl: 0.62,
  zombie_screech: 0.58,
  zombie_bellow: 0.58,
  zombie_attack: 0.8,
  warden_roar: 0.35,
  warden_slam: 0.4,
  grenade_explosion: 0.5,
  amb_gunfire_far: 0.5,
  amb_clang: 0.6,
  heli_land: 0.5,
  siren_wail: 0.5,
  klaxon: 0.5,
  rifle_shot: 0.6,
  pistol_shot: 0.6,
  shotgun_shot: 0.5,
  rifle_shot_up: 0.6,
  pistol_shot_up: 0.6,
  shotgun_shot_up: 0.5,
};

export function getRolloff(id: SoundId): number {
  return ROLLOFF[id] ?? 1;
}

export interface LoopSpec {
  rate: RateClass;
  bus: BusName;
  /** Base gain applied to the buffer (loops are peak-normalised low; this sets their level in the mix). */
  gain: number;
  /** Reverb send. */
  reverb: number;
  /** Whether the loop is positional (heli, flare, transmitter, siren) - a panner is created on demand. */
  positional: boolean;
  essential: boolean;
  gen: (c: Ctx) => Float32Array;
}

export const LOOP_SPECS: Record<Exclude<LoopId, 'ambience'>, LoopSpec> = {
  heli: { rate: 'lo', bus: 'sfx', gain: 0.9, reverb: 0.25, positional: true, essential: false, gen: loopHeli },
  flare: { rate: 'lo', bus: 'sfx', gain: 0.55, reverb: 0.1, positional: true, essential: false, gen: loopFlare },
  gas: { rate: 'lo', bus: 'sfx', gain: 0.5, reverb: 0.1, positional: false, essential: false, gen: loopGas },
  siren: { rate: 'lo', bus: 'sfx', gain: 0.5, reverb: 0.35, positional: true, essential: false, gen: loopSiren },
  heartbeat: { rate: 'xlo', bus: 'ui', gain: 0.9, reverb: 0, positional: false, essential: false, gen: loopHeartbeat },
  transmitter: { rate: 'lo', bus: 'sfx', gain: 0.45, reverb: 0.2, positional: true, essential: false, gen: loopTransmitter },
};

/** The composite ambience bed is mixed live from three independent loops of different lengths (no audible repetition). */
export const AMBIENCE_LAYERS = [
  { name: 'wind', sampleRate: 16000, gain: 0.6, gen: ambWind },
  { name: 'hum', sampleRate: 11025, gain: 0.11, gen: ambHum },
  { name: 'rumble', sampleRate: 8000, gain: 0.38, gen: ambRumble },
] as const;

/** Render one variant of a one-shot sound. Deterministic for (id, variant, sampleRate). */
export function synthSound(id: SoundId, variant: number, hiRate: number): { data: Float32Array; sampleRate: number } {
  const spec = SOUND_SPECS[id];
  const sr = resolveRate(spec.rate, hiRate);
  const c: Ctx = { sr, r: mulberry32(seedFor(id, variant)), v: variant };
  return { data: spec.gen(c), sampleRate: sr };
}

export function synthLoop(id: Exclude<LoopId, 'ambience'>, hiRate: number): { data: Float32Array; sampleRate: number } {
  const spec = LOOP_SPECS[id];
  const sr = resolveRate(spec.rate, hiRate);
  const c: Ctx = { sr, r: mulberry32(seedFor(`loop:${id}`, 0)), v: 0 };
  return { data: spec.gen(c), sampleRate: sr };
}

export function synthAmbienceLayer(index: number): { data: Float32Array; sampleRate: number } {
  const layer = AMBIENCE_LAYERS[index]!;
  const c: Ctx = { sr: layer.sampleRate, r: mulberry32(seedFor(`amb:${layer.name}`, 0)), v: 0 };
  return { data: layer.gen(c), sampleRate: layer.sampleRate };
}
