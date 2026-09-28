/** Gameplay-facing description of the level (positions of stations, crates, spawn points, contract sites...). */
import type { Region, ZombieType } from '../../types';
import type { MapData } from '../../ui/hudTypes';

export interface StationDef {
  id: string;
  kind: 'buy' | 'upgrade';
  name: string;
  x: number;
  z: number;
  /** Yaw of the model (front faces the player). */
  yaw: number;
  region: Region;
}

export interface CrateDef {
  id: string;
  x: number;
  z: number;
  yaw: number;
  region: Region;
}

export type SpawnGroup = 'general' | 'lz' | 'defense';

export interface SpawnPoint {
  x: number;
  z: number;
  region: Region;
  group: SpawnGroup;
  /** Relative preference. */
  weight: number;
}

export interface AmbientZombieDef {
  x: number;
  z: number;
  type: Exclude<ZombieType, 'warden'>;
  region: Region;
}

export interface LevelData {
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  playerStart: { x: number; z: number; yaw: number };
  stations: StationDef[];
  crates: CrateDef[];
  spawnPoints: SpawnPoint[];
  ambient: AmbientZombieDef[];
  /** Defense contract: transmitter site. */
  defense: { x: number; z: number; radius: number };
  /** Hunt contract: where the Warden idles and the drawn search area. */
  hunt: { wardenX: number; wardenZ: number; searchX: number; searchZ: number; searchRadius: number };
  extraction: {
    lzX: number;
    lzZ: number;
    /** Radius within which the extraction may be called. */
    lzRadius: number;
    /** Radio terminal. */
    terminalX: number;
    terminalZ: number;
    terminalYaw: number;
    /** Helicopter touchdown centre and heading. */
    heliX: number;
    heliZ: number;
    heliYaw: number;
    /** Where the helicopter appears / departs (world XZ, high above). */
    heliFrom: { x: number; y: number; z: number };
  };
  /** Contamination source. */
  hazardCenter: { x: number; z: number };
  regionRects: { region: Region; x0: number; z0: number; x1: number; z1: number }[];
  map: MapData;
}

export function regionAtRects(rects: LevelData['regionRects'], x: number, z: number): Region {
  for (const r of rects) if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return r.region;
  return 'low';
}

export function yawFacing(fx: number, fz: number): number {
  return Math.atan2(-fx, -fz);
}

/** Collects gameplay data while the level is being assembled. */
export class LevelDataBuilder {
  stations: StationDef[] = [];
  crates: CrateDef[] = [];
  spawnPoints: SpawnPoint[] = [];
  ambient: AmbientZombieDef[] = [];
  roads: MapData['roads'] = [];
  labels: MapData['labels'] = [];
  regionRects: LevelData['regionRects'] = [];

  station(def: Omit<StationDef, 'id'>): StationDef {
    const s = { ...def, id: `${def.kind}-${this.stations.filter((x) => x.kind === def.kind).length + 1}` };
    this.stations.push(s);
    return s;
  }

  crate(x: number, z: number, yaw: number, region: Region): void {
    this.crates.push({ id: `crate-${this.crates.length + 1}`, x, z, yaw, region });
  }

  spawn(region: Region, group: SpawnGroup, pts: [number, number][], weight = 1): void {
    for (const [x, z] of pts) this.spawnPoints.push({ x, z, region, group, weight });
  }

  zombies(region: Region, type: AmbientZombieDef['type'], pts: [number, number][]): void {
    for (const [x, z] of pts) this.ambient.push({ x, z, type, region });
  }

  road(x0: number, z0: number, x1: number, z1: number, name?: string): void {
    this.roads.push({ x0, z0, x1, z1, name });
  }

  label(text: string, x: number, z: number, size = 1): void {
    this.labels.push({ text, x, z, size });
  }
}
