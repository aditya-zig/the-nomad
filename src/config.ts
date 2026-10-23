/**
 * Central balance and tuning configuration for DEAD SIGNAL: EXCLUSION ZONE.
 * Every gameplay number lives here so the game can be balanced in one place.
 * Angles are in degrees unless the field name says otherwise; distances in metres; times in seconds.
 */
import type { QualityLevel, Region, Settings, WeaponId, ZombieType } from './types';

// ---------------------------------------------------------------------------------------------
// Weapons
// ---------------------------------------------------------------------------------------------

/** Multipliers / additions a weapon upgrade tier applies on top of the base weapon stats. */
export interface UpgradeTier {
  /** Short label shown in the UI, e.g. "MK II". */
  label: string;
  /** Description of what the tier does, shown at the upgrade station. */
  description: string;
  cost: number;
  damageMul: number;
  magSizeAdd: number;
  reserveMaxAdd: number;
  fireRateMul: number;
  recoilMul: number;
  spreadMul: number;
  reloadMul: number;
  pelletsAdd: number;
  headshotMulAdd: number;
  /** 0..1 fraction of a zombie's body armour that this weapon ignores. */
  armorPierce: number;
}

export interface WeaponDef {
  id: WeaponId;
  name: string;
  short: string;
  /** Fully automatic (hold to fire) or semi-automatic (one shot per click). */
  auto: boolean;
  /** Damage per projectile before falloff / multipliers. */
  damage: number;
  pellets: number;
  headshotMul: number;
  /** Seconds between shots. */
  fireInterval: number;
  magSize: number;
  reserveStart: number;
  reserveMax: number;
  reloadStyle: 'magazine' | 'shell';
  /** Magazine reload: seconds when a round is still chambered / when the gun is dry. */
  reloadTactical: number;
  reloadEmpty: number;
  /** Fraction (0..1) of the reload duration at which ammunition is transferred into the magazine. */
  reloadTransferAt: number;
  /** Shell reload timings (shotgun): start, per shell, end. */
  shellStart: number;
  shellEach: number;
  shellEnd: number;
  /** Chamber the next round after the first shell when the gun was dry. */
  shellPump: number;
  /** Cone half-angles in degrees. */
  spreadHip: number;
  spreadAds: number;
  /** Extra spread while moving at full walking speed / in the air. */
  spreadMove: number;
  spreadAir: number;
  /** Extra spread added per shot (bloom) and its recovery per second. */
  spreadPerShot: number;
  spreadMax: number;
  spreadRecover: number;
  /** Camera kick per shot in degrees. */
  recoilPitch: number;
  recoilYaw: number;
  /** Fraction of the kick that decays per second (higher = faster recovery). */
  recoilRecover: number;
  /** Damage falloff: full damage up to `falloffStart`, lerping to `minMul` at `falloffEnd`, 0 beyond `maxRange`. */
  falloffStart: number;
  falloffEnd: number;
  minMul: number;
  maxRange: number;
  /** FOV multiplier when aiming down sights (smaller = more zoom) and the transition time. */
  adsFovMul: number;
  adsTime: number;
  /** Movement speed multiplier while this weapon is equipped. */
  moveMul: number;
  /** Radius within which the shot alerts zombies. */
  noise: number;
  /** Time to raise the weapon after switching. */
  drawTime: number;
  /** Tracer colours by upgrade tier (hex). */
  tracerColors: [number, number, number];
  /** Price to (re)buy the weapon at the buy station (0 = not sold). */
  price: number;
  /** Price of a full ammo refill at the buy station. */
  ammoPrice: number;
  tiers: [UpgradeTier, UpgradeTier];
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  rifle: {
    id: 'rifle',
    name: 'KR-16 Assault Rifle',
    short: 'KR-16',
    auto: true,
    damage: 26,
    pellets: 1,
    headshotMul: 2.2,
    fireInterval: 60 / 700,
    magSize: 30,
    reserveStart: 120,
    reserveMax: 240,
    reloadStyle: 'magazine',
    reloadTactical: 2.05,
    reloadEmpty: 2.6,
    reloadTransferAt: 0.72,
    shellStart: 0,
    shellEach: 0,
    shellEnd: 0,
    shellPump: 0,
    spreadHip: 2.4,
    spreadAds: 0.3,
    spreadMove: 1.6,
    spreadAir: 3.0,
    spreadPerShot: 0.22,
    spreadMax: 2.2,
    spreadRecover: 5.5,
    recoilPitch: 0.62,
    recoilYaw: 0.3,
    recoilRecover: 7.5,
    falloffStart: 32,
    falloffEnd: 85,
    minMul: 0.6,
    maxRange: 160,
    adsFovMul: 0.68,
    adsTime: 0.2,
    moveMul: 1.0,
    noise: 42,
    drawTime: 0.42,
    tracerColors: [0xffe3a3, 0xffb347, 0x6ff0ff],
    price: 700,
    ammoPrice: 250,
    tiers: [
      {
        label: 'MK II',
        description: 'Extended feed: +20% damage, 42-round magazine, faster reload.',
        cost: 1500,
        damageMul: 1.2,
        magSizeAdd: 12,
        reserveMaxAdd: 60,
        fireRateMul: 1.0,
        recoilMul: 0.92,
        spreadMul: 0.95,
        reloadMul: 0.9,
        pelletsAdd: 0,
        headshotMulAdd: 0,
        armorPierce: 0,
      },
      {
        label: 'MK III',
        description: 'Armour-piercing rounds: +45% damage, +10% fire rate, ignores 35% of armour, low recoil.',
        cost: 3200,
        damageMul: 1.45,
        magSizeAdd: 20,
        reserveMaxAdd: 90,
        fireRateMul: 1.1,
        recoilMul: 0.75,
        spreadMul: 0.85,
        reloadMul: 0.82,
        pelletsAdd: 0,
        headshotMulAdd: 0.2,
        armorPierce: 0.35,
      },
    ],
  },
  pistol: {
    id: 'pistol',
    name: 'VX-9 Service Pistol',
    short: 'VX-9',
    auto: false,
    damage: 36,
    pellets: 1,
    headshotMul: 2.4,
    fireInterval: 0.13,
    magSize: 13,
    reserveStart: 78,
    reserveMax: 130,
    reloadStyle: 'magazine',
    reloadTactical: 1.45,
    reloadEmpty: 1.8,
    reloadTransferAt: 0.68,
    shellStart: 0,
    shellEach: 0,
    shellEnd: 0,
    shellPump: 0,
    spreadHip: 1.5,
    spreadAds: 0.22,
    spreadMove: 1.0,
    spreadAir: 2.0,
    spreadPerShot: 0.5,
    spreadMax: 2.0,
    spreadRecover: 6.5,
    recoilPitch: 1.25,
    recoilYaw: 0.35,
    recoilRecover: 9.0,
    falloffStart: 18,
    falloffEnd: 55,
    minMul: 0.5,
    maxRange: 110,
    adsFovMul: 0.82,
    adsTime: 0.14,
    moveMul: 1.05,
    noise: 30,
    drawTime: 0.3,
    tracerColors: [0xfff0c4, 0xffb347, 0x6ff0ff],
    price: 200,
    ammoPrice: 150,
    tiers: [
      {
        label: 'MK II',
        description: 'Match barrel: +30% damage, 17-round magazine.',
        cost: 900,
        damageMul: 1.3,
        magSizeAdd: 4,
        reserveMaxAdd: 34,
        fireRateMul: 1.0,
        recoilMul: 0.9,
        spreadMul: 0.9,
        reloadMul: 0.92,
        pelletsAdd: 0,
        headshotMulAdd: 0,
        armorPierce: 0,
      },
      {
        label: 'MK III',
        description: 'Hand-cannon load: +70% damage, +25% fire rate, +0.4 headshot multiplier, ignores 25% of armour.',
        cost: 2000,
        damageMul: 1.7,
        magSizeAdd: 8,
        reserveMaxAdd: 60,
        fireRateMul: 1.25,
        recoilMul: 0.85,
        spreadMul: 0.8,
        reloadMul: 0.85,
        pelletsAdd: 0,
        headshotMulAdd: 0.4,
        armorPierce: 0.25,
      },
    ],
  },
  shotgun: {
    id: 'shotgun',
    name: 'PS-12 Pump Shotgun',
    short: 'PS-12',
    auto: false,
    damage: 13,
    pellets: 8,
    headshotMul: 1.5,
    fireInterval: 0.78,
    magSize: 6,
    reserveStart: 30,
    reserveMax: 48,
    reloadStyle: 'shell',
    reloadTactical: 0,
    reloadEmpty: 0,
    reloadTransferAt: 0.6,
    shellStart: 0.5,
    shellEach: 0.44,
    shellEnd: 0.4,
    shellPump: 0.5,
    spreadHip: 4.4,
    spreadAds: 3.0,
    spreadMove: 1.2,
    spreadAir: 2.0,
    spreadPerShot: 0.0,
    spreadMax: 4.4,
    spreadRecover: 6,
    recoilPitch: 4.2,
    recoilYaw: 0.8,
    recoilRecover: 6.0,
    falloffStart: 5,
    falloffEnd: 22,
    minMul: 0.18,
    maxRange: 45,
    adsFovMul: 0.85,
    adsTime: 0.2,
    moveMul: 0.96,
    noise: 48,
    drawTime: 0.5,
    tracerColors: [0xffd9a0, 0xffa030, 0x6ff0ff],
    price: 1200,
    ammoPrice: 250,
    tiers: [
      {
        label: 'MK II',
        description: 'Choke and load: +25% damage, 10 pellets per shell, 8-shell tube.',
        cost: 1400,
        damageMul: 1.25,
        magSizeAdd: 2,
        reserveMaxAdd: 16,
        fireRateMul: 1.0,
        recoilMul: 0.95,
        spreadMul: 0.92,
        reloadMul: 0.92,
        pelletsAdd: 2,
        headshotMulAdd: 0,
        armorPierce: 0,
      },
      {
        label: 'MK III',
        description: 'Slug-wad specialty shells: +50% damage, +20% fire rate, tighter spread, ignores 30% of armour.',
        cost: 3000,
        damageMul: 1.5,
        magSizeAdd: 4,
        reserveMaxAdd: 28,
        fireRateMul: 1.2,
        recoilMul: 0.85,
        spreadMul: 0.75,
        reloadMul: 0.8,
        pelletsAdd: 2,
        headshotMulAdd: 0.15,
        armorPierce: 0.3,
      },
    ],
  },
};

