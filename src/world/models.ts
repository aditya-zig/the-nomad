/**
 * Dynamic (non-static) game models: things the game animates or toggles at runtime. Contract + implementation
 * (the builders live in ./models/*.ts: helicopter, stations, crate, pickups, terminal, small, contamination, marker, util).
 *
 * All models: origin at ground level in the middle of the footprint, modelled at true human scale, facing local -Z
 * ("forward" = -Z, same as the camera / yaw convention: forward vector = (-sin yaw, 0, -cos yaw)), so the game
 * positions them with `root.position` and `root.rotation.y = yaw`. Meshes should cast/receive shadows where sensible.
 * Materials come from the shared `MaterialLib` (never mutate shared ones - clone) or are created locally.
 * `dispose()` frees only geometry/materials owned by the instance; shared (reference-counted) geometry/textures/materials
 * are released when the last instance is disposed, and `disposeModelCaches()` force-frees everything at teardown.
 * Animated models expose `update(dt, time)` and never allocate inside it.
 */
import * as THREE from 'three';
import type { Region } from '../types';
import type { MaterialLib } from './materials';
import { createContaminationWallImpl } from './models/contamination';
import { createHelicopterImpl } from './models/helicopter';
import { createAreaMarkerImpl, createObjectiveBeamImpl } from './models/marker';
import { createLootCrateImpl } from './models/crate';
import { createPickupModelImpl } from './models/pickups';
import { createStationModelImpl } from './models/stations';
import { createTerminalImpl } from './models/terminal';
import { createFlareModelImpl, createGrenadeModelImpl } from './models/small';
import { disposeModelCaches } from './models/util';

/** Frees every shared (cached) model resource. Call at application teardown. */
export { disposeModelCaches };

// ---------------------------------------------------------------------------------------------
// Helicopter
// ---------------------------------------------------------------------------------------------

export interface HelicopterState {
  /** 0..1 rotor spin (0 = stopped, 1 = full speed; blades blur into a disc above ~0.6). */
  rotor: number;
  /** Navigation / landing lights on. */
  lights: boolean;
  /** 0..1 side cargo door opening. */
  doorOpen: number;
  /** Nose-down pitch / bank in radians for flight dynamics (visual). */
  pitch?: number;
  roll?: number;
}

export interface HelicopterRig {
  root: THREE.Group;
  /** Local position of the side door threshold where the player boards (on the ground, right side). */
  doorLocal: THREE.Vector3;
  /** Local position/direction of the landing spotlight (for the game to attach a real light if it wants). */
  spotLocal: THREE.Vector3;
  update(dt: number, state: HelicopterState): void;
  dispose(): void;
}

/**
 * A believable transport helicopter (utility/medium-lift silhouette, ~15 m long fuselage, 14 m main rotor): tapered
 * fuselage, cockpit glass, tail boom with tail rotor and fin, engine housings, skids or wheels, side sliding door
 * (opening reveals an interior with seats), main rotor blades that spin (blur disc when fast), strobes (red/white
 * blinking via emissive materials), landing lights (bright emissive lenses). Fictional livery, no real insignia.
 */
export function createHelicopter(mats: MaterialLib): HelicopterRig {
  return createHelicopterImpl(mats);
}

// ---------------------------------------------------------------------------------------------
// Stations
// ---------------------------------------------------------------------------------------------

export type StationKind = 'buy' | 'upgrade';

export interface StationModel {
  root: THREE.Group;
  /** idle = ambient glow; near = brighter inviting glow when the player is within range; used = flash on purchase; denied = red flash. */
  setState(state: 'idle' | 'near' | 'used' | 'denied'): void;
  update(dt: number, time: number): void;
  /** Local position ~0.4 m above the top of the station (for a floating marker). */
  topLocal: THREE.Vector3;
  dispose(): void;
}

/**
 * Buy station: a military supply cage / vending wall - steel cage with shelves of ammo cans, plates and a shotgun
 * on a rack, a glowing green-amber terminal screen, a hazard-striped counter, canvas awning. ~3 x 1.6 m footprint, 2.6 m tall.
 * Upgrade station: an armory workbench - heavy bench with a vise and a weapon cradle, an overhead work lamp, a
 * holographic-ish amber/cyan reticle display, tool wall, anvil-like press. ~3 x 1.6 m footprint, 2.4 m tall.
 * The two must be instantly distinguishable by silhouette AND accent colour (buy = green, upgrade = amber/cyan).
 * The FRONT (where the player stands) faces local -Z. The game adds the collider itself.
 */
export function createStationModel(kind: StationKind, _mats: MaterialLib): StationModel {
  return createStationModelImpl(kind);
}

// ---------------------------------------------------------------------------------------------
// Loot crate
// ---------------------------------------------------------------------------------------------

