/**
 * Shared primitive types used across DEAD SIGNAL: EXCLUSION ZONE.
 *
 * World conventions (everything in the project follows these):
 *  - Units are metres. +Y is up. +X is east, +Z is south, so -Z is NORTH.
 *  - Yaw 0 looks toward -Z (north). Positive yaw turns counter-clockwise (toward -X, west).
 *    Forward vector for a yaw angle: (-sin(yaw), 0, -cos(yaw)).
 *  - Ground is flat at y = 0.
 */

export type WeaponId = 'rifle' | 'pistol' | 'shotgun';

export type ZombieType = 'shambler' | 'runner' | 'armored' | 'warden';

export type Region = 'low' | 'medium' | 'high';

/** Material family of a surface; drives impact effects and impact / footstep audio. */
export type SurfaceKind = 'concrete' | 'metal' | 'wood' | 'dirt' | 'flesh' | 'glass' | 'fabric';

export type QualityLevel = 'low' | 'medium' | 'high';

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface Vec2Like {
  x: number;
  z: number;
}

/** Player-facing settings persisted to localStorage. */
export interface Settings {
  /** Mouse sensitivity multiplier (1 = default). */
  sensitivity: number;
  /** Horizontal field of view in degrees. */
  fov: number;
  /** Master volume 0..1. */
  masterVolume: number;
  quality: QualityLevel;
  reducedMotion: boolean;
  invertY: boolean;
  showFps: boolean;
}

/** Best successful-run statistics persisted to localStorage. */
export interface BestRun {
  /** Seconds from deploy to boarding. Lower is better. */
  time: number;
  kills: number;
  headshots: number;
  cash: number;
  date: string;
}

/** Final statistics for the results screen. */
export interface MissionStats {
  /** Present for Nomad expeditions; optional for upstream preview fixtures. */
  nomad?: import('./logic/nomad').NomadState;
  outcome: 'victory' | 'defeat';
  /** Human-readable reason, e.g. "Extracted", "KIA", "Contamination overran the LZ". */
  reason: string;
  kills: number;
  headshots: number;
  contractsCompleted: number;
  contractsTotal: number;
  /** Supply crates opened. */
  cratesOpened: number;
  /** Total cash earned across the run (not the balance). */
  cashEarned: number;
  cashSpent: number;
  ammoCollected: number;
  platesCollected: number;
  /** Seconds survived (mission clock elapsed). */
  timeSurvived: number;
  shotsFired: number;
  shotsHit: number;
  /** Highest threat region reached. */
  highestRegion: Region;
}