export const WEAPON_IDS: WeaponId[] = ['rifle', 'pistol', 'shotgun'];

export const GRENADE = {
  start: 2,
  max: 4,
  price: 200,
  /** Grenades granted per purchase. */
  purchaseAmount: 2,
  fuse: 2.4,
  throwSpeed: 15,
  throwUp: 0.22,
  radius: 0.09,
  restitution: 0.38,
  friction: 0.7,
  gravity: 17,
  blastRadius: 7.5,
  /** Damage at the centre; falls off linearly to `edgeDamage` at the edge. */
  centerDamage: 260,
  edgeDamage: 25,
  /** Multiplier applied when solid geometry blocks the line to the target. */
  coverMul: 0.0,
  selfMul: 0.4,
  throwDelay: 0.32,
  cooldown: 0.9,
  knockback: 8,
} as const;

// ---------------------------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------------------------

export const PLAYER = {
  radius: 0.34,
  heightStand: 1.8,
  heightCrouch: 1.25,
  eyeStand: 1.68,
  eyeCrouch: 1.14,
  walkSpeed: 4.3,
  sprintSpeed: 6.9,
  crouchSpeed: 2.3,
  adsSpeedMul: 0.62,
  jumpSpeed: 6.4,
  gravity: 21,
  groundAccel: 48,
  airAccel: 9,
  groundFriction: 11,
  stepHeight: 0.42,
  /** Vertical transition speed between standing and crouching eye height (m/s). */
  crouchTransition: 6.5,
  /** Player's max fall speed. */
  terminalVelocity: 40,
  maxHealth: 100,
  healthRegenDelay: 6.5,
  healthRegenRate: 14,
  maxArmor: 100,
  plateArmor: 50,
  maxPlates: 3,
  startPlates: 2,
  plateApplyTime: 2.1,
  maxStamina: 100,
  staminaDrain: 21,
  staminaRegen: 17,
  staminaRegenDelay: 0.9,
  /** After fully exhausting stamina the player must regain this much before sprinting again. */
  staminaResumeAt: 18,
  /** Seconds of sprint that ends when you fire / aim. */
  meleeReach: 0,
  /** Fraction of incoming toxin damage that armour absorbs (toxin ignores armour by design). */
  toxinArmorAbsorb: 0,
  startCash: 600,
  startGrenades: 2,
  interactReach: 2.6,
  /** Maximum simulation step for a single physics sub-step. */
  maxSubstep: 1 / 60,
} as const;

