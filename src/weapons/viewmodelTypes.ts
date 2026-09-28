/**
 * First-person viewmodel contract. The game owns weapon STATE (ammo, reload timing, ADS blend, switching); the
 * rigs own all VISUAL animation derived from a `ViewmodelPose` that the game passes in every frame.
 *
 * Rendering setup (owned by the game): a separate `viewScene` rendered after the world with the depth buffer cleared,
 * using `PerspectiveCamera(fov = 52 (vertical) at 16:9, near = 0.02, far = 6)` positioned at the origin looking down -Z
 * (+X right, +Y up). Rigs are children of that scene and are positioned around the origin: the weapon's grip is
 * roughly at (0.14 .. 0.2, -0.22 .. -0.16, -0.35 .. -0.28) and the gloved forearms come up from below the screen edge.
 * The game supplies hemisphere + directional + point-light lighting and `scene.environment` reflections.
 * All geometry must be small-scale (metres) and must never intersect the near plane in any pose.
 */
import type * as THREE from 'three';
import type { WeaponId } from '../types';

export type ReloadPhase = 'none' | 'mag' | 'shellStart' | 'shellLoad' | 'shellEnd' | 'pump';

export interface ViewmodelPose {
  /** Seconds, monotonic; used for idle breathing / ambient motion. */
  time: number;
  /** 0..1 aim-down-sights blend (already eased by the game). At 1 the sights must sit centred on screen. */
  ads: number;
  /** 0..1 sprint pose blend (weapon lowered and angled across the body, arms tucked). */
  sprint: number;
  /** 0..1 horizontal movement: 0 standing, ~0.6 walking, 1 sprinting. */
  move: number;
  /** Radians, advanced by the game proportionally to distance walked; drives bob (sin) and lateral sway. */
  bobPhase: number;
  /** 0..1 crouch blend (slightly lowers/tilts the weapon). */
  crouch: number;
  /** Vertical velocity normalised to about -1 (falling) .. +1 (rising); 0 when grounded. */
  air: number;
  /** 0..1 impulse set on landing by the game and decayed by it; rig dips the weapon by this amount. */
  landing: number;
  /** Smoothed camera angular velocity in radians/second (yaw, pitch) for weapon sway/lag. */
  lookYaw: number;
  lookPitch: number;
  /** 0..1 draw/holster: 0 = fully lowered (off-screen, hidden), 1 = ready. */
  raise: number;
  /** Reload state. `reloadT` is progress 0..1 WITHIN the current phase. */
  reloadPhase: ReloadPhase;
  reloadT: number;
  /** True when the magazine was empty when the reload began (bolt/slide racked at the end of a 'mag' reload). */
  reloadEmpty: boolean;
  /** 0..1 progress through the current fire interval (0 = just fired, 1 = ready). The shotgun pumps during this; slides/bolts cycle at its start. */
  cycle: number;
  /** Rounds in the magazine (slide / bolt stays locked back when 0 and not reloading). */
  ammo: number;
  magSize: number;
  /** Progress 0..1 of the utility action (grenade throw timeline, or armour-plate application) for the 'grenade'/'plate' rigs. */
  action: number;
  /** Reduced-motion accessibility setting: cut bob/sway/kick amplitudes to about 25%. */
  reducedMotion: boolean;
}

export type ViewmodelId = WeaponId | 'grenade' | 'plate';

export interface ViewmodelRig {
  readonly id: ViewmodelId;
  /** Add to the view scene. Rigs hide themselves internally when `pose.raise` is ~0. */
  readonly root: THREE.Group;
  /** Muzzle tip (world matrices valid after `update`). For 'grenade'/'plate' rigs this is `root`. */
  readonly muzzle: THREE.Object3D;
  /** Where spent casings leave the gun (rifle/pistol: right side of the ejection port; shotgun: ejects on pump). */
  readonly ejectPort: THREE.Object3D;
  /** Advance all animation and write transforms. */
  update(pose: ViewmodelPose, dt: number): void;
  /** A shot was fired: run the muzzle flash (tier-coloured), start the recoil spring, cycle the slide/bolt. `strength` 0.5..1.5. */
  onFire(tier: number, strength?: number): void;
  /** Visual upgrade level 0..2: 0 base finish; 1 amber accent strips/emissive detail; 2 glowing cyan-amber energy accents. Must be clearly visible. */
  setTier(tier: number): void;
  /** Clear all transient animation state (springs, flash). */
  reset(): void;
  dispose(): void;
}

export interface ViewmodelSet {
  rifle: ViewmodelRig;
  pistol: ViewmodelRig;
  shotgun: ViewmodelRig;
  /** Hand pulling a pin and throwing a grenade; `action` timeline: pin pull 0-0.3, wind-up 0.3-0.45, release ~0.5, recover 0.5-1. */
  grenade: ViewmodelRig;
  /** Hand pulling an armour plate from the vest and slotting it in; `action` spans the apply time (arm reaches, plate slides, tap). */
  plate: ViewmodelRig;
  dispose(): void;
}

export const REFERENCE_VIEWMODEL_FOV = 52;