export interface CrateModel {
  root: THREE.Group;
  /** 0 closed .. 1 fully open (hinged lid swings up). */
  setOpen(t: number): void;
  /** Marks the crate as already looted (dim, no glow). */
  setLooted(looted: boolean): void;
  /** Gentle pulsing beacon so unopened crates read from a distance (tier colour: low = white-green, medium = amber, high = red-orange). */
  update(dt: number, time: number): void;
  /** Local position ~0.5 m above the crate (floating marker anchor). */
  topLocal: THREE.Vector3;
  dispose(): void;
}

/** Military supply crate ~1.1 x 0.7 x 0.7 m with latches, stencilled markings, rope handles, tier-coloured accent strip + faint emissive beacon. Lid hinge at the back. */
export function createLootCrate(region: Region, _mats: MaterialLib): CrateModel {
  return createLootCrateImpl(region);
}

// ---------------------------------------------------------------------------------------------
// Pickups
// ---------------------------------------------------------------------------------------------

export type PickupKind = 'ammo' | 'plate' | 'grenade';

/**
 * Ground pickup, <= 0.45 m across, origin at its bottom centre, with an emissive accent so it reads at 20 m
 * (ammo = olive ammo can with brass rounds & green glow, plate = grey ceramic armour plate w/ amber edge,
 * grenade = olive frag grenade w/ red glow). The game spins and bobs it.
 */
export function createPickupModel(kind: PickupKind, _mats: MaterialLib): THREE.Object3D {
  return createPickupModelImpl(kind);
}

// ---------------------------------------------------------------------------------------------
// Extraction terminal, flare, grenade
// ---------------------------------------------------------------------------------------------

export interface TerminalModel {
  root: THREE.Group;
  /** idle = amber "AWAITING SIGNAL", called = red flashing "EXTRACTION INBOUND", done = green. */
  setState(state: 'idle' | 'called' | 'done'): void;
  update(dt: number, time: number): void;
  /** Where the flare is placed when the extraction is called (local). */
  flareLocal: THREE.Vector3;
  topLocal: THREE.Vector3;
  dispose(): void;
}

/** Radio beacon terminal: ruggedised case on legs, mast with folding antenna, dish, satchel, lit screen and buttons, ring of ground lights. ~2 m tall. */
export function createExtractionTerminal(_mats: MaterialLib): TerminalModel {
  return createTerminalImpl();
}

/** World grenade projectile (~0.09 m radius olive frag grenade with lever), origin at its centre. */
export function createGrenadeModel(_mats: MaterialLib): THREE.Object3D {
  return createGrenadeModelImpl();
}

/** Lying flare stick with glowing tip (the burning flare fx comes from the FX module). */
export function createFlareModel(_mats: MaterialLib): THREE.Object3D {
  return createFlareModelImpl();
}

// ---------------------------------------------------------------------------------------------
// Contamination wall & area marker
// ---------------------------------------------------------------------------------------------

export interface ContaminationWall {
  root: THREE.Object3D;
  /** Centre of the spreading contamination (world XZ). */
  setCenter(x: number, z: number): void;
  /** Radius of the toxic zone; the wall sits exactly at this radius. */
  setRadius(r: number): void;
  /** 0..1 visibility (fades in at surge start). */
  setIntensity(k: number): void;
  /** 0..1 how deep inside the toxic zone the camera is (valid after `update`); drives interior fog shells, usable for audio / overlays. */
  readonly insideFactor?: number;
  update(dt: number, time: number, camera: THREE.Camera): void;
  dispose(): void;
}

/**
 * The advancing contamination front: a tall (~14 m) open cylinder of churning green-tinted fog with soft gradient
 * edges (custom shader, noise-scrolled, double-sided, additive-ish but restrained so gameplay stays readable), a
 * darker toxic haze on the ground INSIDE the radius (a huge ground disc / ring so the toxic region is obvious even
 * when the wall is out of view), and a bright thin ring at the base. Must look good from both sides and from inside.
 */
export function createContaminationWall(): ContaminationWall {
  return createContaminationWallImpl();
}

export interface AreaMarker {
  root: THREE.Object3D;
  setRadius(r: number): void;
  setColor(hex: number): void;
  /** 0..1 progress sweep drawn around the ring. */
  setProgress(p: number): void;
  /** Bright when the player is inside (true), dim when outside. */
  setActive(active: boolean): void;
  update(dt: number, time: number): void;
  dispose(): void;
}

/** Objective area marker: glowing ground ring with animated dashes plus a faint vertical light curtain ~3 m high. */
export function createAreaMarker(radius: number, color: number): AreaMarker {
  return createAreaMarkerImpl(radius, color);
}

/**
 * Tall soft vertical beam (~40 m) used to mark far objectives (e.g. the LZ / extraction) in the world; additive, fog-immune.
 * Animates itself (time via onBeforeRender). Free it with `(obj.userData.dispose as () => void)()`.
 */
export function createObjectiveBeam(color: number): THREE.Object3D {
  return createObjectiveBeamImpl(color);
}