// ---------------------------------------------------------------------------------------------
// Zombies
// ---------------------------------------------------------------------------------------------

export interface ZombieDef {
  type: ZombieType;
  name: string;
  hp: number;
  /** Wander / idle-alert walking speed. */
  speedWalk: number;
  /** Chasing speed (each zombie gets +-speedVariance random scaling). */
  speedChase: number;
  speedVariance: number;
  radius: number;
  height: number;
  headRadius: number;
  damage: number;
  attackRange: number;
  attackWindup: number;
  attackStrike: number;
  attackRecovery: number;
  /** Damage multiplier applied to non-head hits (body armour). */
  bodyMul: number;
  /** Multiplier applied to headshots on top of the weapon's own headshot multiplier. */
  headMul: number;
  /** Damage needed within the recent window to stagger. */
  poise: number;
  staggerTime: number;
  reward: number;
  headshotBonus: number;
  /** Radius at which this zombie notices the player with line of sight. */
  sightRange: number;
  /** Turn rate in radians/second. */
  turnRate: number;
  /** Chance a kill drops a supply pickup (scaled by region). */
  dropChance: number;
}

export const ZOMBIES: Record<ZombieType, ZombieDef> = {
  shambler: {
    type: 'shambler',
    name: 'Shambler',
    hp: 100,
    speedWalk: 0.9,
    speedChase: 1.95,
    speedVariance: 0.18,
    radius: 0.32,
    height: 1.8,
    headRadius: 0.17,
    damage: 14,
    attackRange: 1.55,
    attackWindup: 0.6,
    attackStrike: 0.15,
    attackRecovery: 0.6,
    bodyMul: 1,
    headMul: 1,
    poise: 34,
    staggerTime: 0.55,
    reward: 55,
    headshotBonus: 20,
    sightRange: 24,
    turnRate: 4.2,
    dropChance: 0.05,
  },
  runner: {
    type: 'runner',
    name: 'Runner',
    hp: 70,
    speedWalk: 1.3,
    speedChase: 4.7,
    speedVariance: 0.12,
    radius: 0.3,
    height: 1.75,
    headRadius: 0.16,
    damage: 9,
    attackRange: 1.65,
    attackWindup: 0.28,
    attackStrike: 0.12,
    attackRecovery: 0.42,
    bodyMul: 1,
    headMul: 1,
    poise: 24,
    staggerTime: 0.4,
    reward: 85,
    headshotBonus: 25,
    sightRange: 30,
    turnRate: 7.5,
    dropChance: 0.07,
  },
  armored: {
    type: 'armored',
    name: 'Armored Infected',
    hp: 260,
    speedWalk: 0.85,
    speedChase: 1.9,
    speedVariance: 0.1,
    radius: 0.38,
    height: 1.95,
    headRadius: 0.2,
    damage: 22,
    attackRange: 1.75,
    attackWindup: 0.75,
    attackStrike: 0.18,
    attackRecovery: 0.85,
    bodyMul: 0.5,
    headMul: 0.75,
    poise: 95,
    staggerTime: 0.6,
    reward: 160,
    headshotBonus: 40,
    sightRange: 26,
    turnRate: 3.2,
    dropChance: 0.14,
  },
  warden: {
    type: 'warden',
    name: 'THE WARDEN',
    hp: 2400,
    speedWalk: 1.2,
    speedChase: 2.8,
    speedVariance: 0,
    radius: 0.52,
    height: 2.55,
    headRadius: 0.27,
    damage: 42,
    attackRange: 2.2,
    attackWindup: 0.9,
    attackStrike: 0.2,
    attackRecovery: 0.9,
    bodyMul: 0.5,
    headMul: 0.9,
    poise: 500,
    staggerTime: 0.9,
    reward: 400,
    headshotBonus: 150,
    sightRange: 40,
    turnRate: 2.6,
    dropChance: 0,
  },
};

