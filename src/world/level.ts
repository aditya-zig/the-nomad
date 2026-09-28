/**
 * Level assembly: builds the whole district (static geometry, colliders, lights) from the layout modules and exposes the
 * gameplay data (stations, crates, spawn points, contract sites, extraction geometry, map data).
 */
import * as THREE from 'three';
import { Rng } from '../logic/rng';
import type { Region, SurfaceKind } from '../types';
import type { MapData, MapFootprint } from '../ui/hudTypes';
import { LevelBuilder, type LampSpec } from './builder';
import { CollisionWorld } from './collision';
import type { GlowField } from './glow';
import type { SpireHandle, TransmitterHandle } from './landmarks';
import { LevelDataBuilder, regionAtRects, yawFacing, type LevelData } from './layout/data';
import { buildCompound, COMPOUND } from './layout/compound';
import { buildDepot, DEPOT } from './layout/depot';
import { buildLandingZone, buildNorthStrip, LZ } from './layout/northwest';
import { buildRoads } from './layout/roads';
import { buildApartments, buildCheckpoint, buildCornerStore, buildParkingLot } from './layout/southwest';
import type { Ctx } from './layout/util';
import type { MaterialLib } from './materials';
import { FlowField, NavGrid, UNREACHABLE } from './nav';

export const WORLD_BOUNDS = { minX: -66, maxX: 66, minZ: -52, maxZ: 52 };

export interface PlacementReport {
  moved: string[];
  dropped: string[];
}

export interface Level {
  /** What the placement validator had to move / drop (diagnostics). */
  placement: PlacementReport;
  root: THREE.Group;
  world: CollisionWorld;
  nav: NavGrid;
  data: LevelData;
  lights: LampSpec[];
  glowField: GlowField | null;
  transmitter: TransmitterHandle;
  spire: SpireHandle;
  stats: LevelBuilder['stats'];
  regionAt(x: number, z: number): Region;
  /** Advance level animations (blinking beacons, spinning dishes, windsock...). */
  update(dt: number, time: number, viewportHeightPx: number, fovDeg: number): void;
  dispose(): void;
}

