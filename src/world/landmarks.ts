/**
 * Landmarks and large set pieces. Same conventions as `props.ts` (x/z/y/rot, long axis local +X, deterministic seeds,
 * matching colliders, merged via LevelBuilder). These are the visually distinctive things the player navigates by, so they
 * carry the most art effort. Implementations live in `./landmarks/*.ts`.
 */
import type { LevelBuilder } from './builder';
import type { Place } from './props';
import { buildCollapsedRoad, buildOverpassRuin } from './landmarks/collapse';
import { buildContainmentDome } from './landmarks/dome';
import { buildQuarantineGate } from './landmarks/gate';
import { buildHelipad } from './landmarks/helipad';
import { buildToxicPool } from './landmarks/pool';
import { buildSkylineBackdrop } from './landmarks/skyline';
import { buildSpire } from './landmarks/spire';
import { buildTransmitterSite } from './landmarks/transmitter';

export interface TransmitterHandle {
  /**
   * World position of the interaction console (the player presses E here; ~1.0 m tall panel).
   * `y` is the height of the screen centre.
   */
  console: { x: number; y: number; z: number };
  /**
   * Direction the console panel FACES (toward where the player stands), as a yaw in the game's convention
   * (forward = (-sin yaw, 0, -cos yaw)). A player standing in front of it looks along `consoleYaw + PI`.
   */
  consoleYaw: number;
  /** off = dark; ready = amber blink; active = cyan pulsing lights + spinning dish + floodlights; done = steady green. */
  setState(state: 'off' | 'ready' | 'active' | 'done'): void;
  /** 0..1 uplink progress: console progress bar + lights climbing the tower. */
  setProgress(p: number): void;
}

/**
 * The defense-contract relay: ~22 m lattice comms tower with dish and beacons, equipment shack, generators, cable runs,
 * a console table, and painted floor markings for the defense circle of `radius`. Colliders on tower base/shack/generators.
 * Looks powered-down and dead at first, then comes alive with `setState` (floodlights around the arena switch on).
 */
export function transmitterSite(b: LevelBuilder, o: Place & { radius: number }): TransmitterHandle {
  return buildTransmitterSite(b, o);
}

export interface SpireHandle {
  /** Top of the tower (for effects / beacons). */
  top: { x: number; y: number; z: number };
  /** Surge mode: glow shifts toward angry red, faster pulsing, extra beacon flashing. */
  setSurge(on: boolean): void;
}

/**
 * THE landmark: a very tall (default 58 m) lattice/spire structure with a contamination-green glowing core that
 * pulses, aircraft-warning red beacons at several heights, guy-wires, and a heavy concrete base.
 * It reads as a silhouette from 100+ m away through fog. Collider at the base only.
 */
export function spire(b: LevelBuilder, o: Place & { height?: number }): SpireHandle {
  return buildSpire(b, o);
}

/** Containment dome (radius ~9): steel-ribbed glass hemisphere on a concrete drum with glowing green interior, pipes, catwalk. Collider = ring wall + base. */
export function containmentDome(b: LevelBuilder, o: Place & { radius?: number }): void {
  buildContainmentDome(b, o);
}

/** Helipad: painted concrete disc (ring, H, chevrons), edge lights (chase pattern), windsock (tick-animated). No collider (flush) except the windsock mast. */
export function helipad(b: LevelBuilder, o: Place & { radius?: number }): void {
  buildHelipad(b, o);
}

/** Glowing toxic pool (w x d rectangle centred on x,z): kerb + railing (movement collider), emissive green liquid with animated ripple (tick), pulsing green lamp + glow. */
export function toxicPool(b: LevelBuilder, o: Place & { w: number; d: number }): void {
  buildToxicPool(b, o);
}

/** Collapsed road section: broken tilted slabs, rebar, rubble mounds, wrecked debris; blocks passage with colliders (`w` x `d` footprint). */
export function collapsedRoad(b: LevelBuilder, o: Place & { w: number; d: number; seed?: number }): void {
  buildCollapsedRoad(b, o);
}

/** Ruined elevated highway piece (deck ~7 m up on pillars, one span broken and hanging) used as a boundary landmark. `length` along local X. */
export function overpassRuin(b: LevelBuilder, o: Place & { length: number; width?: number }): void {
  buildOverpassRuin(b, o);
}

/**
 * Distant backdrop ring outside `bounds`: silhouettes of dark city blocks, industrial stacks, a few dim lit windows,
 * radio masts with red beacons (`b.glow`), and a low ridge line. Cheap merged geometry, no colliders. It sits at 20-120 m
 * beyond the bounds, inside the fog, giving the district a sense of being enclosed by a larger dead city.
 */
export function skylineBackdrop(
  b: LevelBuilder,
  o: { bounds: { minX: number; maxX: number; minZ: number; maxZ: number }; seed?: number },
): void {
  buildSkylineBackdrop(b, o);
}

/**
 * Quarantine checkpoint gate: two concrete/steel gate posts with a sliding steel gate (`open` 0..1 of the gap width),
 * hazard signage, floodlights and a booth. The gate leaf, when partially open, keeps a >= 3 m passable gap.
 * `width` = clear opening between the posts across local X.
 */
export function quarantineGate(b: LevelBuilder, o: Place & { width: number; open?: number }): void {
  buildQuarantineGate(b, o);
}