export const WARDEN = {
  /** Below this health fraction the Warden becomes enraged (faster). */
  rageAt: 0.5,
  rageSpeedMul: 1.35,
  slamRange: 5.5,
  slamRadius: 5.0,
  slamDamage: 32,
  slamWindup: 1.1,
  slamRecovery: 0.9,
  slamCooldown: 9,
  chargeMinRange: 8,
  chargeMaxRange: 22,
  chargeSpeed: 7.2,
  chargeDuration: 1.5,
  chargeWindup: 0.9,
  chargeCooldown: 13,
  chargeDamage: 38,
} as const;

/** Global tuning for how zombies sense, move, and attack. */
export const ZOMBIE_AI = {
  /** Distance within which any zombie notices a sprinting/firing player regardless of sight. */
  footstepHearing: 9,
  sprintHearing: 16,
  /** Attack hit-check cone half angle (degrees). */
  attackCone: 75,
  /** Vertical reach: attacks miss if the player is higher than this above the zombie's feet. */
  attackVerticalReach: 2.1,
  separationRadius: 0.95,
  separationStrength: 3.2,
  /** Flow-field recompute period and movement threshold. */
  flowInterval: 0.35,
  flowMoveThreshold: 1.0,
  /** How long a zombie keeps chasing after losing awareness (seconds). */
  loseInterest: 14,
  /** Ambient wander radius for idle zombies. */
  wanderRadius: 3.5,
  corpseLifetime: 14,
  maxCorpses: 14,
  /** Movement sub-stepping for zombies (max distance per collision step). */
  maxStepDistance: 0.25,
} as const;