export function buildLevel(mats: MaterialLib): Level {
  const world = new CollisionWorld(WORLD_BOUNDS);
  const b = new LevelBuilder(mats, world);
  const d = new LevelDataBuilder();
  const c: Ctx = { b, d, rng: new Rng(20240928), mats, placed: [] };

  buildRoads(c);
  buildCheckpoint(c);
  buildCornerStore(c);
  buildParkingLot(c);
  buildApartments(c);
  buildLandingZone(c);
  buildNorthStrip(c);
  const depot = buildDepot(c);
  const compound = buildCompound(c);
  b.finalize();

  // ---- gameplay placement validation ----
  // Hand-placed coordinates can collide with procedurally scattered props or land in sealed pockets, so every gameplay point
  // (crates, stations, spawn points, ambient infected) is verified against the REAL collision / navigation data and snapped
  // to the nearest free, reachable ground before anything else is built on it. Crates and stations are also rejected where
  // they would seal a corridor (a 1 m crate in a 2.5 m alley can cut a street in two).
  const report: PlacementReport = { moved: [], dropped: [] };
  const navStatic = new NavGrid(WORLD_BOUNDS, world);
  const reach = new FlowField(navStatic);
  const st0 = { x: -51, z: 43.5 };
  reach.compute(st0.x, st0.z);
  const freeReachable = (x: number, z: number): boolean => !navStatic.isBlockedAt(x, z) && reach.isReachable(x, z);
  const countReachable = (): number => {
    let n = 0;
    const dist = reach.dist;
    for (let i = 0; i < dist.length; i++) if (dist[i] !== UNREACHABLE) n++;
    return n;
  };
  /** Block the cells covered by an (inflated) box in the placement grid; returns the cells that changed. */
  const rasterize = (cx: number, cz: number, hx: number, hz: number, rot: number, inflate = 0.42): number[] => {
    const changed: number[] = [];
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const ex = Math.abs(cos) * hx + Math.abs(sin) * hz + inflate;
    const ez = Math.abs(sin) * hx + Math.abs(cos) * hz + inflate;
    const i0 = Math.max(0, Math.floor((cx - ex - navStatic.minX) / navStatic.cell));
    const i1 = Math.min(navStatic.cols - 1, Math.floor((cx + ex - navStatic.minX) / navStatic.cell));
    const j0 = Math.max(0, Math.floor((cz - ez - navStatic.minZ) / navStatic.cell));
    const j1 = Math.min(navStatic.rows - 1, Math.floor((cz + ez - navStatic.minZ) / navStatic.cell));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const x = navStatic.minX + (i + 0.5) * navStatic.cell;
        const z = navStatic.minZ + (j + 0.5) * navStatic.cell;
        const dx = x - cx;
        const dz = z - cz;
        const lx = Math.abs(cos * dx - sin * dz);
        const lz = Math.abs(sin * dx + cos * dz);
        const qx = Math.max(lx - hx, 0);
        const qz = Math.max(lz - hz, 0);
        if (qx * qx + qz * qz <= inflate * inflate) {
          const idx = j * navStatic.cols + i;
          if (navStatic.blocked[idx] === 0) {
            navStatic.blocked[idx] = 1;
            changed.push(idx);
          }
        }
      }
    }
    return changed;
  };
  const findSpot = (x: number, z: number, maxR: number, ok: (px: number, pz: number) => boolean): { x: number; z: number } | null => {
    if (ok(x, z)) return { x, z };
    for (let r = 0.5; r <= maxR; r += 0.5) {
      const n = Math.max(8, Math.round(r * 8));
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        const px = x + Math.cos(a) * r;
        const pz = z + Math.sin(a) * r;
        if (ok(px, pz)) return { x: px, z: pz };
      }
    }
    return null;
  };
  const front = (yaw: number, dist: number): [number, number] => [-Math.sin(yaw) * dist, -Math.cos(yaw) * dist];
  const placeProp = (kind: string, id: string, x: number, z: number, yaw: number, hx: number, hz: number, height: number, approach: number, tag: string): { x: number; z: number; yaw: number } => {
    const yaws = [yaw, yaw + Math.PI / 2, yaw - Math.PI / 2, yaw + Math.PI];
    const base = countReachable();
    const radius = Math.max(hx, hz) + 0.15;
    const tryAt = (px: number, pz: number): { x: number; z: number; yaw: number } | null => {
      if (world.circleBlocked(px, pz, radius, 0.05, 1.7)) return null;
      for (const yw of yaws) {
        const [fx, fz] = front(yw, approach);
        if (!freeReachable(px + fx, pz + fz)) continue;
        const changed = rasterize(px, pz, hx, hz, yw);
        reach.compute(st0.x, st0.z);
        const ok = countReachable() >= base - changed.length - 24 && reach.isReachable(px + fx, pz + fz);
        if (ok) return { x: px, z: pz, yaw: yw };
        for (const c of changed) navStatic.blocked[c] = 0;
      }
      return null;
    };
    let found: { x: number; z: number; yaw: number } | null = null;
    const cands: [number, number][] = [[x, z]];
    for (let r = 0.5; r <= 8 && cands.length < 400; r += 0.5) {
      const n = Math.max(8, Math.round(r * 6));
      for (let k = 0; k < n; k++) cands.push([x + Math.cos((k / n) * Math.PI * 2) * r, z + Math.sin((k / n) * Math.PI * 2) * r]);
    }
    for (const [cx, cz] of cands) {
      found = tryAt(cx, cz);
      if (found) break;
    }
    if (!found) {
      report.dropped.push(`${kind} ${id} kept at (${x.toFixed(1)}, ${z.toFixed(1)}) - no free spot found`);
      reach.compute(st0.x, st0.z);
      found = { x, z, yaw };
    } else {
      if (Math.hypot(found.x - x, found.z - z) > 0.4) report.moved.push(`${kind} ${id}: (${x.toFixed(1)}, ${z.toFixed(1)}) -> (${found.x.toFixed(1)}, ${found.z.toFixed(1)})`);
      // the accepted candidate is already rasterized; make its collider real and refresh reachability
      world.add({ x: found.x, z: found.z, hx, hz, rot: found.yaw, y1: height, mapKind: 'prop', tag, surface: 'metal' });
      reach.compute(st0.x, st0.z);
    }
    return found;
  };
  // stations first (largest), then crates; colliders are added as each is accepted so later checks see them
  for (const stn of d.stations) {
    const r = placeProp('station', stn.id, stn.x, stn.z, stn.yaw, 1.5, 0.8, 2.4, 2.0, 'station');
    stn.x = r.x;
    stn.z = r.z;
    stn.yaw = r.yaw;
  }
  for (const cr of d.crates) {
    const r = placeProp('crate', cr.id, cr.x, cr.z, cr.yaw, 0.55, 0.35, 0.72, 1.4, 'crate');
    cr.x = r.x;
    cr.z = r.z;
    cr.yaw = r.yaw;
  }
  world.add({ x: LZ.terminalX, z: LZ.terminalZ, hx: 0.5, hz: 0.5, y1: 1.3, mapKind: 'prop', tag: 'terminal', surface: 'metal' });
  rasterize(LZ.terminalX, LZ.terminalZ, 0.5, 0.5, 0);
  reach.compute(st0.x, st0.z);
  // spawn points and ambient infected: nearest free, reachable ground (keeps clear of the props just added)
  const clearOfProps = (x: number, z: number): boolean => freeReachable(x, z) && !world.circleBlocked(x, z, 0.7, 0.05, 1.7);
  const snapList = <T extends { x: number; z: number }>(list: T[], label: string): T[] => {
    const out: T[] = [];
    list.forEach((p, i) => {
      const spot = findSpot(p.x, p.z, 9, clearOfProps);
      if (!spot) {
        report.dropped.push(`${label}${i} dropped at (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`);
        return;
      }
      if (Math.hypot(spot.x - p.x, spot.z - p.z) > 0.4) report.moved.push(`${label}${i}: (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) -> (${spot.x.toFixed(1)}, ${spot.z.toFixed(1)})`);
      p.x = spot.x;
      p.z = spot.z;
      out.push(p);
    });
    return out;
  };
  d.spawnPoints = snapList(d.spawnPoints, 'spawn');
  d.ambient = snapList(d.ambient, 'ambient');

  const nav = new NavGrid(WORLD_BOUNDS, world);

  // ---- minimap / tactical map data straight from the real colliders ----
  const footprints: MapFootprint[] = [];
  for (const col of world.colliders) {
    if (col.mapKind === 'none' || col.tag === 'roof' || col.tag === 'window') continue;
    const w = col.hx * 2;
    const dd = col.hz * 2;
    if (col.mapKind === 'prop' && Math.max(w, dd) < 0.9) continue;
    if (col.y1 < 0.3 && col.mapKind !== 'building') continue;
    footprints.push({ x: col.cx, z: col.cz, hx: col.hx, hz: col.hz, rot: col.rot, kind: col.mapKind });
  }
  const map: MapData = {
    bounds: { ...WORLD_BOUNDS },
    roads: d.roads,
    regions: d.regionRects,
    footprints,
    labels: d.labels,
  };

  const lzYaw = 0;
  const data: LevelData = {
    bounds: { ...WORLD_BOUNDS },
    playerStart: { x: -51, z: 43.5, yaw: yawFacing(0.83, -0.55) },
    stations: d.stations,
    crates: d.crates,
    spawnPoints: d.spawnPoints,
    ambient: d.ambient,
    defense: { x: DEPOT.arena.x, z: DEPOT.arena.z, radius: DEPOT.arena.radius },
    hunt: { wardenX: COMPOUND.wardenX, wardenZ: COMPOUND.wardenZ, searchX: 30, searchZ: -36, searchRadius: 26 },
    extraction: {
      lzX: LZ.x,
      lzZ: LZ.z,
      lzRadius: LZ.radius,
      terminalX: LZ.terminalX,
      terminalZ: LZ.terminalZ,
      terminalYaw: yawFacing(-0.9, 0.35),
      heliX: LZ.x,
      heliZ: LZ.z,
      heliYaw: lzYaw,
      heliFrom: { x: LZ.x + 70, y: 48, z: LZ.z - 70 },
    },
    hazardCenter: { x: COMPOUND.spire.x, z: COMPOUND.spire.z },
    regionRects: d.regionRects,
    map,
  };

  world.groundSurface = (x: number, z: number): SurfaceKind => {
    // outside the paved blocks the ground is dirt
    if (Math.abs(x) > 65 || Math.abs(z) > 51) return 'dirt';
    return 'concrete';
  };

  const ticks = b.ticks;
  const level: Level = {
    root: b.root,
    world,
    nav,
    data,
    lights: b.lights,
    glowField: b.glowField,
    transmitter: depot.transmitter,
    spire: compound.spire,
    stats: b.stats,
    placement: report,
    regionAt: (x, z) => regionAtRects(data.regionRects, x, z),
    update(dt, time, viewportHeightPx, fovDeg) {
      for (let i = 0; i < ticks.length; i++) ticks[i]!(dt, time);
      b.glowField?.update(time, viewportHeightPx, fovDeg);
    },
    dispose() {
      b.glowField?.dispose();
      b.root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.geometry.dispose();
      });
    },
  };
  return level;
}
