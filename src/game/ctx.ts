/** Shared handle to the running game systems, passed to the runtime modules (avoids import cycles). */
import type * as THREE from 'three';
import type { AudioEngineApi } from '../audio/ids';
import type { ZombieManager } from '../enemies/zombieManager';
import type { FxApi } from '../fx/fxTypes';
import type { Rng } from '../logic/rng';
import type { Input } from '../player/input';
import type { Player } from '../player/player';
import type { GameRenderer } from '../render/renderer';
import type { Region, Settings } from '../types';
import type { HudApi, HudEvent } from '../ui/hudTypes';
import type { GrenadeSystem } from '../weapons/grenades';
import type { WeaponSystem } from '../weapons/weaponSystem';
import type { Level } from '../world/level';
import type { MaterialLib } from '../world/materials';
import type { FlowField } from '../world/nav';
import type { Session } from './session';

export interface GameCtx {
  readonly renderer: GameRenderer;
  readonly level: Level;
  readonly mats: MaterialLib;
  readonly audio: AudioEngineApi;
  readonly fx: FxApi;
  readonly hud: HudApi;
  readonly player: Player;
  readonly input: Input;
  readonly weapons: WeaponSystem;
  readonly zombies: ZombieManager;
  readonly grenades: GrenadeSystem;
  readonly flow: FlowField;
  readonly rng: Rng;
  /** Root for objects the runtime adds to the world scene. */
  readonly worldRoot: THREE.Group;
  session: Session;
  settings: Settings;
  /** Wall-clock-independent simulation time (seconds since page load of the sim). */
  time: number;

  hudEvent(e: HudEvent): void;
  feed(text: string, tone?: 'normal' | 'good' | 'warn' | 'danger'): void;
  banner(title: string, subtitle: string | undefined, tone: 'info' | 'good' | 'warn' | 'danger', duration?: number): void;
  radio(speaker: string, text: string, duration?: number): void;
  playerAlive(): boolean;
  playerRegion(): Region;
  /** Hurt the player through the normal armour / health path. */
  hurtPlayer(amount: number, srcX: number | null, srcZ: number | null, opts?: { ignoreArmor?: boolean; toxic?: boolean }): void;
  shake(strength: number): void;
  /** The simulation asks the game to end the run. */
  endRun(outcome: 'victory' | 'defeat', reason: string): void;
  /** Begin the boarding cinematic. */
  beginBoarding(): void;
}