// ---------------------------------------------------------------------------------------------
// Threat regions, spawning
// ---------------------------------------------------------------------------------------------

export interface RegionDef {
  id: Region;
  name: string;
  shortName: string;
  color: string;
  /** Multiplier applied to cash rewards from kills. */
  rewardMul: number;
  /** Seconds between director spawns while the player is here. */
  spawnInterval: number;
  /** Active enemy soft cap while the player is here (scaled by mission phase and quality). */
  activeCap: number;
  /** Spawn composition weights. */
  mix: Record<'shambler' | 'runner' | 'armored', number>;
  /** Ambient (pre-placed idle) population to seed the region with at mission start. */
  ambient: number;
  /** Chance multiplier for kill drops. */
  dropMul: number;
  /** Extra damage taken multiplier (danger scaling). */
  damageMul: number;
}

export const REGIONS: Record<Region, RegionDef> = {
  low: {
    id: 'low',
    name: 'LOW THREAT',
    shortName: 'LOW',
    color: '#8fd18a',
    rewardMul: 1.0,
    spawnInterval: 6.0,
    activeCap: 12,
    mix: { shambler: 0.86, runner: 0.14, armored: 0 },
    ambient: 9,
    dropMul: 1,
    damageMul: 1,
  },
  medium: {
    id: 'medium',
    name: 'MEDIUM THREAT',
    shortName: 'MED',
    color: '#f2c14e',
    rewardMul: 1.35,
    spawnInterval: 4.3,
    activeCap: 18,
    mix: { shambler: 0.52, runner: 0.33, armored: 0.15 },
    ambient: 15,
    dropMul: 1.25,
    damageMul: 1,
  },
  high: {
    id: 'high',
    name: 'HIGH THREAT',
    shortName: 'HIGH',
    color: '#ff5a4d',
    rewardMul: 1.8,
    spawnInterval: 2.9,
    activeCap: 26,
    mix: { shambler: 0.28, runner: 0.38, armored: 0.34 },
    ambient: 19,
    dropMul: 1.5,
    damageMul: 1.1,
  },
};

export const SPAWN = {
  /** Never spawn closer than this to the player (straight-line). */
  minDistance: 24,
  /** Prefer spawn points within this ring. */
  maxDistance: 68,
  /** Spawn points inside the player's forward view cone AND with line of sight are rejected. */
  hiddenFromPlayer: true,
  /** Global hard cap on live (non-corpse) enemies, before quality scaling. */
  hardCap: 40,
  /** Extra ambient zombies wake up when the player is this close with line of sight. */
  ambientWakeRange: 20,
  /** Per-phase activeCap multiplier gain. */
  phaseCapGain: 0.12,
  /** Per-phase spawn interval multiplier (interval *= this ^ phase). */
  phaseIntervalMul: 0.9,
  /** Per-phase shift of composition toward runners / armoured (added weight). */
  phaseRunnerGain: 0.05,
  phaseArmoredGain: 0.04,
  /** Spawning pauses when this many enemies are already alerted and near the player. */
  nearbyLimit: 10,
  nearbyRadius: 18,
} as const;

// ---------------------------------------------------------------------------------------------
// Economy, loot
// ---------------------------------------------------------------------------------------------

export const ECONOMY = {
  platePrice: 350,
  /** Cash for a headshot kill bonus is per-zombie; this multiplies all kill cash globally. */
  killCashMul: 0.45,
  crates: {
    low: { cash: [70, 140], mags: [1, 1.8], plateChance: 0.25, grenadeChance: 0.15 },
    medium: { cash: [130, 240], mags: [1.4, 2.4], plateChance: 0.4, grenadeChance: 0.3 },
    high: { cash: [240, 400], mags: [1.8, 3.0], plateChance: 0.6, grenadeChance: 0.4 },
  } as Record<Region, { cash: [number, number]; mags: [number, number]; plateChance: number; grenadeChance: number }>,
  /** Ground pickups dropped by zombies. */
  pickupLifetime: 40,
  ammoPickupMags: 1.0,
  pickupRadius: 1.4,
  maxPickups: 10,
  crateOpenTime: 0.8,
  stationRange: 3.4,
} as const;

// ---------------------------------------------------------------------------------------------
// Mission
// ---------------------------------------------------------------------------------------------

export const MISSION = {
  /** Seconds until the district is sealed (last chance to call extraction). */
  deadline: 720,
  /** Mission time (elapsed seconds) when the contamination surge begins if extraction hasn't been called. */
  surgeStart: 450,
  /** Elapsed seconds at which escalation phases begin. */
  phases: [120, 300, 450],
  hazard: {
    startRadius: 14,
    /** Damage per second inside the toxic zone (ignores armour). */
    dps: 7,
    /** Distance the front stops short of the LZ centre while an extraction is in progress. */
    lzStandoff: 16,
    /** Warning lead time before the surge starts. */
    warningLead: 20,
  },
  defense: {
    id: 'defense',
    title: 'RESTORE THE RELAY',
    summary: 'Activate the transmitter and hold the marked area until the uplink completes.',
    activateHold: 1.2,
    /** Seconds of presence required to complete. */
    duration: 55,
    radius: 10,
    /** Progress lost per second while the player is outside the area. */
    decayPerSecond: 2.4,
    /** Progress rate multiplier while inside (1 = real time). */
    rate: 1,
    /** Director boosts spawns near the site while active. */
    spawnInterval: 2.2,
    burstEvery: 9,
    burstSize: 4,
    activeCap: 26,
    reward: { cash: 1200, plates: 2, grenades: 0 },
  },
  hunt: {
    id: 'hunt',
    title: 'ELIMINATE THE WARDEN',
    summary: 'Locate and eliminate the elite infected inside the research compound.',
    /** Distance within which the Warden is identified on the HUD. */
    revealRange: 46,
    /** Radius of the search area drawn on the map. */
    searchRadius: 26,
    reward: { cash: 1800, plates: 2, grenades: 2 },
  },
  extraction: {
    title: 'EXTRACT',
    /** Hold time on the beacon to call the helicopter. */
    callHold: 1.5,
    /** Seconds from calling to helicopter touchdown. */
    countdown: 60,
    /** The helicopter becomes visible this many seconds before touchdown. */
    visibleAt: 26,
    landingDuration: 9,
    /** Seconds the helicopter stays on the ground for boarding. */
    boardingWindow: 50,
    boardRadius: 4.6,
    boardingCinematic: 3.6,
    /** Final horde waves: seconds after the call, number of enemies. */
    waves: [
      { at: 0, count: 7, armored: 1 },
      { at: 14, count: 8, armored: 1 },
      { at: 28, count: 9, armored: 1 },
      { at: 44, count: 9, armored: 2 },
      { at: 60, count: 8, armored: 1 },
      { at: 76, count: 6, armored: 1 },
    ],
    activeCap: 26,
    /** Mix for the final horde (shambler/runner; armoured come from `armored` above). */
    runnerFraction: 0.28,
  },
} as const;

// ---------------------------------------------------------------------------------------------
// Rendering, quality, audio, FX limits
// ---------------------------------------------------------------------------------------------

export interface QualityPreset {
  pixelRatioCap: number;
  shadows: boolean;
  shadowMapSize: number;
  bloom: boolean;
  msaaSamples: number;
  /** Number of real dynamic point lights assigned to the nearest lamps. */
  lightPool: number;
  particleScale: number;
  maxEnemies: number;
  /** Maximum decals of each family (bullet holes, blood, scorches). */
  decalScale: number;
}

export const QUALITY: Record<QualityLevel, QualityPreset> = {
  low: {
    pixelRatioCap: 1,
    shadows: false,
    shadowMapSize: 1024,
    bloom: false,
    msaaSamples: 0,
    lightPool: 3,
    particleScale: 0.5,
    maxEnemies: 24,
    decalScale: 0.5,
  },
  // Integrated-GPU preset: retain directional shadows without HDR bloom / multisample targets.
  medium: {
    pixelRatioCap: 1,
    shadows: true,
    shadowMapSize: 1024,
    bloom: false,
    msaaSamples: 0,
    lightPool: 4,
    particleScale: 0.65,
    maxEnemies: 28,
    decalScale: 0.65,
  },
  high: {
    pixelRatioCap: 2,
    shadows: true,
    shadowMapSize: 4096,
    bloom: true,
    msaaSamples: 4,
    lightPool: 7,
    particleScale: 1,
    maxEnemies: 40,
    decalScale: 1,
  },
};

export const DEFAULT_SETTINGS: Settings = {
  sensitivity: 1,
  fov: 90,
  masterVolume: 0.7,
  quality: 'medium',
  reducedMotion: false,
  invertY: false,
  showFps: false,
};

export const RENDER = {
  fogColor: 0x887c65,
  fogDensity: 0.0096,
  exposure: 1.15,
  viewmodelFov: 52,
  near: 0.06,
  far: 420,
  /** Radians of camera rotation per mouse pixel at sensitivity 1. */
  mouseRadPerPixel: 0.0022,
  /** Bloom tuning (kept restrained). */
  bloomStrength: 0.3,
  bloomRadius: 0.32,
  bloomThreshold: 1.75,
} as const;

export const AUDIO = {
  maxVoices: 32,
  /** Reference distance for spatialised sounds. */
  refDistance: 4,
  maxDistance: 90,
} as const;

export const FX = {
  maxParticles: 1800,
  maxBulletHoles: 72,
  maxBloodSplats: 40,
  maxScorches: 8,
  maxTracers: 24,
  maxCasings: 24,
} as const;

/** Is this weapon id valid. */
export function isWeaponId(v: string): v is WeaponId {
  return v === 'rifle' || v === 'pistol' || v === 'shotgun';
}
